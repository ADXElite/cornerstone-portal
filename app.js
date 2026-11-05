// Cornerstone Parent Portal — parent app (no framework).
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ERR = {
  not_found: "We couldn't find that phone number or email in our records. Please use the one the school has on file, or call the front office at (904) 730-5500.",
  bad_identifier: 'Enter a 10-digit cell phone number or a full email address.',
  too_many_codes: 'Too many codes were requested. Please wait 30 minutes and try again.',
  too_many_tries: 'Too many tries. Please wait 30 minutes and request a new code.',
  wrong_code: "That code didn't match or has expired. Check it and try again, or send a new code.",
  bad_code: 'Enter the 6-digit code.',
  bad_phone: "That phone number can't receive texts. Try your email address instead.",
  sms_not_configured: 'Text codes are not set up yet. Please sign in with your email address.',
  email_not_configured: 'Email codes are not set up yet. Please sign in with your cell phone number.',
  sms_failed: "We couldn't send the text. Please try again or use your email address.",
  email_failed: "We couldn't send the email. Please try again or use your phone number.",
  signed_out: 'Your sign-in expired. Please sign in again.',
  guardian_only: 'Only a parent or guardian on file can do this for that student.',
  need_name: "Enter the person's first and last name.", need_phone: 'Enter a 10-digit cell phone number.', bad_email: 'Check the email address.',
  already_on_list: 'That person is already on the pick-up list.', cant_remove_guardian: "Parents/guardians can't be removed here. Please call the front office.",
  not_on_list: 'That person is no longer on the list.',
  limit_reached: "This student already has 5 approved parent notes this semester. A doctor's note is needed for this absence to be excused.",
  too_late: 'Parent notes must be submitted within 5 school days of the absence. Please contact the front office.',
  duplicate: 'A note for this student and date has already been submitted.',
  bad_reason: 'Choose an absent reason.', need_other: 'Enter the reason for "Other".',
  missing_fields: 'Please fill in every required field, including your signature.',
  date_too_far: 'That date is too far in the future.', date_past: 'That date has already passed.',
  bad_range: 'Check the dates — the last day must be on or after the first day.',
  after_cutoff: 'Same-day dismissal changes must be submitted by 1:00 PM. Please call the front office at (904) 730-5500.',
  need_driver: "Enter the student driver's full name.",
  need_pickup: 'Choose who is picking up.', need_bus: 'Choose a bus stop.', bad_method: 'Choose a new transportation method.',
  not_your_student: "That student isn't linked to your account.",
  bad_file_type: 'Upload a photo (JPG, PNG, HEIC) or a PDF.', file_too_big: 'That file is too large. Try a photo instead of a scan, or a smaller PDF.',
  too_many_files: 'Up to 6 files per note.', too_big: 'That file is too large.',
  server_error: 'Something went wrong. Please try again.'
};
const msg = e => ERR[e] || ERR[String(e).split(':')[0]] || ERR.server_error;

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin' });
  let data = {}; try { data = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(data.error || 'server_error'); e.status = r.status; throw e; }
  return data;
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 3200); }
function busy(btn, on, label) {
  if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label || 'Working…'}`; }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.l || btn.innerHTML; }
}

// ---------- dates ----------
const D = s => new Date(s + 'T12:00:00');
const iso = d => d.toLocaleDateString('en-CA');
const addDays = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
const isWeekend = s => [0, 6].includes(D(s).getDay());
const nextSchoolDay = s => { let d = addDays(s, 1); while (isWeekend(d)) d = addDays(d, 1); return d; };
const minusSchoolDays = (s, n) => { let d = s; while (n > 0) { d = addDays(d, -1); if (!isWeekend(d)) n--; } return d; };
const nice = s => s ? D(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
const niceLong = s => D(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const gradeLabel = g => g === 'K' ? 'Kindergarten' : g ? `Grade ${String(g).replace(/^0/, '')}` : '';
const fmt12 = t => { const [h, m] = t.split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

// ---------- state ----------
let HOME = null, ident = null;
const S = { files: [] };

// ---------- routing ----------
const SCREENS = ['login', 'home', 'absence', 'note', 'doctor', 'dismissal', 'pickups', 'history', 'done'];
function show(name) {
  SCREENS.forEach(s => $('#s-' + s).hidden = s !== name);
  $('#tabs').hidden = name === 'login';
  const tab = ['doctor', 'absence'].includes(name) ? 'note' : name === 'pickups' ? 'home' : name;
  $$('.tabs a').forEach(a => { if (a.dataset.t === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
}
async function route() {
  const h = (location.hash || '#home').slice(1);
  if (!HOME) return show('login');
  if (h === 'absence') { $$('.lim').forEach(e => e.textContent = HOME.parent_note_limit); show('absence'); }
  else if (h === 'note') { renderNote(); show('note'); }
  else if (h === 'doctor') { renderDoctor(); show('doctor'); }
  else if (h === 'dismissal') { renderTrans(); show('dismissal'); }
  else if (h === 'pickups') { renderPickups(); show('pickups'); }
  else if (h === 'history') { show('history'); loadHistory(); }
  else if (h === 'done') show('done');
  else { renderHome(); show('home'); }
}
addEventListener('hashchange', route);

async function loadHome() {
  HOME = await api('/api/parent?view=home');
  return HOME;
}

// ---------- sign in ----------
$('#f-start').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter || $('#f-start .btn'); $('#li-err').textContent = '';
  ident = $('#li-id').value.trim();
  if (!ident) return $('#li-err').textContent = ERR.bad_identifier;
  busy(btn, true, 'Sending…');
  try {
    const r = await api('/api/auth', { action: 'start', identifier: ident });
    if (r.trusted) { await loadHome(); location.hash = '#home'; route(); afterSignIn(); return; }
    $('#li-masked').textContent = r.masked;
    $('#f-start').hidden = true; $('#f-code').hidden = false; $('#li-code').value = ''; $('#li-code').focus();
  } catch (err) { $('#li-err').textContent = msg(err.message); }
  finally { busy(btn, false); }
});
$('#f-code').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter || $('#f-code .btn'); $('#code-err').textContent = '';
  busy(btn, true, 'Checking…');
  try {
    await api('/api/auth', { action: 'verify', identifier: ident, code: $('#li-code').value });
    await loadHome(); location.hash = '#home'; route(); afterSignIn();
  } catch (err) { $('#code-err').textContent = msg(err.message); }
  finally { busy(btn, false); }
});
$('#li-code').addEventListener('input', e => { const v = e.target.value.replace(/\D/g, ''); e.target.value = v; if (v.length === 6) $('#f-code').requestSubmit(); });
$('#li-back').onclick = () => { $('#f-code').hidden = true; $('#f-start').hidden = false; $('#li-id').focus(); };
$('#li-resend').onclick = () => { $('#f-code').hidden = true; $('#f-start').hidden = false; $('#f-start').requestSubmit(); };
async function dropPush() { try { const sub = await navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()); if (sub) { await api('/api/parent', { action: 'push', off: true, subscription: sub.toJSON() }); await sub.unsubscribe(); } } catch {} }
$('#b-logout').onclick = async () => { await dropPush(); await api('/api/auth', { action: 'logout' }).catch(() => {}); HOME = null; location.hash = ''; show('login'); };
$('#b-forget').onclick = async () => { await dropPush(); await api('/api/auth', { action: 'forget' }).catch(() => {}); HOME = null; location.hash = ''; show('login'); };

// ---------- home ----------
function transportLines(s) {
  return {
    am: [s.am_transport, s.am_bus_route].filter(Boolean).join(' — ') || 'Not on file',
    pm: [s.pm_transport === 'Car Line' ? 'Car Rider' : s.pm_transport, s.pm_details && !['Car Rider', s.pm_transport].includes(s.pm_details) ? s.pm_details : null, s.pm_bus_route].filter(Boolean).join(' — ') || 'Not on file'
  };
}
function meter(s) {
  const lim = HOME.parent_note_limit, a = s.parent_notes_approved, p = s.parent_notes_pending;
  let h = ''; for (let i = 0; i < lim; i++) h += `<i class="${i < a ? 'on' : i < a + p ? 'pend' : ''}"></i>`;
  return `<span class="meter" aria-label="${a} of ${lim} approved">${h}</span> <span>${a} of ${lim} approved${p ? ` · ${p} pending` : ''}</span>`;
}
function semLabel(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2,4})\s*Semester\s*(\d)/i);
  return m ? `${m[1]}-${m[2].length === 2 ? m[1].slice(0, 2) + m[2] : m[2]} (Semester ${m[3]})` : (v || '');
}
function renderHome() {
  const first = (HOME.parent_name || '').split(' ')[0];
  $('#h-hello').textContent = first ? `Hi, ${first}` : 'Welcome';
  $('#h-date').textContent = niceLong(HOME.today);
  $('#h-sem').textContent = semLabel(HOME.semester);
  $('#h-cut').textContent = `Same-day changes by ${fmt12(HOME.cutoff)}`;
  const box = $('#h-students');
  if (!HOME.students.length) { box.innerHTML = `<div class="card">No students are linked to your account. Please call the front office at (904) 730-5500.</div>`; return; }
  // Pick-up PINs: one row per person, with the students they can pick up.
  const people = new Map();
  for (const s of HOME.students) for (const p of [...s.guardians.map(g => ({ ...g, g: 1 })), ...s.pickups]) {
    if (!p.pin || !p.name) continue;
    const e = people.get(p.pin) || { name: p.name, rel: new Set(), kids: new Set(), g: 0, phone: p.phone };
    if (p.relationship) e.rel.add(p.relationship); e.kids.add(s.first_name); e.g = e.g || p.g; people.set(p.pin, e);
  }
  $('#h-pins').innerHTML = [...people.entries()].sort((a, b) => b[1].g - a[1].g || a[1].name.localeCompare(b[1].name)).map(([pin, e]) =>
    `<div class="row"><div class="txt"><b>${esc(e.name)}</b><p>${esc([...e.rel].join(' / ') || (e.g ? 'Parent/guardian' : 'Pickup'))} · ${esc([...e.kids].join(', '))}${e.phone ? ' · ' + esc(e.phone) : ''}</p></div><span class="pin" aria-label="PIN ${pin.split('').join(' ')}">${pin}</span></div>`).join('')
    || '<div class="empty">No pickup people on file.</div>';
  box.innerHTML = HOME.students.map(s => {
    const t = transportLines(s);
    const up = s.upcoming_changes.map(c => `<span class="tag ${c.status === 'processed' ? 'ok' : 'warn'}">${c.change_type === 'permanent' ? 'From ' : ''}${nice(c.start_date)}${c.change_type === 'date_range' ? '–' + nice(c.end_date) : ''}: ${esc(c.new_method)}</span>`).join(' ');
    return `<article class="stu">
      <div class="stu-h"><div class="av">${esc((s.first_name || '?')[0])}</div><div><b>${esc(s.first_name)} ${esc(s.last_name)}</b><small>${esc(gradeLabel(s.grade))}${s.teacher ? ' · ' + esc(s.teacher) : ''}</small></div></div>
      <dl class="kv">
        <dt>Afternoon</dt><dd>${esc(t.pm)}</dd>
        ${up ? `<dt>Changes</dt><dd>${up}</dd>` : ''}
      </dl></article>`;
  }).join('');
}

// ---------- student pickers ----------
function picker(el, opts = {}) {
  const many = HOME.students.length > 1;
  el.innerHTML = HOME.students.map(s => {
    const off = opts.disable && opts.disable(s);
    return `<label class="${off ? 'off' : ''}"><input type="checkbox" value="${s.student_id}" ${!many && !off ? 'checked' : ''} ${off ? 'disabled' : ''}>
      <span>${esc(s.first_name)} ${esc(s.last_name)}<small>${esc(gradeLabel(s.grade))}${off ? ' · ' + esc(off) : opts.note ? ' · ' + opts.note(s) : ''}</small></span></label>`;
  }).join('');
  el.onchange = opts.onchange || null;
}
const picked = el => [...el.querySelectorAll('input:checked')].map(i => HOME.students.find(s => String(s.student_id) === i.value));

// ---------- switch between the two note types ----------
document.querySelectorAll('input[name=sw-note],input[name=sw-doc]').forEach(r => r.addEventListener('change', () => {
  if (r.checked) location.hash = r.value === 'doctor' ? '#doctor' : '#note';
  // keep both switches in sync for the next visit
  document.querySelectorAll(`input[name=sw-note][value=note],input[name=sw-doc][value=doctor]`).forEach(x => x.checked = true);
}));

// ---------- parent note ----------
let sigDirty = false;
function renderNote() {
  $$('.lim').forEach(e => e.textContent = HOME.parent_note_limit);
  $$('.days').forEach(e => e.textContent = HOME.note_days_limit);
  picker($('#n-students'), {
    disable: s => !s.is_guardian ? 'Only parents/guardians can submit notes' : s.parent_notes_approved >= HOME.parent_note_limit ? `${HOME.parent_note_limit} of ${HOME.parent_note_limit} used — doctor's note needed` : null,
    note: s => `${s.parent_notes_approved} of ${HOME.parent_note_limit} used this semester`
  });
  $('#n-meters').innerHTML = `<dl class="kv" style="padding:8px 0 0">${HOME.students.filter(s => s.is_guardian).map(s =>
    `<dt>${esc(s.first_name)}</dt><dd>${meter(s)}</dd>`).join('')}</dl><p class="muted small" style="margin:4px 0 0">Parent notes approved this semester</p>`;
  const d = $('#n-date');
  d.min = minusSchoolDays(HOME.today, HOME.note_days_limit); d.max = addDays(HOME.today, 60);
  if (!d.value) d.value = isWeekend(HOME.today) ? minusSchoolDays(HOME.today, 1) : HOME.today;
  if (!$('#n-name').value) $('#n-name').value = HOME.parent_name || '';
  if (!$('#n-phone').value && /^\d{10}$/.test(HOME.identifier)) $('#n-phone').value = HOME.identifier.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  $('#n-today').textContent = niceLong(HOME.today);
  sizeSig();
}
$('#n-reason').onchange = e => { $('#n-other-l').hidden = e.target.value !== 'Other'; };
$('#n-phone').addEventListener('input', e => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 10);
  e.target.value = d.length > 6 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
});

