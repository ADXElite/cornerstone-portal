// Parent sign-in with a one-time code (text via Twilio Verify, email via Resend).
// A device that has signed in once is trusted for a year and skips the code.
//   GET  /api/auth                         -> { signedIn, identifier }
//   POST /api/auth {action:'start', identifier}
//   POST /api/auth {action:'verify', identifier, code}
//   POST /api/auth {action:'logout'}  (keeps the device trusted)
//   POST /api/auth {action:'forget'}  (signs out and untrusts this device)
const crypto = require('crypto');
const C = require('../lib/core');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const id = C.readSession(req);
      return C.send(res, 200, { signedIn: !!id, identifier: id ? C.mask(id) : null });
    }
    if (req.method !== 'POST') return C.send(res, 405, { error: 'method' });
    const body = await C.readBody(req, 20_000);
    const action = body.action;

    if (action === 'logout' || action === 'forget') {
      C.clearCookie(res, 'ccs_s');
      if (action === 'forget') C.clearCookie(res, 'ccs_d');
      return C.send(res, 200, { ok: true });
    }

    const id = C.normId(body.identifier);
    if (!id) return C.send(res, 400, { error: 'bad_identifier' });
    const ip = C.clientIp(req) || 'unknown';

    if (action === 'start') {
      const found = await C.rpc('portal_lookup', { p_id: id });
      if (!found.found) return C.send(res, 404, { error: 'not_found' });

      // Trusted device: same person, same device -> no code needed.
      const dev = C.cookies(req).ccs_d;
      if (dev && await C.rpc('portal_device_check', { p_id: id, p_hash: C.sha(dev) })) {
        C.issueSession(res, id);
        return C.send(res, 200, { ok: true, trusted: true });
      }

      if (!await C.rpc('portal_rate_hit', { p_id: id, p_action: 'code', p_max: 5, p_minutes: 30 })) return C.send(res, 429, { error: 'too_many_codes' });
      if (!await C.rpc('portal_rate_hit', { p_id: 'ip:' + ip, p_action: 'code', p_max: 25, p_minutes: 60 })) return C.send(res, 429, { error: 'too_many_codes' });

      if (C.isEmail(id)) {
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        await C.rpc('portal_email_code_set', { p_id: id, p_hash: C.hmac(id + ':' + code) });
        await C.sendEmail({
          to: id,
          subject: `Your Cornerstone sign-in code: ${code}`,
          text: `Your Cornerstone Christian School sign-in code is ${code}. It expires in 10 minutes. If you didn't ask for this, you can ignore this email.`,
          html: C.emailHtml('Your sign-in code', `<p style="margin:0 0 12px">Use this code to sign in to the Cornerstone Parent Portal:</p>
<p style="font-size:34px;font-weight:800;letter-spacing:.25em;margin:0 0 12px;color:#E4010D">${code}</p>
<p style="margin:0;color:#6B6466;font-size:14px">It expires in 10 minutes. If you didn't ask for this, you can ignore this email.</p>`)
        });
      } else {
        await C.twilioVerify('Verifications', { To: '+1' + id, Channel: 'sms' });
      }
      return C.send(res, 200, { sent: true, kind: C.isEmail(id) ? 'email' : 'phone', masked: C.mask(id) });
    }

    if (action === 'verify') {
      const code = String(body.code || '').replace(/\D/g, '');
      if (code.length < 4 || code.length > 10) return C.send(res, 400, { error: 'bad_code' });
      if (!await C.rpc('portal_rate_hit', { p_id: id, p_action: 'verify', p_max: 10, p_minutes: 30 })) return C.send(res, 429, { error: 'too_many_tries' });
      let ok;
      if (C.isEmail(id)) ok = await C.rpc('portal_email_code_check', { p_id: id, p_hash: C.hmac(id + ':' + code) });
      else {
        try { ok = (await C.twilioVerify('VerificationCheck', { To: '+1' + id, Code: code })).status === 'approved'; }
        catch (e) { if (e.code === 400) ok = false; else throw e; }
      }
      if (!ok) return C.send(res, 400, { error: 'wrong_code' });

      C.issueSession(res, id);
      let dev = C.cookies(req).ccs_d;
      if (!dev) dev = crypto.randomBytes(32).toString('base64url');
      await C.rpc('portal_device_add', { p_id: id, p_hash: C.sha(dev), p_ua: String(req.headers['user-agent'] || '') });
      C.setCookie(res, 'ccs_d', dev, C.DEVICE_DAYS);
      return C.send(res, 200, { ok: true });
    }

    return C.send(res, 400, { error: 'bad_action' });
  } catch (e) { return C.fail(res, e); }
};
