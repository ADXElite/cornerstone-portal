// Car line (/carline) and bus driver (/bus) screens. Staff sign in; car line and bus roles only see these screens.
const sb = supabase.createClient('https://cvvdwhgdiqnoqgxtgzfw.supabase.co', 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0');
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let MODE = location.pathname.startsWith('/bus') ? 'bus' : location.pathname.startsWith('/collect') ? 'collect' : 'carline';
const CAR_SITE = MODE !== 'bus'; // /carline (and the older /collect address)
const grade = g => g === 'K' ? 'K' : g ? String(g).replace(/^0/, '') : '';
const tm = t => t ? new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '';
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2500); }
async function call(fn, args = {}) { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; }
const APP = $('#v-app');
let ME = null, timer = null;

document.title = MODE === 'bus' ? 'Bus Roster — Cornerstone' : MODE === 'collect' ? 'Car Line Collector — Cornerstone' : 'Car Line — Cornerstone';
$('#lg-what').textContent = MODE === 'bus' ? 'Bus drivers' : 'Car line';

async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return login();
  try { ME = await call('duty_me'); } catch { await sb.auth.signOut(); return login("This account isn't set up for dismissal. Ask the front office."); }
  const roles = ME.roles || [ME.role];
  const canHere = MODE === 'bus' ? roles.some(r => r === 'bus' || r === 'busdismiss') : roles.some(r => r === 'carcollect' || r === 'carline');
  if (!roles.includes('office') && !roles.includes('admin') && !canHere) {
    const other = roles.includes('bus') || roles.includes('busdismiss') ? '/bus' : roles.includes('carline') ? '/carline' : roles.includes('carcollect') ? '/collect' : '/care';
    const what = { '/bus': 'the bus roster', '/carline': 'car line', '/collect': 'the car line collector list', '/care': 'extended care' }[other];
    APP.hidden = false; $('#v-login').hidden = true;
    APP.innerHTML = `<div class="card"><b class="t">This sign-in isn't set up for ${MODE === 'bus' ? 'bus drivers' : MODE === 'collect' ? 'car line collectors' : 'car line'}.</b><p><a class="btn" href="${other}">Open ${what}</a></p></div>`;
    return;
  }
  $('#who').hidden = false;
  $('#who').innerHTML = `${esc(ME.name || ME.email)}<br><button id="b-out">Sign out</button>`;
  $('#b-out').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $('#v-login').hidden = true; APP.hidden = false;
  MODE === 'bus' ? busStart() : carPick();
}
function login(err) {
  $('#v-login').hidden = false; APP.hidden = true; $('#lg-err').textContent = err || '';
}
$('#f-login').addEventListener('submit', async e => {
  e.preventDefault(); $('#lg-err').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#lg-email').value.trim().toLowerCase(), password: $('#lg-pass').value });
  if (error) return $('#lg-err').textContent = 'Email or password is incorrect.';
  try { sessionStorage.removeItem('ccs_car_job'); } catch {}
  boot();
});
function every(fn, ms) { clearInterval(timer); timer = setInterval(() => { if (!document.hidden && $('#sheet').hidden) fn(true); }, ms); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && ME && MODE !== 'pick') (MODE === 'collect' ? loadCollect(true) : MODE === 'bus' ? (BUS === ALL_BUSES ? loadAllBuses(true) : BUS ? loadBus(true) : null) : loadCars(true)); });

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


