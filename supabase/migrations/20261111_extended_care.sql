-- ============ Extended Care (morning + afterschool) ============
-- Separate from dismissal and attendance: nothing here changes portal_attendance, portal_signins or portal_dismissals.

-- Date of birth (read from the roster file when FACTS includes it).
alter table public.portal_students add column if not exists birth_date date;

create or replace function private.portal_parse_date(t text) returns date
language plpgsql immutable set search_path to '' as $$
declare v text := btrim(coalesce(t, ''));
begin
  if v = '' then return null; end if;
  if v ~ '^\d{4}-\d{1,2}-\d{1,2}' then return left(v, 10)::date; end if;
  if v ~ '^\d{1,2}/\d{1,2}/\d{4}' then return to_date(substring(v from '^\d{1,2}/\d{1,2}/\d{4}'), 'MM/DD/YYYY'); end if;
  if v ~ '^\d{1,2}/\d{1,2}/\d{2}$' then return to_date(v, 'MM/DD/YY'); end if;
  return null;
exception when others then return null;
end $$;

do $$
declare d text := pg_get_functiondef('private.portal_roster_import(jsonb,text,boolean)'::regprocedure);
begin
  if position('birth_date' in d) = 0 then
    d := replace(d, 'pm_transport,pm_details,pm_bus_route,active,updated_at)', 'pm_transport,pm_details,pm_bus_route,birth_date,active,updated_at)');
    d := replace(d, 'nullif(x->>''Afternoon Transportation'',''''), nullif(x->>''Afternoon Details'',''''), nullif(x->>''Bus Route (Afternoon)'',''''),',
      'nullif(x->>''Afternoon Transportation'',''''), nullif(x->>''Afternoon Details'',''''), nullif(x->>''Bus Route (Afternoon)'',''''),' || chr(10) ||
      '    private.portal_parse_date(coalesce(x->>''Birthdate'', x->>''Birth Date'', x->>''Date of Birth'', x->>''DOB'', x->>''Birthday'', x->>''Student Birthdate'')),');
    d := replace(d, 'pm_bus_route=excluded.pm_bus_route,active=excluded.active,', 'pm_bus_route=excluded.pm_bus_route,birth_date=coalesce(excluded.birth_date,t.birth_date),active=excluded.active,');
    if position('portal_parse_date' in d) = 0 or position('birth_date=coalesce' in d) = 0 then raise exception 'roster import patch did not apply'; end if;
    execute d;
  end if;
end $$;

-- Staff role for extended care.
alter table public.portal_staff drop constraint if exists portal_staff_role_check;
alter table public.portal_staff add constraint portal_staff_role_check check (role = any (array['office','carline','bus','care']));

create or replace function public.staff_staff_save(p_email text, p_name text, p_active boolean, p_role text default null)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare e text := private.portal_staff_guard(); v text := lower(btrim(p_email));
begin
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  if p_role is not null and p_role not in ('office','carline','bus','care') then raise exception 'bad_role'; end if;
  if v = e and (not p_active or coalesce(p_role,'office') <> 'office') then raise exception 'cant_remove_self'; end if;
  insert into public.portal_staff(email,name,active,role) values (v, nullif(btrim(p_name),''), p_active, coalesce(p_role,'office'))
  on conflict (email) do update set name = coalesce(excluded.name, public.portal_staff.name), active = excluded.active,
    role = coalesce(p_role, public.portal_staff.role);
  return jsonb_build_object('ok', true);
end $function$;

-- One row per student, day and session.
create table if not exists public.portal_care (
  id bigserial primary key,
  day date not null,
  session text not null check (session in ('am','pm')),
  student_id bigint not null references public.portal_students(student_id),
  location text,
  in_at timestamptz not null default now(),
  in_by text,
  in_how text not null check (in_how in ('auto','staff','kiosk')),
  out_at timestamptz,
  out_by text,
  out_how text check (out_how in ('auto','staff','kiosk')),
  out_person_key text,
  out_person_name text,
  out_relationship text,
  out_signature text,
  kiosk_id uuid,
  unique (student_id, day, session)
);
alter table public.portal_care enable row level security;
create index if not exists portal_care_day on public.portal_care(day, session);

create or replace function private.portal_care_loc(t text) returns text
language sql immutable as $$ select case when coalesce(t,'') ilike '%KHA%' then 'KHA' else 'SP' end $$;

