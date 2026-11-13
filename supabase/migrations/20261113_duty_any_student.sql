-- Car line / bus staff can search ANY student and dismiss them by car or bus, even if FACTS lists another way home
-- (e.g. afternoon extended care). Doing so auto-creates today's dismissal change (one day, already processed,
-- no parent alert) and takes the student off the afterschool care sign-out list. Undo cancels that change.

-- Find any active student (car line + bus screens).
create or replace function public.duty_find_students(p_q text) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare v_today date := private.portal_today(); w text[] := regexp_split_to_array(lower(btrim(coalesce(p_q, ''))), '[\s,]+');
begin
  perform private.portal_duty_guard(array['carline','bus','busdismiss']);
  if length(btrim(coalesce(p_q, ''))) < 2 then return '[]'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', s.student_id, 'first', s.first_name, 'last', s.last_name, 'grade', s.grade,
      'teacher', private.portal_board_teacher(s), 'method', pl.method, 'bus', pl.bus, 'status', pl.day_status,
      'done', x.kind, 'done_at', x.at, 'done_by', coalesce(x.person_name, case when x.kind = 'bus' then 'Bus ' || x.bus end)) order by s.last_name, s.first_name)
    from public.portal_students s join private.portal_plan_today() pl using (student_id)
    left join public.portal_dismissals x on x.student_id = s.student_id and x.day = v_today
    where s.active and (select bool_and(lower(s.first_name || ' ' || s.last_name || ' ' || s.student_id) like '%' || t || '%') from unnest(w) t where t <> '')
    limit 15), '[]');
end $$;
grant execute on function public.duty_find_students(text) to authenticated;

-- Today's one-day change to car rider / bus rider, made by duty staff. Returns true if one was created.
create or replace function private.portal_duty_day_change(p_student bigint, p_method text, p_details text, p_pickup text, p_by text, p_where text) returns boolean
language plpgsql security definer set search_path to '' as $$
declare pl record; s public.portal_students; v_today date := private.portal_today(); v_name text := (select name from public.portal_staff where email = p_by);
begin
  select * into pl from private.portal_plan_today() where student_id = p_student;
  if pl.method = p_method and (p_method <> 'Bus Rider' or p_details is null or coalesce(pl.bus, '') = regexp_replace(p_details, '\D', '', 'g')) then return false; end if;
  select * into s from public.portal_students where student_id = p_student;
  insert into public.portal_transport_changes(student_id, period, change_type, start_date, end_date, current_method, new_method, new_details, pickup_person,
      comments, submitted_by, submitted_name, source, status, processed_by, processed_at)
  values (p_student, 'afternoon', 'one_day', v_today, v_today, coalesce(pl.method, concat_ws(' — ', s.pm_transport, s.pm_details)), p_method, p_details, nullif(btrim(p_pickup), ''),
      'Auto: dismissed in ' || p_where, p_by, coalesce(v_name, p_by) || ' (' || p_where || ')', 'office', 'processed', p_by, now());
  -- Off the afterschool care list: drop an automatic 3:00 sign-in; sign out anyone already signed in by staff/kiosk.
  delete from public.portal_care where student_id = p_student and day = v_today and session = 'pm' and in_how = 'auto' and out_at is null;
  update public.portal_care set out_at = now(), out_how = 'staff', out_by = p_by, out_person_name = coalesce(nullif(btrim(p_pickup), ''), 'Dismissed in ' || p_where)
  where student_id = p_student and day = v_today and session = 'pm' and out_at is null;
  insert into public.portal_care_skip(student_id, day, session, by_email) values (p_student, v_today, 'pm', p_by)
  on conflict (student_id, day, session) do update set by_email = excluded.by_email, at = now();
  return true;
end $$;

