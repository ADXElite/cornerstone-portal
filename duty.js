// Car line (/carline) and bus driver (/bus) screens. Staff sign in; car line and bus roles only see these screens.
const sb = supabase.createClient('https://cvvdwhgdiqnoqgxtgzfw.supabase.co', 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0');
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MODE = location.pathname.startsWith('/bus') ? 'bus' : 'carline';
const grade = g => g === 'K' ? 'K' : g ? String(g).replace(/^0/, '') : '';
const tm = t => t ? new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '';
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2500); }
async function call(fn, args = {}) { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; }
const APP = $('#v-app');
let ME = null, timer = null;

document.title = MODE === 'bus' ? 'Bus Roster — Cornerstone' : 'Car Line — Cornerstone';
$('#lg-what').textContent = MODE === 'bus' ? 'Bus drivers' : 'Car line';

async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return login();
  try { ME = await call('duty_me'); } catch { await sb.auth.signOut(); return login("This account isn't set up for dismissal. Ask the front office."); }
  const roles = ME.roles || [ME.role];
  const canHere = MODE === 'bus' ? roles.some(r => r === 'bus' || r === 'busdismiss') : roles.includes(MODE);
  if (!roles.includes('office') && !roles.includes('admin') && !canHere) {
    const other = roles.includes('bus') || roles.includes('busdismiss') ? '/bus' : roles.includes('carline') ? '/carline' : '/care';
    const what = { '/bus': 'the bus roster', '/carline': 'car line', '/care': 'extended care' }[other];
    APP.hidden = false; $('#v-login').hidden = true;
    APP.innerHTML = `<div class="card"><b class="t">This sign-in isn't set up for ${MODE === 'bus' ? 'bus drivers' : 'car line'}.</b><p><a class="btn" href="${other}">Open ${what}</a></p></div>`;
    return;
  }
  $('#who').hidden = false;
  $('#who').innerHTML = `${esc(ME.name || ME.email)}<br><button id="b-out">Sign out</button>`;
  $('#b-out').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $('#v-login').hidden = true; APP.hidden = false;
  MODE === 'bus' ? busStart() : carStart();
}
function login(err) {
  $('#v-login').hidden = false; APP.hidden = true; $('#lg-err').textContent = err || '';
}
$('#f-login').addEventListener('submit', async e => {
  e.preventDefault(); $('#lg-err').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#lg-email').value.trim().toLowerCase(), password: $('#lg-pass').value });
  if (error) return $('#lg-err').textContent = 'Email or password is incorrect.';
  boot();
});
function every(fn, ms) { clearInterval(timer); timer = setInterval(() => { if (!document.hidden && $('#sheet').hidden) fn(true); }, ms); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && ME) (MODE === 'bus' ? (BUS === ALL_BUSES ? loadAllBuses(true) : BUS ? loadBus(true) : null) : loadCars(true)); });

// =================== BUS ===================
let BUS = store.get('ccs_bus');
const ALL_BUSES = '*all*';
// Bus Dismissal staff (not drivers) go straight to the all-buses list.
const dismissOnly = () => { const r = ME.roles || [ME.role]; return r.includes('busdismiss') && !r.some(x => ['bus', 'office', 'admin'].includes(x)); };
const mayAll = () => (ME.roles || [ME.role]).some(x => ['busdismiss', 'office', 'admin'].includes(x));
async function busStart() { if (dismissOnly()) BUS = ALL_BUSES; BUS === ALL_BUSES ? (mayAll() ? loadAllBuses() : pickBus()) : BUS ? loadBus() : pickBus(); }
async function pickBus() {
  BUS = null; clearInterval(timer);
  APP.innerHTML = `<div class="hd"><h1>Choose your bus</h1></div><div class="buses" id="buses"><p class="muted">Loading…</p></div>`;
  const list = await call('duty_buses');
  const total = list.reduce((n, b) => n + b.present, 0);
  $('#buses').innerHTML = (mayAll() ? `<button data-b="${ALL_BUSES}" class="allb"><b>All Buses</b><small>${total} riding today · check everyone on</small></button>` : '')
    + (list.map(b => `<button data-b="${esc(b.bus)}"><b>Bus ${esc(b.bus)}</b><small>${b.present} riding today</small></button>`).join('') || '<div class="card">No bus riders today.</div>');
  $('#buses').onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; BUS = b.dataset.b; store.set('ccs_bus', BUS); BUS === ALL_BUSES ? loadAllBuses() : loadBus(); };
}