// signature pad
const sig = $('#sig'), sctx = sig.getContext('2d');
function sizeSig() {
  const r = sig.getBoundingClientRect(); if (!r.width) return;
  const ratio = Math.max(1, Math.min(2, devicePixelRatio || 1));
  if (sig.width === Math.round(r.width * ratio)) return;
  sig.width = Math.round(r.width * ratio); sig.height = Math.round(r.height * ratio);
  sctx.scale(ratio, ratio); sctx.lineWidth = 2.4; sctx.lineCap = 'round'; sctx.lineJoin = 'round'; sctx.strokeStyle = '#141213'; sigDirty = false;
}
let drawing = false, last = null;
const pt = e => { const r = sig.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
sig.addEventListener('pointerdown', e => { drawing = true; last = pt(e); sig.setPointerCapture(e.pointerId); sctx.beginPath(); sctx.arc(last[0], last[1], 1.1, 0, 7); sctx.fillStyle = '#141213'; sctx.fill(); });
sig.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); sctx.beginPath(); sctx.moveTo(...last); sctx.lineTo(...p); sctx.stroke(); last = p; sigDirty = true; });
['pointerup', 'pointercancel', 'pointerleave'].forEach(t => sig.addEventListener(t, () => drawing = false));
$('#sig-clear').onclick = () => { sctx.clearRect(0, 0, sig.width, sig.height); sigDirty = false; };
addEventListener('resize', () => { if (!$('#s-note').hidden) sizeSig(); });