-- Today's afterschool care students (base dismissal + today's changes), with location and attendance.
create or replace function private.portal_care_pm_today()
returns table(student_id bigint, location text, day_status text)
language sql stable security definer set search_path to '' as $$
  with t as (select private.portal_today() d),
  ch as (
    select distinct on (c.student_id) c.* from public.portal_transport_changes c, t
    where c.period = 'afternoon' and c.status <> 'cancelled' and c.start_date <= t.d
      and (c.change_type = 'permanent' or coalesce(c.end_date, c.start_date) >= t.d)
    order by c.student_id, c.created_at desc)
  select pl.student_id, private.portal_care_loc(case when ch.id is not null then ch.new_details else s.pm_details end), pl.day_status
  from private.portal_plan_today() pl join public.portal_students s using (student_id) left join ch using (student_id)
  where pl.method = 'Afternoon Extended Care'
$$;

-- Runs every 5 minutes: 3:00 PM auto sign-in (present students only, once attendance is in) and 8:30 AM morning sign-out.
create or replace function private.portal_care_tick() returns void
language plpgsql security definer set search_path to '' as $$
declare v_today date := private.portal_today(); v_now time := (now() at time zone 'America/New_York')::time;
begin
  if extract(isodow from v_today) < 6 and v_now >= '15:00' and v_now < '19:00'
     and exists(select 1 from public.portal_attendance where att_date = v_today) then
    insert into public.portal_care(day, session, student_id, location, in_at, in_by, in_how)
    select v_today, 'pm', r.student_id, r.location, (v_today + time '15:00') at time zone 'America/New_York', 'Automatic (present today)', 'auto'
    from private.portal_care_pm_today() r where r.day_status in ('present','late')
    on conflict (student_id, day, session) do nothing;
  end if;
  update public.portal_care set out_at = (day + time '08:30') at time zone 'America/New_York', out_by = 'Automatic 8:30 AM', out_how = 'auto'
  where session = 'am' and out_at is null and (day < v_today or v_now >= '08:30');
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'portal-care-tick';
select cron.schedule('portal-care-tick', '*/5 * * * *', 'select private.portal_care_tick();');

-- ---------- shared row builder ----------
create or replace function private.portal_care_row(c public.portal_care) returns jsonb
language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('in_at', c.in_at, 'in_by', c.in_by, 'in_how', c.in_how, 'out_at', c.out_at, 'out_by', c.out_by, 'out_how', c.out_how,
    'out_person_name', c.out_person_name, 'out_relationship', c.out_relationship, 'signed', c.out_signature is not null, 'location_logged', c.location)
$$;

-- ---------- staff (care role or office) ----------
create or replace function public.care_me() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare e text := private.portal_duty_guard(array['care']);
begin
  return (select jsonb_build_object('email', email, 'name', name, 'role', role, 'today', private.portal_today(),
    'now_et', to_char(now() at time zone 'America/New_York','HH24:MI')) from public.portal_staff where email = e);
end $$;

-- Today's list for a session. Afternoon: everyone in afterschool care today + anyone signed in. Morning: everyone signed up + anyone signed in.
create or replace function public.care_list(p_session text) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare v_today date := private.portal_today();
begin
  perform private.portal_duty_guard(array['care']);
  if p_session not in ('am','pm') then raise exception 'bad_session'; end if;
  return jsonb_build_object('day', v_today, 'session', p_session,
    'attendance_in', exists(select 1 from public.portal_attendance where att_date = v_today),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'student_id', s.student_id, 'first', s.first_name, 'last', s.last_name, 'grade', s.grade, 'teacher', s.teacher,
        'birth_date', s.birth_date, 'location', coalesce(c.location, r.location), 'enrolled', z.enrolled, 'day_status', r.day_status)
        || coalesce(private.portal_care_row(c), '{}'::jsonb) || jsonb_build_object('signed_in', c.id is not null)
        order by s.last_name, s.first_name)
      from (
        select x.student_id, bool_or(x.enrolled) enrolled from (
          select r2.student_id, true enrolled from private.portal_care_pm_today() r2 where p_session = 'pm'
          union all select st.student_id, true from public.portal_students st where p_session = 'am' and st.active and st.am_transport = 'Morning Extended Care'
          union all select c2.student_id, false from public.portal_care c2 where c2.day = v_today and c2.session = p_session) x
        group by x.student_id) z
      join public.portal_students s on s.student_id = z.student_id
      left join private.portal_care_pm_today() r on r.student_id = z.student_id and p_session = 'pm'
      left join public.portal_care c on c.student_id = z.student_id and c.day = v_today and c.session = p_session), '[]'));
