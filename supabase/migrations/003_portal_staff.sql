-- Front office staff functions. Called from /office with the staff member's Supabase sign-in.
-- Every function checks that the signed-in email is an active row in public.portal_staff.

create or replace function public.portal_is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.portal_staff where active and email = lower(coalesce(auth.jwt()->>'email','')))
$$;

create or replace function private.portal_staff_guard() returns text
language plpgsql stable security definer set search_path = '' as $$
declare e text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if not exists(select 1 from public.portal_staff where active and email = e) then raise exception 'not_staff'; end if;
  return e;
end $$;

create or replace function public.staff_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e text := private.portal_staff_guard();
begin
  return jsonb_build_object('email', e, 'name', (select name from public.portal_staff where email = e),
    'today', private.portal_today(), 'semester', private.portal_semester(private.portal_today()),
    'pending_notes', (select count(*) from public.portal_notes where status='pending'),
    'new_changes', (select count(*) from public.portal_transport_changes where status='new'),
    'today_changes', (select count(*) from public.portal_transport_changes where status<>'cancelled' and private.portal_today() between start_date and coalesce(end_date, '9999-12-31'::date)),
    'students', (select count(*) from public.portal_students where active),
    'last_import', (select to_jsonb(i) from public.portal_imports i order by imported_at desc limit 1));
end $$;

create or replace function public.staff_notes(p_status text default 'pending', p_q text default null, p_kind text default null, p_limit int default 300) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.portal_staff_guard();
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select jsonb_build_object('id',n.id,'student_id',n.student_id,'student',s.last_name||', '||s.first_name,'grade',s.grade,'teacher',s.teacher,
      'kind',n.kind,'absent_date',n.absent_date,'absent_end',n.absent_end,'reason',n.reason,'reason_other',n.reason_other,'provider',n.provider,
      'parent_name',n.parent_name,'submitted_by',n.submitted_by,'status',n.status,'semester',n.semester,'created_at',n.created_at,
      'reviewed_by',n.reviewed_by,'reviewed_at',n.reviewed_at,'review_note',n.review_note,
      'files',(select count(*) from public.portal_note_files f where f.note_id=n.id),
      'approved_parent_notes',(select count(*) from public.portal_notes m where m.student_id=n.student_id and m.kind='parent' and m.status='approved' and m.semester=n.semester)) x
    from public.portal_notes n join public.portal_students s using(student_id)
    where (p_status is null or p_status='all' or n.status=p_status)
      and (p_kind is null or n.kind=p_kind)
      and (p_q is null or p_q='' or s.first_name||' '||s.last_name ilike '%'||p_q||'%' or s.last_name||', '||s.first_name ilike '%'||p_q||'%' or n.student_id::text=p_q)
    order by n.created_at desc limit greatest(1,least(p_limit,2000))) q),'[]');
end $$;

create or replace function public.staff_note(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.portal_staff_guard();
  return (select to_jsonb(n) - 'submitted_by' || jsonb_build_object('submitted_by', n.submitted_by,
      'student', s.first_name||' '||s.last_name,'grade',s.grade,'teacher',s.teacher,
      'approved_parent_notes',(select count(*) from public.portal_notes m where m.student_id=n.student_id and m.kind='parent' and m.status='approved' and m.semester=n.semester),
      'files', coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename,'mime',f.mime,'size',f.size,'data',encode(f.data,'base64')) order by f.created_at) from public.portal_note_files f where f.note_id=n.id),'[]'))
    from public.portal_notes n join public.portal_students s using(student_id) where n.id = p_id);
end $$;

create or replace function public.staff_note_review(p_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text := private.portal_staff_guard(); r public.portal_notes; v_used int; v_lim int := (private.portal_setting('parent_note_limit'))::int;
begin
  if p_status not in ('approved','rejected','pending') then raise exception 'bad_status'; end if;
  select * into r from public.portal_notes where id = p_id for update;
  if r is null then raise exception 'not_found'; end if;
  if p_status = 'approved' and r.kind = 'parent' and r.status <> 'approved' then
    select count(*) into v_used from public.portal_notes where student_id=r.student_id and kind='parent' and status='approved' and semester=r.semester;
    if v_used >= v_lim then raise exception 'limit_reached'; end if;
  end if;
  update public.portal_notes set status = p_status, review_note = nullif(btrim(p_note),''),
    reviewed_by = case when p_status='pending' then null else e end, reviewed_at = case when p_status='pending' then null else now() end
  where id = p_id returning * into r;
  return jsonb_build_object('id', r.id, 'status', r.status);
end $$;

create or replace function public.staff_transport(p_from date default null, p_to date default null, p_q text default null, p_status text default null, p_by text default 'submitted') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.portal_staff_guard();
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select to_jsonb(t) || jsonb_build_object('student', s.last_name||', '||s.first_name, 'grade', s.grade, 'teacher', s.teacher) x
    from public.portal_transport_changes t join public.portal_students s using(student_id)
    where (p_status is null or p_status='' or p_status='all' or t.status = p_status)
      and (p_q is null or p_q='' or s.first_name||' '||s.last_name ilike '%'||p_q||'%' or s.last_name||', '||s.first_name ilike '%'||p_q||'%'
           or coalesce(t.submitted_name,'') ilike '%'||p_q||'%' or coalesce(t.pickup_person,'') ilike '%'||p_q||'%')
      and case when p_by = 'effective' then
             (p_from is null or coalesce(t.end_date,'9999-12-31'::date) >= p_from) and (p_to is null or t.start_date <= p_to)
           else
             (p_from is null or (t.created_at at time zone 'America/New_York')::date >= p_from) and (p_to is null or (t.created_at at time zone 'America/New_York')::date <= p_to)
           end
    order by t.created_at desc limit 3000) q),'[]');