$('#f-note').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#n-err'); err.textContent = '';
  const kids = picked($('#n-students'));
  if (!kids.length) return err.textContent = 'Choose at least one student.';
  if (!$('#n-date').value) return err.textContent = 'Choose the date your student was absent.';
  if (!$('#n-reason').value) return err.textContent = ERR.bad_reason;
  if ($('#n-reason').value === 'Other' && !$('#n-other').value.trim()) return err.textContent = ERR.need_other;
  if (!$('#n-name').value.trim()) return err.textContent = 'Enter your full name.';
  if ($('#n-phone').value.replace(/\D/g, '').length !== 10) return err.textContent = 'Enter your phone number as xxx-xxx-xxxx.';
  if (!sigDirty) return err.textContent = 'Please sign in the signature box.';
  const dateVal = $('#n-date').value;
  const btn = e.submitter || $('#f-note .btn'); busy(btn, true, 'Submitting…');
  const done = [], failed = [];
  for (const s of kids) {
    try {
      await api('/api/parent', { action: 'note', kind: 'parent', student_id: s.student_id, absent_date: dateVal,
        reason: $('#n-reason').value, reason_other: $('#n-reason').value === 'Other' ? $('#n-other').value : '',
        parent_name: $('#n-name').value, parent_phone: $('#n-phone').value, signature: sig.toDataURL('image/png') });
      done.push(s.first_name);
    } catch (x) { failed.push(`${s.first_name}: ${msg(x.message)}`); if (x.status === 401) return signedOut(); }
  }
  busy(btn, false);
  if (failed.length) err.textContent = failed.join(' ');
  if (done.length) {
    $('#f-note').reset(); $('#n-other-l').hidden = true; $('#sig-clear').click(); $('#n-date').value = '';
    await loadHome().catch(() => {});
    finish('Note submitted', `Excused note for ${done.join(' and ')} on ${niceLong(dateVal)} was sent to the front office for review.`, failed.length);
  }
});