end $$;

create or replace function public.care_search(p_q text) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare q text := lower(btrim(coalesce(p_q,'')));
begin
  perform private.portal_duty_guard(array['care']);
  if length(q) < 2 then return '[]'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', student_id, 'first', first_name, 'last', last_name, 'grade', grade, 'teacher', teacher) order by last_name, first_name)
    from (select * from public.portal_students where active and (lower(first_name||' '||last_name) like '%'||q||'%' or lower(last_name||', '||first_name) like '%'||q||'%') limit 25) s), '[]');
end $$;

create or replace function public.care_in(p_student bigint, p_session text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_duty_guard(array['care']); v_today date := private.portal_today(); v_loc text; v_name text;
begin
  if p_session not in ('am','pm') then raise exception 'bad_session'; end if;
  if not exists(select 1 from public.portal_students where student_id = p_student and active) then raise exception 'student_not_found'; end if;
  if exists(select 1 from public.portal_care where student_id = p_student and day = v_today and session = p_session) then raise exception 'already_signed_in'; end if;
  if p_session = 'pm' then
    v_loc := coalesce((select location from private.portal_care_pm_today() where student_id = p_student),
                      (select private.portal_care_loc(pm_details) from public.portal_students where student_id = p_student));
  end if;
  select coalesce(name, email) into v_name from public.portal_staff where email = e;
  insert into public.portal_care(day, session, student_id, location, in_by, in_how) values (v_today, p_session, p_student, v_loc, v_name, 'staff');
  return jsonb_build_object('ok', true, 'time', to_char(now() at time zone 'America/New_York','FMHH12:MI AM'));
end $$;

-- Undo a sign-in made by mistake (only before sign-out).
create or replace function public.care_undo(p_student bigint, p_session text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  perform private.portal_duty_guard(array['care']);
  delete from public.portal_care where student_id = p_student and day = private.portal_today() and session = p_session and out_at is null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.care_out(p_student bigint, p_session text, p_person_key text default null, p_name text default null, p_rel text default null, p_signature text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_duty_guard(array['care']); v_by text;
begin
  if p_session = 'pm' then
    if nullif(btrim(p_name),'') is null then raise exception 'pick_person'; end if;
    if coalesce(p_signature,'') not like 'data:image/png;base64,%' or length(p_signature) > 400000 then raise exception 'need_signature'; end if;
  end if;
  select coalesce(name, email) into v_by from public.portal_staff where email = e;
  update public.portal_care set out_at = now(), out_by = v_by, out_how = 'staff', out_person_key = nullif(p_person_key,''),
    out_person_name = nullif(btrim(p_name),''), out_relationship = nullif(btrim(p_rel),''), out_signature = case when p_session = 'pm' then p_signature end
  where student_id = p_student and day = private.portal_today() and session = p_session and out_at is null;
  if not found then raise exception 'not_signed_in'; end if;
  return jsonb_build_object('ok', true, 'time', to_char(now() at time zone 'America/New_York','FMHH12:MI AM'));
end $$;

-- Parents/guardians and pick-up people for one student (with PIN so staff can check it).
create or replace function public.care_people(p_student bigint) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_duty_guard(array['care']);
  return jsonb_build_object(
    'student', (select jsonb_build_object('student_id', s.student_id, 'name', s.first_name||' '||s.last_name, 'grade', s.grade, 'teacher', s.teacher, 'birth_date', s.birth_date)
                from public.portal_students s where s.student_id = p_student),
    'people', coalesce((select jsonb_agg(x order by (x->>'o')::int, x->>'name') from (
      select distinct on (k) jsonb_build_object('key', k, 'name', nm, 'relationship', rel, 'phone', ph, 'type', tp, 'o', o, 'pin', private.portal_pin_of(k)) x, k from (
        select g.person_key k, g.name nm, g.relationship rel, g.phone ph, 'Parent/Guardian' tp, 1 o from public.portal_guardians g where g.student_id = p_student
        union all
        select e.person_key, btrim(coalesce(e.first_name,'')||' '||coalesce(e.last_name,'')), e.relationship, e.phone, 'Pick-Up', 2 from public.portal_pickups_eff e where e.student_id = p_student) z
      order by k, o) y), '[]'));
end $$;

-- ---------- office ----------
create or replace function public.staff_care_now() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_staff_guard();
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', s.student_id, 'first', s.first_name, 'last', s.last_name, 'grade', s.grade, 'teacher', s.teacher,
      'session', c.session, 'location', c.location, 'in_at', c.in_at, 'in_by', c.in_by, 'in_how', c.in_how) order by c.session, c.location, s.last_name, s.first_name)
    from public.portal_care c join public.portal_students s on s.student_id = c.student_id
    where c.day = private.portal_today() and c.out_at is null), '[]');
