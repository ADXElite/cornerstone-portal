// Front office iPad kiosk — early check-out and late sign-in.
// Set up once with just a name, from the school network (device key saved on this iPad). All calls go through /api/kiosk, which checks the school IP.
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
  campus_only: 'This only works on the school network.', not_in_care: 'is not signed in to afterschool care. Please see the care staff.', need_label: 'Type a name for this iPad.',
  server_error: 'Something went wrong. Please try again or see the front desk.'
};
function errText(m) {
  const [code, who] = String(m || '').split(':');
  if (code === 'already_signed_in' && who && S.care) return `${who} is already signed in to morning care today.`;
  if ((code === 'already_signed_in' || code === 'already_checked_out' || code === 'not_in_care') && who) return `${who} ${ERR[code]}`;
  return ERR[code] || ERR.server_error;
}

async function api(body) {
  const r = await fetch('/api/kiosk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch {}
  if (!r.ok) throw new Error((d && d.message) || 'server_error');
  return d;
}
async function rpc(fn, args = {}) {
  try { return await api({ fn, args: { p_token: TOKEN, ...args } }); }
  catch (x) {
    if (x.message === 'kiosk_not_active') { TOKEN = null; store.set('ccs_kiosk_token', null); setup('This iPad needs to be set up again.'); }
    if (x.message === 'campus_only') offCampus();
    throw x;
  }
}
function offCampus() {
  S = { screen: 'setup' };
  go('setup', `<div class="setup kscreen">
    <h1 class="kh">School Network Only</h1>
    <p class="ksub" style="margin:0">The sign-in / sign-out screen only works on the Cornerstone campus network. Connect this iPad to the school Wi-Fi, then tap Try Again.</p>
    <button class="kbtn" id="retry">Try Again</button></div>`);
  $('#retry').onclick = () => location.reload();
}

// ---------- clock, idle timer ----------
function tick() {
  const n = new Date();
  $('#clock').innerHTML = `${n.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} <span style="font-size:.6em;opacity:.7">ET</span><small>${n.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })}</small>`;
}
setInterval(tick, 5000); tick();
let idle;
function resetIdle() { clearTimeout(idle); if (S.screen !== 'home' && S.screen !== 'setup') idle = setTimeout(() => home(), S.screen === 'done' ? 9000 : 90000); }
addEventListener('pointerdown', resetIdle, { passive: true });
addEventListener('keydown', resetIdle);

// ---------- state ----------
let S = {};
function go(screen, html) { stopScan(); S.screen = screen; K.innerHTML = html; resetIdle(); window.scrollTo(0, 0); }

const ICON_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>';
const ICON_IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>';

// Kiosk mode by Eastern time on school days: 5:00–8:00 AM morning care sign-in, 3:30–7:00 PM afterschool care sign-out,
// otherwise late sign-in / early check-out. The home screen switches by itself when the time comes.
function kioskMode() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return 'school';
  const t = p.hour + ':' + p.minute;
  if (t >= '05:00' && t < '08:00') return 'am';
  if (t >= '15:30' && t < '19:00') return 'pm';
  return 'school';
}
let MODE_SHOWN = null;
setInterval(() => { if (S.screen === 'home' && TOKEN && MODE_SHOWN !== null && kioskMode() !== MODE_SHOWN) home(); }, 15000);
function home() {
  if (!TOKEN) return setup();
  S = {};
  const mode = kioskMode(); MODE_SHOWN = mode;
  if (mode !== 'school') return careHome(mode);
  go('home', `<div class="kscreen">
    <div><h1 class="kh">Front Office</h1><p class="ksub" style="margin-top:6px">Tap what you're here to do.</p></div>
    <div class="big2">
      <button class="bigbtn in" id="b-in">${ICON_IN}<b>Late Sign-In</b><span>Signing a student in after 8:30 AM</span></button>
      <button class="bigbtn out" id="b-out">${ICON_OUT}<b>Early Check-Out</b><span>Picking up a student before dismissal</span></button>
    </div></div>`);
  $('#b-out').onclick = () => { S.kind = 'early_out'; S.method = 'pin'; pinScreen(); };
  $('#b-in').onclick = () => { S.kind = 'late_in'; lateChoice(); };
}
function careHome(mode) {
  const am = mode === 'am';
  go('home', `<div class="kscreen">
    <div><h1 class="kh">${am ? 'Morning Extended Care' : 'Afterschool Care'}</h1><p class="ksub" style="margin-top:6px">${am ? 'Parents: sign your student in to morning care with your PIN.' : 'Parents: sign your student out of afterschool care with your PIN.'}</p></div>
    <div class="big2" style="grid-template-columns:1fr">
      <button class="bigbtn ${am ? 'in' : 'out'}" id="b-care">${am ? ICON_IN : ICON_OUT}<b>${am ? 'Morning Care Sign-In' : 'Afterschool Care Sign-Out'}</b><span>Enter your 4-digit pick-up PIN</span></button>
    </div></div>`);
  $('#b-care').onclick = () => { S.care = mode; S.method = 'pin'; pinScreen(); };
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
        const r = S.care ? await rpc('kiosk_care_pin', { p_pin: S.pin, p_session: S.care }) : await rpc('kiosk_pin', { p_pin: S.pin });
        if (r.error) throw new Error(r.error);
        S.person = r.name; S.students = r.students; S.method = 'pin';
        if (S.care) { const can = r.students.filter(x => x.can); S.selected = new Set(can.length === 1 ? [can[0].student_id] : []); careStudents(); }
        else { S.selected = new Set(r.students.length === 1 ? [r.students[0].student_id] : []); pickStudents(); }
      } catch (x) { if (S.screen !== 'pin') return; $('#perr').textContent = errText(x.message); $('#dots').classList.add('shake'); setTimeout(() => { $('#dots')?.classList.remove('shake'); S.pin = ''; draw(); }, 400); }
      S.busy = false;
    }
  };
}

