-- Weekly changes can repeat every week or every other week (week_interval 1 or 2; up to 4 allowed).
-- The weeks counted are the ones starting with the week of start_date (Mon–Fri weeks).
alter table public.portal_transport_changes add column if not exists week_interval smallint not null default 1;
alter table public.portal_transport_changes drop constraint if exists portal_transport_changes_week_interval_check;
alter table public.portal_transport_changes add constraint portal_transport_changes_week_interval_check check (week_interval between 1 and 4);

create or replace function private.portal_change_on(c public.portal_transport_changes, d date) returns boolean
language sql immutable as $$
  select c.status <> 'cancelled' and c.start_date <= d and case c.change_type
    when 'permanent' then true
    when 'weekly' then (c.end_date is null or c.end_date >= d) and extract(isodow from d)::smallint = any(c.weekdays)
      and ((date_trunc('week', d)::date - date_trunc('week', c.start_date)::date) / 7) % greatest(c.week_interval, 1) = 0
    else coalesce(c.end_date, c.start_date) >= d end;
$$;

create or replace function private.portal_week_interval(p jsonb) returns smallint
language sql immutable as $$ select case when p->>'week_interval' ~ '^[1-4]$' then (p->>'week_interval')::smallint else 1 end $$;

-- Wording: "every Friday" / "every other Friday" / "every 3rd week on Fridays"
create or replace function private.portal_weekly_text(d smallint[], n smallint) returns text
language sql immutable as $$
  select case coalesce(n, 1) when 1 then 'every ' when 2 then 'every other ' else 'every ' || n || ' weeks on ' end
    || string_agg((array['Monday','Tuesday','Wednesday','Thursday','Friday'])[x], ' & ' order by x) from unnest(d) x;
$$;

-- Non-weekly changes always store week_interval = 1.
create or replace function private.portal_set_week_interval() returns trigger
language plpgsql as $$
begin
  if new.change_type <> 'weekly' then new.week_interval := 1; end if;
  return new;
end $$;
drop trigger if exists portal_set_week_interval on public.portal_transport_changes;
create trigger portal_set_week_interval before insert or update on public.portal_transport_changes for each row execute function private.portal_set_week_interval();

do $$ declare d text;
begin
  -- parent submit + office entry: store week_interval
  d := pg_get_functiondef('public.portal_transport_submit(text,text,jsonb)'::regprocedure);
  if d not like '%week_interval%' then
    d := replace(d, 'start_date,end_date,weekdays,current_method', 'start_date,end_date,weekdays,week_interval,current_method');
    d := replace(d, 'v_start, v_end, v_days, v_cur', 'v_start, v_end, v_days, private.portal_week_interval(p), v_cur');
    execute d;
  end if;
  d := pg_get_functiondef('public.staff_enter_change(jsonb)'::regprocedure);
  if d not like '%week_interval%' then
    d := replace(d, 'start_date,end_date,weekdays,current_method', 'start_date,end_date,weekdays,week_interval,current_method');
    d := replace(d, 'v_start, v_end, v_days,', 'v_start, v_end, v_days, private.portal_week_interval(p),');
    execute d;
  end if;
  -- parent home/history + office student page: include week_interval
  d := pg_get_functiondef('public.portal_parent_home(text,text)'::regprocedure);
  if d not like '%week_interval%' then execute replace(d, '''weekdays'',t.weekdays,', '''weekdays'',t.weekdays,''week_interval'',t.week_interval,'); end if;
  d := pg_get_functiondef('public.portal_parent_history(text,text)'::regprocedure);
  if d not like '%week_interval%' then execute replace(d, '''weekdays'',t.weekdays,', '''weekdays'',t.weekdays,''week_interval'',t.week_interval,'); end if;
  d := pg_get_functiondef('public.staff_student(bigint)'::regprocedure);
  if d not like '%week_interval%' then execute replace(d, '''weekdays'', weekdays,', '''weekdays'', weekdays, ''week_interval'', week_interval,'); end if;
  -- office list "effective" filter: check the actual days for any range under 2 weeks x interval
  d := pg_get_functiondef('public.staff_transport(date,date,text,text,text)'::regprocedure);
  if d not like '%portal_change_on%' then
    d := replace(d, 'or p_to - p_from >= 6', 'or p_to - p_from >= 7 * t.week_interval - 1');
    d := replace(d, 'where extract(isodow from g)::smallint = any(t.weekdays)))', 'where private.portal_change_on(t, g::date)))');
    execute d;
  end if;
  -- approval/rejection alert wording
  d := pg_get_functiondef('private.portal_transport_alerts()'::regprocedure);
  if d not like '%portal_weekly_text%' then
    execute replace(d, '''every '' || private.portal_weekday_names(new.weekdays)', 'private.portal_weekly_text(new.weekdays, new.week_interval)');
  end if;
end $$;
