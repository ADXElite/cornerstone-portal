// Daily roster import from the school's SFTP server (Oracle Cloud, 141.148.36.44).
// The school (now) or the vendor (later) uploads the student/parent CSV to /uploads with the ccsftp login.
// This function signs in as ccsportal (key only), imports the newest CSV, and moves every CSV it handled to /processed.
//
// Called by:
//   - Supabase pg_cron job "portal-sftp-import" (every 30 min, 6 AM–6 PM ET, Mon–Fri) with header x-import-key
//   - Front office "Check SFTP now" button (staff Supabase sign-in, Authorization: Bearer <token>)
// POST /api/sftp-import[?force=1]
const SftpClient = require('ssh2-sftp-client');
const C = require('../lib/core');
const { parseCsv } = require('./roster-import');

const SB_URL = 'https://cvvdwhgdiqnoqgxtgzfw.supabase.co';
const SB_KEY = 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0';

async function isStaff(token) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/portal_is_staff`, {
    method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}'
  });
  return r.ok && (await r.json()) === true;
}

function privateKey() {
  let k = C.env('SFTP_PRIVATE_KEY').trim();
  if (k.includes('\\n')) k = k.replace(/\\n/g, '\n');
  if (!k.endsWith('\n')) k += '\n';
  return k;
}

async function firstDir(sftp, names) {
  for (const n of names) { try { if (await sftp.exists(n) === 'd') return n; } catch {} }
  return null;
}

const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/New_York' }).replace(/[: ]/g, '-').replace(/-(\d\d)$/, '$1');

async function notifyFailure(message) {
  try {
    const to = await C.rpc('portal_staff_alert_emails', {});
    if (!to?.length) return;
    await C.sendEmail({ to, subject: 'Portal roster import needs attention',
      text: `The daily student/parent file on the SFTP server was not imported.\n\n${message}\n\nOpen https://portal.csjax.org/office#roster`,
      html: C.emailHtml('Roster import needs attention', `<p style="margin:0 0 12px">The daily student/parent file on the SFTP server was <b>not imported</b>.</p>
<p style="margin:0 0 16px;padding:10px 12px;background:#FBE9EA;color:#A0000A;border-radius:8px">${C.esc(message)}</p>
<p style="margin:0"><a href="https://portal.csjax.org/office#roster" style="color:#E4010D;font-weight:700">Open Roster upload</a></p>`) });
  } catch (e) { console.error('failure email', e.message); }
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const force = url.searchParams.get('force') === '1';
  let by = 'SFTP (scheduled)';
  try {
    if (req.method !== 'POST') return C.send(res, 405, { error: 'method' });
    const key = C.env('ROSTER_IMPORT_KEY');
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (key && req.headers['x-import-key'] === key) by = 'SFTP (scheduled)';
    else if (bearer && await isStaff(bearer)) by = 'SFTP (Check now)';
    else return C.send(res, 401, { error: 'not_allowed' });

    if (!C.env('SFTP_PRIVATE_KEY')) return C.send(res, 503, { error: 'sftp_not_configured' });

    const sftp = new SftpClient();
    let result;
    try {
      await sftp.connect({
        host: C.env('SFTP_HOST') || '141.148.36.44', port: +(C.env('SFTP_PORT') || 22),
        username: C.env('SFTP_USER') || 'ccsportal', privateKey: privateKey(),
        passphrase: C.env('SFTP_PASSPHRASE') || undefined, readyTimeout: 15000
      });
      const up = await firstDir(sftp, [C.env('SFTP_UPLOAD_DIR'), '/uploads', 'uploads'].filter(Boolean));
      const done = await firstDir(sftp, [C.env('SFTP_PROCESSED_DIR'), '/processed', 'processed'].filter(Boolean));
      if (!up || !done) throw Object.assign(new Error('sftp_folders_missing'), { code: 502 });

      const files = (await sftp.list(up)).filter(f => f.type === '-' && /\.csv$/i.test(f.name)).sort((a, b) => a.modifyTime - b.modifyTime);
      if (!files.length) return C.send(res, 200, { ok: true, imported: false, message: 'No new file in /uploads.' });

      const newest = files[files.length - 1];
      const buf = await sftp.get(`${up}/${newest.name}`);
      const rows = parseCsv(buf.toString('utf8'));
      try {
        result = await C.rpc('portal_roster_import_by', { p_rows: rows, p_force: force, p_by: `${by}: ${newest.name}` });
      } catch (e) {
        // Leave the file in /uploads so the office can fix it or force it; tell the office once per file.
        const msg = /too_many_removed/.test(e.message)
          ? `${newest.name} would turn off ${e.message.split(':')[1] || 'many'} students, so it was held back as a safety stop. If the file is correct, open Roster upload and click "Check SFTP now" with "I'm sure" ticked.`
          : e.message === 'bad_columns' ? `${newest.name} doesn't have the "Student ID (System)" column. Check that the right report was uploaded.`
          : `${newest.name}: ${e.message}`;
        const first = await C.rpc('portal_import_error', { p_file: newest.name, p_note: msg });
        if (first) await notifyFailure(msg);
        return C.send(res, 409, { error: e.message, message: msg, file: newest.name });
      }
      // Imported: move the newest and any older (superseded) files to /processed.
      const moved = [];
      for (const f of files) {
        const dest = `${done}/${stamp()}_${f === newest ? '' : 'skipped_'}${f.name}`;
        try { await sftp.rename(`${up}/${f.name}`, dest); moved.push(dest); } catch (e) { console.error('move failed', f.name, e.message); }
      }
      return C.send(res, 200, { ok: true, imported: true, file: newest.name, older_skipped: files.length - 1, moved, ...result });
    } finally { try { await sftp.end(); } catch {} }
  } catch (e) {
    if (/authentication|All configured authentication methods failed|privateKey|Cannot parse/i.test(e.message)) e = Object.assign(new Error('sftp_login_failed'), { code: 502, detail: e.message });
    else if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|Timed out/i.test(e.message)) e = Object.assign(new Error('sftp_unreachable'), { code: 502, detail: e.message });
    return C.fail(res, e);
  }
};

module.exports.config = { maxDuration: 60 };
