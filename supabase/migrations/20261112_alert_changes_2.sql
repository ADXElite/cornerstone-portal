-- Alert changes, Nov 12 2026 (evening):
--  * Staff phone numbers (for texts to the office).
--  * BANNED person at the kiosk -> email + text to Admin/Office staff.
--  * Excused note not approved -> email to the parent with the office's note.
--  * Roster import failure -> email to Donald only (setting import_alert_emails).
--  * Manual parent messages -> push (as before) + email + text to the families picked.
-- Texts are sent by /api/outbox through Twilio (needs TWILIO_SMS_FROM on Vercel).

alter table public.portal_staff add column if not exists phone text;
alter table public.portal_outbox add column if not exists sms_to text[] not null default '{}';
alter table public.portal_outbox add column if not exists sms_body text;

insert into public.portal_settings(key, value, updated_by) values ('import_alert_emails', '["dcorley@csjax.org"]', 'setup')
on conflict (key) do nothing;

create or replace function private.portal_outbox_add(p jsonb) returns void
language plpgsql security definer set search_path to '' as $$
begin
  insert into public.portal_outbox(kind, ref, student_id, push_ids, push_student, push_title, push_body, push_url,
    email_to, email_subject, email_title, email_rows, email_note, email_link, sms_to, sms_body)
  values (p->>'kind', p->>'ref', (p->>'student_id')::bigint,
    coalesce(array(select jsonb_array_elements_text(p->'push_ids')), '{}'), (p->>'push_student')::bigint,
    p->>'push_title', p->>'push_body', coalesce(p->>'push_url', '/'),
    coalesce(array(select jsonb_array_elements_text(p->'email_to')), '{}'), p->>'email_subject', p->>'email_title', p->'email_rows', p->>'email_note', p->>'email_link',
    coalesce(array(select jsonb_array_elements_text(p->'sms_to')), '{}'), p->>'sms_body')
  on conflict (kind, ref) where ref is not null do nothing;
end $$;

-- Sender: also hand back texts.
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
    select id from public.portal_outbox where sent_at is null and tries < 5 and (taken_at is null or taken_at < now() - interval '5 minutes')
    order by id limit 20 for update skip locked),
  u as (update public.portal_outbox o set tries = o.tries + 1, taken_at = clock_timestamp() from t where o.id = t.id returning o.id)
  select array_agg(id) into v_ids from u;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'push_title', o.push_title, 'push_body', o.push_body, 'push_url', o.push_url,
      'email_to', to_jsonb(o.email_to), 'email_subject', o.email_subject, 'email_title', o.email_title, 'email_rows', o.email_rows,
      'email_note', o.email_note, 'email_link', o.email_link, 'sms_to', to_jsonb(o.sms_to), 'sms_body', o.sms_body,
      'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
        from public.portal_push_subs s
        where o.push_title is not null and (s.identifier = any(o.push_ids)
          or (o.push_student is not null and o.push_student in (select private.portal_student_ids(s.identifier))))), '[]'::jsonb)
    ) order by o.id), '[]') into v
  from public.portal_outbox o where o.id = any(coalesce(v_ids, '{}'));
  return jsonb_build_object('items', v,
    'vapid', (select jsonb_object_agg(key, value) from private.config where key in ('vapid_public','vapid_private','vapid_subject')));
end $$;