function finish(title, text, keep) {
  $('#done-t').textContent = title; $('#done-p').textContent = text;
  if (keep) { toast(title); return; }
  location.hash = '#done';
}
function signedOut() { HOME = null; show('login'); $('#li-err').textContent = ERR.signed_out; }

// ---------- doctor's note ----------
function renderDoctor() {
  picker($('#d-students'), { disable: s => !s.is_guardian ? 'Only parents/guardians can submit notes' : null });
  const d = $('#d-start'); d.max = addDays(HOME.today, 60); if (!d.value) d.value = HOME.today;
  $('#d-end').max = addDays(HOME.today, 90);
  drawFiles();
}
function drawFiles() {
  $('#d-files').innerHTML = S.files.map((f, i) => `<li>${f.mime === 'application/pdf' ? '<span class="pdf">PDF</span>' : `<img src="data:${f.mime};base64,${f.data}" alt="">`}
    <span>${esc(f.name)} · ${(f.size / 1024 / 1024).toFixed(1)} MB</span><button type="button" class="x" data-i="${i}" aria-label="Remove ${esc(f.name)}">×</button></li>`).join('');
}
$('#d-files').onclick = e => { const b = e.target.closest('.x'); if (b) { S.files.splice(+b.dataset.i, 1); drawFiles(); } };
const toB64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });
async function shrink(file) {
  // Photos are resized to at most 2000px and saved as JPEG so uploads stay small and fast.
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return { name: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', size: blob.size, data: await toB64(blob) };
  } catch { return null; }
}
$('#d-file').addEventListener('change', async e => {
  const err = $('#d-err'); err.textContent = '';
  for (const f of e.target.files) {
    if (S.files.length >= 6) { err.textContent = ERR.too_many_files; break; }
    let item = null;
    if (f.type === 'application/pdf') {
      if (f.size > 3.2 * 1024 * 1024) { err.textContent = `${f.name}: PDF is larger than 3 MB. Try taking a photo of the note instead.`; continue; }
      item = { name: f.name, mime: f.type, size: f.size, data: await toB64(f) };
    } else if (f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)) {
      item = await shrink(f);
      if (!item && f.size <= 3.2 * 1024 * 1024) item = { name: f.name, mime: f.type || 'image/heic', size: f.size, data: await toB64(f) };
      if (!item) { err.textContent = `${f.name} couldn't be read. Try a JPG or PDF.`; continue; }
    } else { err.textContent = ERR.bad_file_type; continue; }
    S.files.push(item);
  }
  e.target.value = ''; drawFiles();
});
$('#f-doc').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#d-err'); err.textContent = '';
  const kids = picked($('#d-students'));
  if (!kids.length) return err.textContent = 'Choose at least one student.';
  if (!$('#d-start').value) return err.textContent = 'Enter the first day absent.';
  if ($('#d-end').value && $('#d-end').value < $('#d-start').value) return err.textContent = ERR.bad_range;
  if (!S.files.length) return err.textContent = "Add a photo or PDF of the doctor's note.";
  const d0 = $('#d-start').value, d1 = $('#d-end').value && $('#d-end').value !== d0 ? $('#d-end').value : '';
  const btn = e.submitter || $('#f-doc .btn'); busy(btn, true, 'Uploading…');
  const done = [], failed = [];
  for (const s of kids) {
    try {
      const n = await api('/api/parent', { action: 'note', kind: 'doctor', student_id: s.student_id, absent_date: d0, absent_end: d1,
        provider: $('#d-provider').value, comments: $('#d-comments').value });
      for (const f of S.files) await api('/api/parent', { action: 'file', note_id: n.id, name: f.name, mime: f.mime, data: f.data });
      done.push(s.first_name);
    } catch (x) { failed.push(`${s.first_name}: ${msg(x.message)}`); if (x.status === 401) return signedOut(); }
  }
  busy(btn, false);
  if (failed.length) err.textContent = failed.join(' ');
  if (done.length) {
    const when = d1 ? `${nice(d0)} – ${nice(d1)}` : niceLong(d0);
    $('#f-doc').reset(); S.files = []; drawFiles();
    await loadHome().catch(() => {});
    finish("Doctor's note submitted", `The doctor's note for ${done.join(' and ')} (${when}) was sent to the front office for review.`, failed.length);
  }
});

