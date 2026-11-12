-- Every automatic alert now goes through one outbox, so the list of alerts lives in one place.
-- Allowed alerts (Nov 12, 2026):
--   note_submitted        excused note submitted            -> email Sandy + Donald (setting note_alert_emails)
--   note_approved         excused note approved by office   -> push to the parent who sent it
--   transport_approved    dismissal change approved         -> push + email to the parent who sent it
--   transport_rejected    dismissal change rejected         -> push + email to the parent, email Donald (setting reject_alert_emails)
--   pickup_approved       pick-up person approved            -> push + email to the parent who sent it
--   pickup_rejected       pick-up person rejected            -> push + email to the parent who sent it
--   late_in / early_out   student signed in late / out early -> push to the student's parents
-- Sent by /api/outbox (Vercel). Nothing is sent while alerts are paused (those rows are marked skipped).
-- (Transportation change submitted and pick-up person added/removed are emailed to Admin + Office straight from /api/parent;
--  sign-in codes are sent by /api/auth.)

create table if not exists public.portal_outbox (
  id bigserial primary key,
  kind text not null,
  ref text,
  student_id bigint,
  push_ids text[] not null default '{}',       -- parent sign-ins (phone/email) whose phones get the push
  push_student bigint,                          -- or: every parent of this student
  push_title text, push_body text, push_url text default '/',
  email_to text[] not null default '{}',
  email_subject text, email_title text, email_rows jsonb, email_note text, email_link text,
  created_at timestamptz not null default now(),
  tries int not null default 0,
  taken_at timestamptz,
  sent_at timestamptz,
  result jsonb
);
alter table public.portal_outbox enable row level security;
create index if not exists portal_outbox_pending on public.portal_outbox (id) where sent_at is null;
create unique index if not exists portal_outbox_once on public.portal_outbox (kind, ref) where ref is not null;

alter table public.portal_transport_changes add column if not exists review_note text;
alter table public.portal_pickup_requests add column if not exists review_note text;
alter table public.portal_pickup_requests drop constraint if exists portal_pickup_requests_status_check;
alter table public.portal_pickup_requests add constraint portal_pickup_requests_status_check check (status in ('active','cancelled','rejected'));

insert into public.portal_settings(key, value, updated_by) values
  ('note_alert_emails', '["snones@csjax.org","dcorley@csjax.org"]', 'setup'),
  ('reject_alert_emails', '["dcorley@csjax.org"]', 'setup')
on conflict (key) do nothing;

-- ---------- helpers ----------
create or replace function private.portal_setting_emails(p_key text) returns text[]
language sql stable security definer set search_path to '' as $$
  select coalesce(array(select jsonb_array_elements_text(value) from public.portal_settings where key = p_key), '{}');
$$;

-- Emails for "the parent": the sign-in they used if it is an email, otherwise the email on file for that phone under the student.
create or replace function private.portal_parent_emails(p_id text, p_sid bigint) returns text[]
language sql stable security definer set search_path to '' as $$
  select case when p_id like '%@%' then array[lower(p_id)] else coalesce(array(
    select distinct lower(e) from (
      select g.email e from public.portal_guardians g where g.student_id = p_sid and g.phone10 = p_id and g.email like '%@%'
      union select pp.email from public.portal_pickups_eff pp where pp.student_id = p_sid and public.portal_norm_id(pp.phone) = p_id and pp.email like '%@%'
    ) x), '{}') end;
$$;

create or replace function private.portal_first(p_sid bigint) returns text
language sql stable security definer set search_path to '' as $$ select first_name from public.portal_students where student_id = p_sid $$;
create or replace function private.portal_full(p_sid bigint) returns text
language sql stable security definer set search_path to '' as $$ select first_name||' '||last_name from public.portal_students where student_id = p_sid $$;
create or replace function private.portal_day(d date) returns text
language sql stable as $$ select to_char(d, 'Dy, Mon FMDD') $$;

create or replace function private.portal_outbox_add(p jsonb) returns void
language plpgsql security definer set search_path to '' as $$
begin
  insert into public.portal_outbox(kind, ref, student_id, push_ids, push_student, push_title, push_body, push_url,
    email_to, email_subject, email_title, email_rows, email_note, email_link)
  values (p->>'kind', p->>'ref', (p->>'student_id')::bigint,
    coalesce(array(select jsonb_array_elements_text(p->'push_ids')), '{}'), (p->>'push_student')::bigint,
    p->>'push_title', p->>'push_body', coalesce(p->>'push_url', '/'),
    coalesce(array(select jsonb_array_elements_text(p->'email_to')), '{}'), p->>'email_subject', p->>'email_title', p->'email_rows', p->>'email_note', p->>'email_link')
  on conflict (kind, ref) where ref is not null do nothing;
