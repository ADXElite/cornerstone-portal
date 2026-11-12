// Cornerstone Portal — front office staff portal.
const sb = supabase.createClient('https://cvvdwhgdiqnoqgxtgzfw.supabase.co', 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0');
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = s => new Date(s + 'T12:00:00');
const nice = s => s ? D(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
const stamp = t => t ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const grade = g => g === 'K' ? 'K' : g ? String(g).replace(/^0/, '') : '';
const debounce = (f, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 3000); }
const ERR = { not_staff: 'This account is not on the front office staff list.', limit_reached: 'This student already has the maximum approved parent notes this semester. Reject it or ask for a doctor\'s note.',
  bad_columns: 'That file is missing the "Student ID (System)" column. Use the student & parent export.', empty_file: 'That file has no rows.',
  too_many_removed: 'This file would turn off a lot of students. Check it\'s the full export, then tick "I\'m sure" to continue.', cant_remove_self: "You can't turn off your own access.",
  bad_email: 'Enter a valid email address.', bad_setting: 'Check that value.' };
const emsg = e => { const m = (e && (e.message || e)) || ''; return ERR[m.split(':')[0]] || m || 'Something went wrong.'; };
async function call(fn, args = {}) { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; }

let ME = null, TODAY = null, LIMIT = 5;

// ---------- auth ----------
async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return showLogin();
  try { ME = await call('staff_me'); }
  catch (e) { await sb.auth.signOut(); return showLogin(emsg(e)); }
  TODAY = ME.today; try { LIMIT = +(await call('staff_settings')).parent_note_limit || 5; } catch {}
  $('#who').hidden = false;
  $('#who').innerHTML = `${esc(ME.name || ME.email)}<br><button id="b-out">Sign Out</button>`;
  $('#b-out').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $('#v-login').hidden = true; $('#v-app').hidden = false;
  badges(ME); route();
}
function showLogin(err) { $('#v-login').hidden = false; $('#v-app').hidden = true; $('#lg-err').textContent = err || ''; }
$('#f-login').addEventListener('submit', async e => {
  e.preventDefault(); $('#lg-err').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#lg-email').value.trim().toLowerCase(), password: $('#lg-pass').value });
  if (error) return $('#lg-err').textContent = 'Email or password is incorrect.';
  boot();
});
$('#lg-forgot').onclick = async () => {
  const email = $('#lg-email').value.trim().toLowerCase();
  if (!email) return $('#lg-err').textContent = 'Enter your school email first.';
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/office#reset' });
  $('#lg-err').textContent = error ? 'Could not send a reset email. Please ask Mr. Corley to reset your password.' : 'If that email has a sign-in, a reset link is on its way.';
};
sb.auth.onAuthStateChange(async (ev) => {
  if (ev === 'PASSWORD_RECOVERY') {
    const p = prompt('Choose a new password (at least 8 characters):');
    if (p && p.length >= 8) { const { error } = await sb.auth.updateUser({ password: p }); alert(error ? 'Could not update password: ' + error.message : 'Password updated.'); }
  }
});
function badges(m) {
  $('#b-notes').hidden = !m.pending_notes; $('#b-notes').textContent = m.pending_notes;
  const ch = (m.new_changes || 0) + (m.pickup_todo || 0);
  $('#b-trans').hidden = !ch; $('#b-trans').textContent = ch;
  $('#b-pick').hidden = !m.pickup_todo; $('#b-pick').textContent = m.pickup_todo;
  $('#b-sio').hidden = !m.signins_todo; $('#b-sio').textContent = m.signins_todo;
  const home = (m.new_changes || 0) + (m.pickup_todo || 0) + (m.notes_todo || 0) + (m.other_todo || 0) + (m.signins_todo || 0);
  $('#b-home').hidden = !home; $('#b-home').textContent = home;
}
async function refreshBadges() { try { ME = await call('staff_me'); badges(ME); } catch {} }

