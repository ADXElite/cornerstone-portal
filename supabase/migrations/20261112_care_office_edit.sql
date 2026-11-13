-- Nov 12, 2026 (evening)
--  * No parent alert when an excused note is approved (only rejected notes email the parent).
--  * Office can pick a date on the Extended Care screens and mark a student here / not here, with times.
--  * Sign-in sheets only list students who were signed in.
--  * Extended care starts 11/13/2026: earlier records are deleted.

-- ---------- excused notes: no alert on approval ----------
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

-- Days the office marked a student "not here" — the automatic 3:00 PM sign-in leaves them alone.
create table if not exists public.portal_care_skip (
  student_id bigint not null references public.portal_students(student_id),
  day date not null, session text not null check (session in ('am','pm')),
  by_email text, at timestamptz not null default now(),
  primary key (student_id, day, session));
alter table public.portal_care_skip enable row level security;

create or replace function private.portal_care_tick() returns void
language plpgsql security definer set search_path to '' as $function$
declare v_today date := private.portal_today(); v_now time := (now() at time zone 'America/New_York')::time;
begin
  if v_today >= date '2026-11-13' and extract(isodow from v_today) < 6 and v_now >= '15:00' and v_now < '19:00'
     and exists(select 1 from public.portal_attendance where att_date = v_today) then
    insert into public.portal_care(day, session, student_id, location, in_at, in_by, in_how)
    select v_today, 'pm', r.student_id, r.location, (v_today + time '15:00') at time zone 'America/New_York', 'Automatic (present today)', 'auto'
    from private.portal_care_pm_today() r where r.day_status in ('present','late')
      and not exists(select 1 from public.portal_care_skip k where k.student_id = r.student_id and k.day = v_today and k.session = 'pm')
    on conflict (student_id, day, session) do nothing;
  end if;
  perform private.portal_care_cleanup();
  update public.portal_care set out_at = (day + time '08:30') at time zone 'America/New_York', out_by = 'Automatic 8:30 AM', out_how = 'auto'
  where session = 'am' and out_at is null and (day < v_today or v_now >= '08:30');
end $function$;

-- ---------- office: one day of extended care (any date) ----------
create or replace function public.staff_care_day(p_session text, p_day date) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_staff_guard();
  if p_session not in ('am','pm') then raise exception 'bad_session'; end if;
  return jsonb_build_object('day', p_day, 'session', p_session,
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'student_id', s.student_id, 'first', s.first_name, 'last', s.last_name, 'grade', s.grade, 'teacher', s.teacher,
        'location', coalesce(c.location, z.location), 'enrolled', z.enrolled)
        || coalesce(private.portal_care_row(c), '{}'::jsonb) || jsonb_build_object('signed_in', c.id is not null)
        order by s.last_name, s.first_name)
      from (
        select x.student_id, bool_or(x.enrolled) enrolled, max(x.location) location from (
          select st.student_id, true enrolled, private.portal_care_loc(st.pm_details) location from public.portal_students st
            where p_session = 'pm' and st.active and st.pm_transport = 'Afternoon Extended Care'
          union all select st.student_id, true, null from public.portal_students st where p_session = 'am' and st.active and st.am_transport = 'Morning Extended Care'
          union all select c2.student_id, false, c2.location from public.portal_care c2 where c2.day = p_day and c2.session = p_session) x
        group by x.student_id) z
      join public.portal_students s on s.student_id = z.student_id
      left join public.portal_care c on c.student_id = z.student_id and c.day = p_day and c.session = p_session), '[]'));
end $$;
grant execute on function public.staff_care_day(text, date) to authenticated;

-- Office correction: mark a student here (with times) or not here on a given day.
create or replace function public.staff_care_set(p_student bigint, p_session text, p_day date, p_here boolean,
  p_in time default null, p_out time default null, p_out_name text default null, p_location text default null) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_staff_guard(); v_in timestamptz; v_out timestamptz; v_loc text;