// ---------- dismissal change ----------
const PM = [
  ['Car Rider', 'Picked up in car line'], ['Bus Rider', 'Rides a school bus'], ['Afternoon Extended Care', 'After-school care'],
  ['Student Walker', 'Walks home'], ['Student Driver and/or Passenger', 'Drives or rides with a student driver'], ['City Bus Rider', 'Rides the city bus']];
const afterCut = () => HOME.now_et >= HOME.cutoff || isWeekend(HOME.today);

function renderTrans() {
  $('#t-cutnote').innerHTML = afterCut()
    ? `<b class="t">It's past ${fmt12(HOME.cutoff)} — changes for today can't be made here.</b><p>You can still submit changes for upcoming days.</p>`
    : `<b class="t">Same-day changes must be submitted by ${fmt12(HOME.cutoff)}.</b><p>The front office is emailed as soon as you submit.</p>`;
  picker($('#t-students'), { onchange: drawCurrent });
  const today = $('input[name=t-type][value=today]');
  today.disabled = afterCut();
  if (today.disabled && today.checked) $('input[name=t-type][value=one_day]').checked = true;
  if (!$('#t-start').value) $('#t-start').value = afterCut() ? nextSchoolDay(HOME.today) : HOME.today;
  $('#t-start').min = afterCut() ? addDays(HOME.today, 1) : HOME.today; $('#t-start').max = addDays(HOME.today, 180);
  const stops = HOME.bus_stops; const buses = [...new Set(stops.map(s => s.bus))];
  $('#t-stop').innerHTML = '<option value="">Choose a stop…</option>' + buses.map(b => `<optgroup label="${esc(b)}">${stops.filter(s => s.bus === b).map(s => `<option>${esc(s.stop)}</option>`).join('')}</optgroup>`).join('');
  syncTrans(); drawCurrent();
}
function drawCurrent() {
  const kids = picked($('#t-students'));
  const people = new Map();
  $('#t-current').innerHTML = kids.map(s => {
    const t = transportLines(s);
    const list = [...s.guardians.map(g => ({ ...g, kind: 'Parent/guardian' })), ...s.pickups.map(p => ({ ...p, kind: 'Pickup' }))].filter(p => p.name);
    list.forEach(p => { const k = p.name.toLowerCase(); if (!people.has(k)) people.set(k, p); });
    return `<div class="card" style="background:var(--bg)"><b class="t">${esc(s.first_name)} — now on file</b>
      <dl class="kv" style="padding:0"><dt>Afternoon</dt><dd>${esc(t.pm)}</dd></dl>
      <details><summary><b>Pickup people on file (${list.length})</b></summary>
        <div class="list" style="margin-top:8px">${list.map(p => `<div class="row"><div class="txt"><b>${esc(p.name)}</b><p>${esc([p.relationship, p.phone].filter(Boolean).join(' · ') || p.kind)}</p></div>${p.pin ? `<span class="pin sm">${p.pin}</span>` : ''}</div>`).join('') || '<div class="empty">No pickup people on file.</div>'}</div>
      </details></div>`;
  }).join('');
  const cur = $('#t-person').value;
  $('#t-person').innerHTML = '<option value="">Choose a person…</option>' +
    [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${esc(p.name)}" data-r="${esc(p.relationship || '')}" data-p="${esc(p.phone || '')}">${esc(p.name)}${p.relationship ? ' (' + esc(p.relationship) + ')' : ''}</option>`).join('') +
    '<option value="__other">Someone else…</option>';
  if (cur) $('#t-person').value = cur;
}
function syncTrans() {
  const period = $('input[name=t-period]:checked').value;
  const type = $('input[name=t-type]:checked').value;
  const today = $('input[name=t-type][value=today]');
  today.disabled = afterCut();
  if (today.disabled && type === 'today') { $('input[name=t-type][value=one_day]').checked = true; return syncTrans(); }
  $('#t-start-l').hidden = type === 'today';
  $('#t-start-l').firstChild.textContent = type === 'date_range' ? 'From ' : type === 'permanent' ? 'Starting ' : 'Date ';
  $('#t-end-l').hidden = type !== 'date_range';
  const min = type === 'today' ? HOME.today : afterCut() ? addDays(HOME.today, 1) : HOME.today;
  $('#t-start').min = min; if ($('#t-start').value < min) $('#t-start').value = isWeekend(min) ? nextSchoolDay(min) : min;
  $('#t-end').min = $('#t-start').value;
  const list = PM;
  const cur = $('#t-methods input:checked')?.value;
  $('#t-methods').innerHTML = list.map(([v, d]) => `<label><input type="radio" name="t-method" value="${esc(v)}" ${v === cur ? 'checked' : ''}><span>${esc(v)}<small>${esc(d)}</small></span></label>`).join('');
  syncMethod();
}
function syncMethod() {
  const m = $('#t-methods input:checked')?.value;
  const period = $('input[name=t-period]:checked').value;
  $('#t-bus').hidden = m !== 'Bus Rider';
  $('#t-driver').hidden = m !== 'Student Driver and/or Passenger';
  $('#t-pick').hidden = !(m === 'Car Rider' && period === 'afternoon');
  $('#t-other').hidden = $('#t-person').value !== '__other';
}
$$('input[name=t-period],input[name=t-type]').forEach(i => i.addEventListener('change', syncTrans));
$('#t-methods').addEventListener('change', syncMethod);
$('#t-person').addEventListener('change', syncMethod);
$('#t-start').addEventListener('change', () => { $('#t-end').min = $('#t-start').value; });

$('#f-trans').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#t-err'); err.textContent = '';
  const kids = picked($('#t-students'));
  const period = $('input[name=t-period]:checked').value;
  let type = $('input[name=t-type]:checked').value;
  const start = type === 'today' ? HOME.today : $('#t-start').value;
  if (type === 'today') type = 'one_day';
  const method = $('#t-methods input:checked')?.value;
  if (!kids.length) return err.textContent = 'Choose at least one student.';
  if (!start) return err.textContent = 'Choose a date.';
  if (type === 'date_range' && (!$('#t-end').value || $('#t-end').value < start)) return err.textContent = ERR.bad_range;
  if (!method) return err.textContent = ERR.bad_method;
  let details = '', person = '', rel = '', phone = '';
  if (method === 'Bus Rider') { details = $('#t-stop').value; if (!details) return err.textContent = ERR.need_bus; }
  if (method === 'Afternoon Extended Care') details = 'Afterschool Care - SP';
  if (method === 'Student Driver and/or Passenger') {
    const dn = $('#t-dname').value.trim();
    if (!dn) return err.textContent = "Enter the student driver's full name.";
    details = 'Student driver: ' + dn;
  }
  if (method === 'Car Rider' && period === 'afternoon') {
    const sel = $('#t-person');
    if (!sel.value) return err.textContent = ERR.need_pickup;
    if (sel.value === '__other') {
      person = $('#t-oname').value.trim(); rel = $('#t-orel').value.trim(); phone = $('#t-ophone').value.trim();
      if (!person) return err.textContent = "Enter the pickup person's name.";
      details = 'Not on pickup list';
    } else { const o = sel.selectedOptions[0]; person = sel.value; rel = o.dataset.r; phone = o.dataset.p; }
  }
  const endVal = $('#t-end').value;
  const btn = e.submitter || $('#f-trans .btn'); busy(btn, true, 'Submitting…');
  const done = [], failed = []; let alertFail = false;
  for (const s of kids) {
    try {
      const r = await api('/api/parent', { action: 'transport', student_id: s.student_id, period, change_type: type, start_date: start,
        end_date: type === 'date_range' ? $('#t-end').value : '', new_method: method, new_details: details,
        pickup_person: person, pickup_relationship: rel, pickup_phone: phone, comments: $('#t-comments').value });
      if (!r.alerted) alertFail = true;
      done.push(s.first_name);
    } catch (x) { failed.push(`${s.first_name}: ${msg(x.message)}`); if (x.status === 401) return signedOut(); }
  }
  busy(btn, false);
  if (failed.length) err.textContent = failed.join(' ');
  if (done.length) {
    const when = type === 'date_range' ? `${nice(start)} – ${nice(endVal)}` : type === 'permanent' ? `starting ${nice(start)}` : niceLong(start);
    $('#f-trans').reset(); $('#t-start').value = '';
    await loadHome().catch(() => {});
    finish('Change submitted', `${done.join(' and ')}: ${method}${person ? ' with ' + person : ''} — ${when}. ${alertFail ? 'Please also call the front office at (904) 730-5500 to confirm.' : 'The front office has been notified.'}`, failed.length);
  }
});

