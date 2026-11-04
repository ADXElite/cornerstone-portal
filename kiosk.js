// Front office iPad kiosk — early check-out and late sign-in.
// The iPad is turned on once by a staff member (staff sign-in -> device key saved on this iPad).
const SB_URL = 'https://cvvdwhgdiqnoqgxtgzfw.supabase.co';
const SB_KEY = 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0';
const $ = s => document.querySelector(s);
const K = $('#k');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const grade = g => g === 'K' ? 'Kindergarten' : g ? `Grade ${String(g).replace(/^0/, '')}` : '';
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
let TOKEN = store.get('ccs_kiosk_token');

const ERR = {
  bad_pin: "That PIN wasn't found. Please check it and try again.",
  locked: 'Too many wrong PINs. Please wait 3 minutes or ask the front desk for help.',
  student_not_found: "We couldn't find that student ID. Try again or search by name.",
  not_linked: "That student isn't linked to this PIN. Please see the front desk.",
  already_signed_in: 'was already signed in late today. Please see the front desk.',
  already_checked_out: 'was already checked out today. Please see the front desk.',
  need_reason: 'Please type a reason.', need_signature: 'Please sign in the box.', pick_student: 'Tap at least one student.',
  pin_required: 'Early check-out needs a parent or pickup PIN.', one_student: 'Choose one student.',
  server_error: 'Something went wrong. Please try again or see the front desk.'
};
function errText(m) {
  const [code, who] = String(m || '').split(':');
  if ((code === 'already_signed_in' || code === 'already_checked_out') && who) return `${who} ${ERR[code]}`;
  return ERR[code] || ERR.server_error;
}

async function rpc(fn, args = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: TOKEN, ...args })
  });
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch {}
  if (!r.ok) {
    const m = (d && d.message) || 'server_error';
    if (m === 'kiosk_not_active') { TOKEN = null; store.set('ccs_kiosk_token', null); setup('This iPad needs to be set up again by front office staff.'); }
    throw new Error(m);
  }
  return d;
}

// ---------- clock, idle timer ----------
function tick() {
  const n = new Date();
  $('#clock').innerHTML = `${n.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}<small>${n.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })}</small>`;
}
setInterval(tick, 10000); tick();
let idle;
function resetIdle() { clearTimeout(idle); if (S.screen !== 'home' && S.screen !== 'setup') idle = setTimeout(() => home(), S.screen === 'done' ? 9000 : 90000); }
addEventListener('pointerdown', resetIdle, { passive: true });
addEventListener('keydown', resetIdle);

// ---------- state ----------
let S = {};
function go(screen, html) { stopScan(); S.screen = screen; K.innerHTML = html; resetIdle(); window.scrollTo(0, 0); }

const ICON_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>';
const ICON_IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>';

function home() {
  if (!TOKEN) return setup();
  S = {};
  go('home', `<div class="kscreen">
    <div><h1 class="kh">Front office</h1><p class="ksub" style="margin-top:6px">Tap what you're here to do.</p></div>
    <div class="big2">
      <button class="bigbtn out" id="b-out">${ICON_OUT}<b>Early check-out</b><span>Picking up a student before dismissal</span></button>
      <button class="bigbtn in" id="b-in">${ICON_IN}<b>Late sign-in</b><span>Signing a student in after 8:30 AM</span></button>
    </div></div>`);
  $('#b-out').onclick = () => { S.kind = 'early_out'; S.method = 'pin'; pinScreen(); };
  $('#b-in').onclick = () => { S.kind = 'late_in'; lateChoice(); };
}

