-- Office can correct a student's attendance (present / absent) when FACTS synced it wrong.
-- The correction is kept separately, so later FACTS syncs don't undo it, and it feeds portal_status_today,
-- which every screen uses (dismissal boards, car line, bus, afterschool care, kiosk, office).
create table if not exists public.portal_attendance_override (
  student_id bigint not null references public.portal_students(student_id),
  att_date date not null,
  status text not null check (status in ('present','absent')),
  note text, set_by text not null, set_at timestamptz not null default now(),
  primary key (student_id, att_date));
alter table public.portal_attendance_override enable row level security;

-- Priority: checked out early > office correction (absent) > late sign-in > office correction (present) / FACTS.
create or replace function private.portal_status_today()
returns table(student_id bigint, status text, att text, late_at timestamptz, out_at timestamptz, out_by text)
language sql stable security definer set search_path to '' as $function$
  with t as (select private.portal_today() d)
  select s.student_id,
    case when o.created_at is not null then 'dismissed'
         when ov.status = 'absent' then 'absent'
         when l.created_at is not null then 'late'
         when ov.status = 'present' then 'present'
         when a.status = 'A' then 'absent'
         else 'present' end,
    case ov.status when 'absent' then 'A' when 'present' then 'P' else a.status end, l.created_at, o.created_at, o.person_name
  from public.portal_students s cross join t
  left join public.portal_attendance a on a.student_id = s.student_id and a.att_date = t.d
  left join public.portal_attendance_override ov on ov.student_id = s.student_id and ov.att_date = t.d
  left join lateral (select min(r.created_at) created_at from public.portal_signins r where r.student_id = s.student_id and r.kind = 'late_in'
                     and (r.created_at at time zone 'America/New_York')::date = t.d having min(r.created_at) is not null) l on true
  left join lateral (select r.created_at, r.person_name from public.portal_signins r where r.student_id = s.student_id and r.kind = 'early_out'
                     and (r.created_at at time zone 'America/New_York')::date = t.d order by r.created_at limit 1) o on true
  where s.active
$function$;

-- Last 30 school days for the student page: FACTS value, any office correction, and the result.
create or replace function private.portal_att_history(p_id bigint) returns jsonb
language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'status', coalesce(case ov.status when 'absent' then 'A' when 'present' then 'P' end, a.status),
      'facts', a.status, 'override', ov.status, 'note', ov.note, 'by', ov.set_by, 'at', ov.set_at) order by d desc), '[]')
  from (select att_date d from public.portal_attendance where student_id = p_id
        union select att_date from public.portal_attendance_override where student_id = p_id
        union select private.portal_today() order by 1 desc limit 30) days
  left join public.portal_attendance a on a.student_id = p_id and a.att_date = days.d
  left join public.portal_attendance_override ov on ov.student_id = p_id and ov.att_date = days.d;
$$;

-- Set or clear (p_status null) a correction.
create or replace function public.staff_attendance_set(p_student bigint, p_date date, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_staff_guard();
begin
  if not exists(select 1 from public.portal_students where student_id = p_student) then raise exception 'not_found'; end if;
  if p_date is null or p_date > private.portal_today() then raise exception 'bad_date'; end if;
  if p_status is null or p_status = '' then
    delete from public.portal_attendance_override where student_id = p_student and att_date = p_date;
  elsif p_status in ('present','absent') then
    insert into public.portal_attendance_override(student_id, att_date, status, note, set_by) values (p_student, p_date, p_status, nullif(btrim(left(p_note, 300)), ''), e)
    on conflict (student_id, att_date) do update set status = excluded.status, note = excluded.note, set_by = e, set_at = now();
    -- Marked absent today: drop an automatic 3:00 afterschool-care sign-in.
    if p_status = 'absent' and p_date = private.portal_today() then
      delete from public.portal_care where student_id = p_student and day = p_date and in_how = 'auto' and out_at is null;
    end if;
  else raise exception 'bad_status'; end if;
  return jsonb_build_object('ok', true, 'today', (select status from private.portal_status_today() where student_id = p_student));
end $$;
grant execute on function public.staff_attendance_set(bigint, date, text, text) to authenticated;

do $$ declare d text;
begin
  d := pg_get_functiondef('public.staff_student(bigint)'::regprocedure);
  if d not like '%portal_att_history%' then
    d := replace(d, '''attendance'', coalesce((select jsonb_agg(jsonb_build_object(''date'', att_date, ''status'', status) order by att_date desc) from (select * from public.portal_attendance where student_id = p_id order by att_date desc limit 30) a), ''[]''),',
                    '''attendance'', private.portal_att_history(p_id),');
    if d not like '%portal_att_history%' then raise exception 'staff_student attendance text not found'; end if;
    execute d;
  end if;
end $$;
