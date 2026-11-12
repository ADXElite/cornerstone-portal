// Signed-in parent actions.
//   GET  /api/parent?view=home|history
//   POST /api/parent {action:'note', ...}        excused absence note (parent note or doctor's note)
//   POST /api/parent {action:'file', note_id, name, mime, data}   doctor's note file (base64), one per request
//   POST /api/parent {action:'transport', ...}   transportation change -> emails every active office staff member
const C = require('../lib/core');

const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
const TYPE = { one_day: 'One day only', date_range: 'Date range', permanent: 'Permanent change' };

async function alertOffice(ch, req) {
  const to = await C.rpc('portal_staff_alert_emails', {});
  if (!to || !to.length) return;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const sameDay = ch.start_date === today;
  const when = ch.change_type === 'date_range' ? `${fmtDate(ch.start_date)} – ${fmtDate(ch.end_date)}`
    : ch.change_type === 'permanent' ? `Starting ${fmtDate(ch.start_date)} (permanent)` : fmtDate(ch.start_date);
  const newWay = [ch.new_method, ch.new_details].filter(Boolean).join(' — ');
  const rows = [
    ['Student', `${ch.student_name} (Grade ${ch.grade || '—'}, ${ch.teacher || 'no homeroom'})`],
    ['Applies to', ch.period === 'afternoon' ? 'Afternoon dismissal' : 'Morning arrival'],
    ['When', `${when} · ${TYPE[ch.change_type]}`],
    ['Currently', ch.current_method || '—'],
    ['Change to', newWay],
    ch.pickup_person ? ['Picked up by', [ch.pickup_person, ch.pickup_relationship, ch.pickup_phone].filter(Boolean).join(' · ')] : null,
    ch.comments ? ['Parent comments', ch.comments] : null,
    ['Submitted by', `${ch.submitted_name || 'Parent'} (${ch.submitted_by})`],
    ['Submitted', new Date(ch.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })]
  ].filter(Boolean);
  const host = `https://${req.headers.host || 'portal.csjax.org'}`;
  const html = C.emailHtml(sameDay ? 'Same-day dismissal change' : 'Transportation change',
    `${sameDay ? '<p style="margin:0 0 14px;padding:10px 12px;background:#FBE9EA;color:#A0000A;border-radius:8px;font-weight:700">This change is for TODAY.</p>' : ''}
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:15px">${rows.map(([k, v]) =>
      `<tr><td style="padding:7px 10px 7px 0;color:#6B6466;vertical-align:top;white-space:nowrap">${C.esc(k)}</td><td style="padding:7px 0;font-weight:600">${C.esc(v)}</td></tr>`).join('')}</table>
<p style="margin:18px 0 0"><a href="${host}/office#transport" style="display:inline-block;background:#E4010D;color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:9px">Open the change report</a></p>
<p style="margin:12px 0 0;color:#6B6466;font-size:13px">Update KidAccount, then mark this change Processed in the report.</p>`);
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nReport: ${host}/office#transport`;
  await C.sendEmail({ to, subject: `${sameDay ? 'TODAY: ' : ''}Dismissal change — ${ch.student_name} — ${when}`, html, text });
}

async function alertPickup(r, req) {
  const to = await C.rpc('portal_staff_alert_emails', {});
  if (!to || !to.length) return;
  const add = r.action === 'add';
  const who = [r.first_name, r.last_name].filter(Boolean).join(' ');
  const rows = [
    ['Student', `${r.student_name} (Grade ${r.grade || '—'}, ${r.teacher || 'no homeroom'})`],
    ['Change', add ? 'ADD pick-up person' : 'REMOVE pick-up person'],
    ['Person', who],
    r.relationship ? ['Relationship', r.relationship] : null,
    r.phone ? ['Phone', r.phone] : null,
    r.email ? ['Email', r.email] : null,
    add && r.pin ? ['Kiosk PIN', r.pin] : null,
    r.comments ? ['Parent comments', r.comments] : null,
    ['Submitted by', `${r.submitted_name || 'Parent'} (${r.submitted_by})`],
    ['Submitted', new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })]
  ].filter(Boolean);
  const host = `https://${req.headers.host || 'portal.csjax.org'}`;
  const html = C.emailHtml(add ? 'Pick-up person added' : 'Pick-up person removed',
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:15px">${rows.map(([k, v]) =>
      `<tr><td style="padding:7px 10px 7px 0;color:#6B6466;vertical-align:top;white-space:nowrap">${C.esc(k)}</td><td style="padding:7px 0;font-weight:600">${C.esc(v)}</td></tr>`).join('')}</table>