// ----- All buses (Bus Dismissal role): Last, First (Grade) (Bus #), check each student onto the bus -----
let AQ = '', ABUS = '', ANOT = false;
async function loadAllBuses(quiet) {
  if (!quiet) APP.innerHTML = '<p class="muted">Loading…</p>';
  let r; try { r = await call('duty_bus_all'); } catch (x) { if (!quiet) APP.innerHTML = `<div class="card err">${esc(x.message)}</div>`; return; }
  const riding = s => s.status === 'present' || s.status === 'late';
  const busNo = b => b ? String(b).replace(/^bus\s*/i, '') : '?';
  const buses = [...new Set(r.students.map(s => busNo(s.bus)))].sort((a, b) => (+a || 999) - (+b || 999) || a.localeCompare(b));
  const all = r.students.filter(riding), on = all.filter(s => s.on_bus).length;
  const y = scrollY, focused = document.activeElement && document.activeElement.id === 'aq';
  APP.innerHTML = `<div class="hd"><div><h1>All Buses</h1><span class="prog">${on} of ${all.length} on a bus</span></div>
      <div class="tools">${dismissOnly() ? '' : '<button class="btn ghost sm" id="chg">Change bus</button>'}<button class="btn ghost sm" id="ref">Refresh</button></div></div>
    ${r.attendance_in ? '' : '<p class="muted small">Today\'s attendance isn\'t in yet, so everyone shows as present.</p>'}
    <div class="abar"><input type="search" id="aq" placeholder="Search a student" value="${esc(AQ)}" autocomplete="off">
      <div class="achips"><button data-ab="" class="${ABUS ? '' : 'on'}">All</button>${buses.map(b => `<button data-ab="${esc(b)}" class="${ABUS === b ? 'on' : ''}">Bus ${esc(b)}</button>`).join('')}<button id="anot" class="not ${ANOT ? 'on' : ''}" aria-pressed="${ANOT}">Not on Bus</button></div></div>
    <p class="muted small">Tap a student when they get on the bus. Tap again to undo.</p>
    <div id="alist"></div>`;
  const draw = () => {
    const q = AQ.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
    const outOf = s => s.status === 'absent' || s.status === 'dismissed' || s.elsewhere;
    const list = r.students.filter(s => (!ABUS || busNo(s.bus) === ABUS) && (!ANOT || (!s.on_bus && !outOf(s))) && q.every(w => `${s.first} ${s.last}`.toLowerCase().includes(w)));
    $('#alist').innerHTML = list.map(s => {
      const out = s.status === 'absent' || s.status === 'dismissed' || s.elsewhere;
      const st = s.status === 'absent' ? 'Absent' : s.status === 'dismissed' ? 'Checked out early' : s.elsewhere ? 'Picked up in car line' : s.on_bus ? 'On bus ' + tm(s.on_bus_at) : s.status === 'late' ? 'Present (late)' : '';
      return `<button class="kid ${s.on_bus ? 'on' : ''} ${out ? 'out' : ''} ${s.changed ? 'chg' : ''}" data-id="${s.student_id}" ${out ? 'disabled' : ''}>
        <span class="box">${s.on_bus ? '✓' : ''}</span><span><b>${esc(s.last)}, ${esc(s.first)} (${esc(grade(s.grade) === 'K' ? 'K' : grade(s.grade))}) (Bus ${esc(busNo(s.bus))})</b>${s.changed ? '<small style="color:var(--red)">changed today</small>' : ''}</span>
        <span class="st"><small>${esc(st)}</small></span></button>`;
    }).join('') || `<div class="card">${ANOT ? 'Everyone here has been marked on a bus.' : 'No bus riders match.'}</div>`;
    $('#alist').querySelectorAll('.kid:not(.out)').forEach(b => b.onclick = async () => {
      const was = b.classList.contains('on'); b.classList.toggle('on', !was); b.querySelector('.box').textContent = was ? '' : '✓';
      const s = r.students.find(x => String(x.student_id) === b.dataset.id); if (s) { s.on_bus = !was; s.on_bus_at = was ? null : new Date().toISOString(); }
      try { await call('duty_bus_mark', { p_student: +b.dataset.id, p_on: !was }); } catch (x) { toast(x.message); loadAllBuses(true); }
      const n = r.students.filter(x => riding(x) && x.on_bus).length; $('.prog').textContent = `${n} of ${all.length} on a bus`;
      if (ANOT && !was) setTimeout(draw, 600); // drop them from the "Not on Bus" list after a moment
    });
  };
  draw(); scrollTo(0, y);
  if (focused) { const i = $('#aq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  $('#aq').oninput = e => { AQ = e.target.value; draw(); };
  APP.querySelector('.achips').onclick = e => {
    if (e.target.closest('#anot')) { ANOT = !ANOT; $('#anot').classList.toggle('on', ANOT); $('#anot').setAttribute('aria-pressed', ANOT); return draw(); }
    const b = e.target.closest('[data-ab]'); if (!b) return; ABUS = b.dataset.ab; APP.querySelectorAll('.achips [data-ab]').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  if ($('#chg')) $('#chg').onclick = () => { store.set('ccs_bus', null); pickBus(); };
  $('#ref').onclick = () => loadAllBuses();
  every(loadAllBuses, 30000);
}
async function loadBus(quiet) {
  if (!quiet) APP.innerHTML = '<p class="muted">Loading…</p>';
  let r; try { r = await call('duty_bus', { p_bus: BUS }); } catch (x) { if (!quiet) APP.innerHTML = `<div class="card err">${esc(x.message)}</div>`; return; }
  const riding = r.students.filter(s => s.status === 'present' || s.status === 'late');
  const on = riding.filter(s => s.on_bus).length;
  // Students arrive sorted by afternoon drop-off time; keep that order.
  const by = new Map(); for (const s of r.students) { const k = s.stop_no ? 'n' + s.stop_no : 's' + s.stop; if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
  const y = scrollY;
  APP.innerHTML = `<div class="hd"><div><h1>Bus ${esc(BUS)}</h1><span class="prog">${r.driver ? esc(r.driver) + ' · ' : ''}${r.leaves ? 'leaves school ' + esc(r.leaves) + ' · ' : ''}${on} of ${riding.length} on the bus</span></div>
      <div class="tools"><button class="btn ghost sm" id="chg">Change bus</button><button class="btn ghost sm" id="ref">Refresh</button></div></div>
    ${r.attendance_in ? '' : '<p class="muted small">Today\'s attendance isn\'t in yet, so everyone shows as present.</p>'}
    <p class="muted small">Tap a student when they get on the bus. Tap again to undo.</p>
    ${[...by.values()].map(list => { const f = list[0]; return `<div class="stop"><span>${f.stop_time ? esc(f.stop_time) + ' · ' : ''}${esc(f.stop)}<small style="display:block;font-family:var(--body);font-weight:600;text-transform:none;letter-spacing:0;color:var(--muted);font-size:.85rem">${esc(f.stop_where || '')}</small></span><span class="muted">${list.filter(s => s.status === 'present' || s.status === 'late').length}</span></div>
      ${list.map(s => {
        const out = s.status === 'absent' || s.status === 'dismissed' || s.elsewhere;
        const st = s.status === 'absent' ? 'Absent' : s.status === 'dismissed' ? 'Checked out early' : s.elsewhere ? 'Picked up in car line' : s.on_bus ? 'On bus ' + tm(s.on_bus_at) : s.status === 'late' ? 'Present (late)' : '';
        return `<button class="kid ${s.on_bus ? 'on' : ''} ${out ? 'out' : ''} ${s.changed ? 'chg' : ''}" data-id="${s.student_id}" ${out ? 'disabled' : ''}>
          <span class="box">${s.on_bus ? '✓' : ''}</span><span><b>${esc(s.name)}</b><small>Grade ${esc(grade(s.grade))}${s.changed ? ' · <span style="color:var(--red)">changed today</span>' : ''}</small></span>
          <span class="st"><small>${esc(st)}</small></span></button>`; }).join('')}`; }).join('') || '<div class="card">No students on this bus today.</div>'}`;
  scrollTo(0, y);
  $('#chg').onclick = () => { store.set('ccs_bus', null); pickBus(); };
  $('#ref').onclick = () => loadBus();
  APP.querySelectorAll('.kid:not(.out)').forEach(b => b.onclick = async () => {
    const was = b.classList.contains('on'); b.classList.toggle('on', !was); b.querySelector('.box').textContent = was ? '' : '✓';
    try { await call('duty_bus_mark', { p_student: +b.dataset.id, p_on: !was }); loadBus(true); }
    catch (x) { toast(x.message); loadBus(true); }
  });
  every(loadBus, 30000);
}

// =================== CAR LINE ===================
let CARS = null, CQ = '', SHOW_DONE = false;
async function carStart() {
  APP.innerHTML = `<div class="hd"><div><h1>Car line</h1><span class="prog" id="prog"></span></div><div class="tools"><button class="btn ghost sm" id="ref">Refresh</button></div></div>
    <div class="tools"><input type="search" id="cq" placeholder="Type a student's name" autocomplete="off"></div>
    <div class="seg sm" role="radiogroup"><label><input type="radio" name="cv" value="0" checked><span>Waiting</span></label><label><input type="radio" name="cv" value="1"><span>Picked up</span></label></div>
    <div id="att"></div><div id="cars"></div>`;
  $('#cq').oninput = () => { CQ = $('#cq').value.trim().toLowerCase(); drawCars(); };
  document.querySelectorAll('input[name=cv]').forEach(r => r.onchange = () => { SHOW_DONE = r.value === '1' && r.checked; drawCars(); });
  $('#ref').onclick = () => loadCars();
  loadCars();
  every(loadCars, 30000);
}
async function loadCars(quiet) {
  try { CARS = await call('duty_cars'); } catch (x) { if (!quiet) $('#cars').innerHTML = `<div class="card err">${esc(x.message)}</div>`; return; }
  drawCars();
}
function drawCars() {
  if (!CARS) return;
  const here = CARS.students.filter(s => s.status === 'present' || s.status === 'late');
  const done = here.filter(s => s.done);
  $('#prog').textContent = `${done.length} of ${here.length} picked up`;
  $('#att').innerHTML = CARS.attendance_in ? '' : '<p class="muted small">Today\'s attendance isn\'t in yet, so everyone shows as present.</p>';
  const list = here.filter(s => s.done === SHOW_DONE && (!CQ || s.name.toLowerCase().includes(CQ)));
  const away = CARS.students.filter(s => !(s.status === 'present' || s.status === 'late'));
  $('#cars').innerHTML = list.map(s => `<button class="kid ${s.done ? 'on' : ''} ${s.changed ? 'chg' : ''}" data-id="${s.student_id}">
      <span class="box">${s.done ? '✓' : ''}</span><span><b>${esc(s.last)}, ${esc(s.first)}${s.banned ? ' <span style="background:var(--red);color:#fff;font-size:.7rem;font-weight:800;padding:1px 6px;border-radius:5px;vertical-align:2px">BANNED PERSON</span>' : ''}</b><small>Grade ${esc(grade(s.grade))} · ${esc((s.teacher || '').replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/, ''))}${s.changed && s.pickup_person ? ` · <span style="color:var(--red)">today: ${esc(s.pickup_person)}</span>` : ''}</small></span>
      <span class="st"><small>${s.done ? esc(s.picked_by || '') + ' · ' + tm(s.done_at) : ''}</small></span></button>`).join('')
    || `<div class="card">${SHOW_DONE ? 'No one picked up yet.' : CQ ? 'No match.' : 'Everyone has been picked up.'}</div>`;
  if (!SHOW_DONE && away.length && !CQ) $('#cars').innerHTML += `<details class="card" style="margin-top:10px"><summary class="muted">Not here today (${away.length})</summary><p class="small">${away.map(s => `${esc(s.name)} — ${s.status === 'absent' ? 'absent' : 'checked out early'}`).join('<br>')}</p></details>`;
  $('#cars').querySelectorAll('.kid').forEach(b => b.onclick = () => openKid(+b.dataset.id));
}
async function openKid(id) {
  const s = CARS.students.find(x => x.student_id === id);
  $('#sheet').hidden = false;
  $('#sheet-in').innerHTML = '<p class="muted">Loading…</p>';
  const r = await call('duty_car_people', { p_student: id });
  const today = (r.today_pickup || '').toLowerCase();
  $('#sheet-in').innerHTML = `<div class="hd"><div><h1 style="font-size:1.8rem">${esc(r.student.name)}</h1><span class="muted">Grade ${esc(grade(r.student.grade))} · ${esc(r.student.teacher || '')}</span></div><button class="x" id="sx" aria-label="Close">×</button></div>
    ${s.done ? `<div class="card on" style="background:var(--ok-bg);color:var(--ok);border-color:var(--ok)"><b>Picked up by ${esc(s.picked_by || '')} at ${tm(s.done_at)}</b><button class="link" id="undo">Undo</button></div>` : ''}
    ${r.today_pickup ? `<div class="card alert"><b>Today's change: picked up by ${esc(r.today_pickup)}</b></div>` : ''}
    <b>Who is picking up?</b>
    <div class="people">${r.people.map((p, i) => `<button class="person ${today && p.name.toLowerCase() === today ? 'today' : ''}" data-i="${i}"><span><b>${esc(p.name)}</b><small>${esc([p.relationship, p.type].filter(Boolean).join(' · '))}</small></span></button>`).join('')
      || '<div class="card">No authorized pick-up people on file. Send them to the front office.</div>'}</div>
    ${(r.banned || []).length ? `<div class="banbox"><b class="h">⚠ BANNED — do not release to:</b>${r.banned.map((b, i) => `<button data-ban="${i}" type="button"><span><b>${esc(b.name)}</b><small style="display:block;color:#555">${esc([b.relationship, b.type].filter(Boolean).join(' · '))}</small></span><span class="t">BANNED</span></button>`).join('')}<small>If one of these people is here, tap their name to alert the front office.</small></div>` : ''}
    <details class="card"><summary class="muted">Someone not on this list</summary><p class="small">Anyone not on the list must go to the front office with a photo ID.</p></details>`;
  $('#sheet-in').querySelectorAll('[data-ban]').forEach(b => b.onclick = async () => {
    const p = r.banned[+b.dataset.ban]; b.disabled = true;
    try { await call('duty_ban_alert', { p_banned: p.id, p_place: 'carline' }); } catch {}
    $('#sheet-in').innerHTML = `<div class="banwarn"><h2>DO NOT RELEASE</h2><p><b>${esc(p.name)}</b> is BANNED from picking up ${esc(r.student.name)}.</p><p>The front office has been alerted. Keep the student with you and call the office.</p></div><button class="btn" id="sx" style="margin-top:12px">Close</button>`;
    $('#sx').onclick = () => $('#sheet').hidden = true;
  });
  $('#sx').onclick = () => $('#sheet').hidden = true;
  if ($('#undo')) $('#undo').onclick = async () => { await call('duty_car_unmark', { p_student: id }); $('#sheet').hidden = true; toast('Undone'); loadCars(true); };
  $('#sheet-in').querySelectorAll('.person').forEach(b => b.onclick = async () => {
    const p = r.people[+b.dataset.i]; b.disabled = true;
    try { await call('duty_car_mark', { p_student: id, p_person_key: p.key, p_name: p.name, p_rel: p.relationship || p.type });
      $('#sheet').hidden = true; toast(`${r.student.name.split(' ')[0]} picked up by ${p.name}`); loadCars(true); }
    catch (x) { toast(x.message); b.disabled = false; }
  });
}
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; });

boot();