// ---------- routing ----------
const VIEWS = ['dash', 'students', 'student', 'buses', 'cars', 'alerts', 'notes', 'transport', 'pickchanges', 'signins', 'pins', 'settings', 'roster', 'carenow', 'carepm', 'caream', 'caresheets', 'busstops'];
// Which top menu item each screen belongs to.
const MENU = { student: 'students', buses: 'reports', cars: 'reports', pins: 'reports', pickchanges: 'transport', alerts: 'settings', roster: 'settings', carenow: 'care', carepm: 'care', caream: 'care', caresheets: 'care', busstops: 'settings' };
let sioTimer = null;
function route() {
  if (!ME) return;
  let [v, q] = (location.hash.slice(1) || 'dash').split('?');
  if (v === 'reports') v = 'buses';
  const view = VIEWS.includes(v) ? v : 'dash';
  VIEWS.forEach(x => $('#p-' + x).hidden = x !== view);
  clearInterval(sioTimer);
  const tab = MENU[view] || view;
  $$('.otabs a').forEach(a => a.dataset.v === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  $$('.subtabs a').forEach(a => a.dataset.s === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  ({ dash: loadDash, notes: loadNotes, transport: () => { if (q === 'today') { $('#tf-by').value = 'effective'; $('#tf-from').value = $('#tf-to').value = TODAY; } loadTrans(); },
     signins: () => { loadSignins(); sioTimer = setInterval(() => { if (!document.hidden && $('#modal').hidden) loadSignins(true); }, 30000); },
     pins: loadPins, students: () => loadStudentList(), student: () => loadStudent(new URLSearchParams(q || '').get('id')),
     buses: loadBuses, cars: () => loadCars(), pickchanges: () => loadPickChanges(), alerts: () => window.alertInfo && alertInfo(),
     settings: loadSettings, roster: loadImports,
     carenow: () => careNow(), carepm: () => carePm(), caream: () => careAm(), caresheets: () => careSheets(), busstops: () => busStopsLoad() })[view]();
}
addEventListener('hashchange', route);
const closeModal = () => { $('#modal').hidden = true; $('#modal-in').innerHTML = ''; $$('[data-blob]').forEach(u => URL.revokeObjectURL(u.dataset.blob)); };
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

// ---------- today ----------
const TYPE = { one_day: 'One day', date_range: 'Date range', permanent: 'Permanent' };
const when = c => c.change_type === 'date_range' ? `${nice(c.start_date)} – ${nice(c.end_date)}` : c.change_type === 'permanent' ? `From ${nice(c.start_date)}` : nice(c.start_date);
const TS = { new: ['Not Processed', 'warn'], processed: ['Processed', 'ok'], cancelled: ['Cancelled', 'gray'] };
async function loadDash() { return homeLoad(); }

// ---------- notes ----------
let NOTES = [];
async function loadNotes() {
  $('#n-rows').innerHTML = '<tr><td colspan="7" class="empty">Loading…</td></tr>';
  NOTES = await call('staff_notes', { p_status: $('#nf-status').value, p_q: $('#nf-q').value.trim() || null, p_kind: $('#nf-kind').value || null });
  $('#nf-count').textContent = `${NOTES.length} note${NOTES.length === 1 ? '' : 's'}`;
  const NS = { pending: ['Pending', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', ''] };
  $('#n-rows').innerHTML = NOTES.map((n, i) => `<tr class="click" data-i="${i}">
    <td><b>${esc(n.student)}</b><small>Gr ${esc(grade(n.grade))} · ${esc(n.teacher || '')}</small></td>
    <td>${n.kind === 'doctor' ? `<span class="tag">Doctor</span><small>${n.files} file${n.files === 1 ? '' : 's'}</small>` : '<span class="tag gray">Parent</span>'}</td>
    <td>${nice(n.absent_date)}${n.absent_end ? '<small>through ' + nice(n.absent_end) + '</small>' : ''}</td>
    <td>${esc(n.reason_other || n.reason)}</td>
    <td>${n.kind === 'parent' ? `${n.approved_parent_notes} of ${LIMIT}` : '—'}<small>${esc(n.semester)}</small></td>
    <td>${stamp(n.created_at)}<small>${esc(n.parent_name || n.submitted_by)}</small></td>
    <td><span class="tag ${NS[n.status][1]}">${NS[n.status][0]}</span>${n.reviewed_by ? `<small>${esc(n.reviewed_by)}</small>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">No notes here.</td></tr>';
}
$('#n-rows').addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) openNote(NOTES[+tr.dataset.i].id); });
['#nf-status', '#nf-kind'].forEach(s => $(s).addEventListener('change', loadNotes));
$('#nf-q').addEventListener('input', debounce(loadNotes));

function b64Blob(b64, mime) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); }
async function openNote(id) {
  $('#modal').hidden = false; $('#modal-in').innerHTML = '<p class="muted">Loading…</p>';
  const n = await call('staff_note', { p_id: id });
  const lim = LIMIT;
  const files = n.files.map(f => {
    const url = URL.createObjectURL(b64Blob(f.data, f.mime));
    const view = f.mime === 'application/pdf' ? `<iframe src="${url}" title="${esc(f.filename)}"></iframe>` : f.mime.startsWith('image/heic') || f.mime.startsWith('image/heif') ? `<p class="empty">HEIC photo — download to view.</p>` : `<img src="${url}" alt="${esc(f.filename)}">`;
    return `<div class="doc" data-blob="${url}">${view}<div class="cap"><span>${esc(f.filename)} · ${(f.size / 1024).toFixed(0)} KB</span><a href="${url}" download="${esc(f.filename)}" target="_blank" rel="noopener">Open / download</a></div></div>`;
  }).join('');
  const overLimit = n.kind === 'parent' && n.status !== 'approved' && n.approved_parent_notes >= lim;
  $('#modal-in').innerHTML = `
    <div class="mh"><div><h2 style="margin:0">${n.kind === 'doctor' ? "Doctor's note" : 'Parent excused note'}</h2><h1 style="font-size:1.7rem">${esc(n.student)}</h1></div><button class="x" id="m-x" aria-label="Close">×</button></div>
    <dl class="kv wide">
      <dt>Grade / teacher</dt><dd>${esc(grade(n.grade))} · ${esc(n.teacher || '—')}</dd>
      <dt>Date absent</dt><dd>${D(n.absent_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${n.absent_end ? ' through ' + nice(n.absent_end) : ''}</dd>
      <dt>Reason</dt><dd>${esc(n.reason)}${n.reason_other ? ': ' + esc(n.reason_other) : ''}</dd>
      ${n.provider ? `<dt>Doctor / office</dt><dd>${esc(n.provider)}</dd>` : ''}
      ${n.comments ? `<dt>Parent comments</dt><dd>${esc(n.comments)}</dd>` : ''}
      ${n.parent_name ? `<dt>Parent</dt><dd>${esc(n.parent_name)} · ${esc(n.parent_phone || '')}</dd>` : ''}
      <dt>Signed in as</dt><dd>${esc(n.submitted_by)}</dd>
      <dt>Submitted</dt><dd>${stamp(n.created_at)}</dd>
      ${n.kind === 'parent' ? `<dt>Parent notes</dt><dd>${n.approved_parent_notes} of ${lim} approved in ${esc(n.semester)}</dd>` : `<dt>Semester</dt><dd>${esc(n.semester)}</dd>`}
      ${n.reviewed_by ? `<dt>Reviewed</dt><dd>${esc(n.status)} by ${esc(n.reviewed_by)} · ${stamp(n.reviewed_at)}</dd>` : ''}
    </dl>
    ${n.signature ? `<div><h2>Signature</h2><img class="sigimg" src="${n.signature}" alt="Parent signature"></div>` : ''}
    ${n.kind === 'doctor' ? `<div class="stack"><h2>Doctor's Note</h2>${files || '<p class="err">No file was attached. Ask the parent to resubmit.</p>'}</div>` : ''}
    ${overLimit ? `<p class="err">This student already has ${lim} approved parent notes this semester. This absence needs a doctor's note to be excused.</p>` : ''}
    <label class="f">Note to Parent <small class="muted">(optional — shown in the parent's history)</small><textarea id="m-note" rows="2">${esc(n.review_note || '')}</textarea></label>
    <div class="actions">
      <button class="btn ok" id="m-ok" ${overLimit ? 'disabled' : ''}>Approve — Mark Excused</button>
      <button class="btn" id="m-no">Reject</button>
      ${n.status !== 'pending' ? '<button class="btn ghost" id="m-reset">Move Back to Pending</button>' : ''}
    </div>
    <p class="err" id="m-err"></p>`;
  $('#m-x').onclick = closeModal;
  const act = async st => {
    try { await call('staff_note_review', { p_id: id, p_status: st, p_note: $('#m-note').value }); closeModal(); toast(st === 'approved' ? 'Approved' : st === 'rejected' ? 'Rejected' : 'Moved to pending'); if (!$('#p-notes').hidden) loadNotes(); refreshBadges(); window.noteReviewed && window.noteReviewed(id, st); }
    catch (e) { $('#m-err').textContent = emsg(e); }
  };
  $('#m-ok').onclick = () => act('approved');
  $('#m-no').onclick = () => act('rejected');
  if ($('#m-reset')) $('#m-reset').onclick = () => act('pending');
}

// ---------- transport report ----------
let TR = [];
function tRow(c, i) {
  const [l, k] = TS[c.status];
  return `<tr class="click ${c.start_date <= TODAY && (c.end_date || '9999') >= TODAY ? 'today' : ''}" data-i="${i}">
    <td><b>${esc(c.student)}</b><small>Gr ${esc(grade(c.grade))} · ${esc(c.teacher || '')}</small></td>
    <td>${when(c)}<small>${c.period === 'afternoon' ? 'Afternoon' : 'Morning'} · ${TYPE[c.change_type]}</small></td>
    <td><small>${esc(c.current_method || '—')}</small><b>→ ${esc(c.new_method)}</b>${c.new_details && c.new_details !== 'Not on pickup list' ? `<small>${esc(c.new_details)}</small>` : ''}</td>
    <td>${c.pickup_person ? `<b>${esc(c.pickup_person)}${c.pickup_pin ? ` <span class="pin sm">${c.pickup_pin}</span>` : ''}</b><small>${esc([c.pickup_relationship, c.pickup_phone].filter(Boolean).join(' · '))}${c.new_details === 'Not on pickup list' ? ' · <b style="display:inline;color:var(--red)">Not on pickup list</b>' : ''}</small>` : '—'}${c.comments ? `<small>“${esc(c.comments)}”</small>` : ''}</td>
    <td>${esc(c.submitted_name || '')}<small>${esc(c.submitted_by)} · ${stamp(c.created_at)}</small></td>
    <td><span class="tag ${k}">${l}</span>${c.processed_by ? `<small>${esc(c.processed_by)}</small>` : ''}</td></tr>`;
}
function bindTRows(tbody, rows, reload) {
  tbody.onclick = e => { const tr = e.target.closest('tr[data-i]'); if (tr) openChange(rows[+tr.dataset.i], reload); };
}
function openChange(c, reload) {
  $('#modal').hidden = false;
  $('#modal-in').innerHTML = `<div class="mh"><div><h2 style="margin:0">Dismissal Change</h2><h1 style="font-size:1.7rem">${esc(c.student)}</h1></div><button class="x" id="m-x" aria-label="Close">×</button></div>
    <dl class="kv wide">
      <dt>Applies To</dt><dd>${c.period === 'afternoon' ? 'Afternoon dismissal' : 'Morning arrival'}</dd>
      <dt>When</dt><dd>${when(c)} · ${TYPE[c.change_type]}</dd>
      <dt>Was</dt><dd>${esc(c.current_method || '—')}</dd>
      <dt>Change to</dt><dd>${esc(c.new_method)}${c.new_details ? ' — ' + esc(c.new_details) : ''}</dd>
      ${c.pickup_person ? `<dt>Picked Up By</dt><dd>${esc([c.pickup_person, c.pickup_relationship, c.pickup_phone].filter(Boolean).join(' · '))}</dd>` : ''}
      ${c.comments ? `<dt>Comments</dt><dd>${esc(c.comments)}</dd>` : ''}
      <dt>Submitted by</dt><dd>${esc(c.submitted_name || '')} (${esc(c.submitted_by)}) · ${stamp(c.created_at)}</dd>
      ${c.processed_by ? `<dt>${esc(TS[c.status][0])}</dt><dd>${esc(c.processed_by)} · ${stamp(c.processed_at)}</dd>` : ''}
    </dl>
    <div class="actions">
      ${c.status !== 'processed' ? '<button class="btn ok" data-s="processed">Mark Processed (KidAccount Updated)</button>' : ''}
      ${c.status !== 'new' ? '<button class="btn ghost" data-s="new">Mark Not Processed</button>' : ''}
      ${c.status !== 'cancelled' ? '<button class="btn ghost" data-s="cancelled">Cancel This Change</button>' : ''}
    </div><p class="err" id="m-err"></p>`;
  $('#m-x').onclick = closeModal;
  $$('#modal-in [data-s]').forEach(b => b.onclick = async () => {
    try { await call('staff_transport_set', { p_id: c.id, p_status: b.dataset.s }); closeModal(); toast('Saved'); reload(); refreshBadges(); }
    catch (e) { $('#m-err').textContent = emsg(e); }
  });
}
async function loadTrans() {
  if (!$('#tf-from').value && !$('#tf-to').value) { const d = D(TODAY); d.setDate(d.getDate() - 30); $('#tf-from').value = d.toLocaleDateString('en-CA'); }
  $('#t-rows').innerHTML = '<tr><td colspan="6" class="empty">Loading…</td></tr>';
  TR = await call('staff_transport', { p_from: $('#tf-from').value || null, p_to: $('#tf-to').value || null, p_q: $('#tf-q').value.trim() || null, p_status: $('#tf-status').value, p_by: $('#tf-by').value });
  $('#tf-count').textContent = `${TR.length} change${TR.length === 1 ? '' : 's'}`;
  $('#t-rows').innerHTML = TR.map(tRow).join('') || '<tr><td colspan="6" class="empty">No dismissal changes match.</td></tr>';
  bindTRows($('#t-rows'), TR, loadTrans);
}
['#tf-by', '#tf-from', '#tf-to', '#tf-status'].forEach(s => $(s).addEventListener('change', loadTrans));
$('#tf-q').addEventListener('input', debounce(loadTrans));
$('#tf-today').onclick = () => { $('#tf-by').value = 'effective'; $('#tf-from').value = $('#tf-to').value = TODAY; loadTrans(); };
$('#tf-csv').onclick = () => {
  const cols = [['Student', c => c.student], ['Grade', c => c.grade], ['Teacher', c => c.teacher], ['Period', c => c.period], ['Type', c => TYPE[c.change_type]],
    ['Start date', c => c.start_date], ['End date', c => c.end_date], ['Was', c => c.current_method], ['New method', c => c.new_method], ['Details', c => c.new_details],
    ['Pickup person', c => c.pickup_person], ['Pickup relationship', c => c.pickup_relationship], ['Pickup phone', c => c.pickup_phone], ['Comments', c => c.comments],
    ['Submitted by', c => c.submitted_name], ['Parent login', c => c.submitted_by], ['Submitted at', c => stamp(c.created_at)], ['Status', c => TS[c.status][0]], ['Processed by', c => c.processed_by], ['Processed at', c => stamp(c.processed_at)]];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.map(c => q(c[0])).join(','), ...TR.map(r => cols.map(c => q(c[1](r))).join(','))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `dismissal-changes-${$('#tf-from').value || 'all'}-to-${$('#tf-to').value || 'now'}.csv`; a.click();
};

// ---------- sign-in / sign-out ----------
let SIO = [];
const KIND = { early_out: ['Early Check-Out', ''], late_in: ['Late Sign-In', 'warn'] };
const HOW = { pin: 'PIN', student_id: 'Student ID typed', badge: 'Badge scanned', name: 'Name search' };
const tm = t => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
async function loadSignins(quiet) {
  if (!$('#sio-from').value && !$('#sio-to').value) $('#sio-from').value = $('#sio-to').value = TODAY;
  if (!quiet) $('#sio-rows').innerHTML = '<tr><td colspan="7" class="empty">Loading…</td></tr>';
  try {
    SIO = await call('staff_signins', { p_from: $('#sio-from').value || null, p_to: $('#sio-to').value || null, p_kind: $('#sio-kind').value, p_q: $('#sio-q').value.trim() || null, p_facts: $('#sio-facts').value });
  } catch (e) { if (!quiet) $('#sio-rows').innerHTML = `<tr><td colspan="7" class="empty">${esc(emsg(e))}</td></tr>`; return; }
  const multiDay = $('#sio-from').value !== $('#sio-to').value;
  $('#sio-count').textContent = `${SIO.length} entr${SIO.length === 1 ? 'y' : 'ies'} · ${SIO.filter(r => !r.facts_done).length} not yet updated in FACTS`;
  $('#sio-rows').innerHTML = SIO.map((r, i) => `<tr data-i="${i}">
    <td><b>${tm(r.created_at)}</b>${multiDay ? `<small>${nice(new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))}</small>` : ''}</td>
    <td><span class="tag ${KIND[r.kind][1]}">${KIND[r.kind][0]}</span></td>
    <td><b>${esc(r.student)}</b><small>Gr ${esc(grade(r.grade))} · ${esc(r.teacher || '')}</small></td>
    <td>${r.method === 'pin' ? `<b>${esc(r.person_name)} <span class="pin sm">${esc(r.pin)}</span></b><small>${esc(r.relationship || '')}</small>` : `<b>Student signed self in</b><small>${HOW[r.method]}</small>`}</td>
    <td>${esc(r.reason || '')}</td>
    <td>${r.has_signature ? `<button class="link" data-sig="${i}">View</button>` : '<small class="muted">—</small>'}</td>
    <td class="c"><input type="checkbox" class="fx" data-fx="${i}" ${r.facts_done ? 'checked' : ''} aria-label="Updated in FACTS for ${esc(r.student)}">${r.facts_done ? `<small>${esc((r.facts_by || '').split('@')[0])} · ${tm(r.facts_at)}</small>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">No late sign-ins or early check-outs.</td></tr>';
  refreshBadges();
}
$('#sio-rows').addEventListener('change', async e => {
  const cb = e.target.closest('[data-fx]'); if (!cb) return;
  const r = SIO[+cb.dataset.fx]; cb.disabled = true;
  try { await call('staff_signin_facts', { p_id: r.id, p_done: cb.checked }); toast(cb.checked ? 'Marked updated in FACTS' : 'Unmarked'); loadSignins(true); }
  catch (x) { cb.checked = !cb.checked; toast(emsg(x)); }
  cb.disabled = false;
});
$('#sio-rows').addEventListener('click', async e => {
  const b = e.target.closest('[data-sig]'); if (!b) return;
  const r = await call('staff_signin', { p_id: SIO[+b.dataset.sig].id });
  $('#modal').hidden = false;
  $('#modal-in').innerHTML = `<div class="mh"><div><h2 style="margin:0">${KIND[r.kind][0]}</h2><h1 style="font-size:1.7rem">${esc(r.student)}</h1></div><button class="x" id="m-x" aria-label="Close">×</button></div>
    <dl class="kv wide"><dt>Time</dt><dd>${stamp(r.created_at)}</dd><dt>Signed by</dt><dd>${esc(r.person_name)}${r.pin ? ` <span class="pin sm">${esc(r.pin)}</span>` : ''} ${r.relationship ? '(' + esc(r.relationship) + ')' : ''}</dd>
      <dt>Reason</dt><dd>${esc(r.reason || '')}</dd>${r.kiosk ? `<dt>Device</dt><dd>${esc(r.kiosk)}</dd>` : ''}</dl>
    ${r.signature ? `<img class="sigimg" src="${r.signature}" alt="Signature">` : ''}`;
  $('#m-x').onclick = closeModal;
});
['#sio-from', '#sio-to', '#sio-kind', '#sio-facts'].forEach(s => $(s).addEventListener('change', () => loadSignins()));
$('#sio-q').addEventListener('input', debounce(() => loadSignins()));
$('#sio-today').onclick = () => { $('#sio-from').value = $('#sio-to').value = TODAY; loadSignins(); };
$('#sio-csv').onclick = () => {
  const cols = [['Date', r => new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })], ['Time', r => tm(r.created_at)], ['Type', r => KIND[r.kind][0]],
    ['Student', r => r.student], ['Student ID', r => r.student_id], ['Grade', r => r.grade], ['Teacher', r => r.teacher], ['Signed by', r => r.person_name], ['PIN', r => r.pin],
    ['Relationship', r => r.relationship], ['How', r => HOW[r.method]], ['Reason', r => r.reason], ['Updated in FACTS', r => r.facts_done ? 'Yes' : 'No'], ['Updated by', r => r.facts_by]];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.map(c => q(c[0])).join(','), ...SIO.map(r => cols.map(c => q(c[1](r))).join(','))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `sign-in-sign-out-${$('#sio-from').value}-to-${$('#sio-to').value}.csv`; a.click();
};

// ---------- students ----------
const TODAY_TAG = { present: ['Present', 'ok'], late: ['Late — Present', 'warn'], absent: ['Absent', ''], dismissed: ['Checked Out Early', 'gray'] };

// ---------- pick-up & PIN report ----------
let PINS = [], PINF = null;
async function loadPins() {
  if (!PINF) {
    PINF = await call('staff_pin_filters');
    $('#pf-grade').innerHTML = '<option value="">All Grades</option>' + (PINF.grades || []).sort((a, b) => a === 'K' ? -1 : b === 'K' ? 1 : +a - +b).map(g => `<option value="${esc(g)}">${esc(g === 'K' ? 'Kindergarten' : 'Grade ' + String(g).replace(/^0/, ''))}</option>`).join('');
    $('#pf-teacher').innerHTML = '<option value="">All Teachers</option>' + (PINF.teachers || []).sort().map(t => `<option>${esc(t)}</option>`).join('');
    $('#pf-warn').innerHTML = (PINF.warnings || []).map(w => `<p class="err">⚠ ${esc(w.note)}</p>`).join('');
  }
  $('#pin-rows').innerHTML = '<tr><td colspan="7" class="empty">Loading…</td></tr>';
  PINS = await call('staff_pin_report', { p_q: $('#pf-q').value.trim() || null, p_grade: $('#pf-grade').value || null, p_teacher: $('#pf-teacher').value || null });
  const students = new Set(PINS.map(r => r.sid)).size;
  $('#pf-count').textContent = `${students} student${students === 1 ? '' : 's'} · ${PINS.length} people`;
  let last = null;
  $('#pin-rows').innerHTML = PINS.map(r => {
    const first = r.sid !== last; last = r.sid;
    return `${first ? `<tr class="grp"><td colspan="7"><b>${esc(r.last)}, ${esc(r.first)}</b> <small style="display:inline">ID ${r.sid} · Grade ${esc(grade(r.grade))} · ${esc(r.teacher || '')}${r.board && r.board !== r.teacher ? ' · board: ' + esc(r.board) : ''}</small></td></tr>` : ''}
    <tr><td>${esc(r.name)}${r.pending ? ' <span class="tag warn">Added in Portal</span>' : ''}</td><td>${r.type === 'Parent/guardian' ? '<span class="tag ok">Parent/Guardian</span>' : '<span class="tag gray">Pick-Up</span>'}</td>
      <td>${esc(r.relationship || '')}</td><td>${esc(r.phone || '')}<small>${esc(r.email || '')}</small></td><td>${esc(r.id || '')}</td>
      <td>${r.pin ? `<span class="pin sm">${esc(r.pin)}</span>` : '—'}</td><td><small>${r.pin_source === 'file' ? 'From FACTS' : r.pin ? 'Portal' : ''}</small></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="empty">No matches.</td></tr>';
}
['#pf-grade', '#pf-teacher'].forEach(s => $(s).addEventListener('change', loadPins));
$('#pf-q').addEventListener('input', debounce(loadPins));
$('#pf-print').onclick = () => window.print();
$('#pf-csv').onclick = () => {
  const cols = [['Student', r => `${r.last}, ${r.first}`], ['Student ID', r => r.sid], ['Grade', r => r.grade], ['Homeroom', r => r.teacher], ['Dismissal board', r => r.board],
    ['Person', r => r.name], ['Type', r => r.type], ['Relationship', r => r.relationship], ['Phone', r => r.phone], ['Email', r => r.email], ['FACTS ID', r => r.id], ['PIN', r => r.pin], ['PIN from', r => r.pin_source === 'file' ? 'FACTS' : 'Portal']];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.map(c => q(c[0])).join(','), ...PINS.map(r => cols.map(c => q(c[1](r))).join(','))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `pickup-pins-${TODAY}.csv`; a.click();
};

// ---------- roster ----------
let PARSED = null;
$('#r-file') && $('#r-file').addEventListener('change', e => {
  const f = e.target.files[0]; $('#r-err').textContent = ''; $('#r-preview').innerHTML = '';
  if (!f) return;
  Papa.parse(f, { header: true, skipEmptyLines: true, transformHeader: h => h.trim(), complete: res => {
    PARSED = res.data;
    const att = PARSED.length && 'studentid' in PARSED[0] && 'Attendance' in PARSED[0];
    if (!PARSED.length || (!att && !('Student ID (System)' in PARSED[0]))) { PARSED = null; return $('#r-err').textContent = 'That file is neither the student & parent file nor the daily attendance file.'; }
    if (att) {
      const a = PARSED.filter(r => /^a/i.test(r.Attendance || '')).length;
      $('#r-preview').innerHTML = `<div class="card" style="background:var(--bg)"><b class="t">${esc(f.name)} — Daily Attendance for Today</b><p>${PARSED.length} students · ${a} absent · ${PARSED.length - a} present</p>
        <div class="actions"><button class="btn" id="r-go">Update Today's Attendance</button></div></div>`;
    } else {
      const ids = new Set(PARSED.map(r => r['Student ID (System)']).filter(Boolean));
      $('#r-preview').innerHTML = `<div class="card" style="background:var(--bg)"><b class="t">${esc(f.name)} — Student &amp; Parent File</b><p>${PARSED.length} rows · ${ids.size} students</p>
        <label class="actions" style="font-weight:600"><input type="checkbox" id="r-force"> I'm sure — allow turning off many students</label>
        <div class="actions"><button class="btn" id="r-go">Update Roster</button></div></div>`;
    }
    $('#r-go').onclick = async () => {
      const b = $('#r-go'); b.disabled = true; b.textContent = 'Updating…';
      try {
        const r = att ? await call('staff_attendance_import', { p_rows: PARSED }) : await call('staff_roster_import', { p_rows: PARSED, p_force: $('#r-force').checked });
        $('#r-preview').innerHTML = `<div class="card on" style="background:var(--ok-bg);color:var(--ok);border-color:var(--ok)"><b>${att ? attText(r) : rosterText(r)}</b></div>`;
        $('#r-file').value = ''; PARSED = null; loadImports();
      } catch (x) { $('#r-err').textContent = emsg(x); b.disabled = false; b.textContent = att ? "Update today's attendance" : 'Update roster'; }
    };
  }, error: () => $('#r-err').textContent = "Couldn't read that file." });
});
const rosterText = r => `Roster updated: ${r.students} students, ${r.guardians} parents/guardians, ${r.pickups} pickup people${r.deactivated ? `, ${r.deactivated} turned off` : ''}${r.file_pins != null ? `, ${r.file_pins} PINs from the file` : ''}.`
  + (r.warnings && r.warnings.length ? ' ⚠ ' + r.warnings.join(' ') : '');
const attText = r => `Today's attendance updated: ${r.present} present, ${r.absent} absent${r.not_in_roster ? ` (${r.not_in_roster} IDs not in the roster)` : ''}.`;
async function loadImports() {
  call('staff_import_errors').then(errs => {
    $('#sftp-errors').innerHTML = errs.map(e => `<p class="err">${esc(e.note)} <small class="muted">(${stamp(e.at)})</small></p>`).join('');
  }).catch(() => {});
  const rows = await call('staff_imports');
  $('#r-hist').innerHTML = rows.map(i => `<tr><td>${stamp(i.imported_at)}</td><td>${esc(i.imported_by)}</td><td>${i.rows_in}</td><td>${i.students}</td><td>${i.guardians}</td><td>${i.pickups}</td><td>${i.deactivated}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">No uploads yet.</td></tr>';
}

const SFTP_ERR = { sftp_not_configured: "The portal's SFTP key hasn't been added in Vercel yet (SFTP_PRIVATE_KEY).", sftp_login_failed: "The SFTP server refused the portal's key.",
  sftp_unreachable: 'The SFTP server could not be reached.', sftp_folders_missing: 'The uploads or processed folder is missing on the SFTP server.' };
$('#sftp-go').onclick = async () => {
  const b = $('#sftp-go'); b.disabled = true; b.textContent = 'Checking…'; $('#sftp-result').innerHTML = '';
  try {
    const { data } = await sb.auth.getSession();
    const r = await fetch('/api/sftp-import' + ($('#sftp-force').checked ? '?force=1' : ''), { method: 'POST', headers: { Authorization: 'Bearer ' + data.session.access_token } });
    const j = await r.json().catch(() => ({}));
    $('#sftp-result').innerHTML = r.ok
      ? (j.imported ? (j.results || []).map(x => `<p class="card" style="background:var(--ok-bg);color:var(--ok);border-color:var(--ok);font-weight:700">${esc(x.file)}: ${esc(x.kind === 'attendance' ? attText(x) : rosterText(x))}</p>`).join('')
          + (j.message ? `<p class="err">${esc(j.message)}</p>` : '') : `<p class="muted">${esc(j.message)}</p>`)
      : `<p class="err">${esc(j.message || SFTP_ERR[j.error] || emsg(j.error))}</p>`;
    loadImports(); refreshBadges();
  } catch (e) { $('#sftp-result').innerHTML = `<p class="err">${esc(emsg(e))}</p>`; }
  b.disabled = false; b.textContent = 'Check SFTP now';
};

// ---------- settings ----------
let SET = null;
async function loadSettings() {
  const [staff, set] = await Promise.all([call('staff_staff_list'), call('staff_settings')]);
  SET = set;
  $('#ap-on').checked = set.alerts_paused === true;
  $('#ap-card').style.borderColor = set.alerts_paused === true ? 'var(--red)' : '';
  const ROLE = { admin: ['Admin', 'ok'], office: ['Front Office', 'ok'], carline: ['Car Line', 'warn'], bus: ['Bus Driver', 'gray'], care: ['Extended Care', 'warn'] };
  const rolesOf = st => st.roles || [st.role];
  $('#staff-list').innerHTML = staff.map(st => `<div class="row" data-row="${esc(st.email)}"><div class="txt"><b>${esc(st.name || st.email)} ${rolesOf(st).map(r => `<span class="tag ${(ROLE[r] || ['', ''])[1]}">${(ROLE[r] || [r])[0]}</span>`).join(' ')}${st.active ? '' : ' <span class="tag gray">Off</span>'}</b>
      <p>${esc(st.email)}${st.has_login ? (st.last_sign_in ? ' · last signed in ' + stamp(st.last_sign_in) : ' · has a sign-in') : ' · <b style="display:inline;color:var(--red)">no sign-in yet</b>'}</p>
      <div class="roles-pick" data-roles="${esc(st.email)}" hidden>${Object.entries(ROLE).map(([k, v]) => `<label><input type="checkbox" value="${k}" ${rolesOf(st).includes(k) ? 'checked' : ''}> ${v[0]}${k === 'admin' ? ' (all roles)' : ''}</label>`).join('')}
        <button class="btn sm" data-saveroles="${esc(st.email)}" type="button">Save Roles</button></div></div>
    <span class="actions"><button class="btn ghost sm" data-editroles="${esc(st.email)}">Edit Roles</button><button class="btn ghost sm" data-pw="${esc(st.email)}">${st.has_login ? 'Reset Password' : 'Create Sign-In'}</button>
    <button class="btn ${st.active ? 'ghost' : ''} sm" data-e="${esc(st.email)}" data-a="${st.active ? 0 : 1}">${st.active ? 'Turn Off' : 'Turn On'}</button></span></div>`).join('');
  $$('#staff-list [data-e]').forEach(b => b.onclick = async () => {
    try { await call('staff_staff_save', { p_email: b.dataset.e, p_name: null, p_active: b.dataset.a === '1' }); loadSettings(); } catch (e) { $('#sa-err').textContent = emsg(e); }
  });
  $$('#staff-list [data-editroles]').forEach(b => b.onclick = () => { const box = $(`#staff-list [data-roles="${CSS.escape(b.dataset.editroles)}"]`); box.hidden = !box.hidden; });
  $$('#staff-list .roles-pick').forEach(box => wireAdmin(box));
  // Only Admins can give or take away Admin, or change an Admin's account.
  const iAdmin = (ME?.roles || []).includes('admin');
  $$('#sa-roles input[value=admin], #staff-list .roles-pick input[value=admin]').forEach(i => i.closest('label').hidden = !iAdmin);
  if (!iAdmin) staff.filter(st => rolesOf(st).includes('admin')).forEach(st => {
    $$(`#staff-list [data-row="${CSS.escape(st.email)}"] .actions button`).forEach(b => b.hidden = true);
  });
  $$('#staff-list [data-saveroles]').forEach(b => b.onclick = async () => {
    const box = b.closest('.roles-pick'), roles = [...box.querySelectorAll('input:checked')].map(i => i.value);
    const st = staff.find(x => x.email === b.dataset.saveroles);
    if (!roles.length) return $('#sa-err').textContent = 'Choose at least one role.';
    try { await call('staff_staff_save', { p_email: st.email, p_name: null, p_active: st.active, p_roles: roles }); toast('Roles saved'); loadSettings(); } catch (e) { $('#sa-err').textContent = emsg(e); }
  });
  $$('#staff-list [data-pw]').forEach(b => b.onclick = async () => {
    const pw = prompt(`New password for ${b.dataset.pw} (at least 8 characters):`); if (!pw) return;
    const st = staff.find(x => x.email === b.dataset.pw);
    try { await staffUsers(st.has_login ? { action: 'password', email: b.dataset.pw, password: pw } : { action: 'create', email: b.dataset.pw, name: st.name, roles: st.roles || [st.role], password: pw }); toast('Password saved. Share it with them privately.'); loadSettings(); }
    catch (x) { $('#sa-err').textContent = x.message; }
  });
  drawSems(set.semesters);
  call('staff_kiosks').then(ks => {
    $('#kiosk-list').innerHTML = ks.map(k => `<div class="row"><div class="txt"><b>${esc(k.label)}</b><p>Set up ${/^campus /.test(k.created_by) ? "on the school network" : "by " + esc(k.created_by)} · ${stamp(k.created_at)}${k.last_seen_at ? ' · last used ' + stamp(k.last_seen_at) : ''}</p></div>
      <button class="btn ghost sm" data-k="${k.id}">Turn Off</button></div>`).join('') || '<div class="empty">No iPads set up yet.</div>';
    $('#kiosk-list').querySelectorAll('[data-k]').forEach(b => b.onclick = async () => {
      if (!confirm('Turn off this iPad? It will need to be set up again.')) return;
      await call('staff_kiosk_revoke', { p_id: b.dataset.k }); loadSettings();
    });
  }).catch(() => {});
  $('#set-limit').value = set.parent_note_limit; $('#set-days').value = set.note_days_limit; $('#set-cut').value = set.dismissal_cutoff;
}
function drawSems(list) {
  $('#sem-list').innerHTML = list.map((s, i) => `<div class="sem-row" data-i="${i}">
    <label class="f">Name<input type="text" class="s-l" value="${esc(s.label)}"></label><label class="f">Start<input type="date" class="s-s" value="${s.start}"></label>
    <label class="f">End<input type="date" class="s-e" value="${s.end}"></label><button class="x" type="button" aria-label="Remove">×</button></div>`).join('');
  $$('#sem-list .x').forEach(b => b.onclick = () => { b.parentElement.remove(); });
}
const readSems = () => $$('#sem-list .sem-row').map(r => ({ label: r.querySelector('.s-l').value.trim(), start: r.querySelector('.s-s').value, end: r.querySelector('.s-e').value })).filter(s => s.label && s.start && s.end);
$('#sem-add').onclick = () => drawSems([...readSems(), { label: '', start: '', end: '' }]);
$('#sem-save').onclick = async () => { try { await call('staff_settings_set', { p_key: 'semesters', p_value: readSems() }); toast('Semesters saved'); } catch (e) { $('#set-err').textContent = emsg(e); } };
$('#set-save').onclick = async () => {
  try {
    await call('staff_settings_set', { p_key: 'parent_note_limit', p_value: +$('#set-limit').value });
    await call('staff_settings_set', { p_key: 'note_days_limit', p_value: +$('#set-days').value });
    await call('staff_settings_set', { p_key: 'dismissal_cutoff', p_value: $('#set-cut').value.slice(0, 5) });
    toast('Rules saved');
  } catch (e) { $('#set-err').textContent = emsg(e); }
};
// Ticking Admin ticks every role; unticking any role unticks Admin.
function wireAdmin(box) {
  const boxes = [...box.querySelectorAll('input[type=checkbox]')], adm = boxes.find(i => i.value === 'admin');
  boxes.forEach(i => i.addEventListener('change', () => {
    if (i === adm) boxes.forEach(x => x.checked = adm.checked);
    else if (!i.checked) adm.checked = false;
    else if (boxes.filter(x => x !== adm).every(x => x.checked)) adm.checked = true;
  }));
}
wireAdmin($('#sa-roles'));
async function staffUsers(body) {
  const { data } = await sb.auth.getSession();
  const r = await fetch('https://cvvdwhgdiqnoqgxtgzfw.supabase.co/functions/v1/portal-staff-users', { method: 'POST',
    headers: { Authorization: 'Bearer ' + data.session.access_token, apikey: 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not save.');
  return j;
}
$('#f-staff').addEventListener('submit', async e => {
  e.preventDefault(); $('#sa-err').textContent = '';
  const b = e.submitter; b.disabled = true;
  try {
    const roles = [...$$('#sa-roles input:checked')].map(i => i.value);
    if (!roles.length) throw new Error('Choose at least one role.');
    await staffUsers({ action: 'create', email: $('#sa-email').value, name: $('#sa-name').value, roles, password: $('#sa-pass').value });
    const all = roles.includes('admin') ? ['office', 'carline', 'bus', 'care'] : roles;
    const where = all.map(r => ({ carline: 'portal.csjax.org/carline', bus: 'portal.csjax.org/bus', care: 'portal.csjax.org/care', office: 'portal.csjax.org/office' })[r]).filter(Boolean).join('\n');
    alert(`Sign-in created.\n\nGive them:\n${where}\nEmail: ${$('#sa-email').value.trim().toLowerCase()}\nPassword: the one you just typed`);
    $('#f-staff').reset(); loadSettings();
  } catch (x) { $('#sa-err').textContent = x.message; }
  b.disabled = false;
});

boot();

$('#ap-on').addEventListener('change', async e => {
  const on = e.target.checked; e.target.disabled = true;
  try { await call('staff_settings_set', { p_key: 'alerts_paused', p_value: on }); toast(on ? 'Alerts paused — only sign-in codes will send' : 'Alerts are back on'); $('#ap-card').style.borderColor = on ? 'var(--red)' : ''; }
  catch (x) { e.target.checked = !on; toast(emsg(x)); }
  e.target.disabled = false;
});
