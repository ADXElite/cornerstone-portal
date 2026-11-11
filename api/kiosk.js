// Front office kiosk API — only answers requests from the Cornerstone campus network.
// The kiosk needs no staff login: it is set up with just a name, and every action is passed
// to the database from here (the database refuses kiosk calls made straight from a browser).
const C = require('../lib/core');

const FNS = new Set(['kiosk_hello', 'kiosk_pin', 'kiosk_search', 'kiosk_student', 'kiosk_submit', 'kiosk_care_pin', 'kiosk_care_submit']);
const allowedIps = () => (process.env.KIOSK_ALLOWED_IPS || process.env.DISMISSAL_ALLOWED_IPS || '107.1.157.26')
  .split(',').map(s => s.trim()).filter(Boolean);

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
    return C.send(res, 200, await C.rpc('portal_kiosk_call', { p_fn: b.fn, p_token: String(p_token || ''), p_args: args }));
  } catch (e) {
    return C.send(res, e.db ? 400 : 500, { message: e.db ? e.message : 'server_error' });
  }
};
