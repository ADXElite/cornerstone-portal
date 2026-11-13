-- Weekly repeating dismissal changes (e.g. "Car Rider every Friday").
-- change_type 'weekly' + weekdays (ISO 1=Mon … 5=Fri), from start_date until end_date (null = ongoing).
-- On those days the change overrides the FACTS transportation; other days FACTS stays in charge.
-- When several changes apply to the same day, the most specific wins: one day > date range > weekly > permanent, then newest.

alter table public.portal_transport_changes add column if not exists weekdays smallint[];
alter table public.portal_transport_changes drop constraint if exists portal_transport_changes_change_type_check;
alter table public.portal_transport_changes add constraint portal_transport_changes_change_type_check
  check (change_type in ('one_day','date_range','permanent','weekly'));
alter table public.portal_transport_changes drop constraint if exists portal_transport_changes_weekdays_check;
alter table public.portal_transport_changes add constraint portal_transport_changes_weekdays_check
  check (change_type <> 'weekly' or (cardinality(weekdays) between 1 and 5 and weekdays <@ array[1,2,3,4,5]::smallint[]));

-- Is change c in effect on day d?
create or replace function private.portal_change_on(c public.portal_transport_changes, d date) returns boolean
language sql immutable as $$
  select c.status <> 'cancelled' and c.start_date <= d and case c.change_type
    when 'permanent' then true
    when 'weekly' then (c.end_date is null or c.end_date >= d) and extract(isodow from d)::smallint = any(c.weekdays)
    else coalesce(c.end_date, c.start_date) >= d end;
$$;

-- The one change that decides each student's afternoon (or morning) on day d.
create or replace function private.portal_change_for(d date, p_period text default 'afternoon') returns setof public.portal_transport_changes
language sql stable security definer set search_path to '' as $$
  select distinct on (c.student_id) c.* from public.portal_transport_changes c
  where c.period = p_period and private.portal_change_on(c, d)
  order by c.student_id, case c.change_type when 'one_day' then 1 when 'date_range' then 2 when 'weekly' then 3 else 4 end, c.created_at desc;
$$;

create or replace function private.portal_care_pm_today() returns table(student_id bigint, location text, day_status text)
language sql stable security definer set search_path to '' as $function$
  with ch as (select * from private.portal_change_for(private.portal_today()))
  select pl.student_id, private.portal_care_loc(case when ch.id is not null then ch.new_details else s.pm_details end), pl.day_status
  from private.portal_plan_today() pl join public.portal_students s using (student_id) left join ch using (student_id)
  where pl.method = 'Afternoon Extended Care'
$function$;

create or replace function private.portal_dismissal_today()
returns table(student_id bigint, first_name text, last_name text, teacher text, slug text, method text, detail text, changed boolean, change_note text, checked_out_at timestamptz, checked_out_by text, day_status text)
language sql stable security definer set search_path to '' as $function$
  with ch as (select * from private.portal_change_for(private.portal_today())),
  base as (
    select s.*, private.portal_board_teacher(s) bt, ch.id ch_id, ch.new_method, ch.new_details, ch.pickup_person,
      case
        when ch.id is not null then case when ch.new_method = 'Car Line' then 'Car Rider' else ch.new_method end
        when s.pm_transport = 'Bus Rider' then 'Bus Rider'
        when s.pm_transport ilike '%extended care%' then 'Afternoon Extended Care'
        when s.pm_details in ('Student Walker','City Bus Rider') then s.pm_details
        when s.pm_details ilike 'Student Driver%' then 'Student Driver'
        when s.pm_transport is null and s.pm_details is null then 'Not on file'
        else 'Car Rider' end m
    from public.portal_students s left join ch using (student_id)
    where s.active)
  select b.student_id, b.first_name, b.last_name, b.bt, private.portal_slug(b.bt),
    case when b.m ilike 'Student Driver%' then 'Student Driver' else b.m end,
    case
      when b.m = 'Bus Rider' then nullif(substring(coalesce(case when b.ch_id is not null then b.new_details end, b.pm_details, b.pm_bus_route, '') from '(?i)bus\s*(\d+)'), '')
      when b.m = 'Afternoon Extended Care' then nullif(btrim(regexp_replace(coalesce(case when b.ch_id is not null then b.new_details end, b.pm_details, ''), '^.*-\s*', '')), '')
      when b.m = 'Car Rider' and b.ch_id is not null then nullif(b.pickup_person, '')
    end,
    b.ch_id is not null,
    case when b.ch_id is not null then concat_ws(' — ', b.new_method, nullif(b.new_details,''), case when b.pickup_person is not null then 'with ' || b.pickup_person end) end,
    st.out_at, st.out_by, st.status
  from base b join private.portal_status_today() st using (student_id)
