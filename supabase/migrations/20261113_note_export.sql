-- Admin export of excused notes as individual PDFs into the school's other system.
-- Each note is exported once: exported_at / exported_by are set when the admin's browser downloads its PDF.
-- Only reviewed notes (approved or rejected) are exported; pending notes wait until the office decides.
alter table public.portal_notes add column if not exists exported_at timestamptz;
alter table public.portal_notes add column if not exists exported_by text;

-- Notes not yet exported, oldest first.
create or replace function public.staff_notes_to_export() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  perform private.portal_admin_guard();
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'student_id', n.student_id, 'student', s.last_name || ', ' || s.first_name,
      'kind', n.kind, 'absent_date', n.absent_date, 'status', n.status) order by n.created_at)
    from public.portal_notes n join public.portal_students s using (student_id)
    where n.exported_at is null and n.status in ('approved','rejected')), '[]');
end $$;
grant execute on function public.staff_notes_to_export() to authenticated;

create or replace function public.staff_note_exported(p_id uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare e text := private.portal_admin_guard();
begin
  update public.portal_notes set exported_at = now(), exported_by = e where id = p_id and exported_at is null;
end $$;
grant execute on function public.staff_note_exported(uuid) to authenticated;

-- Show the export date in the office list.
do $$ declare d text;
begin
  d := pg_get_functiondef('public.staff_notes(text,text,text,integer)'::regprocedure);
  if d not like '%exported_at%' then
    execute replace(d, '''review_note'',n.review_note,', '''review_note'',n.review_note,''exported_at'',n.exported_at,''exported_by'',n.exported_by,');
  end if;
end $$;