end $$;

-- Wake the sender right away (pg_net sends after this transaction commits); a cron job retries anything left over.
create or replace function private.portal_outbox_kick() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  perform net.http_post(url := 'https://portal.csjax.org/api/outbox',
    headers := jsonb_build_object('Content-Type','application/json','x-import-key',(select value from private.config where key='portal_import_key')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
  return null;
end $$;
drop trigger if exists portal_outbox_kick on public.portal_outbox;
create trigger portal_outbox_kick after insert on public.portal_outbox for each statement execute function private.portal_outbox_kick();

create or replace function private.portal_outbox_tick() returns void
language plpgsql security definer set search_path to '' as $$
begin
  if exists(select 1 from public.portal_outbox where sent_at is null and tries < 5 and (taken_at is null or taken_at < now() - interval '2 minutes')) then
    perform net.http_post(url := 'https://portal.csjax.org/api/outbox',
      headers := jsonb_build_object('Content-Type','application/json','x-import-key',(select value from private.config where key='portal_import_key')),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  end if;
end $$;
select cron.unschedule(jobid) from cron.job where jobname = 'portal-outbox';
select cron.schedule('portal-outbox', '* * * * *', 'select private.portal_outbox_tick();');

-- ---------- sender API (called by /api/outbox with the portal API key) ----------
create or replace function public.portal_outbox_take(p_key text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v jsonb; v_ids bigint[];
begin
  if not private.portal_key_ok(p_key) then raise exception 'forbidden'; end if;
  if private.portal_alerts_paused() then
    update public.portal_outbox set sent_at = now(), result = '{"skipped":"alerts_paused"}' where sent_at is null;
    return jsonb_build_object('items', '[]'::jsonb);
  end if;
  with t as (
    select id from public.portal_outbox where sent_at is null and tries < 5 and (taken_at is null or taken_at < now() - interval '2 minutes')
    order by id limit 50 for update skip locked),
  u as (update public.portal_outbox o set tries = o.tries + 1, taken_at = clock_timestamp() from t where o.id = t.id returning o.id)
  select array_agg(id) into v_ids from u;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'push_title', o.push_title, 'push_body', o.push_body, 'push_url', o.push_url,
      'email_to', to_jsonb(o.email_to), 'email_subject', o.email_subject, 'email_title', o.email_title, 'email_rows', o.email_rows,
      'email_note', o.email_note, 'email_link', o.email_link,
      'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
        from public.portal_push_subs s
        where o.push_title is not null and (s.identifier = any(o.push_ids)
          or (o.push_student is not null and o.push_student in (select private.portal_student_ids(s.identifier))))), '[]'::jsonb)
    ) order by o.id), '[]') into v
  from public.portal_outbox o where o.id = any(coalesce(v_ids, '{}'));
  return jsonb_build_object('items', v,
    'vapid', (select jsonb_object_agg(key, value) from private.config where key in ('vapid_public','vapid_private','vapid_subject')));
end $$;

create or replace function public.portal_outbox_done(p_key text, p_id bigint, p_result jsonb, p_gone text[] default '{}', p_ok boolean default true) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not private.portal_key_ok(p_key) then raise exception 'forbidden'; end if;
  update public.portal_outbox set result = p_result, sent_at = case when p_ok then now() end, taken_at = null where id = p_id;
  if coalesce(array_length(p_gone, 1), 0) > 0 then delete from public.portal_push_subs where endpoint = any(p_gone); end if;
end $$;
-- Guarded by the portal API key (same as the other server-only portal_* functions).

