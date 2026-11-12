// Extended care staff screen (/care). Morning care: mark students present (signed-up list + search everyone).
// Afterschool care: KHA / SP roster, sign in, sign out with the pick-up person and their signature.
// Separate from dismissal and attendance — nothing here changes a student's present/absent status.
const sb = supabase.createClient('https://cvvdwhgdiqnoqgxtgzfw.supabase.co', 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0');
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const grade = g => g === 'K' ? 'K' : g ? String(g).replace(/^0/, '') : '';
const tm = t => t ? new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '';
const md = d => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${m}/${dd}/${y}`; };
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2500); }
const ERR = { absent_today: 'Absent today — can\'t be signed in to afterschool care.', checked_out_today: 'Checked out early today — can\'t be signed in to afterschool care.', already_signed_in: 'Already signed in today.', not_signed_in: 'Not signed in.', pick_person: 'Choose who is picking up.', need_signature: 'Please sign.', student_not_found: 'Student not found.' };
const msg = m => ERR[String(m).split(':')[0]] || m;
async function call(fn, args = {}) { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; }
const APP = $('#v-app');
let ME = null, timer = null, LIST = null;
const etHour = () => +new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
let SESSION = store.get('ccs_care_session') || (etHour() < 12 ? 'am' : 'pm');
let LOC = store.get('ccs_care_loc') || 'all';

async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return login();
  try { ME = await call('care_me'); } catch { await sb.auth.signOut(); return login("This account isn't set up for extended care. Ask the front office."); }
  $('#who').hidden = false;
  $('#who').innerHTML = `${esc(ME.name || ME.email)}<br><button id="b-out">Sign Out</button>`;
  $('#b-out').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $('#v-login').hidden = true; APP.hidden = false;
  load();
  clearInterval(timer); timer = setInterval(() => { if (!document.hidden && $('#sheet').hidden && !document.activeElement?.matches('input')) load(true); }, 30000);
}
function login(err) { $('#v-login').hidden = false; APP.hidden = true; $('#lg-err').textContent = err || ''; }
$('#f-login').addEventListener('submit', async e => {
  e.preventDefault(); $('#lg-err').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#lg-email').value.trim().toLowerCase(), password: $('#lg-pass').value });
  if (error) return $('#lg-err').textContent = 'Email or password is incorrect.';
  boot();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && ME) load(true); });

async function load(quiet) {
  if (!quiet) APP.innerHTML = '<p class="muted">Loading…</p>';
  try { LIST = await call('care_list', { p_session: SESSION }); } catch (x) { if (!quiet) APP.innerHTML = `<div class="card err">${esc(x.message)}</div>`; return; }
  draw();
}

function header(extra) {
  return `<div class="hd"><div><h1>${SESSION === 'am' ? 'Morning Care' : 'Afterschool Care'}</h1><span class="prog">${extra}</span></div>
    <div class="tools"><div class="segs" id="ses"><button data-s="am" aria-pressed="${SESSION === 'am'}">Morning</button><button data-s="pm" aria-pressed="${SESSION === 'pm'}">Afterschool</button></div>
    <button class="btn ghost sm" id="ref">Refresh</button></div></div>`;
}
function wire() {
  $('#ses').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; SESSION = b.dataset.s; store.set('ccs_care_session', SESSION); load(); };
  $('#ref').onclick = () => load();
}

function draw() {
  const y = scrollY;
  SESSION === 'am' ? drawAm() : drawPm();
  scrollTo(0, y);
}

// ---------------- Morning ----------------
function drawAm() {
  const st = LIST.students, here = st.filter(s => s.signed_in && !s.out_at).length;
  APP.innerHTML = header(`${here} here now · ${st.filter(s => s.signed_in).length} today`) + `
    <p class="muted small">Tap a student to mark them present. Everyone still here is signed out automatically at 8:30 AM. This does not change their school attendance.</p>
    <div class="card" style="gap:8px"><b>Not on the list? Find any student</b>
      <input type="search" id="q" placeholder="Type a first or last name" autocomplete="off"><div class="hits" id="hits"></div></div>
    <div class="stop"><span>Signed Up for Morning Care</span><span class="muted">${st.filter(s => s.enrolled).length}</span></div>
    ${st.filter(s => s.enrolled).map(kidAm).join('') || '<div class="card">No students signed up.</div>'}
    ${st.some(s => !s.enrolled) ? `<div class="stop"><span>Also Here Today (Not Signed Up)</span><span class="muted">${st.filter(s => !s.enrolled).length}</span></div>${st.filter(s => !s.enrolled).map(kidAm).join('')}` : ''}`;
  wire();
  wireSearch();
  APP.querySelectorAll('.kid[data-id]').forEach(b => b.onclick = () => {
    const s = LIST.students.find(x => x.student_id === +b.dataset.id);
    if (!s.signed_in) return markIn(s.student_id);
    sheetAm(s);
  });
}
function kidAm(s) {
  const st = !s.signed_in ? '' : s.out_at ? `Out ${tm(s.out_at)}${s.out_how === 'auto' ? ' (auto)' : ''}` : `Here since ${tm(s.in_at)}`;
  return `<button class="kid ${s.signed_in && !s.out_at ? 'on' : ''} ${s.out_at ? 'done' : ''}" data-id="${s.student_id}">
    <span class="box">${s.signed_in ? '✓' : ''}</span><span><b>${esc(s.last)}, ${esc(s.first)}</b><small>Grade ${esc(grade(s.grade))} · ${esc(s.teacher || '')}</small></span>
    <span class="st"><small>${esc(st)}</small></span></button>`;
}
function wireSearch() {
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(async () => {
    const q = $('#q').value.trim(); if (q.length < 2) return $('#hits').innerHTML = '';
    const list = await call('care_search', { p_q: q }).catch(() => []);
    const on = new Set(LIST.students.filter(s => s.signed_in).map(s => s.student_id));
    $('#hits').innerHTML = list.map(s => `<button class="kid ${on.has(s.student_id) ? 'on' : ''}" data-add="${s.student_id}" ${on.has(s.student_id) ? 'disabled' : ''}><span class="box">${on.has(s.student_id) ? '✓' : '+'}</span><span><b>${esc(s.first)} ${esc(s.last)}</b><small>Grade ${esc(grade(s.grade))} · ${esc(s.teacher || '')}</small></span><span class="st"><small>${on.has(s.student_id) ? 'Already signed in' : SESSION === 'am' ? 'Mark present' : 'Sign in'}</small></span></button>`).join('') || '<p class="muted">No matches.</p>';
  }, 250); };
  $('#hits').onclick = async e => { const b = e.target.closest('[data-add]'); if (!b) return; await markIn(+b.dataset.add); $('#q').value = ''; $('#hits').innerHTML = ''; };
}
async function markIn(id) {
  try { const r = await call('care_in', { p_student: id, p_session: SESSION }); toast((SESSION === 'am' ? 'Marked present ' : 'Signed in ') + r.time); load(true); }
  catch (x) { toast(msg(x.message)); load(true); }
}
function sheetAm(s) {
  openSheet(`<div class="hd"><div><h1 style="font-size:1.8rem">${esc(s.first)} ${esc(s.last)}</h1><span class="muted">Grade ${esc(grade(s.grade))} · ${esc(s.teacher || '')}</span></div><button class="x" id="sx" aria-label="Close">×</button></div>
    <div class="card"><p>Marked present at <b>${tm(s.in_at)}</b> by ${esc(s.in_by || '')}.${s.out_at ? `<br>Signed out at <b>${tm(s.out_at)}</b>${s.out_how === 'auto' ? ' (automatic)' : ' by ' + esc(s.out_by || '')}.` : ''}</p></div>
    ${s.out_at ? '' : `<div class="row-btns"><button class="btn" id="out">Sign Out Now</button><button class="btn ghost" id="undo">Undo — Marked by Mistake</button></div>`}`);
  if ($('#out')) $('#out').onclick = async () => { try { await call('care_out', { p_student: s.student_id, p_session: 'am' }); closeSheet(); toast('Signed out'); load(true); } catch (x) { toast(msg(x.message)); } };
  if ($('#undo')) $('#undo').onclick = async () => { await call('care_undo', { p_student: s.student_id, p_session: 'am' }); closeSheet(); toast('Undone'); load(true); };
}

// ---------------- Afterschool ----------------
function drawPm() {
  const all = LIST.students, st = all.filter(s => LOC === 'all' || s.location === LOC);
  const here = st.filter(s => s.signed_in && !s.out_at).length, out = st.filter(s => s.out_at).length;
  const away = s => !s.signed_in && (s.day_status === 'absent' || s.day_status === 'dismissed');
  APP.innerHTML = header(`${here} here now · ${out} picked up · ${st.length} on the list`) + `
    <div class="segs" id="locs" style="margin:4px 0 8px">${[['all', 'All'], ['KHA', 'KHA'], ['SP', 'SP']].map(([v, l]) => `<button data-l="${v}" aria-pressed="${LOC === v}">${l} (${v === 'all' ? all.length : all.filter(s => s.location === v).length})</button>`).join('')}</div>
    ${LIST.attendance_in ? '' : '<p class="muted small">Today\'s attendance isn\'t in yet.</p>'}
    <p class="muted small">Students marked present today are signed in automatically at 3:00 PM. Tap a student to sign them in or out, or to see who can pick them up.</p>
    <div class="card" style="gap:8px"><b>Not on the list? Find any student</b>
      <input type="search" id="q" placeholder="Type a first or last name" autocomplete="off"><div class="hits" id="hits"></div></div>
    ${st.map(s => {
      const status = s.out_at ? `Picked up ${tm(s.out_at)} · ${esc(s.out_person_name || '')}` : s.signed_in ? `Here since ${tm(s.in_at)}` : s.day_status === 'absent' ? 'Absent today' : s.day_status === 'dismissed' ? 'Checked out early' : 'Not signed in';
      return `<button class="kid ${s.signed_in && !s.out_at ? 'on' : ''} ${s.out_at ? 'done' : ''} ${away(s) ? 'out' : ''}" data-id="${s.student_id}">
        <span class="box">${s.signed_in ? '✓' : ''}</span><span><b>${esc(s.last)}, ${esc(s.first)}<span class="loc ${esc(s.location)}">${esc(s.location || '')}</span></b><small>Grade ${esc(grade(s.grade))} · ${esc(s.teacher || '')}${s.enrolled ? '' : ' · not on today\'s list'}</small></span>
        <span class="st"><small>${status}</small></span></button>`; }).join('') || '<div class="card">No students.</div>'}`;
  wire();
  $('#locs').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; LOC = b.dataset.l; store.set('ccs_care_loc', LOC); draw(); };
  APP.querySelectorAll('.kid[data-id]').forEach(b => b.onclick = () => sheetPm(LIST.students.find(x => x.student_id === +b.dataset.id)));
  wireSearch();
}

async function sheetPm(s) {
  openSheet('<p class="muted">Loading…</p>');
  let r; try { r = await call('care_people', { p_student: s.student_id }); } catch (x) { $('#sheet-in').innerHTML = `<div class="card err">${esc(x.message)}</div>`; return; }
  const people = r.people;
  $('#sheet-in').innerHTML = `<div class="hd"><div><h1 style="font-size:1.8rem">${esc(s.first)} ${esc(s.last)}<span class="loc ${esc(s.location)}">${esc(s.location || '')}</span></h1><span class="muted">Grade ${esc(grade(s.grade))} · ${esc(s.teacher || '')}</span></div><button class="x" id="sx" aria-label="Close">×</button></div>
    <div class="card"><p>${s.out_at ? `Signed in ${tm(s.in_at)}. <b>Picked up ${tm(s.out_at)}</b> by ${esc(s.out_person_name || '')}${s.out_relationship ? ' (' + esc(s.out_relationship) + ')' : ''}${s.out_how === 'kiosk' ? ' at the kiosk' : s.out_by ? ' · entered by ' + esc(s.out_by) : ''}.`
      : s.signed_in ? `<b>Here since ${tm(s.in_at)}</b> (${s.in_how === 'auto' ? 'automatic 3:00 PM sign-in' : 'signed in by ' + esc(s.in_by || '')}).` : 'Not signed in to afterschool care today.'}</p></div>
    ${!s.signed_in ? `<button class="btn" id="in">Sign In Now</button>` : ''}
    ${s.signed_in && !s.out_at ? `<b>Sign out — who is picking up?</b><div class="people" id="pp">${people.map((p, i) => `<button class="person" data-i="${i}"><div><b>${esc(p.name)}</b><small>${esc(p.relationship || p.type)}${p.phone ? ' · ' + esc(p.phone) : ''}${p.pin ? ' · PIN <span class="pin">' + esc(p.pin) + '</span>' : ''}</small></div></button>`).join('') || '<p class="muted">No pick-up people on file.</p>'}</div>
      <button class="btn ghost sm" id="undo">Undo Sign-In (Marked by Mistake)</button>` : ''}
    ${(r.banned || []).length ? `<div class="banbox"><b class="h">⚠ BANNED — do not release to:</b>${r.banned.map((b, i) => `<button data-ban="${i}" type="button"><span><b>${esc(b.name)}</b><small style="display:block;color:#555">${esc([b.relationship, b.type].filter(Boolean).join(' · '))}</small></span><span class="t">BANNED</span></button>`).join('')}<small>If one of these people is here, tap their name to alert the front office.</small></div>` : ''}
    ${s.out_at || !s.signed_in ? `<b>Who can pick up</b><div class="pp">${people.map(p => `<div><span><b>${esc(p.name)}</b> <small class="muted">${esc(p.relationship || p.type)}</small></span><small>${esc(p.phone || '')}${p.pin ? ' · PIN <span class="pin">' + esc(p.pin) + '</span>' : ''}</small></div>`).join('') || '<p class="muted">None on file.</p>'}</div>` : ''}`;
  $('#sx').onclick = closeSheet;
  if ($('#in')) $('#in').onclick = async () => { try { const x = await call('care_in', { p_student: s.student_id, p_session: 'pm' }); closeSheet(); toast('Signed in ' + x.time); load(true); } catch (x) { toast(msg(x.message)); } };
  if ($('#undo')) $('#undo').onclick = async () => { await call('care_undo', { p_student: s.student_id, p_session: 'pm' }); closeSheet(); toast('Undone'); load(true); };
  if ($('#pp')) $('#pp').onclick = e => { const b = e.target.closest('[data-i]'); if (b) signOut(s, people[+b.dataset.i]); };
  $$('#sheet-in [data-ban]').forEach(b => b.onclick = async () => {
    const p = r.banned[+b.dataset.ban]; b.disabled = true;
    try { await call('duty_ban_alert', { p_banned: p.id, p_place: 'care' }); } catch {}
    $('#sheet-in').innerHTML = `<div class="banwarn"><h2>DO NOT RELEASE</h2><p><b>${esc(p.name)}</b> is BANNED from picking up ${esc(s.first)} ${esc(s.last)}.</p><p>The front office has been alerted. Keep the student with you and call the office.</p></div><button class="btn" id="sx" style="margin-top:12px">Close</button>`;
    $('#sx').onclick = closeSheet;
  });
}
function signOut(s, p) {
  $('#sheet-in').innerHTML = `<div class="hd"><div><h1 style="font-size:1.6rem">Sign out ${esc(s.first)}</h1><span class="muted">Picked up by <b>${esc(p.name)}</b> (${esc(p.relationship || p.type)})</span></div><button class="x" id="sx" aria-label="Close">×</button></div>
    <div class="card" style="gap:8px"><div style="display:flex;justify-content:space-between"><b>${esc(p.name)}, sign here</b><button class="link" id="sclr">Clear</button></div><canvas class="sigc" id="sig"></canvas></div>
    <p class="err" id="serr"></p>
    <div class="row-btns"><button class="btn" id="ok">Confirm Sign-Out</button><button class="btn ghost" id="back">Back</button></div>`;
  $('#sx').onclick = closeSheet; $('#back').onclick = () => sheetPm(s);
  const sig = pad($('#sig'));
  $('#ok').onclick = async () => {
    if (!sig.dirty()) return $('#serr').textContent = 'Please have them sign.';
    const b = $('#ok'); b.disabled = true;
    try { const r = await call('care_out', { p_student: s.student_id, p_session: 'pm', p_person_key: p.key || null, p_name: p.name, p_rel: p.relationship || p.type, p_signature: sig.data() });
      closeSheet(); toast(`${s.first} signed out ${r.time}`); load(true); }
    catch (x) { $('#serr').textContent = msg(x.message); b.disabled = false; }
  };
}

// ---------------- shared ----------------
function openSheet(html) { $('#sheet').hidden = false; $('#sheet-in').innerHTML = html; if ($('#sx')) $('#sx').onclick = closeSheet; }
function closeSheet() { $('#sheet').hidden = true; }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
function pad(c) {
  const r0 = c.getBoundingClientRect(), ratio = Math.min(2, devicePixelRatio || 1);
  c.width = Math.round(r0.width * ratio); c.height = Math.round(r0.height * ratio);
  const x = c.getContext('2d'); x.scale(ratio, ratio); x.lineWidth = 2.6; x.lineCap = x.lineJoin = 'round'; x.strokeStyle = '#141213'; x.fillStyle = '#141213';
  let drawing = false, last = null, dirty = false;
  const pt = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener('pointerdown', e => { drawing = true; last = pt(e); c.setPointerCapture(e.pointerId); x.beginPath(); x.arc(last[0], last[1], 1.2, 0, 7); x.fill(); });
  c.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); x.beginPath(); x.moveTo(...last); x.lineTo(...p); x.stroke(); last = p; dirty = true; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => c.addEventListener(t, () => drawing = false));
  $('#sclr').onclick = () => { x.clearRect(0, 0, c.width, c.height); dirty = false; };
  return { dirty: () => dirty, data: () => { const o = document.createElement('canvas'); o.width = 600; o.height = Math.round(600 * c.height / c.width); o.getContext('2d').drawImage(c, 0, 0, o.width, o.height); return o.toDataURL('image/png'); } };
}

boot();