// ---------- late sign-in: who? ----------
const ICON_STU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/><path d="M22 10v6"/></svg>';
const ICON_PAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85"/></svg>';
function lateChoice() {
  go('late', `<div class="kscreen">
    <button class="back" id="bk">‹ Back</button>
    <h1 class="kh">Late Sign-In</h1>
    <div class="big2">
      <button class="bigbtn in" id="c-student">${ICON_STU}<span>I am a</span><b>Student</b></button>
      <button class="bigbtn out" id="c-adult">${ICON_PAR}<span>I am a</span><b>Parent</b></button>
    </div></div>`);
  $('#bk').onclick = home;
  $('#c-adult').onclick = () => { S.method = 'pin'; pinScreen(); };
  $('#c-student').onclick = studentEntry;
}

// ---------- student: scan badge or type name, same screen ----------
function studentEntry() {
  go('student', `<div class="kscreen">
    <button class="back" id="bk">‹ Back</button>
    <div><h1 class="kh">Scan Your Badge</h1><p class="ksub" style="margin-top:6px">Hold your badge's barcode up to the camera — or type your name.</p></div>
    <div class="sgrid2">
      <div><div class="scanbox"><div id="scanner"></div><div class="scanline"></div>
        <button class="kbtn ghost" id="flip" style="position:absolute;right:10px;bottom:10px;min-width:0;padding:8px 14px;font-size:.95rem;background:rgba(0,0,0,.55);color:#fff;border-color:rgba(255,255,255,.4)">Switch camera</button></div>
        <div class="kerr" id="serr" style="margin-top:8px"></div></div>
      <div class="stack" style="gap:12px;align-content:start">
        <b style="font-size:1.3rem">Or type your name</b>
        <input class="search" id="q" type="search" placeholder="First or last name" autocomplete="off" autocapitalize="words" enterkeyhint="search" style="-webkit-user-select:text;user-select:text">
        <div class="hits" id="hits"></div>
      </div>
    </div></div>`);
  $('#bk').onclick = lateChoice;
  S.facing = S.facing || 'user';
  startScan();
  $('#flip').onclick = async () => { S.facing = S.facing === 'user' ? 'environment' : 'user'; await stopScan(); startScan(); };
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(async () => {
    const q = $('#q').value.trim(); $('#serr').textContent = '';
    if (q.length < 2) return $('#hits').innerHTML = '';
    if (/^\d+$/.test(q)) { $('#hits').innerHTML = `<button class="hit" id="byid"><span>Student ID ${esc(q)}</span><small>Tap to continue</small></button>`; $('#byid').onclick = () => findId(q, 'student_id'); return; }
    try {
      const list = await rpc('kiosk_search', { p_q: q });
      $('#hits').innerHTML = list.map((s, i) => `<button class="hit" data-i="${i}"><span>${esc(s.first_name)} ${esc(s.last_name)}</span><small>${esc(grade(s.grade))}</small></button>`).join('') || '<p class="ksub">No matches.</p>';
      $('#hits').onclick = e => { const b = e.target.closest('.hit'); if (b) confirmStudent(list[+b.dataset.i], 'name'); };
    } catch (x) { $('#serr').textContent = errText(x.message); }
  }, 250); };
}
async function findId(id, method) {
  if (!id) return;
  try { confirmStudent(await rpc('kiosk_student', { p_id: id }), method); }
  catch (x) { if ($('#serr')) $('#serr').textContent = errText(x.message); }
}
let scanner = null, scanBusy = false;
function startScan() {
  if (!window.Html5Qrcode) { $('#serr').textContent = "The camera didn't load. Type your name below instead."; return; }
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
    }, () => {}).catch(() => { if ($('#serr')) $('#serr').textContent = 'Camera is blocked. Allow camera access in Safari, or type your name below.'; });
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

