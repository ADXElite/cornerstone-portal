-- 1) Office can upload a scanned file straight from their computer into Scanned Documents.
-- 2) Scans can also arrive from outside the campus network (Google Apps Script reading scan-to-email),
--    but only with a separate, longer key (scan_remote_key). The campus-only scan_key keeps working as before.
insert into private.config(key, value) select 'scan_remote_key', encode(extensions.gen_random_bytes(20), 'hex')
where not exists (select 1 from private.config where key = 'scan_remote_key');

drop function if exists public.portal_scan_add(text, text, text, text, text, text);
create or replace function public.portal_scan_add(p_key text, p_scan_key text, p_name text, p_mime text, p_b64 text, p_ip text, p_campus boolean default true) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v uuid; b bytea;
begin
  if not private.portal_key_ok(p_key) then raise exception 'forbidden'; end if;
  if not ((p_campus and p_scan_key = (select value from private.config where key = 'scan_key'))
          or p_scan_key = (select value from private.config where key = 'scan_remote_key')) then raise exception 'bad_scan_key'; end if;
  if p_mime not in ('application/pdf','image/jpeg','image/png','image/tiff') then raise exception 'bad_type'; end if;
  b := decode(p_b64, 'base64');
  if length(b) < 100 then raise exception 'empty_file'; end if;
  if length(b) > 20 * 1024 * 1024 then raise exception 'too_big'; end if;
  insert into public.portal_scans(filename, mime, size, data, source_ip)
  values (coalesce(nullif(btrim(p_name), ''), 'scan-' || to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD-HH24MI') || '.pdf'), p_mime, length(b), b, p_ip)
  returning id into v;
  return jsonb_build_object('ok', true, 'id', v);
end $$;

create or replace function public.staff_scan_upload(p_name text, p_mime text, p_b64 text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_staff_guard(); v uuid; b bytea;
begin
  if p_mime not in ('application/pdf','image/jpeg','image/png','image/tiff') then raise exception 'bad_type'; end if;
  b := decode(p_b64, 'base64');
  if length(b) < 100 then raise exception 'empty_file'; end if;
  if length(b) > 20 * 1024 * 1024 then raise exception 'too_big'; end if;
  insert into public.portal_scans(filename, mime, size, data, source_ip)
  values (coalesce(nullif(btrim(left(p_name, 120)), ''), 'upload.pdf'), p_mime, length(b), b, 'upload:' || e) returning id into v;
  return jsonb_build_object('ok', true, 'id', v);
end $$;
grant execute on function public.staff_scan_upload(text, text, text) to authenticated;

create or replace function public.staff_scan_key() returns text
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_admin_guard();
  return (select value from private.config where key = 'scan_key');
end $$;
create or replace function public.staff_scan_remote_key() returns text
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_admin_guard();
  return (select value from private.config where key = 'scan_remote_key');
end $$;
grant execute on function public.staff_scan_remote_key() to authenticated;