begin
  if p_session not in ('am','pm') then raise exception 'bad_session'; end if;
  if p_day < date '2026-11-13' then raise exception 'Extended care records start 11/13/2026.'; end if;
  if p_day > private.portal_today() then raise exception 'You can''t mark a future day.'; end if;
  if not exists(select 1 from public.portal_students where student_id = p_student) then raise exception 'not_found'; end if;
  if not p_here then
    delete from public.portal_care where student_id = p_student and day = p_day and session = p_session;
    insert into public.portal_care_skip(student_id, day, session, by_email) values (p_student, p_day, p_session, e)
    on conflict (student_id, day, session) do update set by_email = excluded.by_email, at = now();
    return jsonb_build_object('ok', true, 'here', false);
  end if;
  if p_in is null then raise exception 'Enter the sign-in time.'; end if;
  delete from public.portal_care_skip where student_id = p_student and day = p_day and session = p_session;
  v_in := (p_day + p_in) at time zone 'America/New_York';
  v_out := case when p_out is not null then (p_day + p_out) at time zone 'America/New_York' end;
  if v_out is not null and v_out < v_in then raise exception 'Sign-out time is before sign-in time.'; end if;
  v_loc := case when p_session = 'pm' then coalesce(nullif(p_location, ''),
    (select c.location from public.portal_care c where c.student_id = p_student and c.day = p_day and c.session = 'pm'),
    (select private.portal_care_loc(st.pm_details) from public.portal_students st where st.student_id = p_student), 'SP') end;
  if v_loc is not null and v_loc not in ('KHA','SP') then raise exception 'bad_location'; end if;
  insert into public.portal_care(day, session, student_id, location, in_at, in_by, in_how, out_at, out_by, out_how, out_person_name)
  values (p_day, p_session, p_student, v_loc, v_in, e || ' (office)', 'staff', v_out, case when v_out is not null then e || ' (office)' end,
          case when v_out is not null then 'staff' end, nullif(btrim(p_out_name), ''))
  on conflict (student_id, day, session) do update set
    -- A time that didn't change (to the minute) keeps who/how it was recorded.
    location = excluded.location,
    in_at  = case when date_trunc('minute', public.portal_care.in_at) = excluded.in_at then public.portal_care.in_at else excluded.in_at end,
    in_by  = case when date_trunc('minute', public.portal_care.in_at) = excluded.in_at then public.portal_care.in_by else excluded.in_by end,
    in_how = case when date_trunc('minute', public.portal_care.in_at) = excluded.in_at then public.portal_care.in_how else 'staff' end,
    out_at  = case when date_trunc('minute', public.portal_care.out_at) is not distinct from excluded.out_at then public.portal_care.out_at else excluded.out_at end,
    out_by  = case when date_trunc('minute', public.portal_care.out_at) is not distinct from excluded.out_at then public.portal_care.out_by else excluded.out_by end,
    out_how = case when date_trunc('minute', public.portal_care.out_at) is not distinct from excluded.out_at then public.portal_care.out_how else excluded.out_how end,
    out_person_name = case when excluded.out_at is null then null else coalesce(excluded.out_person_name, public.portal_care.out_person_name) end,
    out_signature = case when excluded.out_at is null then null else public.portal_care.out_signature end,
    out_person_key = case when excluded.out_at is null then null else public.portal_care.out_person_key end,
    out_relationship = case when excluded.out_at is null then null else public.portal_care.out_relationship end;
  return jsonb_build_object('ok', true, 'here', true);
end $$;
grant execute on function public.staff_care_set(bigint, text, date, boolean, time, time, text, text) to authenticated;

-- ---------- sheets: only students who were signed in ----------
create or replace function public.staff_care_sheet(p_from date, p_to date, p_session text, p_loc text default 'all') returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_staff_guard();
  if p_session not in ('am','pm') or p_to < p_from or p_to > p_from + 31 then raise exception 'bad_range'; end if;
  return jsonb_build_object('from', p_from, 'to', p_to, 'session', p_session, 'loc', p_loc,
    'students', coalesce((select jsonb_agg(jsonb_build_object('student_id', s.student_id, 'first', s.first_name, 'last', s.last_name, 'grade', s.grade,
        'location', z.location,
        'days', coalesce((select jsonb_object_agg(c.day::text, jsonb_build_object('in_at', c.in_at, 'out_at', c.out_at, 'out_person_name', c.out_person_name,
              'out_relationship', c.out_relationship, 'out_by', c.out_by, 'out_how', c.out_how, 'signature', c.out_signature))
            from public.portal_care c where c.student_id = s.student_id and c.session = p_session and c.day between p_from and p_to), '{}'))
        order by s.last_name, s.first_name)
      from (select c.student_id, max(c.location) location from public.portal_care c
            where c.session = p_session and c.day between p_from and p_to group by c.student_id) z
      join public.portal_students s on s.student_id = z.student_id
      where p_session = 'am' or p_loc = 'all' or z.location = p_loc), '[]'));
end $$;

-- ---------- extended care starts 11/13/2026 ----------
delete from public.portal_care where day < date '2026-11-13';