// Put any student on a bus (asks which bus unless the driver's bus is known).
async function busAnyStudent(x, fixedBus, after) {
  $('#sheet').hidden = false;
  let buses = fixedBus ? [fixedBus] : [];
  if (!fixedBus) { $('#sheet-in').innerHTML = '<p class="muted">Loading…</p>'; try { buses = await call('duty_bus_numbers'); } catch { buses = ['1', '4', '5']; } }
  $('#sheet-in').innerHTML = `<div class="hd"><div><h1 style="font-size:1.8rem">${esc(x.first)} ${esc(x.last)}</h1><span class="muted">Grade ${esc(grade(x.grade))}${x.teacher ? ' · ' + esc(x.teacher) : ''}</span></div><button class="x" id="sx" aria-label="Close">×</button></div>
    ${changeNote(x, 'Bus Rider')}
    <b>${fixedBus ? 'Put on this bus?' : 'Which bus did they get on?'}</b>
    <div class="buses" style="margin-top:8px">${buses.map(b => `<button data-pb="${esc(b)}"><b>Bus ${esc(b)}</b><small>${fixedBus ? 'Tap to check them on' : 'Check them on'}</small></button>`).join('')}</div>`;
  $('#sx').onclick = () => $('#sheet').hidden = true;
  $('#sheet-in').querySelectorAll('[data-pb]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await call('duty_bus_mark_any', { p_student: x.student_id, p_bus: b.dataset.pb }); $('#sheet').hidden = true; toast(`${x.first} is on Bus ${b.dataset.pb}`); after(); }
    catch (er) { toast(er.message === 'pick_bus' ? 'Choose a bus.' : er.message); b.disabled = false; }
  });
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
    <p class="muted small">Tap a student when they get on the bus. Tap again to undo. Not on the list? Search their name.</p>
    <div id="alist"></div><div id="aothers"></div>`;
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
  const others = () => findOthers(AQ, $('#aothers'), x => r.students.some(y => y.student_id === x.student_id), x => busAnyStudent(x, null, () => { AQ = ''; loadAllBuses(); }));
  $('#aq').oninput = e => { AQ = e.target.value; draw(); others(); };
  if (AQ) others();
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
  const bqv = $('#bq') ? $('#bq').value : '', bqf = document.activeElement && document.activeElement.id === 'bq';
  // Students arrive sorted by afternoon drop-off time; keep that order.
  const by = new Map(); for (const s of r.students) { const k = s.stop_no ? 'n' + s.stop_no : 's' + s.stop; if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
  const y = scrollY;
  APP.innerHTML = `<div class="hd"><div><h1>Bus ${esc(BUS)}</h1><span class="prog">${r.driver ? esc(r.driver) + ' · ' : ''}${r.leaves ? 'leaves school ' + esc(r.leaves) + ' · ' : ''}${on} of ${riding.length} on the bus</span></div>
      <div class="tools"><button class="btn ghost sm" id="chg">Change bus</button><button class="btn ghost sm" id="ref">Refresh</button></div></div>
    ${r.attendance_in ? '' : '<p class="muted small">Today\'s attendance isn\'t in yet, so everyone shows as present.</p>'}
    <p class="muted small">Tap a student when they get on the bus. Tap again to undo.</p>
    <div class="abar"><input type="search" id="bq" placeholder="Student not on this list? Search their name" autocomplete="off"></div><div id="bothers"></div>
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
  const bOthers = () => findOthers($('#bq').value, $('#bothers'), x => r.students.some(y => y.student_id === x.student_id), x => busAnyStudent(x, BUS, () => { $('#bq').value = ''; loadBus(); }));
  $('#bq').oninput = bOthers;
  if (bqv) { $('#bq').value = bqv; bOthers(); if (bqf) { $('#bq').focus(); $('#bq').setSelectionRange(bqv.length, bqv.length); } }
  APP.querySelectorAll('.kid:not(.out)').forEach(b => b.onclick = async () => {
    const was = b.classList.contains('on'); b.classList.toggle('on', !was); b.querySelector('.box').textContent = was ? '' : '✓';
    try { await call('duty_bus_mark', { p_student: +b.dataset.id, p_on: !was }); loadBus(true); }
    catch (x) { toast(x.message); loadBus(true); }
  });
  every(loadBus, 30000);
}