// ---------- PIN ----------
function pinScreen() {
  S.pin = '';
  go('pin', `<div class="kscreen">
    <button class="back" id="bk">‹ Back</button>
    <div class="pinwrap">
      <h1 class="kh">Enter your 4-digit PIN</h1>
      <p class="ksub" style="margin:0">Parents can find PINs in the Cornerstone Parent Portal.</p>
      <div class="dots" id="dots"><i></i><i></i><i></i><i></i></div>
      <div class="kerr" id="perr"></div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<button class="fn" data-c="clr">Clear</button><button data-n="0">0</button><button class="fn" data-c="del">⌫</button></div>
    </div></div>`);
  $('#bk').onclick = () => S.kind === 'late_in' ? lateChoice() : home();
  const draw = () => document.querySelectorAll('#dots i').forEach((d, i) => d.classList.toggle('on', i < S.pin.length));
  K.querySelector('.pad').onclick = async e => {
    const b = e.target.closest('button'); if (!b || S.busy) return;
    if (b.dataset.c === 'clr') S.pin = ''; else if (b.dataset.c === 'del') S.pin = S.pin.slice(0, -1); else if (S.pin.length < 4) S.pin += b.dataset.n;
    $('#perr').textContent = ''; draw();
    if (S.pin.length === 4) {
      S.busy = true;
      try {
        const r = await rpc('kiosk_pin', { p_pin: S.pin });
        if (r.error) throw new Error(r.error);
        S.person = r.name; S.students = r.students; S.selected = new Set(r.students.length === 1 ? [r.students[0].student_id] : []);
        S.method = 'pin'; pickStudents();
      } catch (x) { if (S.screen !== 'pin') return; $('#perr').textContent = errText(x.message); $('#dots').classList.add('shake'); setTimeout(() => { $('#dots')?.classList.remove('shake'); S.pin = ''; draw(); }, 400); }
      S.busy = false;
    }
  };
}

// ---------- late sign-in: who? ----------
function lateChoice() {
  go('late', `<div class="kscreen">
    <button class="back" id="bk">‹ Back</button>
    <h1 class="kh">Late sign-in</h1>
    <div class="choices">
      <button class="choice" id="c-adult"><b>I'm dropping off a student</b><span>Parent, guardian or pickup person — use your 4-digit PIN</span></button>
      <button class="choice" id="c-student"><b>I'm a student signing myself in</b><span>Scan your student badge or type your student ID</span></button>
    </div></div>`);
  $('#bk').onclick = home;
  $('#c-adult').onclick = () => { S.method = 'pin'; pinScreen(); };
  $('#c-student').onclick = studentEntry;
}

