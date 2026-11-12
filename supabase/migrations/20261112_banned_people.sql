-- ============ BANNED people ============
-- A parent/guardian or pick-up person who was under a student in one FACTS file and is gone in the next
-- stays listed under that student as BANNED: they can't sign in to the parent app, their PIN doesn't work at the
-- kiosk (and alerts the office), and car line / extended care staff see them in red with an alert.

create table if not exists public.portal_link_snapshot (
  student_id bigint not null, kind text not null, name text, relationship text, phone text, phone10 text, email text, person_key text, pin text
);
alter table public.portal_link_snapshot enable row level security;

create table if not exists public.portal_banned (
  id bigserial primary key,
  student_id bigint not null references public.portal_students(student_id),
  kind text not null check (kind in ('guardian','pickup')),
  name text not null, relationship text, phone text, phone10 text, email text, person_key text, pin text,
  banned_at timestamptz not null default now(),
  cleared_at timestamptz, cleared_by text
);
alter table public.portal_banned enable row level security;
create index if not exists portal_banned_student on public.portal_banned(student_id) where cleared_at is null;
create index if not exists portal_banned_pin on public.portal_banned(pin) where cleared_at is null;

create table if not exists public.portal_ban_alerts (
  id bigserial primary key,
  banned_id bigint references public.portal_banned(id),
  student_id bigint references public.portal_students(student_id),
  place text not null, detail text, by_email text,
  at timestamptz not null default now(),
  seen_at timestamptz, seen_by text
);
alter table public.portal_ban_alerts enable row level security;

-- Everyone currently under each active student, as FACTS sent them (with their PIN).
create or replace function private.portal_snap_links() returns void
language plpgsql security definer set search_path to '' as $$
begin
  delete from public.portal_link_snapshot;
  insert into public.portal_link_snapshot(student_id, kind, name, relationship, phone, phone10, email, person_key, pin)
  select g.student_id, 'guardian', btrim(g.name), g.relationship, g.phone, g.phone10, lower(g.email), g.person_key, private.portal_pin_of(g.person_key)
  from public.portal_guardians g join public.portal_students s on s.student_id = g.student_id and s.active
  where nullif(btrim(g.name), '') is not null
  union all
  select p.student_id, 'pickup', btrim(concat_ws(' ', p.first_name, p.last_name)), p.relationship, p.phone, public.portal_norm_id(p.phone), lower(p.email), p.person_key, private.portal_pin_of(p.person_key)
  from public.portal_pickups p join public.portal_students s on s.student_id = p.student_id and s.active
  where nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') is not null;
end $$;

-- Is this snapshot/banned person still under the student (same person key, name, cell phone or email)?
create or replace function private.portal_still_linked(p_student bigint, p_key text, p_name text, p_phone10 text, p_email text) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists(
    select 1 from (
      select g.person_key k, lower(btrim(g.name)) nm, g.phone10 ph, lower(g.email) em from public.portal_guardians g where g.student_id = p_student
      union all
      select e.person_key, lower(btrim(concat_ws(' ', e.first_name, e.last_name))), public.portal_norm_id(e.phone), lower(e.email) from public.portal_pickups_eff e where e.student_id = p_student) c
    where (p_key is not null and c.k = p_key)
       or (c.nm = lower(btrim(p_name)))
       or (p_phone10 ~ '^\d{10}$' and c.ph = p_phone10)
       or (p_email is not null and c.em = p_email))
$$;

-- Run after every roster import: ban people who disappeared, clear bans for people who came back, refresh the snapshot.
create or replace function private.portal_detect_bans() returns void
language plpgsql security definer set search_path to '' as $$
begin
  if exists(select 1 from public.portal_link_snapshot) then
    insert into public.portal_banned(student_id, kind, name, relationship, phone, phone10, email, person_key, pin)
    select distinct on (s.student_id, lower(s.name)) s.student_id, s.kind, s.name, s.relationship, s.phone, s.phone10, s.email, s.person_key, s.pin
    from public.portal_link_snapshot s
    join public.portal_students st on st.student_id = s.student_id and st.active
    where not private.portal_still_linked(s.student_id, s.person_key, s.name, s.phone10, s.email)
      and not exists(select 1 from public.portal_banned b where b.student_id = s.student_id and b.cleared_at is null and lower(b.name) = lower(s.name))
    order by s.student_id, lower(s.name), s.kind;
  end if;
  update public.portal_banned b set cleared_at = now(), cleared_by = 'Back in the FACTS file'
  where b.cleared_at is null and private.portal_still_linked(b.student_id, b.person_key, b.name, b.phone10, b.email);
  perform private.portal_snap_links();
