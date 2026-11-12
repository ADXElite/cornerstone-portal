// Daily roster import from the school's SFTP server (Oracle Cloud, 141.148.36.44).
// The school (now) or the vendor (later) uploads the student/parent CSV to /uploads with the ccsftp login.
// This function signs in as ccsportal (key only), imports the newest roster CSV and the newest daily attendance CSV,
// and moves every CSV it handled to /processed. File type is detected from its columns.
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

// Import failures are shown under Settings → Data Upload. No email is sent (only the alerts on the approved list go out).
async function notifyFailure(message) { console.log('roster import failed (no email sent):', message); }

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

      const all = (await sftp.list(up)).filter(f => f.type === '-' && /\.csv$/i.test(f.name)).sort((a, b) => a.modifyTime - b.modifyTime);
      if (!all.length) return C.send(res, 200, { ok: true, imported: false, message: 'No new file in /uploads.' });

      // Read every file and sort it by layout: daily attendance (studentid, Attendance) or student/parent roster.
      const files = [];
      for (const f of all) {
        const rows = parseCsv((await sftp.get(`${up}/${f.name}`)).toString('utf8'));
        const cols = rows[0] ? Object.keys(rows[0]) : [];
        const kind = cols.includes('studentid') && cols.includes('Attendance') ? 'attendance' : cols.includes('Student ID (System)') ? 'roster' : 'unknown';
        files.push({ f, rows, kind });
      }
      const results = [], moved = [], held = [];
      const move = async (x, tag = '') => {
        const dest = `${done}/${stamp()}_${tag}${x.f.name}`;
        try { await sftp.rename(`${up}/${x.f.name}`, dest); moved.push(dest); } catch (e) { console.error('move failed', x.f.name, e.message); }
      };
      // Roster first (so new students exist), then attendance. Only the newest file of each kind is imported.
      for (const kind of ['roster', 'attendance']) {
        const list = files.filter(x => x.kind === kind);
        if (!list.length) continue;
        const newest = list[list.length - 1];
        try {
          const r = kind === 'roster'
            ? await C.rpc('portal_roster_import_by', { p_rows: newest.rows, p_force: force, p_by: `${by}: ${newest.f.name}` })
            : await C.rpc('portal_attendance_import', { p_rows: newest.rows, p_by: `${by}: ${newest.f.name}` });
          results.push({ kind, file: newest.f.name, ...r });
          for (const x of list) await move(x, x === newest ? '' : 'skipped_');
        } catch (e) {
          // Leave the file in /uploads so the office can fix it or force it; tell the office once per file.
          const msg = /too_many_removed/.test(e.message)
            ? `${newest.f.name} would turn off ${e.message.split(':')[1] || 'many'} students, so it was held back as a safety stop. If the file is correct, open Roster upload and click "Check SFTP now" with "I'm sure" ticked.`
            : e.message === 'bad_columns' ? `${newest.f.name} is missing expected columns. Check that the right report was uploaded.`
            : `${newest.f.name}: ${e.message}`;
          held.push({ kind, file: newest.f.name, error: e.message, message: msg });
          if (await C.rpc('portal_import_error', { p_file: newest.f.name, p_note: msg })) await notifyFailure(msg);
        }
      }
      for (const x of files.filter(x => x.kind === 'unknown')) {
        const msg = `${x.f.name} isn't a student roster or daily attendance file, so it was moved to /processed without importing.`;
        held.push({ kind: 'unknown', file: x.f.name, message: msg });
        if (await C.rpc('portal_import_error', { p_file: x.f.name, p_note: msg })) await notifyFailure(msg);
        await move(x, 'unrecognized_');
      }
      if (!results.length && held.length) return C.send(res, 409, { error: held[0].error || 'not_imported', message: held.map(h => h.message).join(' '), held });
      const roster = results.find(r => r.kind === 'roster') || {};
      return C.send(res, 200, { ok: true, imported: results.length > 0, results, held, moved,
        file: results.map(r => r.file).join(', '), ...roster, attendance: results.find(r => r.kind === 'attendance') || null,
        message: held.length ? held.map(h => h.message).join(' ') : undefined });
    } finally { try { await sftp.end(); } catch {} }
  } catch (e) {
    if (/authentication|All configured authentication methods failed|privateKey|Cannot parse/i.test(e.message)) e = Object.assign(new Error('sftp_login_failed'), { code: 502, detail: e.message });
    else if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|Timed out/i.test(e.message)) e = Object.assign(new Error('sftp_unreachable'), { code: 502, detail: e.message });
    return C.fail(res, e);
  }
};

module.exports.config = { maxDuration: 60 };