// ---------- student: badge / ID / name ----------
function studentEntry(tab) {
  tab = tab || 'scan'; S.sid = '';
  go('student', `<div class="kscreen">
    <button class="back" id="bk">‹ Back</button>
    <h1 class="kh">Find your name</h1>
    <div class="chips2" role="tablist">
      <button data-t="scan" aria-pressed="${tab === 'scan'}">Scan my badge</button>
      <button data-t="id" aria-pressed="${tab === 'id'}">Type my student ID</button>
      <button data-t="name" aria-pressed="${tab === 'name'}">Search my name</button>
    </div>
    <div id="pane"></div><div class="kerr" id="serr"></div></div>`);
  $('#bk').onclick = lateChoice;
  K.querySelector('[role=tablist]').onclick = e => { const b = e.target.closest('button'); if (b) studentEntry(b.dataset.t); };
  if (tab === 'scan') {
    $('#pane').innerHTML = `<p class="ksub" style="margin:0 0 12px">Hold your badge's barcode up to the camera.</p>
      <div class="scanbox"><div id="scanner"></div><div class="scanline"></div></div>
      <div class="row2" style="justify-content:center;margin-top:12px"><button class="kbtn ghost" id="flip" style="min-width:0">Switch camera</button></div>`;
    S.facing = S.facing || 'user';
    startScan();
    $('#flip').onclick = async () => { S.facing = S.facing === 'user' ? 'environment' : 'user'; await stopScan(); startScan(); };
  } else if (tab === 'id') {
    $('#pane').innerHTML = `<div class="pinwrap" style="margin:0"><div class="kh" id="sidv" style="font-size:3rem;min-height:3.2rem;letter-spacing:.12em">&nbsp;</div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<button class="fn" data-c="del">⌫</button><button data-n="0">0</button><button class="fn" data-c="go" style="color:var(--red)">Go</button></div></div>`;
    K.querySelector('.pad').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c === 'del') S.sid = S.sid.slice(0, -1); else if (b.dataset.c === 'go') return findId(S.sid, 'student_id'); else if (S.sid.length < 12) S.sid += b.dataset.n;
      $('#sidv').innerHTML = S.sid || '&nbsp;'; $('#serr').textContent = '';
    };
  } else {
    $('#pane').innerHTML = `<input class="search" id="q" type="search" placeholder="Start typing your first or last name" autocomplete="off" autocapitalize="words" style="-webkit-user-select:text;user-select:text"><div class="hits" id="hits" style="margin-top:12px"></div>`;
    let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const q = $('#q').value.trim(); if (q.length < 2) return $('#hits').innerHTML = '';
      try {
        const list = await rpc('kiosk_search', { p_q: q });
        $('#hits').innerHTML = list.map((s, i) => `<button class="hit" data-i="${i}"><span>${esc(s.first_name)} ${esc(s.last_name)}</span><small>${esc(grade(s.grade))}</small></button>`).join('') || '<p class="ksub">No matches.</p>';
        $('#hits').onclick = e => { const b = e.target.closest('.hit'); if (b) confirmStudent(list[+b.dataset.i], 'name'); };
      } catch (x) { $('#serr').textContent = errText(x.message); }
    }, 250); };
    $('#q').focus();
  }
}
async function findId(id, method) {
  if (!id) return;
  try { confirmStudent(await rpc('kiosk_student', { p_id: id }), method); }
  catch (x) { if ($('#serr')) $('#serr').textContent = errText(x.message); }
}
let scanner = null, scanBusy = false;
function startScan() {
  if (!window.Html5Qrcode) { $('#serr').textContent = "The camera scanner didn't load. Type your student ID instead."; return; }
  const F = Html5QrcodeSupportedFormats;
  scanner = new Html5Qrcode('scanner', { verbose: false, useBarCodeDetectorIfSupported: true,
    formatsToSupport: [F.CODE_128, F.CODE_39, F.CODE_93, F.CODABAR, F.ITF, F.EAN_13, F.EAN_8, F.UPC_A, F.QR_CODE, F.PDF_417, F.DATA_MATRIX] });
  scanner.start({ facingMode: S.facing }, { fps: 12, qrbox: (w, h) => ({ width: Math.floor(w * .85), height: Math.floor(h * .45) }), aspectRatio: 4 / 3 },
    async text => {
      if (scanBusy) return; scanBusy = true;
      const digits = String(text).replace(/\D/g, '');
      try { const s = await rpc('kiosk_student', { p_id: digits }); await stopScan(); confirmStudent(s, 'badge'); }
      catch (x) { if ($('#serr')) $('#serr').textContent = errText(x.message); setTimeout(() => scanBusy = false, 1500); return; }
      scanBusy = false;
    }, () => {}).catch(() => { if ($('#serr')) $('#serr').textContent = 'Camera is blocked. Allow camera access in Safari, or type your student ID.'; });
}
async function stopScan() {
  const s = scanner; scanner = null;
  if (s) { try { if (s.isScanning) await s.stop(); s.clear(); } catch {} }
}
function confirmStudent(st, method) {
  S.method = method; S.students = [st]; S.selected = new Set([st.student_id]); S.person = `${st.first_name} ${st.last_name}`;
  go('confirm', `<div class="kscreen">
    <button class="back" id="bk">‹ Back</button>
    <h1 class="kh">Is this you?</h1>
    <div class="stu-pick" aria-pressed="true" style="max-width:520px"><div class="av"><span>${esc(st.first_name[0])}</span></div><div><b>${esc(st.first_name)} ${esc(st.last_name)}</b><small>${esc(grade(st.grade))}${st.teacher ? ' · ' + esc(st.teacher) : ''}</small></div></div>
    <div class="row2"><button class="kbtn ghost" id="no">No, go back</button><button class="kbtn" id="yes">Yes, that's me</button></div></div>`);
  $('#bk').onclick = $('#no').onclick = () => studentEntry();
  $('#yes').onclick = details;
}