end $$;

-- Sign-in/out sheet data for a date range. p_loc: 'all' | 'KHA' | 'SP'. Lists everyone enrolled now plus anyone logged in the range.
create or replace function public.staff_care_sheet(p_from date, p_to date, p_session text, p_loc text default 'all') returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_staff_guard();
  if p_session not in ('am','pm') or p_to < p_from or p_to > p_from + 31 then raise exception 'bad_range'; end if;
  return jsonb_build_object('from', p_from, 'to', p_to, 'session', p_session, 'loc', p_loc,
    'students', coalesce((select jsonb_agg(jsonb_build_object('student_id', s.student_id, 'first', s.first_name, 'last', s.last_name, 'grade', s.grade,
        'birth_date', s.birth_date, 'location', z.location,
        'days', coalesce((select jsonb_object_agg(c.day::text, jsonb_build_object('in_at', c.in_at, 'out_at', c.out_at, 'out_person_name', c.out_person_name,
              'out_relationship', c.out_relationship, 'out_by', c.out_by, 'out_how', c.out_how, 'signature', c.out_signature))
            from public.portal_care c where c.student_id = s.student_id and c.session = p_session and c.day between p_from and p_to), '{}'))
        order by s.last_name, s.first_name)
      from (
        select x.student_id, max(x.location) location from (
          select st.student_id, private.portal_care_loc(st.pm_details) location from public.portal_students st
            where st.active and p_session = 'pm' and st.pm_transport = 'Afternoon Extended Care'
          union all select st.student_id, null from public.portal_students st where st.active and p_session = 'am' and st.am_transport = 'Morning Extended Care'
          union all select c.student_id, c.location from public.portal_care c where c.session = p_session and c.day between p_from and p_to) x
        group by x.student_id) z
      join public.portal_students s on s.student_id = z.student_id
      where p_session = 'am' or p_loc = 'all' or z.location = p_loc), '[]'));
end $$;