-- ---------- events ----------
-- Excused notes: submitted -> email Sandy + Donald; approved -> push to the parent.
create or replace function private.portal_note_alerts() returns trigger
language plpgsql security definer set search_path to '' as $$
declare dates text := private.portal_day(new.absent_date) || coalesce(' – ' || private.portal_day(new.absent_end), '');
begin
  if tg_op = 'INSERT' then
    perform private.portal_outbox_add(jsonb_build_object('kind', 'note_submitted', 'ref', new.id, 'student_id', new.student_id,
      'email_to', to_jsonb(private.portal_setting_emails('note_alert_emails')),
      'email_subject', 'Excused note submitted — ' || private.portal_full(new.student_id) || ' — ' || dates,
      'email_title', case when new.kind = 'doctor' then 'Doctor''s note submitted' else 'Excused note submitted' end,
      'email_rows', jsonb_build_array(
        jsonb_build_array('Student', private.portal_full(new.student_id) || ' (ID ' || new.student_id || ')'),
        jsonb_build_array('Type', case when new.kind = 'doctor' then 'Doctor''s note' else 'Note from home' end),
        jsonb_build_array('Absent', dates),
        jsonb_build_array('Reason', coalesce(new.reason_other, new.reason, '—')),
        jsonb_build_array('Submitted by', coalesce(new.parent_name, '') || ' (' || new.submitted_by || ')')),
      'email_note', 'Review it on the office portal under Excused Notes.', 'email_link', '/office'));
  elsif new.status = 'approved' and old.status is distinct from 'approved' then
    perform private.portal_outbox_add(jsonb_build_object('kind', 'note_approved', 'ref', new.id, 'student_id', new.student_id,
      'push_ids', jsonb_build_array(new.submitted_by), 'push_url', '/#history',
      'push_title', 'Absence Excused',
      'push_body', private.portal_first(new.student_id) || '''s absence on ' || dates || ' was marked excused.'));
  end if;
  return null;
end $$;
drop trigger if exists portal_note_alerts on public.portal_notes;
create trigger portal_note_alerts after insert or update of status on public.portal_notes for each row execute function private.portal_note_alerts();

-- Dismissal changes sent by a parent: approved (Processed) / rejected (Cancelled) by the office.
create or replace function private.portal_transport_alerts() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_first text := private.portal_first(new.student_id); v_when text; v_rows jsonb; v_ok boolean;
begin
  if new.source is distinct from 'parent' or new.status = old.status or new.status not in ('processed','cancelled') then return null; end if;
  v_ok := new.status = 'processed';
  v_when := case new.change_type when 'date_range' then private.portal_day(new.start_date) || ' – ' || private.portal_day(new.end_date)
    when 'permanent' then 'starting ' || private.portal_day(new.start_date) else private.portal_day(new.start_date) end;
  v_rows := jsonb_build_array(
    jsonb_build_array('Student', private.portal_full(new.student_id)),
    jsonb_build_array('When', v_when),
    jsonb_build_array('Change to', concat_ws(' — ', new.new_method, new.new_details)),
    jsonb_build_array('Status', case when v_ok then 'Approved' else 'Not approved' end))
    || case when new.review_note is not null then jsonb_build_array(jsonb_build_array('Office note', new.review_note)) else '[]' end;
  perform private.portal_outbox_add(jsonb_build_object('kind', case when v_ok then 'transport_approved' else 'transport_rejected' end,
    'ref', new.id, 'student_id', new.student_id,
    'push_ids', jsonb_build_array(new.submitted_by),
    'push_title', case when v_ok then 'Dismissal Change Approved' else 'Dismissal Change Not Approved' end,
    'push_body', v_first || '''s change to ' || new.new_method || ' (' || v_when || ') was ' || case when v_ok then 'approved.' else 'not approved. Please call the front office.' end,
    'email_to', to_jsonb(private.portal_parent_emails(new.submitted_by, new.student_id)),
    'email_subject', case when v_ok then 'Dismissal change approved — ' else 'Dismissal change not approved — ' end || private.portal_full(new.student_id),
    'email_title', case when v_ok then 'Dismissal change approved' else 'Dismissal change not approved' end,
    'email_rows', v_rows,
    'email_note', case when v_ok then 'The front office has updated your student''s dismissal.' else 'Please call the front office at (904) 730-5500 if you have questions.' end));
  if not v_ok then
    perform private.portal_outbox_add(jsonb_build_object('kind', 'transport_rejected_staff', 'ref', new.id, 'student_id', new.student_id,
      'email_to', to_jsonb(private.portal_setting_emails('reject_alert_emails')),
      'email_subject', 'Dismissal change rejected — ' || private.portal_full(new.student_id),
      'email_title', 'Dismissal change rejected',
      'email_rows', v_rows || jsonb_build_array(jsonb_build_array('Submitted by', coalesce(new.submitted_name, '') || ' (' || new.submitted_by || ')'),
        jsonb_build_array('Rejected by', coalesce(new.processed_by, ''))),
      'email_link', '/office#transport'));
  end if;
  return null;
end $$;
drop trigger if exists portal_transport_alerts on public.portal_transport_changes;
create trigger portal_transport_alerts after update of status on public.portal_transport_changes for each row execute function private.portal_transport_alerts();