// ---------- pick students (PIN) ----------
function pickStudents() {
  const verb = S.kind === 'early_out' ? 'checking out' : 'signing in';
  go('pick', `<div class="kscreen">
    <button class="back" id="bk">‹ Start over</button>
    <div><h1 class="kh">Hi, ${esc((S.person || '').split(' ')[0])}</h1><p class="ksub" style="margin-top:6px">Tap each student you're ${verb}.</p></div>
    <div class="stus" id="stus">${S.students.map(s => `<button class="stu-pick" data-id="${s.student_id}" aria-pressed="${S.selected.has(s.student_id)}"><div class="av"><span>${esc(s.first_name[0])}</span></div><div><b>${esc(s.first_name)} ${esc(s.last_name)}</b><small>${esc(grade(s.grade))}${s.teacher ? ' · ' + esc(s.teacher) : ''}</small></div></button>`).join('')}</div>
    <div class="kerr" id="kerr"></div>
    <div class="row2" style="justify-content:flex-end"><button class="kbtn" id="next">Next</button></div></div>`);
  $('#bk').onclick = home;
  $('#stus').onclick = e => { const b = e.target.closest('.stu-pick'); if (!b) return; const id = +b.dataset.id; S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); b.setAttribute('aria-pressed', S.selected.has(id)); };
  $('#next').onclick = () => S.selected.size ? details() : ($('#kerr').textContent = ERR.pick_student);
}

