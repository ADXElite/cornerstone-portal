-- Lets the office force the kiosk into a mode (am / pm / school) until a set time.
-- portal_settings key 'kiosk_mode_override' = {"mode":"am","until":"<timestamptz>"}
create or replace function public.kiosk_hello(p_token text) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare k uuid := private.portal_kiosk(p_token); o jsonb;
begin
  select value into o from public.portal_settings where key = 'kiosk_mode_override'
    and (value->>'until')::timestamptz > now() and value->>'mode' in ('am','pm','school');
  return jsonb_build_object('label', (select label from public.portal_kiosks where id = k), 'today', private.portal_today(),
    'now_et', to_char(now() at time zone 'America/New_York', 'HH24:MI'), 'mode_override', o);
end $function$;