// ---------- pick-up people ----------
function renderPickups() {
  picker($('#pp-students'), { disable: s => !s.is_guardian ? 'Only parents/guardians can change this list' : null, onchange: e => {
    const cb = e.target.closest('input'); if (!cb) return;
    if (cb.checked) $$('#pp-students input').forEach(i => { if (i !== cb) i.checked = false; });
    drawPickups();
  } });
  const first = HOME.students.find(s => s.is_guardian);
  if (first && !picked($('#pp-students')).length) { const i = $(`#pp-students input[value="${first.student_id}"]`); if (i) i.checked = true; }
  $('#f-pp').hidden = !first;
  drawPickups();
}
function drawPickups() {
  const s = picked($('#pp-students'))[0];
  if (!s) { $('#pp-list').innerHTML = HOME.students.some(x => x.is_guardian) ? '' : '<div class="card">Only a parent or guardian on file can change the pick-up list.</div>'; return; }
  const rows = [
    ...s.guardians.filter(g => g.name).map(g => `<div class="row"><div class="txt"><b>${esc(g.name)}</b><p>${esc(g.relationship || 'Parent/guardian')}${g.phone ? ' · ' + esc(g.phone) : ''}</p></div>${g.pin ? `<span class="pin sm">${g.pin}</span>` : ''}</div>`),
    ...s.pickups.map(p => `<div class="row"><div class="txt"><b>${esc(p.name)}${p.pending ? ' <span class="tag warn">Added in app</span>' : ''}</b><p>${esc([p.relationship, p.phone].filter(Boolean).join(' · ') || 'Pick-up')}</p>
      <button class="link" data-rm="${esc(p.key)}" data-nm="${esc(p.name)}" style="padding:4px 0">Remove</button></div>${p.pin ? `<span class="pin sm">${p.pin}</span>` : ''}</div>`)
  ];
  $('#pp-list').innerHTML = `<div><h2>${esc(s.first_name)}'s pick-up list</h2><div class="list">${rows.join('') || '<div class="empty">No one on file.</div>'}</div></div>`;
}
$('#pp-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  const s = picked($('#pp-students'))[0];
  if (!confirm(`Remove ${b.dataset.nm} from ${s.first_name}'s pick-up list? Their PIN will stop working for ${s.first_name}.`)) return;
  b.disabled = true;
  try {
    await api('/api/parent', { action: 'pickup', type: 'remove', student_id: s.student_id, person_key: b.dataset.rm });
    await loadHome(); renderPickups(); toast(`${b.dataset.nm} removed. The front office was notified.`);
  } catch (x) { if (x.status === 401) return signedOut(); toast(msg(x.message)); b.disabled = false; }
});
$('#pp-phone').addEventListener('input', e => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 10);
  e.target.value = d.length > 6 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
});
$('#f-pp').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#pp-err'); err.textContent = '';
  const s = picked($('#pp-students'))[0];
  if (!s) return err.textContent = 'Choose a student.';
  if (!$('#pp-first').value.trim() || !$('#pp-last').value.trim()) return err.textContent = ERR.need_name;
  if ($('#pp-phone').value.replace(/\D/g, '').length !== 10) return err.textContent = ERR.need_phone;
  const btn = e.submitter || $('#f-pp .btn'); busy(btn, true, 'Adding…');
  try {
    const r = await api('/api/parent', { action: 'pickup', type: 'add', student_id: s.student_id, first_name: $('#pp-first').value, last_name: $('#pp-last').value,
      relationship: $('#pp-rel').value, phone: $('#pp-phone').value, email: $('#pp-email').value });
    const nm = $('#pp-first').value.trim();
    $('#f-pp').reset(); await loadHome(); renderPickups();
    alert(`${nm} was added to ${s.first_name}'s pick-up list.\n\nTheir PIN is ${r.pin}. Share it with them — they'll type it on the front office iPad.`);
  } catch (x) { if (x.status === 401) return signedOut(); err.textContent = msg(x.message); }
  finally { busy(btn, false); }
});