end $$;

do $$
declare d text := pg_get_functiondef('private.portal_after_roster()'::regprocedure);
begin
  if position('portal_detect_bans' in d) = 0 then
    d := replace(d, '  from private.portal_facts_stops() f where f.matched_id is null;' || chr(10) || 'end',
                    '  from private.portal_facts_stops() f where f.matched_id is null;' || chr(10) ||
                    '  -- 5. People removed from a student since the last file become BANNED.' || chr(10) ||
                    '  perform private.portal_detect_bans();' || chr(10) || 'end');
    if position('portal_detect_bans' in d) = 0 then raise exception 'after_roster patch failed'; end if;
    execute d;
  end if;
end $$;

-- Start the snapshot from today's data (no one is banned by this).
select private.portal_snap_links();

-- ---------- sign-in: banned phone numbers / emails get nothing ----------
create or replace function private.portal_id_banned(p_id text) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.portal_banned b where b.cleared_at is null
    and ((b.phone10 ~ '^\d{10}$' and b.phone10 = public.portal_norm_id(p_id)) or (b.email is not null and b.email = public.portal_norm_id(p_id))))
$$;

create or replace function private.portal_my_keys(p_id text)
 returns setof text language sql stable security definer set search_path to '' as $function$
  select private.portal_same_person(array(
    select person_key from public.portal_guardians where person_key is not null and (phone10 = public.portal_norm_id(p_id) or email = public.portal_norm_id(p_id))
    union
    select person_key from public.portal_pickups_eff where person_key is not null
      and (public.portal_norm_id(phone) = public.portal_norm_id(p_id) or lower(email) = public.portal_norm_id(p_id))))
  where not private.portal_id_banned(p_id)
$function$;

-- ---------- kiosk: a banned person's PIN alerts the office ----------
do $$
declare f text; d text;
begin
  foreach f in array array['public.kiosk_pin(text,text)', 'public.kiosk_care_pin(text,text,text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('portal_banned' in d) = 0 then
      d := replace(d, '    insert into public.portal_kiosk_fails(kiosk_id) values (k);',
        '    if exists(select 1 from public.portal_banned b where b.cleared_at is null and b.pin = p_pin) then' || chr(10) ||
        '      insert into public.portal_ban_alerts(banned_id, student_id, place, detail)' || chr(10) ||
        '      select b.id, b.student_id, ''kiosk'', ''Entered their PIN at the front office kiosk'' from public.portal_banned b where b.cleared_at is null and b.pin = p_pin;' || chr(10) ||
        '      return jsonb_build_object(''error'', ''see_office'', ''alert'', (select jsonb_agg(jsonb_build_object(''person'', b.name, ''relationship'', b.relationship,' || chr(10) ||
        '        ''student'', s.first_name || '' '' || s.last_name, ''grade'', s.grade)) from public.portal_banned b join public.portal_students s on s.student_id = b.student_id' || chr(10) ||
        '        where b.cleared_at is null and b.pin = p_pin));' || chr(10) ||
        '    end if;' || chr(10) ||
        '    insert into public.portal_kiosk_fails(kiosk_id) values (k);');
      if position('portal_banned' in d) = 0 then raise exception 'kiosk patch failed for %', f; end if;
      execute d;
    end if;
  end loop;
end $$;

-- ---------- shared: banned people for a student ----------
create or replace function private.portal_banned_for(p_student bigint) returns jsonb
language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'relationship', b.relationship, 'phone', b.phone, 'email', b.email,
      'type', case b.kind when 'guardian' then 'Parent/Guardian' else 'Pick-Up' end, 'banned_at', b.banned_at) order by b.name), '[]')
  from public.portal_banned b where b.student_id = p_student and b.cleared_at is null
