// Shared helpers for the Cornerstone Portal API (Vercel Node functions, no dependencies).
const crypto = require('crypto');

const SB_URL = 'https://cvvdwhgdiqnoqgxtgzfw.supabase.co';
const SB_KEY = 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0';
const SESSION_DAYS = 120;
const DEVICE_DAYS = 365;

const env = k => process.env[k] || '';

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readBody(req, limit = 6_000_000) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('too_big'), { code: 413 }); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function readText(req, limit = 10_000_000) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('too_big'), { code: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

// Calls a key-protected database function. Database errors come back as { error: '<code>' }.
async function rpc(fn, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: env('PORTAL_API_KEY'), ...args })
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = (data && data.message) || 'server_error';
    const e = new Error(msg); e.code = 400; e.db = true; throw e;
  }
  return data;
}

// ---------- identifiers ----------
function normId(v) {
  v = String(v || '').trim();
  if (!v) return null;
  if (v.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
  const d = v.replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return ten.length === 10 ? ten : null;
}
const isEmail = id => id.includes('@');
function mask(id) {
  if (isEmail(id)) { const [u, d] = id.split('@'); return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`; }
  return `(•••) •••-${id.slice(-4)}`;
}

// ---------- cookies & sessions ----------
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, days) {
  const prev = res.getHeader('Set-Cookie') || [];
  const c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.round(days * 86400)}`;
  res.setHeader('Set-Cookie', [].concat(prev, c));
}
const b64u = b => Buffer.from(b).toString('base64url');
const hmac = s => crypto.createHmac('sha256', env('SESSION_SECRET')).update(s).digest('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function issueSession(res, id) {
  const payload = b64u(JSON.stringify({ id, exp: Date.now() + SESSION_DAYS * 86400e3 }));
  setCookie(res, 'ccs_s', `${payload}.${hmac(payload)}`, SESSION_DAYS);
}
function readSession(req) {
  const v = cookies(req).ccs_s; if (!v || !env('SESSION_SECRET')) return null;
  const [payload, sig] = v.split('.');
  if (!payload || !sig) return null;
  const want = hmac(payload);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try { const s = JSON.parse(Buffer.from(payload, 'base64url').toString()); return s.exp > Date.now() ? s.id : null; } catch { return null; }
}
function clearCookie(res, name) { setCookie(res, name, '', 0); }

function clientIp(req) {
  return String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim();
}

// ---------- outbound messages ----------
async function twilioVerify(path, form) {
  const sid = env('TWILIO_ACCOUNT_SID'), tok = env('TWILIO_AUTH_TOKEN'), svc = env('TWILIO_VERIFY_SID');
  if (!sid || !tok || !svc) throw Object.assign(new Error('sms_not_configured'), { code: 503 });
  const r = await fetch(`https://verify.twilio.com/v2/Services/${svc}/${path}`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.code === 60200 ? 'bad_phone' : 'sms_failed'); e.code = r.status === 404 ? 400 : 502; e.detail = data.message; throw e; }
  return data;
}

async function sendEmail({ to, subject, html, text, replyTo, loginCode }) {
  // While alerts are paused (office Settings), only sign-in codes go out. If the check itself fails, nothing is sent.
  if (!loginCode) {
    let paused = true;
    try { paused = await rpc('portal_alerts_paused', {}); } catch (e) { console.error('alerts_paused check failed', e.message); }
    if (paused) { console.log('email skipped (alerts paused):', subject); return { skipped: 'alerts_paused' }; }
  }
  const key = env('RESEND_API_KEY');
  if (!key) throw Object.assign(new Error('email_not_configured'), { code: 503 });
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('EMAIL_FROM') || 'Cornerstone Christian School <noreply@csjax.org>',
      to: [].concat(to), subject, html, text, ...(replyTo ? { reply_to: replyTo } : {})
    })
  });
  if (!r.ok) { const e = new Error('email_failed'); e.code = 502; e.detail = await r.text(); throw e; }
  return r.json();
}

// Same email sent to each person separately (nobody sees the other addresses). Resend batch API, 100 per call.
async function sendEmailEach({ to, subject, html, text }) {
  const list = [...new Set([].concat(to).filter(Boolean))];
  let paused = true;
  try { paused = await rpc('portal_alerts_paused', {}); } catch (e) { console.error('alerts_paused check failed', e.message); }
  if (paused) return { skipped: 'alerts_paused' };
  const key = env('RESEND_API_KEY');
  if (!key) throw Object.assign(new Error('email_not_configured'), { code: 503 });
  const from = env('EMAIL_FROM') || 'Cornerstone Christian School <noreply@csjax.org>';
  let sent = 0;
  for (let i = 0; i < list.length; i += 100) {
    const r = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(list.slice(i, i + 100).map(t => ({ from, to: [t], subject, html, text })))
    });
    if (!r.ok) { const e = new Error('email_failed'); e.code = 502; e.detail = await r.text(); throw e; }
    sent += list.slice(i, i + 100).length;
  }
  return { sent };
}

// Plain text message through Twilio. TWILIO_SMS_FROM is the school's texting number (+1...) or a Messaging Service SID (MG...).
async function sendSms(to10, body) {
  const sid = env('TWILIO_ACCOUNT_SID'), tok = env('TWILIO_AUTH_TOKEN'), from = env('TWILIO_SMS_FROM');
  if (!sid || !tok || !from) throw Object.assign(new Error('sms_not_configured'), { code: 503 });
  const form = { To: '+1' + to10, Body: body };
  if (from.startsWith('MG')) form.MessagingServiceSid = from; else form.From = from;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form)
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); const e = new Error('sms_failed'); e.detail = d.message; throw e; }
  return true;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Branded email shell matching the app (black header, red rule).
function emailHtml(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#F6F4F4;font-family:Segoe UI,Arial,sans-serif;color:#141213">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E4DFDF">
<tr><td style="background:#141213;border-bottom:3px solid #E4010D;padding:16px 20px;color:#fff;font-weight:800;letter-spacing:.06em;text-transform:uppercase;font-size:15px">Cornerstone Christian School</td></tr>
<tr><td style="padding:22px 20px"><h1 style="margin:0 0 14px;font-size:21px;text-transform:uppercase;letter-spacing:.01em">${esc(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:14px 20px;background:#F6F4F4;color:#6B6466;font-size:12px">9039 Beach Boulevard · Jacksonville, FL 32216 · (904) 730-5500</td></tr>
</table></td></tr></table></body></html>`;
}

function fail(res, e) {
  const code = e.code && e.code >= 400 && e.code < 600 ? e.code : 500;
  if (code >= 500) console.error(e.message, e.detail || '');
  return send(res, code, { error: e.message || 'server_error' });
}

module.exports = { env, send, readBody, readText, rpc, normId, isEmail, mask, cookies, setCookie, clearCookie, issueSession, readSession,
  sha, hmac, clientIp, twilioVerify, sendEmail, sendEmailEach, sendSms, emailHtml, esc, fail, DEVICE_DAYS };
