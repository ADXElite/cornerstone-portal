-- Supabase blocks DELETE without WHERE on API calls (pg_safeupdate), which broke the FACTS student import
-- ("Database error: DELETE requires a WHERE clause"). Same function, with "where true".
create or replace function private.portal_snap_links() returns void
language plpgsql security definer set search_path to '' as $function$
begin
  delete from public.portal_link_snapshot where true;
  insert into public.portal_link_snapshot(student_id, kind, name, relationship, phone, phone10, email, person_key, pin)
  select g.student_id, 'guardian', btrim(g.name), g.relationship, g.phone, g.phone10, lower(g.email), g.person_key, private.portal_pin_of(g.person_key)
  from public.portal_guardians g join public.portal_students s on s.student_id = g.student_id and s.active
  where nullif(btrim(g.name), '') is not null
  union all
  select p.student_id, 'pickup', btrim(concat_ws(' ', p.first_name, p.last_name)), p.relationship, p.phone, public.portal_norm_id(p.phone), lower(p.email), p.person_key, private.portal_pin_of(p.person_key)
  from public.portal_pickups p join public.portal_students s on s.student_id = p.student_id and s.active
  where nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') is not null;
end $function$;