create or replace function private.portal_outbox_tick() returns void
language plpgsql security definer set search_path to '' as $$
begin
  if exists(select 1 from public.portal_outbox where sent_at is null and tries < 5 and (taken_at is null or taken_at < now() - interval '5 minutes')) then
    perform net.http_post(url := 'https://portal.csjax.org/api/outbox',
      headers := jsonb_build_object('Content-Type','application/json','x-import-key',(select value from private.config where key='portal_import_key')),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  end if;
end $$;

-- ---------- staff phone ----------
drop function if exists public.staff_staff_save(text, text, boolean, text, text[]);
create or replace function public.staff_staff_save(p_email text, p_name text, p_active boolean, p_role text default null, p_roles text[] default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare e text := private.portal_staff_guard(); v text := lower(btrim(p_email));
  v_roles text[] := coalesce(p_roles, case when p_role is not null then array[p_role] end);
  v_phone text := case when p_phone is null then null else nullif(regexp_replace(p_phone, '\D', '', 'g'), '') end;
begin
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  if v_phone is not null and length(v_phone) = 11 and v_phone like '1%' then v_phone := substr(v_phone, 2); end if;
  if v_phone is not null and v_phone !~ '^\d{10}$' then raise exception 'bad_phone'; end if;
  if v_roles is not null then
    v_roles := array(select distinct x from unnest(v_roles) x where x is not null);
    if cardinality(v_roles) = 0 then raise exception 'pick_role'; end if;
    if not (v_roles <@ array['admin','office','carline','bus','care']) then raise exception 'bad_role'; end if;
  end if;
  -- Only Admins can give or take away the Admin role, or change an Admin's account.
  if not exists(select 1 from public.portal_staff where email = e and 'admin' = any(roles))
     and ('admin' = any(coalesce(v_roles, '{}')) or exists(select 1 from public.portal_staff where email = v and 'admin' = any(roles))) then
    raise exception 'admin_only';
  end if;
  if v = e and (not p_active or (v_roles is not null and not (v_roles && array['office','admin']))) then raise exception 'cant_remove_self'; end if;
  insert into public.portal_staff(email, name, active, role, roles, phone)
  values (v, nullif(btrim(p_name),''), p_active, private.portal_role_main(coalesce(v_roles, array['office'])), coalesce(v_roles, array['office']), v_phone)
  on conflict (email) do update set name = coalesce(excluded.name, public.portal_staff.name), active = excluded.active,
    roles = coalesce(v_roles, public.portal_staff.roles), role = private.portal_role_main(coalesce(v_roles, public.portal_staff.roles)),
    phone = case when p_phone is null then public.portal_staff.phone else v_phone end;
  return jsonb_build_object('ok', true);
end $function$;
grant execute on function public.staff_staff_save(text, text, boolean, text, text[], text) to authenticated;

create or replace function public.staff_staff_list() returns jsonb
language plpgsql stable security definer set search_path to '' as $function$
begin
  perform private.portal_staff_guard();
  return coalesce((select jsonb_agg(jsonb_build_object('email',st.email,'name',st.name,'role',st.role,'roles',to_jsonb(st.roles),'active',st.active,'phone',st.phone,
      'has_login', exists(select 1 from auth.users u where lower(u.email)=st.email),
      'last_sign_in', (select max(u.last_sign_in_at) from auth.users u where lower(u.email)=st.email)) order by st.name, st.email) from public.portal_staff st),'[]');
end $function$;

-- ---------- BANNED person at the kiosk -> email + text to Admin/Office ----------
create or replace function private.portal_ban_kiosk_alert() returns trigger
language plpgsql security definer set search_path to '' as $$
declare b public.portal_banned; t text := to_char(new.at at time zone 'America/New_York', 'FMHH12:MI AM'); s text := private.portal_full(new.student_id);
begin
  if new.place <> 'kiosk' then return null; end if;
  select * into b from public.portal_banned where id = new.banned_id;
  perform private.portal_outbox_add(jsonb_build_object('kind', 'ban_kiosk', 'ref', new.id, 'student_id', new.student_id,
    'email_to', to_jsonb(array(select email from public.portal_staff where active and roles && array['admin','office'])),
    'email_subject', '⚠ BANNED person at the kiosk — ' || s,
    'email_title', 'BANNED person at the front office kiosk',
    'email_rows', jsonb_build_array(
      jsonb_build_array('Person', b.name || coalesce(' (' || b.relationship || ')', '')),
      jsonb_build_array('BANNED for', s),
      jsonb_build_array('Time', t)),
    'email_note', 'They entered their PIN at the kiosk. The kiosk told them to see the front office. Do not release the student to them.',
    'email_link', '/office',
    'sms_to', to_jsonb(array(select phone from public.portal_staff where active and roles && array['admin','office'] and phone ~ '^\d{10}$')),
    'sms_body', 'Cornerstone ALERT: BANNED person ' || b.name || ' entered their PIN at the front office kiosk at ' || t || ' (student: ' || s || '). Do not release the student.'));
  return null;
end $$;
drop trigger if exists portal_ban_kiosk_alert on public.portal_ban_alerts;
create trigger portal_ban_kiosk_alert after insert on public.portal_ban_alerts for each row execute function private.portal_ban_kiosk_alert();

-- ---------- excused notes: not approved -> email the parent with the office note ----------
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
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    perform private.portal_outbox_add(jsonb_build_object('kind', 'note_rejected', 'ref', new.id, 'student_id', new.student_id,
      'email_to', to_jsonb(private.portal_parent_emails(new.submitted_by, new.student_id)),
      'email_subject', 'Excused note not approved — ' || private.portal_full(new.student_id) || ' — ' || dates,
      'email_title', 'Excused note not approved',
      'email_rows', jsonb_build_array(
        jsonb_build_array('Student', private.portal_full(new.student_id)),
        jsonb_build_array('Type', case when new.kind = 'doctor' then 'Doctor''s note' else 'Note from home' end),
        jsonb_build_array('Absent', dates),
        jsonb_build_array('Status', 'Not approved'),
        jsonb_build_array('Note from the office', coalesce(new.review_note, '—'))),
      'email_note', 'Please call the front office at (904) 730-5500 if you have questions.'));
  end if;
  return null;
end $$;

-- ---------- roster import failure -> Donald only ----------
create or replace function public.portal_import_alert_emails(p_key text) returns text[]
language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.portal_key_ok(p_key) then raise exception 'forbidden'; end if;
  return private.portal_setting_emails('import_alert_emails');
end $$;

-- ---------- manual parent message -> email + text (push is sent by the office screen as before) ----------
create or replace function public.staff_message_send(p_title text, p_body text, p_aud jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_staff_guard(); t text := p_aud->>'type'; v_sids bigint[]; v_em text[]; v_ph text[];
  v_title text := btrim(left(p_title, 80)); v_body text := btrim(left(coalesce(p_body, ''), 300));
begin
  if private.portal_alerts_paused() then raise exception 'Alerts are paused for testing. Turn them back on under Settings → Staff & Rules.'; end if;
  if v_title = '' then raise exception 'Add a title.'; end if;
  v_sids := array(select s.student_id from public.portal_students s where s.active and case t
      when 'all' then true
      when 'grade' then s.grade = any(array(select jsonb_array_elements_text(p_aud->'grades')))
      when 'teacher' then s.teacher = p_aud->>'teacher'
      when 'student' then s.student_id = (p_aud->>'student_id')::bigint
      when 'transport' then exists(select 1 from private.portal_plan_today() pl where pl.student_id = s.student_id
                             and pl.method = p_aud->>'method' and (coalesce(p_aud->>'bus','') = '' or pl.bus = p_aud->>'bus'))
      else false end);
  v_em := array(select distinct lower(btrim(g.email)) from public.portal_guardians g where g.student_id = any(v_sids)
                and g.email like '%@%' and not private.portal_id_banned(lower(btrim(g.email))));
  v_ph := array(select distinct g.phone10 from public.portal_guardians g where g.student_id = any(v_sids)
                and g.phone10 ~ '^\d{10}$' and not private.portal_id_banned(g.phone10));
  perform private.portal_outbox_add(jsonb_build_object('kind', 'manual', 'ref', gen_random_uuid(),
    'email_to', to_jsonb(v_em), 'email_subject', v_title, 'email_title', v_title,
    'email_rows', jsonb_build_array(jsonb_build_array('Message', coalesce(nullif(v_body, ''), v_title))),
    'email_note', 'Sent by the Cornerstone Christian School front office.',
    'sms_to', to_jsonb(v_ph), 'sms_body', 'Cornerstone Christian School: ' || v_title || case when v_body <> '' then ' — ' || v_body else '' end));
  return jsonb_build_object('students', cardinality(v_sids), 'emails', cardinality(v_em), 'texts', cardinality(v_ph));
end $$;
grant execute on function public.staff_message_send(text, text, jsonb) to authenticated;
