-- BANNED person at the kiosk: email Admin/Office staff only (no texts).
create or replace function private.portal_ban_kiosk_alert() returns trigger
language plpgsql security definer set search_path to '' as $$
declare b public.portal_banned; t text := to_char(new.at at time zone 'America/New_York', 'FMHH12:MI AM'); s text := private.portal_full(new.student_id);
begin
  if new.place <> 'kiosk' then return null; end if;
  select * into b from public.portal_banned where id = new.banned_id;
  perform private.portal_outbox_add(jsonb_build_object('kind', 'ban_kiosk', 'ref', new.id, 'student_id', new.student_id,
    'email_to', to_jsonb(array(select email from public.portal_staff where active and roles && array['admin','office'])),
    'email_subject', '⚠ BANNED person at the kiosk — ' || s,
    'email_title', 'BANNED person at the front office kiosk',
    'email_rows', jsonb_build_array(
      jsonb_build_array('Person', b.name || coalesce(' (' || b.relationship || ')', '')),
      jsonb_build_array('BANNED for', s),
      jsonb_build_array('Time', t)),
    'email_note', 'They entered their PIN at the kiosk. The kiosk told them to see the front office. Do not release the student to them.',
    'email_link', '/office'));
  return null;
end $$;