// ---------- install on home screen + push alerts ----------
const VAPID_PUBLIC = 'BEdnr4yPaJwpJFaIgOZhqymxN25eKxIQpK5rcudvfU1ERy3t4WQtlk8ialLqFbLqIvckyc0auLReADT7PWrGMWg';
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(navigator.userAgent);
const isPhone = isIOS || isAndroid;
const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const later = { get: k => { try { return +localStorage.getItem(k) || 0; } catch { return 0; } }, set: k => { try { localStorage.setItem(k, Date.now() + 3 * 864e5); } catch {} } };
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (!$('#welcome').hidden) sheet('install'); });
addEventListener('appinstalled', () => { $('#welcome').hidden = true; toast('Installed! Open Cornerstone from your home screen.'); });
const SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>';
function sheet(mode) {
  const box = $('#welcome-in');
  if (mode === 'install') {
    box.innerHTML = `<img class="welcome-icon" src="/icons/icon-192.png" alt="">
      <h2 class="w-title" id="w-title">Add Cornerstone to your home screen</h2>
      <p>Open the parent portal like an app, stay signed in, and get school alerts on your phone.</p>
      <div class="w-perks"><span>Excused notes</span><span>Dismissal changes</span><span>Pick-up PINs</span><span>School alerts</span></div>
      ${installEvt ? '' : isIOS ? `<ol class="w-steps"><li><span>Tap the Share button ${SHARE} at the bottom (or top) of Safari.</span></li><li><span>Scroll and tap <b>Add to Home Screen</b>, then <b>Add</b>.</span></li><li><span>Open <b>CCS Portal</b> from your home screen and turn on alerts.</span></li></ol>`
        : `<ol class="w-steps"><li><span>Tap the <b>⋮</b> menu in your browser.</span></li><li><span>Tap <b>Install app</b> or <b>Add to Home screen</b>.</span></li><li><span>Open <b>CCS Portal</b> from your home screen and turn on alerts.</span></li></ol>`}
      <div class="stack">${installEvt ? '<button class="btn big" id="w-install">Install the app</button>' : ''}<button class="w-later" id="w-later">Maybe later</button></div>`;
    if ($('#w-install')) $('#w-install').onclick = async () => { installEvt.prompt(); const c = await installEvt.userChoice.catch(() => ({})); installEvt = null; if (c.outcome === 'accepted') $('#welcome').hidden = true; else sheet('install'); };
    $('#w-later').onclick = () => { later.set('ccs_install_later'); $('#welcome').hidden = true; };
  } else {
    box.innerHTML = `<img class="welcome-icon" src="/icons/icon-192.png" alt="">
      <h2 class="w-title" id="w-title">Turn on school alerts</h2>
      <p>Get notified about closings, early dismissals, and updates on your notes and requests — straight from the Cornerstone front office.</p>
      <div class="stack"><button class="btn big" id="w-push">Turn on alerts</button><button class="w-later" id="w-later">Not now</button></div><p class="err" id="w-err"></p>`;
    $('#w-push').onclick = async () => { const ok = await enablePush(); if (ok) { $('#welcome').hidden = true; toast("Alerts are on. We'll notify you here."); } };
    $('#w-later').onclick = () => { later.set('ccs_push_later'); $('#welcome').hidden = true; };
  }
  $('#welcome').hidden = false;
}
const b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { if ($('#w-err')) $('#w-err').textContent = 'Alerts are blocked. Turn on notifications for this app in your phone Settings.'; syncAlertsBtn(); return false; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC) });
    await api('/api/parent', { action: 'push', subscription: sub.toJSON() });
    syncAlertsBtn(); return true;
  } catch (x) { if ($('#w-err')) $('#w-err').textContent = "Couldn't turn on alerts on this device."; return false; }
}
async function syncAlertsBtn() {
  const b = $('#qa-alerts');
  if (isPhone && !standalone) { b.hidden = false; $('#qa-alerts-s').textContent = 'Add the app to get alerts'; b.onclick = () => sheet('install'); return; }
  if (!canPush) { b.hidden = true; return; }
  const on = Notification.permission === 'granted' && await navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).catch(() => null);
  b.hidden = !!on;
  $('#qa-alerts-s').textContent = Notification.permission === 'denied' ? 'Blocked in phone Settings' : 'Turn on notifications';
  b.onclick = () => sheet('push');
}
async function afterSignIn() {
  syncAlertsBtn();
  // Keep this device's alert subscription linked to whoever is signed in.
  if (canPush && Notification.permission === 'granted') navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(sub => sub && api('/api/parent', { action: 'push', subscription: sub.toJSON() })).catch(() => {});
  if (isPhone && !standalone) { if (later.get('ccs_install_later') < Date.now()) setTimeout(() => sheet('install'), 600); return; }
  if (canPush && Notification.permission === 'default' && later.get('ccs_push_later') < Date.now()) setTimeout(() => sheet('push'), 600);
}