-- Pick-up people added/removed by a parent: approved (checked off) / rejected by the office.
create or replace function private.portal_pickup_alerts() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_who text := concat_ws(' ', new.first_name, new.last_name); v_ok boolean; v_what text;
begin
  if new.source is distinct from 'parent' then return null; end if;
  if new.status = 'rejected' and old.status is distinct from 'rejected' then v_ok := false;
  elsif new.sis_done and not old.sis_done and new.status = 'active' then v_ok := true;
  else return null; end if;
  v_what := case when new.action = 'add' then 'add ' else 'remove ' end || v_who || case when new.action = 'add' then ' to ' else ' from ' end
    || private.portal_first(new.student_id) || '''s pick-up list';
  perform private.portal_outbox_add(jsonb_build_object('kind', case when v_ok then 'pickup_approved' else 'pickup_rejected' end,
    'ref', new.id, 'student_id', new.student_id,
    'push_ids', jsonb_build_array(new.submitted_by),
    'push_title', case when v_ok then 'Pick-Up Person Approved' else 'Pick-Up Person Not Approved' end,
    'push_body', 'Your request to ' || v_what || ' was ' || case when v_ok then 'approved.' else 'not approved. Please call the front office.' end,
    'email_to', to_jsonb(private.portal_parent_emails(new.submitted_by, new.student_id)),
    'email_subject', case when v_ok then 'Pick-up person approved — ' else 'Pick-up person not approved — ' end || private.portal_full(new.student_id),
    'email_title', case when v_ok then 'Pick-up person approved' else 'Pick-up person not approved' end,
    'email_rows', jsonb_build_array(
      jsonb_build_array('Student', private.portal_full(new.student_id)),
      jsonb_build_array('Request', case when new.action = 'add' then 'Add ' else 'Remove ' end || v_who),
      jsonb_build_array('Status', case when v_ok then 'Approved' else 'Not approved' end))
      || case when new.review_note is not null then jsonb_build_array(jsonb_build_array('Office note', new.review_note)) else '[]' end,
    'email_note', case when v_ok then '' else 'Please call the front office at (904) 730-5500 if you have questions.' end));
  return null;
end $$;
drop trigger if exists portal_pickup_alerts on public.portal_pickup_requests;
create trigger portal_pickup_alerts after update of sis_done, status on public.portal_pickup_requests for each row execute function private.portal_pickup_alerts();

-- Late sign-in / early sign-out -> push to the student's parents.
create or replace function private.portal_signin_alerts() returns trigger
language plpgsql security definer set search_path to '' as $$
declare t text := to_char(new.created_at at time zone 'America/New_York', 'FMHH12:MI AM');
begin
  if new.kind not in ('late_in','early_out') then return null; end if;
  perform private.portal_outbox_add(jsonb_build_object('kind', new.kind, 'ref', new.id, 'student_id', new.student_id,
    'push_student', new.student_id,
    'push_title', case when new.kind = 'late_in' then 'Signed In Late' else 'Signed Out Early' end,
    'push_body', private.portal_first(new.student_id) || case when new.kind = 'late_in' then ' was signed in late at ' || t || '.'
      else ' was signed out early at ' || t || coalesce(' by ' || nullif(new.person_name, ''), '') || '.' end));
  return null;
end $$;
drop trigger if exists portal_signin_alerts on public.portal_signins;
create trigger portal_signin_alerts after insert on public.portal_signins for each row execute function private.portal_signin_alerts();

-- ---------- office actions ----------
drop function if exists public.staff_transport_set(uuid, text);
create or replace function public.staff_transport_set(p_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_staff_guard();
begin
  if p_status not in ('new','processed','cancelled') then raise exception 'bad_status'; end if;
  update public.portal_transport_changes set status = p_status,
    review_note = case when p_status = 'cancelled' then nullif(btrim(left(p_note, 500)), '') else review_note end,
    processed_by = case when p_status='new' then null else e end, processed_at = case when p_status='new' then null else now() end
  where id = p_id;
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;
grant execute on function public.staff_transport_set(uuid, text, text) to authenticated;

-- Reject a parent's pick-up request: an added person comes off the list, a removed person goes back on.
create or replace function public.staff_pickup_reject(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_staff_guard();
begin
  update public.portal_pickup_requests set status = 'rejected', review_note = nullif(btrim(left(p_note, 500)), ''),
    sis_done = true, sis_by = e, sis_at = now()
  where id = p_id and status = 'active';
  if not found then raise exception 'This request can no longer be rejected.'; end if;
end $$;
grant execute on function public.staff_pickup_reject(uuid, text) to authenticated;

-- Staff alert emails go to everyone with the Admin or Office role.
create or replace function public.portal_staff_alert_emails(p_key text) returns text[]
language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.portal_key_ok(p_key) then raise exception 'forbidden'; end if;
  return array(select email from public.portal_staff where active and roles && array['admin','office'] order by email);
end $$;