// =================== Any student (search beyond today's list) ===================
// Car line / bus staff can dismiss a student whose usual way home is different (e.g. afterschool care).
// The database then creates today's dismissal change and takes them off the afterschool care list.
const METHOD_LABEL = m => m === 'Afternoon Extended Care' ? 'Afterschool Care' : (m || 'Not on file');
let FIND_T = null;
function findOthers(q, box, exclude, onPick) {
  clearTimeout(FIND_T);
  if (!box) return;
  if (q.trim().length < 2) { box.innerHTML = ''; return; }
  FIND_T = setTimeout(async () => {
    let list = []; try { list = await call('duty_find_students', { p_q: q }); } catch { list = []; }
    list = list.filter(x => !exclude(x));
    box.innerHTML = list.length ? `<h3 class="others-h">Other students <small>— not on this list today</small></h3>` + list.map(x => {
      const away = x.status === 'absent' ? 'Absent today' : x.status === 'dismissed' ? 'Checked out early' : x.done ? (x.done === 'bus' ? 'On ' : 'Picked up · ') + (x.done_by || '') : '';
      return `<button class="kid other" data-oid="${x.student_id}" ${x.status === 'absent' || x.status === 'dismissed' ? 'disabled' : ''}>
        <span class="box">+</span><span><b>${esc(x.last)}, ${esc(x.first)} (${esc(grade(x.grade))})</b><small>Today: ${esc(METHOD_LABEL(x.method))}${x.method === 'Bus Rider' && x.bus ? ' · Bus ' + esc(x.bus) : ''}${x.teacher ? ' · ' + esc(x.teacher.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/, '')) : ''}</small></span>
        <span class="st"><small>${esc(away)}</small></span></button>`; }).join('') : '';
    box.querySelectorAll('[data-oid]').forEach(b => b.onclick = () => onPick(list.find(x => String(x.student_id) === b.dataset.oid)));
  }, 250);
}
function changeNote(x, how) {
  return x.method === how ? '' : `<div class="card alert"><b>${esc(x.first)} is listed as ${esc(METHOD_LABEL(x.method))} today.</b>
    <p class="small" style="margin:4px 0 0">Dismissing ${how === 'Car Rider' ? 'in car line' : 'on a bus'} changes today's dismissal to ${how}${x.method === 'Afternoon Extended Care' ? ' and takes them off the afterschool care list' : ''}.</p></div>`;
}



// =================== /carline: choose the job after sign-in ===================
const carJobs = () => { const r = ME.roles || [ME.role], staff = r.some(x => ['office', 'admin', 'carline'].includes(x));
  return [...(staff || r.includes('carcollect') ? ['collect'] : []), ...(staff ? ['carline'] : [])]; };
function carPick(force) {
  const jobs = carJobs();
  let job = null; try { job = sessionStorage.getItem('ccs_car_job'); } catch {}
  if (location.pathname.startsWith('/collect') && jobs.includes('collect') && !force) job = 'collect';
  if (jobs.length === 1) job = jobs[0];
  if (!force && job && jobs.includes(job)) return startCarJob(job);
  clearInterval(timer); MODE = 'pick';
  APP.innerHTML = `<div class="hd"><div><h1>Car Line</h1><span class="prog">What are you doing today?</span></div></div>
    <div class="buses jobs">
      <button data-job="collect"><b>Car Line Collector</b><small>Collect car riders from their classrooms (check #1)</small></button>
      <button data-job="carline"><b>Car Line Dismisser</b><small>Check students into the car and pick who picked them up (check #2)</small></button>
    </div>`;
  APP.querySelectorAll('[data-job]').forEach(b => b.onclick = () => { try { sessionStorage.setItem('ccs_car_job', b.dataset.job); } catch {} startCarJob(b.dataset.job); });
}
function startCarJob(job) {
  MODE = job;
  document.title = job === 'collect' ? 'Car Line Collector — Cornerstone' : 'Car Line — Cornerstone';
  job === 'collect' ? collectStart() : carStart();
  if (carJobs().length > 1) {
    const t = APP.querySelector('.hd .tools');
    if (t) { t.insertAdjacentHTML('afterbegin', `<button class="btn ghost sm" id="swjob">${job === 'collect' ? 'Switch to Dismisser' : 'Switch to Collector'}</button>`);
      $('#swjob').onclick = () => { const next = job === 'collect' ? 'carline' : 'collect'; try { sessionStorage.setItem('ccs_car_job', next); } catch {} startCarJob(next); }; }
  }
}

