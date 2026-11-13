-- Doctor's notes scanned at the front office.
-- The scanner posts the PDF to https://portal.csjax.org/api/scan/<scan_key> (campus network only).
-- Scans wait in portal_scans until the office picks the student + date(s); then they become a pending doctor's note.
create table if not exists public.portal_scans (
  id uuid primary key default gen_random_uuid(),
  filename text not null, mime text not null, size int not null, data bytea not null,
  received_at timestamptz not null default now(), source_ip text,
  note_id uuid references public.portal_notes(id) on delete set null,
  assigned_at timestamptz, assigned_by text,
  deleted_at timestamptz, deleted_by text);
alter table public.portal_scans enable row level security;
create index if not exists portal_scans_open on public.portal_scans (received_at) where note_id is null and deleted_at is null;

insert into private.config(key, value) select 'scan_key', encode(extensions.gen_random_bytes(12), 'hex')
where not exists (select 1 from private.config where key = 'scan_key');

-- Called by /api/scan (server, portal API key) with the key from the URL.
create or replace function public.portal_scan_add(p_key text, p_scan_key text, p_name text, p_mime text, p_b64 text, p_ip text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v uuid; b bytea;
begin
  if not private.portal_key_ok(p_key) then raise exception 'forbidden'; end if;
  if p_scan_key is distinct from (select value from private.config where key = 'scan_key') then raise exception 'bad_scan_key'; end if;
  if p_mime not in ('application/pdf','image/jpeg','image/png','image/tiff') then raise exception 'bad_type'; end if;
  b := decode(p_b64, 'base64');
  if length(b) < 100 then raise exception 'empty_file'; end if;
  if length(b) > 20 * 1024 * 1024 then raise exception 'too_big'; end if;
  insert into public.portal_scans(filename, mime, size, data, source_ip)
  values (coalesce(nullif(btrim(p_name), ''), 'scan-' || to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD-HH24MI') || '.pdf'), p_mime, length(b), b, p_ip)
  returning id into v;
  return jsonb_build_object('ok', true, 'id', v);
end $$;

-- Office: scans waiting to be matched to a student.
create or replace function public.staff_scans() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_staff_guard();
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'filename', filename, 'mime', mime, 'size', size, 'received_at', received_at) order by received_at)
    from public.portal_scans where note_id is null and deleted_at is null), '[]');
end $$;

create or replace function public.staff_scan(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_staff_guard();
  return (select jsonb_build_object('id', id, 'filename', filename, 'mime', mime, 'size', size, 'received_at', received_at, 'data', encode(data, 'base64'))
    from public.portal_scans where id = p_id);
end $$;

-- Turn a scan into a pending doctor's note for the chosen student and date(s).
create or replace function public.staff_scan_assign(p_id uuid, p_student bigint, p_date date, p_end date default null,
  p_provider text default null, p_comments text default null) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_staff_guard(); sc public.portal_scans; v_note uuid; v_name text := (select name from public.portal_staff where email = e);
begin
  select * into sc from public.portal_scans where id = p_id for update;
  if sc is null or sc.deleted_at is not null then raise exception 'scan_not_found'; end if;
  if sc.note_id is not null then raise exception 'scan_already_added'; end if;
  if not exists(select 1 from public.portal_students where student_id = p_student) then raise exception 'pick_student'; end if;
  if p_date is null then raise exception 'need_date'; end if;
  if p_end is not null and p_end < p_date then raise exception 'bad_range'; end if;
  insert into public.portal_notes(student_id, kind, absent_date, absent_end, reason, provider, comments, parent_name, submitted_by, semester)
  values (p_student, 'doctor', p_date, nullif(p_end, p_date), 'Doctor''s note', nullif(btrim(p_provider), ''), nullif(btrim(left(p_comments, 1000)), ''),
          'Turned in at the front office', 'office:' || e, private.portal_semester(p_date))
  returning id into v_note;
  insert into public.portal_note_files(note_id, filename, mime, size, data) values (v_note, sc.filename, sc.mime, sc.size, sc.data);
  update public.portal_scans set note_id = v_note, assigned_at = now(), assigned_by = e where id = p_id;
  return jsonb_build_object('ok', true, 'note_id', v_note);
end $$;

create or replace function public.staff_scan_delete(p_id uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_staff_guard();
begin
  update public.portal_scans set deleted_at = now(), deleted_by = e where id = p_id and note_id is null;
end $$;

grant execute on function public.staff_scans(), public.staff_scan(uuid), public.staff_scan_assign(uuid, bigint, date, date, text, text), public.staff_scan_delete(uuid) to authenticated;

-- Office-entered notes don't need the "note submitted" email to Sandy and Donald (the office already has it).
do $$ declare d text;
begin
  d := pg_get_functiondef('private.portal_note_alerts()'::regprocedure);
  if d not like '%office:%' then
    execute replace(d, 'if tg_op = ''INSERT'' then', 'if tg_op = ''INSERT'' and new.submitted_by like ''office:%'' then return null;
  elsif tg_op = ''INSERT'' then');
  end if;
end $$;

-- Admins can see the scanner address (for setting up the scanner).
create or replace function public.staff_scan_key() returns text
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_admin_guard();
  return (select value from private.config where key = 'scan_key');
end $$;
grant execute on function public.staff_scan_key() to authenticated;