$$;

-- Car line / extended care staff tapped a banned person: log an alert for the office.
create or replace function public.duty_ban_alert(p_banned bigint, p_place text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_duty_guard(array['carline','bus','care']); b public.portal_banned;
begin
  select * into b from public.portal_banned where id = p_banned;
  if b is null then raise exception 'not_found'; end if;
  insert into public.portal_ban_alerts(banned_id, student_id, place, detail, by_email)
  values (b.id, b.student_id, case when p_place in ('carline','care') then p_place else 'carline' end,
          case when p_place = 'care' then 'Tried to sign the student out of extended care' else 'Tried to pick up the student in car line' end, e);
  return jsonb_build_object('ok', true);
end $$;

-- Car line people list + banned.
create or replace function public.duty_car_people(p_student bigint) returns jsonb
language plpgsql stable security definer set search_path to '' as $function$
begin
  perform private.portal_duty_guard(array['carline']);
  return jsonb_build_object(
    'student', (select jsonb_build_object('student_id', s.student_id, 'name', s.first_name||' '||s.last_name, 'grade', s.grade, 'teacher', private.portal_board_teacher(s))
                from public.portal_students s where s.student_id = p_student),
    'today_pickup', (select pickup_person from private.portal_plan_today() where student_id = p_student),
    'banned', private.portal_banned_for(p_student),
    'people', coalesce((select jsonb_agg(x order by (x->>'o')::int, x->>'name') from (
      select distinct on (k) jsonb_build_object('key', k, 'name', nm, 'relationship', rel, 'phone', ph, 'type', tp, 'o', o, 'pin', private.portal_pin_of(k)) x, k from (
        select g.person_key k, g.name nm, g.relationship rel, g.phone ph, 'Parent/guardian' tp, 1 o from public.portal_guardians g where g.student_id = p_student
        union all
        select e.person_key, btrim(coalesce(e.first_name,'')||' '||coalesce(e.last_name,'')), e.relationship, e.phone, 'Pick-up', 2 from public.portal_pickups_eff e where e.student_id = p_student) z
      order by k, o) y), '[]'));
end $function$;

-- Car line list: flag students with a banned person.
create or replace function public.duty_cars() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare v_today date := private.portal_today();
begin
  perform private.portal_duty_guard(array['carline']);
  return jsonb_build_object('date', v_today, 'attendance_in', exists(select 1 from public.portal_attendance where att_date = v_today),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'student_id', s.student_id, 'name', s.first_name||' '||s.last_name, 'last', s.last_name, 'first', s.first_name, 'grade', s.grade, 'teacher', private.portal_board_teacher(s),
        'status', pl.day_status, 'changed', pl.changed, 'pickup_person', pl.pickup_person,
        'banned', (select count(*) from public.portal_banned b where b.student_id = s.student_id and b.cleared_at is null),
        'done', x.at is not null, 'done_at', x.at, 'picked_by', x.person_name, 'picked_rel', x.relationship, 'marked_by', x.by_email)
        order by s.last_name, s.first_name)
      from private.portal_plan_today() pl join public.portal_students s using (student_id)
      left join public.portal_dismissals x on x.student_id = pl.student_id and x.day = v_today and x.kind = 'car'
      where pl.method = 'Car Rider'), '[]'));
end $$;

