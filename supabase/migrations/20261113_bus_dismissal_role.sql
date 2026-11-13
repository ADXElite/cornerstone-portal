-- New staff role "busdismiss" (Bus Dismissal): at /bus they see every bus rider for today on one list
-- ("Last, First (Grade) (Bus #)") and check students off as they get on the bus.
alter table public.portal_staff drop constraint if exists portal_staff_roles_check;
alter table public.portal_staff add constraint portal_staff_roles_check
  check (cardinality(roles) > 0 and roles <@ array['admin','office','carline','bus','busdismiss','care']);

create or replace function private.portal_role_main(p_roles text[]) returns text language sql immutable as $$
  select case when 'admin' = any(p_roles) then 'admin' when 'office' = any(p_roles) then 'office' when 'care' = any(p_roles) then 'care'
              when 'carline' = any(p_roles) then 'carline' when 'bus' = any(p_roles) then 'bus' when 'busdismiss' = any(p_roles) then 'busdismiss' else 'bus' end
$$;
create or replace function private.portal_roles_eff(p_roles text[]) returns text[] language sql immutable as $$
  select case when 'admin' = any(p_roles) then array['admin','office','carline','bus','busdismiss','care'] else p_roles end
$$;

do $$ declare d text;
begin
  -- allow the new role when saving staff
  d := pg_get_functiondef('public.staff_staff_save(text,text,boolean,text,text[],text)'::regprocedure);
  if d not like '%busdismiss%' then execute replace(d, 'array[''admin'',''office'',''carline'',''bus'',''care'']', 'array[''admin'',''office'',''carline'',''bus'',''busdismiss'',''care'']'); end if;
  -- bus-dismissal staff can sign in to the duty screens and check students onto buses
  d := pg_get_functiondef('public.duty_me()'::regprocedure);
  if d not like '%busdismiss%' then execute replace(d, 'portal_duty_guard(array[''carline'',''bus''])', 'portal_duty_guard(array[''carline'',''bus'',''busdismiss''])'); end if;
  d := pg_get_functiondef('public.duty_bus_mark(bigint,boolean)'::regprocedure);
  if d not like '%busdismiss%' then execute replace(d, 'portal_duty_guard(array[''bus''])', 'portal_duty_guard(array[''bus'',''busdismiss''])'); end if;
  d := pg_get_functiondef('public.duty_buses()'::regprocedure);
  if d not like '%busdismiss%' then execute replace(d, 'portal_duty_guard(array[''bus''])', 'portal_duty_guard(array[''bus'',''busdismiss''])'); end if;
  d := pg_get_functiondef('public.duty_bus(text)'::regprocedure);
  if d not like '%busdismiss%' then execute replace(d, 'portal_duty_guard(array[''bus''])', 'portal_duty_guard(array[''bus'',''busdismiss''])'); end if;
end $$;

-- Every bus rider today, all buses, sorted by last name.
create or replace function public.duty_bus_all() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare v_today date := private.portal_today();
begin
  perform private.portal_duty_guard(array['bus','busdismiss']);
  return jsonb_build_object('date', v_today, 'attendance_in', exists(select 1 from public.portal_attendance where att_date = v_today),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'student_id', s.student_id, 'first', s.first_name, 'last', s.last_name, 'grade', s.grade, 'bus', pl.bus,
        'status', pl.day_status, 'changed', pl.changed,
        'on_bus', x.at is not null, 'on_bus_at', x.at, 'marked_by', x.by_email, 'elsewhere', x2.kind)
        order by s.last_name, s.first_name)
      from private.portal_plan_today() pl join public.portal_students s using (student_id)
      left join public.portal_dismissals x on x.student_id = pl.student_id and x.day = v_today and x.kind = 'bus'
      left join public.portal_dismissals x2 on x2.student_id = pl.student_id and x2.day = v_today and x2.kind <> 'bus'
      where pl.method = 'Bus Rider'), '[]'));
end $$;
grant execute on function public.duty_bus_all() to authenticated;