$function$;

create or replace function private.portal_plan_today()
returns table(student_id bigint, method text, bus text, stop text, pickup_person text, changed boolean, day_status text)
language sql stable security definer set search_path to '' as $function$
  with ch as (select * from private.portal_change_for(private.portal_today()))
  select d.student_id, d.method,
    case when d.method = 'Bus Rider' then coalesce(rs.bus, d.detail) end,
    case when d.method = 'Bus Rider' then st.stop end,
    case when ch.id is not null then ch.pickup_person end,
    d.changed, d.day_status
  from private.portal_dismissal_today() d left join ch using (student_id)
  left join lateral (select coalesce(case when ch.id is not null then nullif(ch.new_details,'') end,
      (select s.pm_bus_route from public.portal_students s where s.student_id = d.student_id)) stop) st on true
  left join lateral (select (private.portal_route_stop(d.detail, st.stop)).bus) rs on d.method = 'Bus Rider'
$function$;

-- Weekdays from the request: [1..5] ISO numbers.
create or replace function private.portal_weekdays(p jsonb) returns smallint[]
language sql immutable as $$
  select array(select distinct x::smallint from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) x where x ~ '^[1-5]$' order by 1);
$$;

-- ---------- parents ----------
create or replace function public.portal_transport_submit(p_key text, p_id text, p jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_id text := public.portal_norm_id(p_id); v_sid bigint := (p->>'student_id')::bigint; s record;
  v_period text := p->>'period'; v_type text := p->>'change_type';
  v_start date := (p->>'start_date')::date; v_end date := nullif(p->>'end_date','')::date;
  v_days smallint[] := private.portal_weekdays(p->'weekdays');
  v_today date := private.portal_today(); v_now time := (now() at time zone 'America/New_York')::time;
  v_cut time := (private.portal_setting('dismissal_cutoff')#>>'{}')::time; v_method text := case when p->>'new_method' = 'Car Line' then 'Car Rider' else p->>'new_method' end;
  v_cur text; v_row public.portal_transport_changes;
begin
  if not private.portal_key_ok(p_key) then raise exception 'forbidden'; end if;
  if v_sid is null or v_sid not in (select private.portal_student_ids(v_id)) then raise exception 'not_your_student'; end if;
  select * into s from public.portal_students where student_id = v_sid;
  if v_period not in ('afternoon','morning') or v_type not in ('one_day','date_range','permanent','weekly') or v_start is null then raise exception 'missing_fields'; end if;
  if v_start < v_today then raise exception 'date_past'; end if;
  if v_start > v_today + 180 then raise exception 'date_too_far'; end if;
  if v_start = v_today and v_period = 'morning' then raise exception 'morning_same_day'; end if;
  if v_start = v_today and v_now >= v_cut then raise exception 'after_cutoff'; end if;
  if v_type = 'date_range' and (v_end is null or v_end < v_start or v_end > v_start + 180) then raise exception 'bad_range'; end if;
  if v_type = 'weekly' then
    if cardinality(v_days) = 0 then raise exception 'need_weekdays'; end if;
    if v_end is not null and (v_end < v_start or v_end > v_start + 366) then raise exception 'bad_range'; end if;
  else
    v_days := null;
    if v_type <> 'date_range' then v_end := case when v_type='one_day' then v_start else null end; end if;
  end if;
  if v_period = 'afternoon' and v_method not in ('Car Rider','Bus Rider','Afternoon Extended Care','Student Walker','Student Driver and/or Passenger','City Bus Rider') then raise exception 'bad_method'; end if;
  if v_period = 'morning' and v_method not in ('Car Rider','Bus Rider','Morning Extended Care','Student Walker') then raise exception 'bad_method'; end if;
  if v_method = 'Bus Rider' and not exists(select 1 from jsonb_array_elements(private.portal_bus_stop_list()) x where x->>'stop' = btrim(coalesce(p->>'new_details',''))) then raise exception 'need_bus'; end if;
  v_cur := case when v_period='afternoon' then concat_ws(' — ', s.pm_transport, s.pm_details, s.pm_bus_route) else concat_ws(' — ', s.am_transport, s.am_bus_route) end;

  insert into public.portal_transport_changes(student_id,period,change_type,start_date,end_date,weekdays,current_method,new_method,new_details,pickup_person,pickup_phone,pickup_relationship,comments,submitted_by,submitted_name)
  values (v_sid, v_period, v_type, v_start, v_end, v_days, v_cur, v_method, nullif(btrim(p->>'new_details'),''), nullif(btrim(p->>'pickup_person'),''),
          nullif(btrim(p->>'pickup_phone'),''), nullif(btrim(p->>'pickup_relationship'),''), nullif(btrim(left(p->>'comments',1000)),''), v_id,
          (select g.name from public.portal_guardians g where g.student_id = v_sid and (g.phone10=v_id or g.email=v_id) limit 1))
  returning * into v_row;
  return to_jsonb(v_row) || jsonb_build_object('student_name', s.first_name||' '||s.last_name, 'grade', s.grade, 'teacher', s.teacher);
end $function$;

create or replace function public.portal_parent_home(p_key text, p_id text) returns jsonb
language plpgsql stable security definer set search_path to '' as $function$
declare v_id text := public.portal_norm_id(p_id); v_today date := private.portal_today(); v_sem text := private.portal_semester(private.portal_today());
begin
  if not private.portal_key_ok(p_key) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'identifier', v_id,
    'parent_name', (select g.name from public.portal_guardians g where g.phone10 = v_id or g.email = v_id limit 1),
    'today', v_today,
    'now_et', to_char(now() at time zone 'America/New_York','HH24:MI'),
    'semester', v_sem,
    'parent_note_limit', (private.portal_setting('parent_note_limit'))::int,
    'note_days_limit', (private.portal_setting('note_days_limit'))::int,
    'cutoff', private.portal_setting('dismissal_cutoff')#>>'{}',
    'bus_stops', private.portal_bus_stop_list(),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'student_id', s.student_id, 'is_guardian', private.portal_is_guardian(v_id, s.student_id), 'first_name', s.first_name, 'last_name', s.last_name, 'grade', s.grade, 'teacher', s.teacher,
        'am_transport', s.am_transport, 'am_bus_route', s.am_bus_route, 'pm_transport', s.pm_transport, 'pm_details', s.pm_details, 'pm_bus_route', s.pm_bus_route,
        'guardians', coalesce((select jsonb_agg(jsonb_build_object('name',g.name,'relationship',g.relationship,'phone',g.phone,'pin',private.portal_pin_of(g.person_key)) order by g.slot) from public.portal_guardians g where g.student_id=s.student_id),'[]'),
        'pickups', coalesce((select jsonb_agg(jsonb_build_object('name',btrim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),'relationship',p.relationship,'phone',p.phone,'pin',private.portal_pin_of(p.person_key),'key',p.person_key,'source',p.source,'pending',p.request_id is not null) order by p.first_name, p.last_name) from public.portal_pickups_eff p where p.student_id=s.student_id),'[]'),
        'parent_notes_approved', (select count(*) from public.portal_notes n where n.student_id=s.student_id and n.kind='parent' and n.status='approved' and n.semester=v_sem),
        'parent_notes_pending', (select count(*) from public.portal_notes n where n.student_id=s.student_id and n.kind='parent' and n.status='pending' and n.semester=v_sem),
        'upcoming_changes', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'period',t.period,'change_type',t.change_type,'start_date',t.start_date,'end_date',t.end_date,'weekdays',t.weekdays,'new_method',t.new_method,'new_details',t.new_details,'pickup_person',t.pickup_person,'status',t.status) order by t.start_date)
             from public.portal_transport_changes t where t.student_id=s.student_id and t.status<>'cancelled'
             and case t.change_type
                   when 'weekly' then t.end_date is null or t.end_date >= v_today
                   when 'permanent' then t.start_date >= v_today or t.created_at > now() - interval '14 days'
                   else coalesce(t.end_date,t.start_date) >= v_today end),'[]')
      ) order by s.last_name, s.first_name)
      from public.portal_students s where s.student_id in (select private.portal_student_ids(v_id))),'[]')
  );