// =================== CAR LINE COLLECTOR (/collect) ===================
// Check #1: staff collect car riders from their classrooms. Car line staff still do check #2 (official dismissal).
let COL = null, COLQ = '', COL_LEFT = false, COL_OPEN = {};
const colKey = s => s.board || 'No board';
async function collectStart() {
  APP.innerHTML = `<div class="hd"><div><h1>Collect Car Riders</h1><span class="prog" id="cprog"></span></div><div class="tools"><button class="btn ghost sm" id="cref">Refresh</button></div></div>
    <div class="abar"><input type="search" id="colq" placeholder="Search a student" autocomplete="off">
      <div class="achips"><button id="colall" class="on">All</button><button id="colleft">Not Collected</button></div></div>
    <p class="muted small">Tap a student when you collect them from their classroom. Car line staff still check them into the car.</p>
    <div id="catt"></div><div id="clist"><p class="muted">Loading…</p></div>`;
  $('#colq').oninput = e => { COLQ = e.target.value.trim().toLowerCase(); drawCollect(); };
  $('#colall').onclick = () => { COL_LEFT = false; $('#colall').classList.add('on'); $('#colleft').classList.remove('on'); drawCollect(); };
  $('#colleft').onclick = () => { COL_LEFT = true; $('#colleft').classList.add('on'); $('#colall').classList.remove('on'); drawCollect(); };
  $('#cref').onclick = () => loadCollect();
  loadCollect();
  every(loadCollect, 20000);
}
async function loadCollect(quiet) {
  try { COL = await call('duty_collect_list'); } catch (x) { if (!quiet) $('#clist').innerHTML = `<div class="card err">${esc(x.message)}</div>`; return; }
  drawCollect();
}
function drawCollect() {
  if (!COL) return;
  const here = s => s.status === 'present' || s.status === 'late';
  const all = COL.students.filter(here), got = all.filter(s => s.collected || s.dismissed).length;
  $('#cprog').textContent = `${got} of ${all.length} collected`;
  $('#catt').innerHTML = COL.attendance_in ? '' : '<p class="muted small">Today\'s attendance isn\'t in yet, so everyone shows as present.</p>';
  const q = COLQ.split(/[\s,]+/).filter(Boolean);
  const list = COL.students.filter(s => q.every(w => `${s.first} ${s.last}`.toLowerCase().includes(w)) && (!COL_LEFT || (here(s) && !s.collected && !s.dismissed)));
  const boards = [...new Set(list.map(colKey))];
  const y = scrollY;
  $('#clist').innerHTML = boards.map(b => {
    const kids = list.filter(s => colKey(s) === b), bAll = COL.students.filter(s => colKey(s) === b && here(s));
    const bGot = bAll.filter(s => s.collected || s.dismissed).length, doneAll = bAll.length && bGot === bAll.length;
    const open = COL_OPEN[b] ?? !doneAll;
    return `<details class="cboard${doneAll ? ' alldone' : ''}" data-b="${esc(b)}" ${open || q.length ? 'open' : ''}><summary><b>${esc(b)}</b><span>${bGot} of ${bAll.length}${doneAll ? ' ✓' : ''}</span></summary>
      ${kids.map(s => {
        const out = !here(s);
        const st = s.status === 'absent' ? 'Absent' : s.status === 'dismissed' ? 'Checked out early' : s.dismissed ? `In car · ${esc(s.picked_by || '')} ${tm(s.dismissed_at)}` : s.collected ? `Collected ${tm(s.collected_at)}${s.collected_by ? ' · ' + esc(s.collected_by.split(' ')[0]) : ''}` : '';
        return `<button class="kid ${s.collected || s.dismissed ? 'on' : ''} ${out || s.dismissed ? 'out' : ''} ${s.changed ? 'chg' : ''}" data-cid="${s.student_id}" ${out || s.dismissed ? 'disabled' : ''}>
          <span class="box">${s.collected || s.dismissed ? '✓' : ''}</span><span><b>${esc(s.last)}, ${esc(s.first)}</b><small>Grade ${esc(grade(s.grade))}${s.changed ? ' · <span style="color:var(--red)">car rider today (changed)</span>' : ''}</small></span>
          <span class="st"><small>${st}</small></span></button>`; }).join('')}</details>`;
  }).join('') || `<div class="card">${COL_LEFT ? 'Everyone has been collected.' : q.length ? 'No match.' : 'No car riders today.'}</div>`;
  scrollTo(0, y);
  $('#clist').querySelectorAll('details').forEach(d => d.ontoggle = () => { COL_OPEN[d.dataset.b] = d.open; });
  $('#clist').querySelectorAll('[data-cid]').forEach(b => b.onclick = async () => {
    const s = COL.students.find(x => String(x.student_id) === b.dataset.cid), on = !s.collected;
    s.collected = on; s.collected_at = on ? new Date().toISOString() : null; s.collected_by = on ? (ME.name || '') : null; drawCollect();
    try { await call('duty_collect_mark', { p_student: s.student_id, p_on: on }); } catch (x) { toast(x.message); loadCollect(true); }
  });
}

