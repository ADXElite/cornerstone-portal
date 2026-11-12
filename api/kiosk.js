// Front office kiosk API — only answers requests from the Cornerstone campus network.
// The kiosk needs no staff login: it is set up with just a name, and every action is passed
// to the database from here (the database refuses kiosk calls made straight from a browser).
const C = require('../lib/core');

const FNS = new Set(['kiosk_hello', 'kiosk_pin', 'kiosk_search', 'kiosk_student', 'kiosk_submit', 'kiosk_care_pin', 'kiosk_care_submit']);
const allowedIps = () => (process.env.KIOSK_ALLOWED_IPS || process.env.DISMISSAL_ALLOWED_IPS || '107.1.157.26')
  .split(',').map(s => s.trim()).filter(Boolean);

async function banEmail(list) {
  const to = await C.rpc('portal_staff_alert_emails', {});
  if (!to || !to.length) return;
  const time = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const rows = list.map(a => `<li><b>${C.esc(a.person)}</b>${a.relationship ? ' (' + C.esc(a.relationship) + ')' : ''} — BANNED for <b>${C.esc(a.student)}</b>${a.grade ? ', grade ' + C.esc(a.grade) : ''}</li>`).join('');
  await C.sendEmail({ to, subject: `⚠ BANNED person at the kiosk — ${list.map(a => a.student).join(', ')}`,
    html: `<p><b>A BANNED person entered their PIN at the front office kiosk at ${time}.</b></p><ul>${rows}</ul><p>The kiosk told them to see the front office. Do not release the student to them.</p><p>See the alert on the office portal home screen: https://portal.csjax.org/office</p>`,
    text: `A BANNED person entered their PIN at the front office kiosk at ${time}.\n` + list.map(a => `- ${a.person} — BANNED for ${a.student}`).join('\n') + `\nDo not release the student to them.` });
}

module.exports = async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  const ip = C.clientIp(req);
  if (!allowedIps().includes(ip)) return C.send(res, 403, { message: 'campus_only', ip });
  if (req.method !== 'POST') return C.send(res, 200, { ok: true, campus: true });

  let b;
  try { b = await C.readBody(req, 300_000); } catch { return C.send(res, 400, { message: 'bad_request' }); }
  try {
    if (b.fn === 'ping') return C.send(res, 200, { ok: true });
    if (b.fn === 'register') {
      const token = await C.rpc('portal_kiosk_register', { p_label: String(b.label || '').slice(0, 60), p_ip: ip });
      return C.send(res, 200, { token });
    }
    if (!FNS.has(b.fn)) return C.send(res, 400, { message: 'bad_request' });
    const { p_token, ...args } = b.args || {};
    const out = await C.rpc('portal_kiosk_call', { p_fn: b.fn, p_token: String(p_token || ''), p_args: args });
    // A BANNED person entered their PIN: email the office (the kiosk itself only says "please see the front office").
    if (out && out.error === 'see_office' && Array.isArray(out.alert)) {
      try { await banEmail(out.alert); } catch (e) { console.error('ban alert email failed', e.message); }
      return C.send(res, 200, { error: 'see_office' });
    }
    return C.send(res, 200, out);
  } catch (e) {
    return C.send(res, e.db ? 400 : 500, { message: e.db ? e.message : 'server_error' });
  }
};