// ---------- history ----------
const STATUS = { pending: ['Pending review', 'warn'], approved: ['Approved — excused', 'ok'], rejected: ['Not approved', ''], new: ['Sent to office', 'warn'], processed: ['Processed', 'ok'], cancelled: ['Cancelled', 'gray'] };
async function loadHistory() {
  $('#hi-who').textContent = HOME.parent_name || HOME.identifier;
  $('#hi-notes').innerHTML = $('#hi-changes').innerHTML = '<div class="empty">Loading…</div>';
  try {
    const h = await api('/api/parent?view=history');
    $('#hi-notes').innerHTML = h.notes.map(n => {
      const [l, c] = STATUS[n.status];
      return `<div class="row"><div class="txt"><b>${esc(n.student)} — ${n.kind === 'doctor' ? "Doctor's note" : 'Parent note'}</b>
        <p>${nice(n.absent_date)}${n.absent_end ? ' – ' + nice(n.absent_end) : ''} · ${esc(n.reason)}${n.review_note ? `<br><b style="display:inline;color:var(--ink)">Office:</b> ${esc(n.review_note)}` : ''}</p></div><span class="tag ${c}">${l}</span></div>`;
    }).join('') || '<div class="empty">No notes yet.</div>';
    $('#hi-changes').innerHTML = h.changes.map(c => {
      const [l, k] = STATUS[c.status];
      const when = c.change_type === 'date_range' ? `${nice(c.start_date)} – ${nice(c.end_date)}` : c.change_type === 'permanent' ? `From ${nice(c.start_date)} (permanent)` : nice(c.start_date);
      return `<div class="row"><div class="txt"><b>${esc(c.student)} — ${esc(c.new_method)}</b><p>${when} · Afternoon${c.pickup_person ? ' · ' + esc(c.pickup_person) : ''}${c.new_details && !c.pickup_person ? ' · ' + esc(c.new_details) : ''}</p></div><span class="tag ${k}">${l}</span></div>`;
    }).join('') || '<div class="empty">No dismissal changes yet.</div>';
  } catch (x) { if (x.status === 401) return signedOut(); $('#hi-notes').innerHTML = `<div class="empty">${msg(x.message)}</div>`; }
}

// ---------- start ----------
(async () => {
  try {
    const a = await api('/api/auth');
    if (a.signedIn) { await loadHome(); }
  } catch {}
  route();
  if (HOME) afterSignIn();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