end $function$;

-- ---------- office ----------
create or replace function public.staff_enter_change(p jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare e text := private.portal_staff_guard(); v_type text := p->>'type'; v_sid bigint := (p->>'student_id')::bigint; s public.portal_students;
  v_at timestamptz; v_id uuid; v_cur text; r public.portal_pickup_requests; v_name text := (select name from public.portal_staff where email = e);
  v_ct text := p->>'change_type'; v_days smallint[] := private.portal_weekdays(p->'weekdays'); v_start date; v_end date;
begin
  select * into s from public.portal_students where student_id = v_sid;
  if s is null then raise exception 'pick_student'; end if;
  v_at := coalesce(((private.portal_today()::text || ' ' || nullif(p->>'time',''))::timestamp at time zone 'America/New_York'), now());
  if v_type = 'transport' then
    if p->>'period' not in ('afternoon','morning') or v_ct not in ('one_day','date_range','permanent','weekly') or nullif(p->>'new_method','') is null or nullif(p->>'start_date','') is null then raise exception 'missing_fields'; end if;
    if p->>'new_method' = 'Bus Rider' and not exists(select 1 from jsonb_array_elements(private.portal_bus_stop_list()) x where x->>'stop' = btrim(coalesce(p->>'new_details',''))) then raise exception 'need_bus'; end if;
    v_start := (p->>'start_date')::date;
    v_end := case v_ct when 'date_range' then nullif(p->>'end_date','')::date when 'one_day' then v_start when 'weekly' then nullif(p->>'end_date','')::date end;
    if v_ct = 'date_range' and (v_end is null or v_end < v_start) then raise exception 'bad_range'; end if;
    if v_ct = 'weekly' then
      if cardinality(v_days) = 0 then raise exception 'need_weekdays'; end if;
      if v_end is not null and v_end < v_start then raise exception 'bad_range'; end if;
    else v_days := null; end if;
    v_cur := case when p->>'period'='afternoon' then concat_ws(' — ', s.pm_transport, s.pm_details, s.pm_bus_route) else concat_ws(' — ', s.am_transport, s.am_bus_route) end;
    insert into public.portal_transport_changes(student_id,period,change_type,start_date,end_date,weekdays,current_method,new_method,new_details,pickup_person,pickup_phone,pickup_relationship,comments,submitted_by,submitted_name,source)
    values (v_sid, p->>'period', v_ct, v_start, v_end, v_days,
      v_cur, p->>'new_method', nullif(btrim(p->>'new_details'),''), nullif(btrim(p->>'pickup_person'),''), nullif(btrim(p->>'pickup_phone'),''), nullif(btrim(p->>'pickup_relationship'),''),
      nullif(btrim(p->>'comments'),''), e, coalesce(v_name, e) || ' (office)', 'office') returning id into v_id;
  elsif v_type in ('pickup_add','pickup_remove') then
    r := private.portal_pickup_apply(v_sid, case v_type when 'pickup_add' then 'add' else 'remove' end, nullif(btrim(p->>'first_name'),''), nullif(btrim(p->>'last_name'),''),
      nullif(btrim(p->>'relationship'),''), nullif(btrim(p->>'phone'),''), nullif(lower(btrim(p->>'email')),''), p->>'person_key', 'office', e, coalesce(v_name, e) || ' (office)', nullif(btrim(p->>'comments'),''));
    return jsonb_build_object('ok', true, 'id', r.id, 'pin', private.portal_pin_of(r.person_key));
  elsif v_type in ('late_in','early_out') then
    if nullif(btrim(p->>'person_name'),'') is null or nullif(btrim(p->>'reason'),'') is null then raise exception 'missing_fields'; end if;
    insert into public.portal_signins(kind, student_id, person_key, person_name, relationship, pin, method, reason, entered_by, created_at)
    values (v_type, v_sid, nullif(p->>'person_key',''), btrim(p->>'person_name'), nullif(btrim(p->>'relationship'),''), private.portal_pin_of(nullif(p->>'person_key','')),
      'office', btrim(left(p->>'reason',300)), e, v_at) returning id into v_id;
  elsif v_type = 'other' then
    if nullif(btrim(p->>'details'),'') is null then raise exception 'missing_fields'; end if;
    insert into public.portal_office_changes(student_id, details, created_by) values (v_sid, btrim(left(p->>'details',2000)), e) returning id into v_id;
  else raise exception 'bad_type'; end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

create or replace function public.staff_transport(p_from date default null, p_to date default null, p_q text default null, p_status text default null, p_by text default 'submitted') returns jsonb
language plpgsql stable security definer set search_path to '' as $function$
begin
  perform private.portal_staff_guard();
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select to_jsonb(t) || jsonb_build_object('student', s.last_name||', '||s.first_name, 'grade', s.grade, 'teacher', s.teacher, 'pickup_pin', (select pe.pin from public.portal_people pe where pe.person_key in (
        select g.person_key from public.portal_guardians g where g.student_id = t.student_id and lower(btrim(g.name)) = lower(btrim(t.pickup_person))
        union select pk.person_key from public.portal_pickups pk where pk.student_id = t.student_id and lower(btrim(coalesce(pk.first_name,'')||' '||coalesce(pk.last_name,''))) = lower(btrim(t.pickup_person))) limit 1)) x
    from public.portal_transport_changes t join public.portal_students s using(student_id)
    where (p_status is null or p_status='' or p_status='all' or t.status = p_status)
      and (p_q is null or p_q='' or s.first_name||' '||s.last_name ilike '%'||p_q||'%' or s.last_name||', '||s.first_name ilike '%'||p_q||'%'
           or coalesce(t.submitted_name,'') ilike '%'||p_q||'%' or coalesce(t.pickup_person,'') ilike '%'||p_q||'%')
      and case when p_by = 'effective' then
             (p_from is null or coalesce(t.end_date,'9999-12-31'::date) >= p_from) and (p_to is null or t.start_date <= p_to)
             -- a weekly change only counts if one of its weekdays falls in the range
             and (t.change_type <> 'weekly' or p_from is null or p_to is null or p_to - p_from >= 6
                  or exists(select 1 from generate_series(greatest(p_from, t.start_date), least(p_to, coalesce(t.end_date, p_to)), interval '1 day') g
                            where extract(isodow from g)::smallint = any(t.weekdays)))
           else
             (p_from is null or (t.created_at at time zone 'America/New_York')::date >= p_from) and (p_to is null or (t.created_at at time zone 'America/New_York')::date <= p_to)
           end
    order by t.created_at desc limit 3000) q),'[]');