end $$;

create or replace function public.staff_transport_set(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text := private.portal_staff_guard();
begin
  if p_status not in ('new','processed','cancelled') then raise exception 'bad_status'; end if;
  update public.portal_transport_changes set status = p_status,
    processed_by = case when p_status='new' then null else e end, processed_at = case when p_status='new' then null else now() end
  where id = p_id;
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

create or replace function public.staff_students(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_sem text := private.portal_semester(private.portal_today());
begin
  perform private.portal_staff_guard();
  return coalesce((select jsonb_agg(jsonb_build_object('student_id',s.student_id,'name',s.last_name||', '||s.first_name,'grade',s.grade,'teacher',s.teacher,'active',s.active,
      'am',concat_ws(' — ',s.am_transport,s.am_bus_route),'pm',concat_ws(' — ',s.pm_transport,s.pm_details,s.pm_bus_route),
      'guardians',coalesce((select jsonb_agg(jsonb_build_object('name',g.name,'relationship',g.relationship,'phone',g.phone,'email',g.email) order by g.slot) from public.portal_guardians g where g.student_id=s.student_id),'[]'),
      'pickups',coalesce((select jsonb_agg(jsonb_build_object('name',btrim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),'relationship',p.relationship,'phone',p.phone)) from public.portal_pickups p where p.student_id=s.student_id),'[]'),
      'parent_notes_approved',(select count(*) from public.portal_notes n where n.student_id=s.student_id and n.kind='parent' and n.status='approved' and n.semester=v_sem),
      'doctor_notes',(select count(*) from public.portal_notes n where n.student_id=s.student_id and n.kind='doctor' and n.semester=v_sem)
    ) order by s.last_name, s.first_name)
    from public.portal_students s
    where p_q is not null and length(btrim(p_q)) >= 2 and (s.first_name||' '||s.last_name ilike '%'||btrim(p_q)||'%' or s.last_name||', '||s.first_name ilike '%'||btrim(p_q)||'%' or s.student_id::text = btrim(p_q)
      or exists(select 1 from public.portal_guardians g where g.student_id=s.student_id and (g.name ilike '%'||btrim(p_q)||'%' or g.email ilike '%'||btrim(p_q)||'%' or g.phone10 = public.portal_norm_id(p_q))))
    limit 50),'[]');
end $$;

create or replace function public.staff_staff_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.portal_staff_guard();
  return coalesce((select jsonb_agg(jsonb_build_object('email',st.email,'name',st.name,'active',st.active,'has_login', exists(select 1 from auth.users u where lower(u.email)=st.email)) order by st.email) from public.portal_staff st),'[]');
end $$;

create or replace function public.staff_staff_save(p_email text, p_name text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text := private.portal_staff_guard(); v text := lower(btrim(p_email));
begin
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  if v = e and not p_active then raise exception 'cant_remove_self'; end if;
  insert into public.portal_staff(email,name,active) values (v, nullif(btrim(p_name),''), p_active)
  on conflict (email) do update set name = coalesce(excluded.name, public.portal_staff.name), active = excluded.active;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.portal_staff_guard();
  return (select jsonb_object_agg(key, value) from public.portal_settings);
end $$;

create or replace function public.staff_settings_set(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text := private.portal_staff_guard();
begin
  if p_key not in ('semesters','parent_note_limit','note_days_limit','dismissal_cutoff') then raise exception 'bad_setting'; end if;
  if p_key = 'semesters' then perform (s->>'start')::date, (s->>'end')::date from jsonb_array_elements(p_value) s; end if;
  if p_key = 'dismissal_cutoff' then perform (p_value#>>'{}')::time; end if;
  if p_key in ('parent_note_limit','note_days_limit') and ((p_value#>>'{}')::int < 0 or (p_value#>>'{}')::int > 60) then raise exception 'bad_setting'; end if;
  update public.portal_settings set value = p_value, updated_at = now(), updated_by = e where key = p_key;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_roster_import(p_rows jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text := private.portal_staff_guard();
begin
  return private.portal_roster_import(p_rows, e, p_force);
end $$;

create or replace function public.staff_imports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.portal_staff_guard();
  return coalesce((select jsonb_agg(to_jsonb(i) order by i.imported_at desc) from (select * from public.portal_imports order by imported_at desc limit 20) i),'[]');
end $$;

do $$ declare f text; begin
  foreach f in array array['portal_is_staff()','staff_me()','staff_notes(text,text,text,int)','staff_note(uuid)','staff_note_review(uuid,text,text)',
    'staff_transport(date,date,text,text,text)','staff_transport_set(uuid,text)','staff_students(text)','staff_staff_list()',
    'staff_staff_save(text,text,boolean)','staff_settings()','staff_settings_set(text,jsonb)','staff_roster_import(jsonb,boolean)','staff_imports()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function private.portal_staff_guard() from public, anon, authenticated;
