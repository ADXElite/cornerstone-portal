// Sends the queued alerts in public.portal_outbox (push to parents' phones + emails).
// Called by the database right after an alert is queued, and every minute by a cron job for retries.
// Only the database (x-import-key) can call it. Nothing is sent while alerts are paused (the database skips them).
const webpush = require('web-push');
const C = require('../lib/core');

const HOST = 'https://portal.csjax.org';

function emailBody(it) {
  const rows = (it.email_rows || []).map(([k, v]) =>
    `<tr><td style="padding:7px 10px 7px 0;color:#6B6466;vertical-align:top;white-space:nowrap">${C.esc(k)}</td><td style="padding:7px 0;font-weight:600">${C.esc(v)}</td></tr>`).join('');
  const html = C.emailHtml(it.email_title || it.email_subject,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:15px">${rows}</table>`
    + (it.email_note ? `<p style="margin:16px 0 0;color:#6B6466;font-size:14px">${C.esc(it.email_note)}</p>` : '')
    + (it.email_link ? `<p style="margin:16px 0 0"><a href="${HOST}${it.email_link}" style="display:inline-block;background:#E4010D;color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:9px">Open the office portal</a></p>` : ''));
  const text = (it.email_rows || []).map(([k, v]) => `${k}: ${v}`).join('\n') + (it.email_note ? `\n\n${it.email_note}` : '') + (it.email_link ? `\n\n${HOST}${it.email_link}` : '');
  return { html, text };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return C.send(res, 405, { error: 'method' });
    const key = C.env('ROSTER_IMPORT_KEY');
    if (!key || req.headers['x-import-key'] !== key) return C.send(res, 401, { error: 'not_allowed' });

    const { items, vapid } = await C.rpc('portal_outbox_take', {});
    if (!items.length) return C.send(res, 200, { sent: 0 });
    if (vapid) webpush.setVapidDetails(vapid.vapid_subject, vapid.vapid_public, vapid.vapid_private);

    let done = 0;
    for (const it of items) {
      const result = {}; const gone = []; let ok = true;
      if (it.push_title) {
        let sent = 0, failed = 0;
        const payload = JSON.stringify({ title: it.push_title, body: it.push_body || '', url: it.push_url || '/', tag: `portal-${it.kind}-${it.id}` });
        for (const s of it.subs) {
          try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' }); sent++; }
          catch (e) { failed++; if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.endpoint); }
        }
        result.push = { devices: it.subs.length, sent, failed };
      }
      if (it.email_subject && it.email_to && it.email_to.length) {
        try { const { html, text } = emailBody(it); const r = await C.sendEmail({ to: it.email_to, subject: it.email_subject, html, text }); result.email = r && r.skipped ? r : { to: it.email_to.length }; }
        catch (e) { ok = false; result.email = { error: e.message }; }
      } else if (it.email_subject) result.email = { to: 0, note: 'no email on file' };
      await C.rpc('portal_outbox_done', { p_id: it.id, p_result: result, p_gone: gone, p_ok: ok });
      done++;
    }
    return C.send(res, 200, { sent: done });
  } catch (e) { return C.fail(res, e); }
};