end $function$;

create or replace function public.staff_me() returns jsonb
language plpgsql stable security definer set search_path to '' as $function$
declare e text := private.portal_staff_guard();
begin
  return jsonb_build_object('email', e, 'name', (select name from public.portal_staff where email = e), 'roles', (select to_jsonb(private.portal_roles_eff(roles)) from public.portal_staff where email = e),
    'today', private.portal_today(), 'semester', private.portal_semester(private.portal_today()),
    'pending_notes', (select count(*) from public.portal_notes where status='pending'),
    'ban_alerts', (select count(*) from public.portal_ban_alerts where seen_at is null),
    'new_changes', (select count(*) from public.portal_transport_changes where status='new'),
    'today_changes', (select count(*) from public.portal_transport_changes c where private.portal_change_on(c, private.portal_today())),
    'students', (select count(*) from public.portal_students where active),
    'signins_today', (select count(*) from public.portal_signins where (created_at at time zone 'America/New_York')::date = private.portal_today()),
    'pickup_todo', (select count(*) from public.portal_pickup_requests where not sis_done and (status='active' or resolved_at is not null)),
    'notes_todo', (select count(*) from public.portal_notes where not sis_done),
    'other_todo', (select count(*) from public.portal_office_changes where not sis_done),
    'signins_todo', (select count(*) from public.portal_signins where not facts_done),
    'last_import', (select to_jsonb(i) from public.portal_imports i order by imported_at desc limit 1));
