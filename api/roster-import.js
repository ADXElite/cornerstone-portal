// Automated daily roster upload (for a sync script or extension).
//   POST /api/roster-import   header  x-import-key: <ROSTER_IMPORT_KEY>
//   body: the student/parent CSV export as text (same columns as "Report 1.csv").
//   ?force=1 allows an upload that would remove more than 15% of active students.
// Office staff can also upload the file by hand on /office → Roster.
const C = require('../lib/core');

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.filter(r => r.some(v => v.trim() !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return C.send(res, 405, { error: 'method' });
    const key = C.env('ROSTER_IMPORT_KEY');
    if (!key || req.headers['x-import-key'] !== key) return C.send(res, 401, { error: 'bad_key' });
    const rows = parseCsv(await C.readText(req));
    const force = new URL(req.url, 'http://x').searchParams.get('force') === '1';
    const cols = rows[0] ? Object.keys(rows[0]) : [];
    if (cols.includes('studentid') && cols.includes('Attendance')) return C.send(res, 200, await C.rpc('portal_attendance_import', { p_rows: rows, p_by: 'API upload' }));
    return C.send(res, 200, await C.rpc('portal_roster_import', { p_rows: rows, p_force: force }));
  } catch (e) { return C.fail(res, e); }
};

module.exports.config = { api: { bodyParser: false } };
module.exports.parseCsv = parseCsv;
