// Dismissal boards API — only answers requests from the Cornerstone campus network (DISMISSAL_ALLOWED_IPS).
// Built live from the Cornerstone Portal: today's afternoon transportation from the roster file,
// parent/office dismissal changes in effect today, and early check-outs from the front office iPad.
// GET /api/dismissal            -> list of class boards
// GET /api/dismissal?slug=name  -> one class board
const C = require('../lib/core');

// Combined boards: one link that shows several homerooms together (same as app.csjax.org).
const COMBINED = {
  'williams-newkirk': { teacher_name: 'Williams & Newkirk', slugs: ['jarrodd-williams', 'alexandria-newkirk'] }
};
// Display-name overrides. slug -> { name, link }: `link` is an extra, nicer link that opens the same board.
const RENAME = {
  'nichelle-english-wilson': { name: 'Nichelle Wilson', link: 'nichelle-wilson' }
};
const ALIAS = Object.fromEntries(Object.entries(RENAME).filter(([, v]) => v.link).map(([k, v]) => [v.link, k]));
const HIDDEN = new Set(Object.values(COMBINED).flatMap(d => d.slugs));
const named = b => b && RENAME[b.slug] ? { ...b, teacher_name: RENAME[b.slug].name, slug: RENAME[b.slug].link || b.slug } : b;

function merge(slug, def, boards) {
  boards = boards.filter(Boolean);
  if (!boards.length) return null;
  const groups = [];
  for (const b of boards) {
    const who = named(b).teacher_name.split(' ').slice(-1)[0];
    for (const g of b.groups || []) {
      let m = groups.find(x => x.method === g.method);
      if (!m) groups.push(m = { key: g.key, method: g.method, students: [] });
      for (const st of g.students || []) m.students.push({ ...st, teacher: who });
    }
  }
  groups.forEach(g => g.students.sort((a, b) => a.name.split(' ').slice(-1)[0].localeCompare(b.name.split(' ').slice(-1)[0])));
  return { slug, teacher_name: def.teacher_name, combined: true, board_date: boards[0].board_date, updated_at: boards[0].updated_at,
    groups, checked_out: boards.flatMap(b => b.checked_out || []), changes: boards.reduce((n, b) => n + (b.changes || 0), 0) };
}

module.exports = async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const allowed = (process.env.DISMISSAL_ALLOWED_IPS || '107.1.157.26').split(',').map(s => s.trim()).filter(Boolean);
  const ip = C.clientIp(req);
  if (!allowed.includes(ip)) return C.send(res, 403, { error: 'campus_only', ip });

  const url = new URL(req.url, 'http://x');
  let slug = (url.searchParams.get('slug') || '').toLowerCase().replace(/[^a-z0-9-]/g, '') || null;
  if (slug && ALIAS[slug]) slug = ALIAS[slug];
  const read = s => C.rpc('portal_board_read', { p_slug: s });
  try {
    if (!slug) {
      const all = await read(null);
      const list = all.filter(t => !HIDDEN.has(t.slug)).map(named);
      for (const [key, def] of Object.entries(COMBINED)) {
        const parts = all.filter(t => def.slugs.includes(t.slug));
        if (parts.length) list.push({ slug: key, teacher_name: def.teacher_name, combined: true, board_date: parts[0].board_date, updated_at: parts[0].updated_at,
          students: parts.reduce((n, p) => n + p.students, 0) });
      }
      list.sort((a, b) => a.teacher_name.localeCompare(b.teacher_name));
      return C.send(res, 200, list);
    }
    if (COMBINED[slug]) {
      const b = merge(slug, COMBINED[slug], await Promise.all(COMBINED[slug].slugs.map(read)));
      return b ? C.send(res, 200, b) : C.send(res, 404, { error: 'not_found' });
    }
    const b = named(await read(slug));
    return b ? C.send(res, 200, b) : C.send(res, 404, { error: 'not_found' });
  } catch (e) { return C.send(res, 502, { error: 'upstream' }); }
};