// ---------- reason + signature ----------
const REASONS = {
  early_out: ['Doctor / dentist appointment', 'Not feeling well', 'Family emergency', 'Family event', 'Other'],
  late_in: ['Doctor / dentist appointment', 'Not feeling well', 'Traffic', 'Overslept', 'Car trouble', 'Other']
};
function details() {
  const names = S.students.filter(s => S.selected.has(s.student_id)).map(s => s.first_name).join(' and ');
  const needSig = S.method === 'pin';
  go('details', `<div class="kscreen">
    <button class="back" id="bk">‹ Back</button>
    <div><h1 class="kh">${S.kind === 'early_out' ? 'Checking out' : 'Signing in'} ${esc(names)}</h1></div>
    <div class="card form" style="gap:14px">
      <b style="font-size:1.25rem">${S.kind === 'early_out' ? 'Why is the student leaving early?' : 'Why is the student late?'}</b>
      <div class="chips2" id="rc">${REASONS[S.kind].map(r => `<button data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <textarea class="kr" id="reason" maxlength="300" placeholder="Type the reason"></textarea>
    </div>
    ${needSig ? `<div class="card" style="gap:10px"><div class="row2"><b style="font-size:1.25rem">Sign here</b><button class="link" id="sclr" style="font-size:1.1rem">Clear</button></div><canvas class="ksig" id="sig"></canvas><small class="muted">${esc(S.person)}</small></div>` : ''}
    <div class="kerr" id="kerr"></div>
    <div class="row2" style="justify-content:flex-end"><button class="kbtn" id="submit">${S.kind === 'early_out' ? 'Check out' : 'Sign in'}</button></div></div>`);
  $('#bk').onclick = () => S.method === 'pin' ? pickStudents() : studentEntry();
  $('#rc').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    K.querySelectorAll('#rc button').forEach(x => x.setAttribute('aria-pressed', x === b));
    const r = b.dataset.r;
    if (r === 'Other') { $('#reason').value = ''; $('#reason').focus(); }
    else $('#reason').value = r;
  };
  let sig = null;
  if (needSig) sig = pad($('#sig'));
  $('#submit').onclick = async () => {
    const reason = $('#reason').value.trim(); $('#kerr').textContent = '';
    if (!reason) return $('#kerr').textContent = ERR.need_reason;
    if (needSig && !sig.dirty()) return $('#kerr').textContent = ERR.need_signature;
    const b = $('#submit'); b.disabled = true; b.textContent = 'Saving…';
    try {
      const r = await rpc('kiosk_submit', { p: { kind: S.kind, method: S.method, pin: S.method === 'pin' ? S.pin : null, student_ids: [...S.selected], reason, signature: needSig ? sig.data() : null } });
      done(r);
    } catch (x) { $('#kerr').textContent = errText(x.message); b.disabled = false; b.textContent = S.kind === 'early_out' ? 'Check out' : 'Sign in'; }
  };
}
function pad(c) {
  const r0 = c.getBoundingClientRect(), ratio = Math.min(2, devicePixelRatio || 1);
  c.width = Math.round(r0.width * ratio); c.height = Math.round(r0.height * ratio);
  const x = c.getContext('2d'); x.scale(ratio, ratio); x.lineWidth = 2.8; x.lineCap = x.lineJoin = 'round'; x.strokeStyle = '#141213'; x.fillStyle = '#141213';
  let drawing = false, last = null, dirty = false;
  const pt = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener('pointerdown', e => { drawing = true; last = pt(e); c.setPointerCapture(e.pointerId); x.beginPath(); x.arc(last[0], last[1], 1.3, 0, 7); x.fill(); });
  c.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); x.beginPath(); x.moveTo(...last); x.lineTo(...p); x.stroke(); last = p; dirty = true; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => c.addEventListener(t, () => drawing = false));
  $('#sclr').onclick = () => { x.clearRect(0, 0, c.width, c.height); dirty = false; };
  return { dirty: () => dirty, data: () => {
    // Shrink to a small PNG for storage.
    const o = document.createElement('canvas'); o.width = 600; o.height = Math.round(600 * c.height / c.width);
    o.getContext('2d').drawImage(c, 0, 0, o.width, o.height); return o.toDataURL('image/png');
  } };
}

// ---------- done ----------
function done(r) {
  const who = r.students.join(' and ');
  const out = S.kind === 'early_out';
  go('done', `<div class="done2">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>
    <h1>${out ? 'Checked out' : 'Signed in'}</h1>
    <p><b>${esc(who)}</b> ${out ? 'checked out' : 'signed in'} at ${esc(r.time)}.</p>
    <p class="muted">${out ? 'Please wait here — the front office will call your student to the office.' : S.method === 'pin' ? 'Thank you! The front office has been notified.' : 'Please get a tardy pass from the front desk, then head to class.'}</p>
    <button class="kbtn" id="fin">Done</button></div>`);
  $('#fin').onclick = home;
}

// ---------- one-time setup by staff ----------
function setup(note) {
  S = { screen: 'setup' };
  go('setup', `<div class="setup kscreen">
    <h1 class="kh">Set up this iPad</h1>
    <p class="ksub" style="margin:0">${esc(note || 'A front office staff member signs in once to turn on the sign-in / sign-out screen on this iPad.')}</p>
    <form class="card form" id="f-setup">
      <label>Staff email <input type="email" id="se" autocomplete="username" required style="-webkit-user-select:text;user-select:text"></label>
      <label>Password <input type="password" id="sp" autocomplete="current-password" required style="-webkit-user-select:text;user-select:text"></label>
      <label>Name for this iPad <input type="text" id="sl" value="Front Office iPad" maxlength="60" style="-webkit-user-select:text;user-select:text"></label>
      <button class="btn" type="submit">Turn on kiosk</button>
      <p class="err" id="serr2"></p>
    </form></div>`);
  $('#f-setup').onsubmit = async e => {
    e.preventDefault(); $('#serr2').textContent = '';
    const sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    const { error } = await sb.auth.signInWithPassword({ email: $('#se').value.trim().toLowerCase(), password: $('#sp').value });
    if (error) return $('#serr2').textContent = 'Email or password is incorrect.';
    const { data, error: e2 } = await sb.rpc('staff_kiosk_register', { p_label: $('#sl').value });
    await sb.auth.signOut();
    if (e2) return $('#serr2').textContent = e2.message === 'not_staff' ? 'That account is not on the front office staff list.' : 'Could not set up this iPad.';
    TOKEN = data; store.set('ccs_kiosk_token', data); home();
  };
}

// Hold the school logo for 3 seconds to reset this iPad's setup.
let hold;
$('.top img').addEventListener('pointerdown', () => { hold = setTimeout(() => { if (confirm('Remove this iPad\'s kiosk setup? A staff member will need to sign in again.')) { TOKEN = null; store.set('ccs_kiosk_token', null); setup(); } }, 3000); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(t => $('.top img').addEventListener(t, () => clearTimeout(hold)));

(async () => {
  if (!TOKEN) return setup();
  try { await rpc('kiosk_hello'); home(); } catch (x) { if (TOKEN) home(); }
})();
