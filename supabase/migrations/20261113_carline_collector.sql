-- New staff role "carcollect" (Car Line Collector), screen at /collect.
-- Two-check car line: #1 a collector picks the student up from their classroom (portal_collections),
-- #2 car line staff officially dismiss them and pick who picked them up (portal_dismissals, unchanged).
alter table public.portal_staff drop constraint if exists portal_staff_roles_check;
alter table public.portal_staff add constraint portal_staff_roles_check
  check (cardinality(roles) > 0 and roles <@ array['admin','office','carline','carcollect','bus','busdismiss','care']);

create or replace function private.portal_role_main(p_roles text[]) returns text language sql immutable as $$
  select case when 'admin' = any(p_roles) then 'admin' when 'office' = any(p_roles) then 'office' when 'care' = any(p_roles) then 'care'
              when 'carline' = any(p_roles) then 'carline' when 'carcollect' = any(p_roles) then 'carcollect'
              when 'bus' = any(p_roles) then 'bus' when 'busdismiss' = any(p_roles) then 'busdismiss' else 'bus' end
$$;
create or replace function private.portal_roles_eff(p_roles text[]) returns text[] language sql immutable as $$
  select case when 'admin' = any(p_roles) then array['admin','office','carline','carcollect','bus','busdismiss','care'] else p_roles end
$$;

create table if not exists public.portal_collections (
  student_id bigint not null references public.portal_students(student_id),
  day date not null, by_email text not null, at timestamptz not null default now(),
  primary key (student_id, day));
alter table public.portal_collections enable row level security;

do $$ declare d text;
begin
  d := pg_get_functiondef('public.staff_staff_save(text,text,boolean,text,text[],text)'::regprocedure);
  if d not like '%carcollect%' then execute replace(d, 'array[''admin'',''office'',''carline'',''bus'',''busdismiss'',''care'']', 'array[''admin'',''office'',''carline'',''carcollect'',''bus'',''busdismiss'',''care'']'); end if;
  d := pg_get_functiondef('public.duty_me()'::regprocedure);
  if d not like '%carcollect%' then execute replace(d, 'portal_duty_guard(array[''carline'',''bus'',''busdismiss''])', 'portal_duty_guard(array[''carline'',''carcollect'',''bus'',''busdismiss''])'); end if;
  -- car line list also shows whether each student has been collected from class
  d := pg_get_functiondef('public.duty_cars()'::regprocedure);
  if d not like '%portal_collections%' then
    d := replace(d, '''done'', x.at is not null,', '''collected'', cl.at is not null, ''collected_at'', cl.at, ''collected_by'', (select coalesce(st.name, cl.by_email) from public.portal_staff st where st.email = cl.by_email), ''done'', x.at is not null,');
    d := replace(d, 'where pl.method = ''Car Rider''', 'left join public.portal_collections cl on cl.student_id = pl.student_id and cl.day = v_today
      where pl.method = ''Car Rider''');
    execute d;
  end if;
end $$;

-- Collector screen: today's car riders grouped by the dismissal board they're on.
create or replace function public.duty_collect_list() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare v_today date := private.portal_today();
begin
  perform private.portal_duty_guard(array['carline','carcollect']);
  return jsonb_build_object('date', v_today, 'attendance_in', exists(select 1 from public.portal_attendance where att_date = v_today),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'student_id', s.student_id, 'first', s.first_name, 'last', s.last_name, 'grade', s.grade,
        'board', regexp_replace(coalesce(private.portal_board_teacher(s), 'No board'), '^(Mr|Mrs|Ms|Miss|Dr)\.?\s+', '', 'i'),
        'status', pl.day_status, 'changed', pl.changed,
        'collected', cl.at is not null, 'collected_at', cl.at, 'collected_by', (select coalesce(st.name, cl.by_email) from public.portal_staff st where st.email = cl.by_email),
        'dismissed', x.at is not null, 'dismissed_at', x.at, 'picked_by', x.person_name)
        order by private.portal_board_teacher(s), s.last_name, s.first_name)
      from private.portal_plan_today() pl join public.portal_students s using (student_id)
      left join public.portal_collections cl on cl.student_id = pl.student_id and cl.day = v_today
      left join public.portal_dismissals x on x.student_id = pl.student_id and x.day = v_today and x.kind = 'car'
      where pl.method = 'Car Rider'), '[]'));
end $$;
grant execute on function public.duty_collect_list() to authenticated;

create or replace function public.duty_collect_mark(p_student bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_duty_guard(array['carline','carcollect']); v_today date := private.portal_today();
begin
  if not exists(select 1 from public.portal_students where student_id = p_student and active) then raise exception 'student_not_found'; end if;
  if p_on then
    insert into public.portal_collections(student_id, day, by_email) values (p_student, v_today, e)
    on conflict (student_id, day) do update set by_email = e, at = now();
  else
    delete from public.portal_collections where student_id = p_student and day = v_today;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.duty_collect_mark(bigint, boolean) to authenticated;
