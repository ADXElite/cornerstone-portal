-- Nov 13, 2026: an excused note can't be marked "Entered in FACTS" until the office approves or rejects it.
-- Moving a note back to pending also clears its FACTS check.
create or replace function public.staff_note_sis(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path to '' as $function$
declare e text := private.portal_staff_guard(); v_status text;
begin
  select status into v_status from public.portal_notes where id = p_id;
  if v_status is null then raise exception 'not_found'; end if;
  if p_done and v_status = 'pending' then raise exception 'Review the note and click Approve or Reject before marking it entered in FACTS.'; end if;
  update public.portal_notes set sis_done = p_done, sis_by = case when p_done then e end, sis_at = case when p_done then now() end where id = p_id;
end $function$;

create or replace function public.staff_note_review(p_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path to '' as $function$
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
    reviewed_by = case when p_status='pending' then null else e end, reviewed_at = case when p_status='pending' then null else now() end,
    sis_done = case when p_status='pending' then false else sis_done end,
    sis_by = case when p_status='pending' then null else sis_by end,
    sis_at = case when p_status='pending' then null else sis_at end
  where id = p_id returning * into r;
  return jsonb_build_object('id', r.id, 'status', r.status);
end $function$;
