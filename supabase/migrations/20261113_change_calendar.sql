-- Calendar of dismissal changes for one student: for each school day (Mon–Fri) in the range,
-- the change that decides that afternoon (same rules as the boards: one day > date range > weekly > permanent, then newest).
create or replace function public.staff_change_calendar(p_student bigint, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_staff_guard();
  if p_to < p_from or p_to - p_from > 120 then raise exception 'bad_range'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('date', d, 'id', c.id, 'method', c.new_method, 'details', c.new_details, 'pickup', c.pickup_person,
      'type', c.change_type, 'weekdays', c.weekdays, 'week_interval', c.week_interval, 'status', c.status, 'by', c.submitted_name) order by d)
    from generate_series(p_from, p_to, interval '1 day') g(dd)
    cross join lateral (select g.dd::date d) x
    cross join lateral (
      select * from public.portal_transport_changes c
      where c.student_id = p_student and c.period = 'afternoon' and private.portal_change_on(c, x.d)
      order by case c.change_type when 'one_day' then 1 when 'date_range' then 2 when 'weekly' then 3 else 4 end, c.created_at desc
      limit 1) c
    where extract(isodow from x.d) <= 5), '[]');
end $$;
grant execute on function public.staff_change_calendar(bigint, date, date) to authenticated;