-- Undo: cancel the automatic change for today.
create or replace function private.portal_duty_day_change_undo(p_student bigint, p_where text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  update public.portal_transport_changes set status = 'cancelled'
  where student_id = p_student and start_date = private.portal_today() and change_type = 'one_day' and source = 'office'
    and comments = 'Auto: dismissed in ' || p_where and status <> 'cancelled';
  delete from public.portal_care_skip where student_id = p_student and day = private.portal_today() and session = 'pm';
end $$;

-- Car line: any student; auto change when they weren't a car rider today.
create or replace function public.duty_car_mark(p_student bigint, p_person_key text, p_name text, p_rel text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_duty_guard(array['carline']); v_today date := private.portal_today(); v_chg boolean;
begin
  if not exists(select 1 from public.portal_students where student_id = p_student and active) then raise exception 'student_not_found'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'pick_person'; end if;
  v_chg := private.portal_duty_day_change(p_student, 'Car Rider', null, p_name, e, 'car line');
  insert into public.portal_dismissals(student_id, day, kind, person_key, person_name, relationship, by_email)
  values (p_student, v_today, 'car', nullif(p_person_key,''), btrim(p_name), nullif(btrim(p_rel),''), e)
  on conflict (student_id, day) do update set kind = 'car', bus = null, stop = null, person_key = excluded.person_key, person_name = excluded.person_name,
    relationship = excluded.relationship, by_email = e, at = now();
  return jsonb_build_object('ok', true, 'changed', v_chg, 'time', to_char(now() at time zone 'America/New_York','FMHH12:MI AM'));
end $$;

create or replace function public.duty_car_unmark(p_student bigint) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  perform private.portal_duty_guard(array['carline']);
  delete from public.portal_dismissals where student_id = p_student and day = private.portal_today() and kind = 'car';
  perform private.portal_duty_day_change_undo(p_student, 'car line');
  return jsonb_build_object('ok', true);
end $$;

-- Bus: any student onto a given bus; auto change when they weren't riding that bus today.
create or replace function public.duty_bus_mark_any(p_student bigint, p_bus text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_duty_guard(array['bus','busdismiss']); v_today date := private.portal_today(); v_bus text := nullif(regexp_replace(coalesce(p_bus, ''), '\D', '', 'g'), ''); v_chg boolean; pl record;
begin
  if not exists(select 1 from public.portal_students where student_id = p_student and active) then raise exception 'student_not_found'; end if;
  select * into pl from private.portal_plan_today() where student_id = p_student;
  if v_bus is null and pl.method = 'Bus Rider' then v_bus := pl.bus; end if;
  if v_bus is null then raise exception 'pick_bus'; end if;
  v_chg := private.portal_duty_day_change(p_student, 'Bus Rider', 'Bus ' || v_bus, null, e, 'bus dismissal');
  insert into public.portal_dismissals(student_id, day, kind, bus, stop, by_email) values (p_student, v_today, 'bus', v_bus, null, e)
  on conflict (student_id, day) do update set kind = 'bus', bus = excluded.bus, stop = null, person_key = null, person_name = null, relationship = null, by_email = e, at = now();
  return jsonb_build_object('ok', true, 'changed', v_chg);
end $$;
grant execute on function public.duty_bus_mark_any(bigint, text) to authenticated;

-- Unchecking a bus rider also cancels an automatic bus change from today.
create or replace function public.duty_bus_mark(p_student bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_duty_guard(array['bus','busdismiss']); v_today date := private.portal_today(); pl record;
begin
  select * into pl from private.portal_plan_today() where student_id = p_student;
  if p_on then
    if pl is null or pl.method <> 'Bus Rider' then raise exception 'not_bus_rider'; end if;
    insert into public.portal_dismissals(student_id, day, kind, bus, stop, by_email) values (p_student, v_today, 'bus', pl.bus, pl.stop, e)
    on conflict (student_id, day) do update set kind = 'bus', bus = excluded.bus, stop = excluded.stop, person_key = null, person_name = null, relationship = null, by_email = e, at = now();
  else
    delete from public.portal_dismissals where student_id = p_student and day = v_today and kind = 'bus';
    perform private.portal_duty_day_change_undo(p_student, 'bus dismissal');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Bus list for the "which bus?" buttons.
create or replace function public.duty_bus_numbers() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_duty_guard(array['bus','busdismiss']);
  return coalesce((select jsonb_agg(b order by nullif(regexp_replace(b, '\D', '', 'g'), '')::int nulls last) from (
    select distinct regexp_replace(bus, '^\s*bus\s*', '', 'i') b from public.portal_bus_info where bus is not null
    union select distinct pl.bus from private.portal_plan_today() pl where pl.method = 'Bus Rider' and pl.bus is not null) z where b <> ''), '[]');
end $$;
grant execute on function public.duty_bus_numbers() to authenticated;