// ---------- extended care: pick students, sign, confirm ----------
const ktm = t => t ? new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '';
function careStudents() {
  const am = S.care === 'am';
  const why = x => am ? `Already signed in ${ktm(x.in_at)}` : x.out_at ? `Already signed out ${ktm(x.out_at)}` : 'Not signed in to afterschool care today';
  go('care-pick', `<div class="kscreen">
    <button class="back" id="bk">‹ Back</button>
    <div><h1 class="kh">Hi${S.person ? ', ' + esc(S.person.split(' ')[0]) : ''}</h1><p class="ksub" style="margin-top:6px">${am ? 'Tap each student you are signing in to morning care.' : 'Tap each student you are signing out of afterschool care.'}</p></div>
    <div class="stus" id="stus">${S.students.map(x => `<button class="stu-pick" data-id="${x.student_id}" aria-pressed="${S.selected.has(x.student_id)}" ${x.can ? '' : 'disabled style="opacity:.45"'}><div class="av"><span>${esc(x.first_name[0])}</span></div><div><b>${esc(x.first_name)} ${esc(x.last_name)}</b><small>${esc(grade(x.grade))}${x.can ? (x.location ? ' · Afterschool Care ' + esc(x.location) : '') : ' · ' + esc(why(x))}</small></div></button>`).join('')}</div>
    <div class="kerr" id="kerr"></div>
    <div class="row2" style="justify-content:flex-end"><button class="kbtn" id="next">${am ? 'Sign In' : 'Next'}</button></div></div>`);
  $('#bk').onclick = home;
  $('#stus').onclick = e => { const b = e.target.closest('.stu-pick:not([disabled])'); if (!b) return; const id = +b.dataset.id; S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); b.setAttribute('aria-pressed', S.selected.has(id)); };
  if (!S.students.some(x => x.can)) $('#kerr').textContent = am ? 'Your students are already signed in today.' : 'None of your students are signed in to afterschool care right now. Please see the care staff.';
  $('#next').onclick = async () => {
    if (!S.selected.size) return $('#kerr').textContent = ERR.pick_student;
    if (!am) return careSign();
    const b = $('#next'); b.disabled = true; b.textContent = 'Saving…';
    try { careDone(await rpc('kiosk_care_submit', { p: { session: 'am', pin: S.pin, student_ids: [...S.selected] } })); }
    catch (x) { $('#kerr').textContent = errText(x.message); b.disabled = false; b.textContent = 'Sign In'; }
  };
}
function careSign() {
  const names = S.students.filter(x => S.selected.has(x.student_id)).map(x => x.first_name).join(' and ');
  go('care-sign', `<div class="kscreen">
    <button class="back" id="bk">‹ Back</button>
    <div><h1 class="kh">Signing out ${esc(names)}</h1><p class="ksub" style="margin-top:6px">Afterschool care · ${esc(S.person || '')}</p></div>
    <div class="card" style="gap:10px"><div class="row2"><b style="font-size:1.25rem">Sign here</b><button class="link" id="sclr" style="font-size:1.1rem">Clear</button></div><canvas class="ksig" id="sig"></canvas><small class="muted">${esc(S.person || '')}</small></div>
    <div class="kerr" id="kerr"></div>
    <div class="row2" style="justify-content:flex-end"><button class="kbtn" id="submit">Confirm Sign-Out</button></div></div>`);
  $('#bk').onclick = careStudents;
  const sig = pad($('#sig'));
  $('#submit').onclick = async () => {
    if (!sig.dirty()) return $('#kerr').textContent = ERR.need_signature;
    const b = $('#submit'); b.disabled = true; b.textContent = 'Saving…';
    try { careDone(await rpc('kiosk_care_submit', { p: { session: 'pm', pin: S.pin, student_ids: [...S.selected], signature: sig.data() } })); }
    catch (x) { $('#kerr').textContent = errText(x.message); b.disabled = false; b.textContent = 'Confirm Sign-Out'; }
  };
}
function careDone(r) {
  const am = S.care === 'am';
  go('done', `<div class="done2">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>
    <h1>${am ? 'Signed In' : 'Signed Out'}</h1>
    <p><b>${esc(r.students.join(' and '))}</b> ${am ? 'signed in to morning care' : 'signed out of afterschool care'} at ${esc(r.time)}.</p>
    <p class="muted">${am ? 'Have a great day!' : 'Thank you — have a good evening!'}</p>
    <button class="kbtn" id="fin">Done</button></div>`);
  $('#fin').onclick = home;
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

// ---------- one-time setup: just a name, school network only ----------
function setup(note) {
  S = { screen: 'setup' };
  go('setup', `<div class="setup kscreen">
    <h1 class="kh">Set Up This iPad</h1>
    <p class="ksub" style="margin:0">${esc(note || 'Give this iPad a name to turn on the sign-in / sign-out screen. This only works on the school network.')}</p>
    <form class="card form" id="f-setup">
      <label>Name for This iPad <input type="text" id="sl" value="Front Office iPad" maxlength="60" required style="-webkit-user-select:text;user-select:text"></label>
      <button class="btn" type="submit">Turn On Kiosk</button>
      <p class="err" id="serr2"></p>
    </form></div>`);
  $('#f-setup').onsubmit = async e => {
    e.preventDefault(); $('#serr2').textContent = '';
    const label = $('#sl').value.trim();
    if (!label) return $('#serr2').textContent = ERR.need_label;
    try { const r = await api({ fn: 'register', label }); TOKEN = r.token; store.set('ccs_kiosk_token', r.token); home(); }
    catch (x) { $('#serr2').textContent = x.message === 'campus_only' ? 'This iPad is not on the school network. Connect to the school Wi-Fi and try again.' : 'Could not set up this iPad. Please try again.'; }
  };
}

// Hold the school logo for 3 seconds to reset this iPad's setup.
let hold;
$('.top img').addEventListener('pointerdown', () => { hold = setTimeout(() => { if (confirm('Remove this iPad\'s kiosk setup? A staff member will need to sign in again.')) { TOKEN = null; store.set('ccs_kiosk_token', null); setup(); } }, 3000); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(t => $('.top img').addEventListener(t, () => clearTimeout(hold)));

(async () => {
  if (!TOKEN) {
    try { await api({ fn: 'ping' }); } catch (x) { if (x.message === 'campus_only') return offCampus(); }
    return setup();
  }
  try { await rpc('kiosk_hello'); home(); } catch (x) { if (TOKEN && x.message !== 'campus_only') home(); }
})();