end $function$;

-- Day names for alert wording: {5} -> 'Fridays', {1,3} -> 'Mondays & Wednesdays'
create or replace function private.portal_weekday_names(d smallint[]) returns text
language sql immutable as $$
  select string_agg((array['Mondays','Tuesdays','Wednesdays','Thursdays','Fridays'])[x], ' & ' order by x) from unnest(d) x;
$$;

create or replace function private.portal_transport_alerts() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_first text := private.portal_first(new.student_id); v_when text; v_rows jsonb; v_ok boolean;
begin
  if new.source is distinct from 'parent' or new.status = old.status or new.status not in ('processed','cancelled') then return null; end if;
  v_ok := new.status = 'processed';
  v_when := case new.change_type when 'date_range' then private.portal_day(new.start_date) || ' – ' || private.portal_day(new.end_date)
    when 'permanent' then 'starting ' || private.portal_day(new.start_date)
    when 'weekly' then 'every ' || private.portal_weekday_names(new.weekdays) || ' starting ' || private.portal_day(new.start_date)
      || coalesce(' until ' || private.portal_day(new.end_date), '')
    else private.portal_day(new.start_date) end;
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

-- Parent history and the office student page: include the weekdays.
do $$ declare d text;
begin
  d := pg_get_functiondef('public.portal_parent_history(text,text)'::regprocedure);
  if d not like '%weekdays%' then execute replace(d, '''end_date'',t.end_date,', '''end_date'',t.end_date,''weekdays'',t.weekdays,'); end if;
  d := pg_get_functiondef('public.staff_student(bigint)'::regprocedure);
  if d not like '%''weekdays''%' then execute replace(d, '''end_date'', end_date,', '''end_date'', end_date, ''weekdays'', weekdays,'); end if;
end $$;