// =================== CAR LINE ===================
let CARS = null, CQ = '', SHOW_DONE = false;
async function carStart() {
  APP.innerHTML = `<div class="hd"><div><h1>Car line</h1><span class="prog" id="prog"></span></div><div class="tools"><button class="btn ghost sm" id="ref">Refresh</button></div></div>
    <div class="tools"><input type="search" id="cq" placeholder="Type a student's name" autocomplete="off"></div>
    <div class="seg sm" role="radiogroup"><label><input type="radio" name="cv" value="0" checked><span>Waiting</span></label><label><input type="radio" name="cv" value="1"><span>Picked up</span></label></div>
    <div id="att"></div><div id="cars"></div><div id="cothers"></div>`;
  $('#cq').oninput = () => { CQ = $('#cq').value.trim().toLowerCase(); drawCars();
    findOthers($('#cq').value, $('#cothers'), x => (CARS && CARS.students.some(c => c.student_id === x.student_id)), x => openKid(x.student_id, x)); };
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
      <span class="st"><small>${s.done ? esc(s.picked_by || '') + ' · ' + tm(s.done_at) : s.collected ? `<span class="coll">✓ Collected ${tm(s.collected_at)}</span>` : '<span class="incl">In class</span>'}</small></span></button>`).join('')
    || `<div class="card">${SHOW_DONE ? 'No one picked up yet.' : CQ ? 'No match.' : 'Everyone has been picked up.'}</div>`;
  if (!SHOW_DONE && away.length && !CQ) $('#cars').innerHTML += `<details class="card" style="margin-top:10px"><summary class="muted">Not here today (${away.length})</summary><p class="small">${away.map(s => `${esc(s.name)} — ${s.status === 'absent' ? 'absent' : 'checked out early'}`).join('<br>')}</p></details>`;
  $('#cars').querySelectorAll('.kid').forEach(b => b.onclick = () => openKid(+b.dataset.id));
}
async function openKid(id, other) {
  const s = CARS.students.find(x => x.student_id === id) || { done: other && other.done === 'car', picked_by: other && other.done_by, done_at: other && other.done_at };
  $('#sheet').hidden = false;
  $('#sheet-in').innerHTML = '<p class="muted">Loading…</p>';
  const r = await call('duty_car_people', { p_student: id });
  const today = (r.today_pickup || '').toLowerCase();
  $('#sheet-in').innerHTML = `<div class="hd"><div><h1 style="font-size:1.8rem">${esc(r.student.name)}</h1><span class="muted">Grade ${esc(grade(r.student.grade))} · ${esc(r.student.teacher || '')}</span></div><button class="x" id="sx" aria-label="Close">×</button></div>
    ${s.done ? `<div class="card on" style="background:var(--ok-bg);color:var(--ok);border-color:var(--ok)"><b>Picked up by ${esc(s.picked_by || '')} at ${tm(s.done_at)}</b><button class="link" id="undo">Undo</button></div>` : ''}
    ${other ? changeNote(other, 'Car Rider') : ''}
    ${!s.done && s.collected ? `<div class="card" style="border-color:var(--ok);background:var(--ok-bg)"><b style="color:var(--ok)">✓ Collected from class at ${tm(s.collected_at)}${s.collected_by ? ' by ' + esc(s.collected_by) : ''}</b></div>`
      : !s.done && s.collected === false ? '<div class="card"><b>Not collected from class yet.</b></div>' : ''}
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
      $('#sheet').hidden = true; toast(`${r.student.name.split(' ')[0]} picked up by ${p.name}`); if (other) { $('#cq').value = ''; CQ = ''; $('#cothers').innerHTML = ''; } loadCars(true); }
    catch (x) { toast(x.message); b.disabled = false; }
  });
}
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; });

boot();