-- Extended care people list + banned.
create or replace function public.care_people(p_student bigint) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_duty_guard(array['care']);
  return jsonb_build_object(
    'student', (select jsonb_build_object('student_id', s.student_id, 'name', s.first_name||' '||s.last_name, 'grade', s.grade, 'teacher', s.teacher)
                from public.portal_students s where s.student_id = p_student),
    'banned', private.portal_banned_for(p_student),
    'people', coalesce((select jsonb_agg(x order by (x->>'o')::int, x->>'name') from (
      select distinct on (k) jsonb_build_object('key', k, 'name', nm, 'relationship', rel, 'phone', ph, 'type', tp, 'o', o, 'pin', private.portal_pin_of(k)) x, k from (
        select g.person_key k, g.name nm, g.relationship rel, g.phone ph, 'Parent/Guardian' tp, 1 o from public.portal_guardians g where g.student_id = p_student
        union all
        select e.person_key, btrim(coalesce(e.first_name,'')||' '||coalesce(e.last_name,'')), e.relationship, e.phone, 'Pick-Up', 2 from public.portal_pickups_eff e where e.student_id = p_student) z
      order by k, o) y), '[]'));
end $$;

-- ---------- office ----------
do $$
declare d text := pg_get_functiondef('public.staff_student(bigint)'::regprocedure);
begin
  if position('portal_banned' in d) = 0 then
    d := replace(d, '''archived_at'', (select archived_at from public.portal_students where student_id = p_id),',
      '''archived_at'', (select archived_at from public.portal_students where student_id = p_id),' || chr(10) ||
      '    ''banned'', coalesce((select jsonb_agg(jsonb_build_object(''id'', b.id, ''name'', b.name, ''relationship'', b.relationship, ''phone'', b.phone, ''email'', b.email,' || chr(10) ||
      '        ''type'', case b.kind when ''guardian'' then ''Parent/Guardian'' else ''Pick-Up'' end, ''banned_at'', b.banned_at, ''cleared_at'', b.cleared_at, ''cleared_by'', b.cleared_by) order by b.cleared_at nulls first, b.name)' || chr(10) ||
      '      from public.portal_banned b where b.student_id = p_id), ''[]''),');
    if position('portal_banned' in d) = 0 then raise exception 'staff_student patch failed'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.staff_me()'::regprocedure);
  if position('ban_alerts' in d) = 0 then
    d := replace(d, '''pending_notes'', (select count(*) from public.portal_notes where status=''pending''),',
      '''pending_notes'', (select count(*) from public.portal_notes where status=''pending''),' || chr(10) ||
      '    ''ban_alerts'', (select count(*) from public.portal_ban_alerts where seen_at is null),');
    if position('ban_alerts' in d) = 0 then raise exception 'staff_me patch failed'; end if;
    execute d;
  end if;
end $$;

create or replace function public.staff_ban_alerts() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_staff_guard();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'place', a.place, 'detail', a.detail, 'at', a.at, 'by', a.by_email,
      'person', b.name, 'relationship', b.relationship, 'student_id', s.student_id, 'student', s.last_name || ', ' || s.first_name, 'grade', s.grade, 'teacher', s.teacher)
      order by a.at desc)
    from public.portal_ban_alerts a join public.portal_banned b on b.id = a.banned_id join public.portal_students s on s.student_id = a.student_id
    where a.seen_at is null), '[]');
end $$;

create or replace function public.staff_ban_alert_seen(p_id bigint) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_staff_guard();
begin
  update public.portal_ban_alerts set seen_at = now(), seen_by = e where id = p_id and seen_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- Office lifts a ban (for example FACTS removed someone by mistake).
create or replace function public.staff_ban_clear(p_id bigint) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_staff_guard();
begin
  update public.portal_banned set cleared_at = now(), cleared_by = e where id = p_id and cleared_at is null;
  update public.portal_ban_alerts set seen_at = coalesce(seen_at, now()), seen_by = coalesce(seen_by, e) where banned_id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.duty_ban_alert(bigint, text), public.staff_ban_alerts(), public.staff_ban_alert_seen(bigint), public.staff_ban_clear(bigint) from public, anon;
grant execute on function public.duty_ban_alert(bigint, text), public.staff_ban_alerts(), public.staff_ban_alert_seen(bigint), public.staff_ban_clear(bigint) to authenticated;
revoke all on function private.portal_snap_links(), private.portal_detect_bans(), private.portal_still_linked(bigint,text,text,text,text),
  private.portal_id_banned(text), private.portal_banned_for(bigint) from public, anon, authenticated;
