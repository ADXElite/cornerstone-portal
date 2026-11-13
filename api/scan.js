// Scanner drop box for doctor's notes turned in at the front office.
//   POST https://portal.csjax.org/api/scan/<scan key>
// Accepts the file as the raw request body (Content-Type: application/pdf) or as a multipart form upload
// (any field name). The school's network can send with the scan key; anywhere else needs the longer remote key. The scan waits under Excused Notes → Scanned Documents
// until the office picks the student and date(s).
const C = require('../lib/core');

const allowedIps = () => (process.env.KIOSK_ALLOWED_IPS || process.env.DISMISSAL_ALLOWED_IPS || '107.1.157.26')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX = 20 * 1024 * 1024;

async function rawBody(req) {
  // Read the stream first (works for any content type); fall back to a body Vercel already parsed.
  const chunks = []; let n = 0;
  if (!req.readableEnded) for await (const c of req) { n += c.length; if (n > MAX) throw Object.assign(new Error('too_big'), { code: 413 }); chunks.push(c); }
  if (n) return Buffer.concat(chunks);
  let b; try { b = req.body; } catch { b = null; }
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === 'string') return Buffer.from(b, 'binary');
  return null;
}

// Minimal multipart/form-data reader: returns the first part that carries a file.
function firstFilePart(buf, boundary) {
  const sep = Buffer.from('--' + boundary);
  let pos = buf.indexOf(sep);
  while (pos !== -1) {
    const start = pos + sep.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const headEnd = buf.indexOf('\r\n\r\n', start);
    if (headEnd === -1) break;
    const head = buf.slice(start, headEnd).toString('utf8');
    const next = buf.indexOf(sep, headEnd + 4);
    if (next === -1) break;
    const body = buf.slice(headEnd + 4, next - 2); // drop trailing \r\n
    const fn = /filename\*?="?([^";\r\n]*)"?/i.exec(head);
    const ct = /content-type:\s*([^\r\n;]+)/i.exec(head);
    if (fn || (ct && !/^text\//i.test(ct[1]))) return { name: fn ? decodeURIComponent(fn[1].replace(/^UTF-8''/i, '')) : '', mime: ct ? ct[1].trim().toLowerCase() : '', data: body };
    pos = next;
  }
  return null;
}

const sniff = b => b.slice(0, 4).toString() === '%PDF' ? 'application/pdf'
  : b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'image/png'
  : (b.slice(0, 2).toString() === 'II' || b.slice(0, 2).toString() === 'MM') ? 'image/tiff' : '';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const ip = C.clientIp(req);
  // On campus: the short scan key works. Off campus (e.g. Google Apps Script for scan-to-email): only the long remote key works.
  const campus = allowedIps().includes(ip);
  const done = (code, body) => { console.log(`[scan] ${req.method} from ${ip}${campus ? ' (campus)' : ''} ct=${req.headers['content-type'] || '-'} len=${req.headers['content-length'] || '-'} -> ${code} ${JSON.stringify(body)}`); return C.send(res, code, body); };
  if (req.method === 'GET') return campus ? done(200, { ok: true, ready: true, note: 'POST the scanned PDF to this address.' }) : done(404, { error: 'not_found' });
  if (req.method !== 'POST' && req.method !== 'PUT') return done(405, { error: 'method' });
  const key = String(req.query.key || '').trim();
  if (!key) return done(404, { error: 'not_found' });
  try {
    const ctype = String(req.headers['content-type'] || '').toLowerCase();
    let buf = await rawBody(req), name = String(req.headers['x-file-name'] || req.query.name || ''), mime = '';
    if (!buf) return done(400, { error: 'send_the_file_as_pdf_or_multipart' });
    const bm = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(req.headers['content-type'] || '')); // keep the boundary's case
    if (ctype.startsWith('multipart/') && bm) {
      const part = firstFilePart(buf, bm[1] || bm[2]);
      if (!part) return done(400, { error: 'no_file_in_upload' });
      buf = part.data; name = part.name || name; mime = part.mime;
    } else mime = ctype.split(';')[0].trim();
    const real = sniff(buf);
    if (real) mime = real;
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'].includes(mime)) return done(415, { error: 'pdf_or_image_only' });
    if (buf.length > MAX) return done(413, { error: 'too_big' });
    const r = await C.rpc('portal_scan_add', { p_scan_key: key, p_name: name.slice(0, 120), p_mime: mime, p_b64: buf.toString('base64'), p_ip: ip, p_campus: campus });
    return done(200, { ok: true, id: r.id });
  } catch (e) {
    if (e.message === 'bad_scan_key') return done(404, { error: 'not_found' });
    console.log(`[scan] error from ${ip}: ${e.message}`); return C.fail(res, e);
  }
};