<p style="margin:14px 0 0;color:#6B6466;font-size:13px">${add ? 'This person can use the front office iPad with their PIN right away.' : 'This person can no longer use their PIN for this student.'} Update FACTS, then check it off on the office home screen.</p>
<p style="margin:16px 0 0"><a href="${host}/office" style="display:inline-block;background:#E4010D;color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:9px">Open the office portal</a></p>`);
  await C.sendEmail({ to, subject: `Pick-up person ${add ? 'added' : 'removed'} — ${r.student_name} — ${who}`, html, text: rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${host}/office` });
}

module.exports = async (req, res) => {
  try {
    const id = C.readSession(req);
    if (!id) return C.send(res, 401, { error: 'signed_out' });

    if (req.method === 'GET') {
      const view = new URL(req.url, 'http://x').searchParams.get('view');
      if (view === 'history') return C.send(res, 200, await C.rpc('portal_parent_history', { p_id: id }));
      return C.send(res, 200, await C.rpc('portal_parent_home', { p_id: id }));
    }
    if (req.method !== 'POST') return C.send(res, 405, { error: 'method' });
    const body = await C.readBody(req, 6_000_000);

    if (body.action === 'note') {
      const { action, file, ...p } = body;
      // Doctor's notes must come with a photo or PDF; the note and its first file are saved together.
      if (p.kind === 'doctor') {
        const data = String(file?.data || '').replace(/^data:[^,]*,/, '');
        if (!data) return C.send(res, 400, { error: 'need_file' });
        return C.send(res, 200, await C.rpc('portal_doctor_note_submit', { p_id: id, p,
          p_name: String(file.name || 'note').slice(0, 200), p_mime: file.mime, p_b64: data }));
      }
      return C.send(res, 200, await C.rpc('portal_note_submit', { p_id: id, p }));
    }
    if (body.action === 'file') {
      const data = String(body.data || '').replace(/^data:[^,]*,/, '');
      if (!data) return C.send(res, 400, { error: 'missing_file' });
      return C.send(res, 200, await C.rpc('portal_note_file_add', {
        p_id: id, p_note: body.note_id, p_name: String(body.name || 'note').slice(0, 200), p_mime: body.mime, p_b64: data }));
    }
    if (body.action === 'transport') {
      const { action, ...p } = body;
      // Parents may only change afternoon dismissal; extended care is always the SP location.
      p.period = 'afternoon';
      if (p.new_method === 'Afternoon Extended Care') p.new_details = 'Afterschool Care - SP';
      if (p.new_method === 'Student Driver and/or Passenger' && !/^Student driver: \S/.test(String(p.new_details || '').trim()))
        return C.send(res, 400, { error: 'need_driver' });
      const ch = await C.rpc('portal_transport_submit', { p_id: id, p });
      let alerted = true;
      try { await alertOffice(ch, req); } catch (e) { alerted = false; console.error('office alert failed', e.message, e.detail || ''); }
      return C.send(res, 200, { ok: true, id: ch.id, alerted });
    }
    if (body.action === 'pickup') {
      const { action, ...p } = body;
      p.action = p.type;
      const r = await C.rpc('portal_pickup_change', { p_id: id, p });
      let alerted = true;
      try { await alertPickup(r, req); } catch (e) { alerted = false; console.error('pickup alert failed', e.message, e.detail || ''); }
      return C.send(res, 200, { ok: true, id: r.id, pin: r.pin, alerted });
    }
    if (body.action === 'push') {
      const sub = body.subscription || {};
      if (body.off) { await C.rpc('portal_push_delete', { p_endpoint: String(sub.endpoint || '') }); return C.send(res, 200, { ok: true }); }
      await C.rpc('portal_push_save', { p_id: id, p_endpoint: String(sub.endpoint || ''), p_p256dh: String(sub.keys?.p256dh || ''), p_auth: String(sub.keys?.auth || ''), p_ua: String(req.headers['user-agent'] || '') });
      return C.send(res, 200, { ok: true });
    }
    return C.send(res, 400, { error: 'bad_action' });
  } catch (e) { return C.fail(res, e); }
};