-- ---------- kiosk (called only through portal_kiosk_call) ----------
create or replace function public.kiosk_care_pin(p_token text, p_pin text, p_session text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare k uuid := private.portal_kiosk(p_token); v_keys text[]; v_name text; v_today date := private.portal_today();
begin
  if p_session not in ('am','pm') then raise exception 'bad_session'; end if;
  if (select count(*) from public.portal_kiosk_fails where kiosk_id = k and at > now() - interval '3 minutes') >= 5 then return jsonb_build_object('error', 'locked'); end if;
  v_keys := private.portal_pin_keys(p_pin);
  if coalesce(array_length(v_keys,1),0) = 0 or not exists(select 1 from private.portal_pin_students_k(v_keys)) then
    insert into public.portal_kiosk_fails(kiosk_id) values (k);
    return jsonb_build_object('error', case when (select count(*) from public.portal_kiosk_fails where kiosk_id = k and at > now() - interval '3 minutes') >= 5 then 'locked' else 'bad_pin' end);
  end if;
  delete from public.portal_kiosk_fails where kiosk_id = k;
  select name into v_name from public.portal_people where person_key = v_keys[1];
  return jsonb_build_object('name', v_name, 'students', coalesce((select jsonb_agg(jsonb_build_object('student_id', s.student_id, 'first_name', s.first_name, 'last_name', s.last_name,
      'grade', s.grade, 'relationship', ps.relationship, 'in_at', c.in_at, 'out_at', c.out_at, 'location', c.location,
      'can', case when p_session = 'pm' then c.id is not null and c.out_at is null else c.id is null end) order by s.last_name, s.first_name)
    from private.portal_pin_students_k(v_keys) ps join public.portal_students s on s.student_id = ps.student_id
    left join public.portal_care c on c.student_id = s.student_id and c.day = v_today and c.session = p_session), '[]'));
end $$;

create or replace function public.kiosk_care_submit(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare k uuid := private.portal_kiosk(p_token); v_session text := p->>'session'; v_today date := private.portal_today();
  v_ids bigint[] := array(select jsonb_array_elements_text(coalesce(p->'student_ids','[]'))::bigint);
  v_sig text := p->>'signature'; v_keys text[]; v_name text; v_rel text; sid bigint; v_names text[] := '{}'; s public.portal_students;
begin
  if v_session not in ('am','pm') then raise exception 'missing_fields'; end if;
  if coalesce(array_length(v_ids,1),0) = 0 then raise exception 'pick_student'; end if;
  if (select count(*) from public.portal_kiosk_fails where kiosk_id = k and at > now() - interval '3 minutes') >= 5 then raise exception 'locked'; end if;
  if v_session = 'pm' and (coalesce(v_sig,'') not like 'data:image/png;base64,%' or length(v_sig) > 400000) then raise exception 'need_signature'; end if;
  v_keys := private.portal_pin_keys(p->>'pin');
  if coalesce(array_length(v_keys,1),0) = 0 then raise exception 'bad_pin'; end if;
  select name into v_name from public.portal_people where person_key = v_keys[1];
  foreach sid in array v_ids loop
    select * into s from public.portal_students where student_id = sid and active;
    if s is null then raise exception 'student_not_found'; end if;
    select relationship into v_rel from private.portal_pin_students_k(v_keys) where student_id = sid;
    if not found then raise exception 'not_linked'; end if;
    if v_session = 'am' then
      insert into public.portal_care(day, session, student_id, in_by, in_how, kiosk_id) values (v_today, 'am', sid, v_name || coalesce(' ('||v_rel||')',''), 'kiosk', k)
      on conflict (student_id, day, session) do nothing;
      if not found then raise exception 'already_signed_in:%', s.first_name; end if;
    else
      update public.portal_care set out_at = now(), out_by = 'Kiosk', out_how = 'kiosk', out_person_key = v_keys[1], out_person_name = v_name,
        out_relationship = v_rel, out_signature = v_sig, kiosk_id = k
      where student_id = sid and day = v_today and session = 'pm' and out_at is null;
      if not found then raise exception 'not_in_care:%', s.first_name; end if;
    end if;
    v_names := v_names || (s.first_name||' '||s.last_name);
  end loop;
  return jsonb_build_object('ok', true, 'students', to_jsonb(v_names), 'time', to_char(now() at time zone 'America/New_York', 'FMHH12:MI AM'));
end $$;

create or replace function public.portal_kiosk_call(p_key text, p_fn text, p_token text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  if not private.portal_key_ok(p_key) then raise exception 'forbidden'; end if;
  p_args := coalesce(p_args, '{}'::jsonb);
  case p_fn
    when 'kiosk_hello'       then return to_jsonb(public.kiosk_hello(p_token));
    when 'kiosk_pin'         then return to_jsonb(public.kiosk_pin(p_token, p_args->>'p_pin'));
    when 'kiosk_search'      then return to_jsonb(public.kiosk_search(p_token, p_args->>'p_q'));
    when 'kiosk_student'     then return to_jsonb(public.kiosk_student(p_token, p_args->>'p_id'));
    when 'kiosk_submit'      then return to_jsonb(public.kiosk_submit(p_token, p_args->'p'));
    when 'kiosk_care_pin'    then return public.kiosk_care_pin(p_token, p_args->>'p_pin', p_args->>'p_session');
    when 'kiosk_care_submit' then return public.kiosk_care_submit(p_token, p_args->'p');
    else raise exception 'bad_fn';
  end case;
end $$;

-- Grants: staff functions for signed-in staff; kiosk ones only through portal_kiosk_call.
revoke all on function public.care_me(), public.care_list(text), public.care_search(text), public.care_in(bigint,text), public.care_undo(bigint,text),
  public.care_out(bigint,text,text,text,text,text), public.care_people(bigint), public.staff_care_now(), public.staff_care_sheet(date,date,text,text) from public, anon;
grant execute on function public.care_me(), public.care_list(text), public.care_search(text), public.care_in(bigint,text), public.care_undo(bigint,text),
  public.care_out(bigint,text,text,text,text,text), public.care_people(bigint), public.staff_care_now(), public.staff_care_sheet(date,date,text,text) to authenticated;
revoke all on function public.kiosk_care_pin(text,text,text), public.kiosk_care_submit(text,jsonb) from public, anon, authenticated;
revoke all on function private.portal_care_tick(), private.portal_care_pm_today() from public, anon, authenticated;
