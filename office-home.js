// Office home screen: Change requests · Late sign-in & early sign-out · Excused notes · Enter a change · Parent alerts.
// Uses helpers from office.js ($, call, esc, nice, stamp, grade, toast, openNote, openChange, closeModal, b64Blob, ...).
const PUSH_URL = 'https://cvvdwhgdiqnoqgxtgzfw.supabase.co/functions/v1/portal-push';
const H = { trans: [], pick: [], other: [], sio: [], notes: [] };
const showMode = () => 'todo';
const fx = (kind, i, done, by, at) => `<td class="c"><input type="checkbox" class="fx" data-sis="${kind}:${i}" ${done ? 'checked' : ''} aria-label="Entered in FACTS">${done && by ? `<small>${esc(String(by).split('@')[0])}${at ? ' · ' + stamp(at) : ''}</small>` : ''}</td>`;
const src = (by, name) => `${esc(name || '')}<small>${esc(by || '')}</small>`;

async function homeLoad(quiet) {
  const all = showMode() === 'all';
  if (all && !$('#h-from').value) { const d = D(TODAY); d.setDate(d.getDate() - 14); $('#h-from').value = d.toLocaleDateString('en-CA'); $('#h-to').value = TODAY; }
  const from = all ? $('#h-from').value || null : null, to = all ? $('#h-to').value || null : null, sis = all ? 'all' : 'todo';
  if (!quiet) ['#h-trans', '#h-pick', '#h-other', '#h-sio', '#h-notes'].forEach(id => $(id).innerHTML = `<tr><td colspan="7" class="empty">Loading…</td></tr>`);
  try {
    const [trans, pick, other, sio, notes] = await Promise.all([
      call('staff_transport', { p_from: from, p_to: to, p_status: all ? 'all' : 'new', p_by: 'submitted' }),
      call('staff_pickup_requests', { p_sis: sis, p_from: from, p_to: to }),
      call('staff_other_list', { p_sis: sis, p_from: from, p_to: to }),
      call('staff_signins', { p_from: from, p_to: to, p_kind: 'all', p_q: null, p_facts: sis }),
      call('staff_notes_list', { p_sis: sis, p_from: from, p_to: to })]);
    Object.assign(H, { trans, pick, other, sio, notes });
  } catch (e) { toast(emsg(e)); return; }
  drawHome();
  refreshBadges();
}

function drawHome() {
  const empty = (n, t) => `<tr><td colspan="${n}" class="empty">${t}</td></tr>`;
  const all = showMode() === 'all';
  const none = all ? 'Nothing in these dates.' : 'All caught up.';
  const badge = (id, n) => { const el = $(id); if (!el) return; el.hidden = !n; el.textContent = n; };
  const todo = a => a.filter(x => x.sis_done === false || x.facts_done === false || x.status === 'new').length;

  $('#c-trans').textContent = `(${H.trans.length})`;
  $('#h-trans').innerHTML = H.trans.map((c, i) => `<tr class="click ${c.status !== 'new' ? 'done' : ''}" data-row="trans:${i}">
    <td><b>${esc(c.student)}</b><small>Gr ${esc(grade(c.grade))} · ${esc(c.teacher || '')}</small></td>
    <td>${when(c)}<small>${c.period === 'afternoon' ? 'Afternoon' : 'Morning'} · ${TYPE[c.change_type]}</small></td>
    <td><small>${esc(c.current_method || '—')}</small><b>→ ${esc(c.new_method)}</b>${c.new_details && c.new_details !== 'Not on pickup list' ? `<small>${esc(c.new_details)}</small>` : ''}</td>
    <td>${c.pickup_person ? `<b>${esc(c.pickup_person)}${c.pickup_pin ? ` <span class="pin sm">${c.pickup_pin}</span>` : ''}</b><small>${esc(c.pickup_relationship || '')}${c.new_details === 'Not on pickup list' ? ' · not on pick-up list' : ''}</small>` : '—'}</td>
    <td>${src(stamp(c.created_at), c.submitted_name)}</td>${fx('trans', i, c.status !== 'new', c.processed_by, c.processed_at)}</tr>`).join('') || empty(6, none);

  $('#c-pick').textContent = `(${H.pick.length})`;
  $('#h-pick').innerHTML = H.pick.map((r, i) => `<tr class="${r.sis_done ? 'done' : ''}">
    <td><b>${esc(r.student)}</b><small>Gr ${esc(grade(r.grade))} · ${esc(r.teacher || '')}</small></td>
    <td><span class="tag ${r.action === 'add' ? 'ok' : ''}">${r.action === 'add' ? 'Add' : 'Remove'}</span>${r.status === 'cancelled' ? '<small>Cancelled</small>' : ''}</td>
    <td><b>${esc([r.first_name, r.last_name].filter(Boolean).join(' '))}${r.pin && r.action === 'add' ? ` <span class="pin sm">${r.pin}</span>` : ''}</b><small>${esc(r.relationship || '')}</small></td>
    <td>${esc(r.phone || '')}<small>${esc(r.email || '')}</small></td>
    <td>${src(stamp(r.created_at), r.submitted_name || r.submitted_by)}${r.comments ? `<small>“${esc(r.comments)}”</small>` : ''}</td>${fx('pick', i, r.sis_done, r.sis_by, r.sis_at)}</tr>`).join('') || empty(6, none);

  $('#h-other-wrap').hidden = !H.other.length;
  $('#c-other').textContent = `(${H.other.length})`;
  $('#h-other').innerHTML = H.other.map((o, i) => `<tr class="${o.sis_done ? 'done' : ''}"><td><b>${esc(o.student)}</b><small>Gr ${esc(grade(o.grade))}</small></td>
    <td style="white-space:pre-wrap">${esc(o.details)}</td><td>${src(stamp(o.created_at), o.created_by)}</td>${fx('other', i, o.sis_done, o.sis_by, o.sis_at)}</tr>`).join('');

  $('#h-sio').innerHTML = H.sio.map((r, i) => {
    const multi = all; const d = new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    return `<tr class="${r.facts_done ? 'done' : ''}">
    <td><b>${tm(r.created_at)}</b><small>${multi || d !== TODAY ? nice(d) + ' · ' : ''}<span class="tag ${KIND[r.kind][1]}" style="margin-top:4px">${KIND[r.kind][0]}</span></small></td>
    <td><b>${esc(r.student)}</b><small>Gr ${esc(grade(r.grade))} · ${esc(r.teacher || '')}</small></td>
    <td>${r.method === 'pin' || r.method === 'office' ? `<b>${esc(r.person_name)}${r.pin ? ` <span class="pin sm">${esc(r.pin)}</span>` : ''}</b><small>${esc(r.relationship || '')}${r.method === 'office' ? ' · entered by office' : ''}</small>` : `<b>Student (Self)</b><small>${HOW[r.method]}</small>`}</td>
    <td>${esc(r.reason || '')}${r.has_signature ? `<small><button class="link" data-sig="${i}" style="padding:0">View Signature</button></small>` : ''}</td>
    <td><button class="btn ghost sm" data-print="${i}">Print</button></td>${fx('sio', i, r.facts_done, r.facts_by, r.facts_at)}</tr>`; }).join('') || empty(6, none);

  const NS = { pending: ['Pending', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', ''] };
  $('#h-notes').innerHTML = H.notes.map((n, i) => `<tr class="${n.sis_done ? 'done' : ''}">
    <td><b>${esc(n.student)}</b><small>ID ${n.student_id} · Gr ${esc(grade(n.grade))}</small></td>
    <td>${n.kind === 'doctor' ? `<span class="tag">Doctor</span><small>${n.files} file${n.files === 1 ? '' : 's'}</small>` : `<span class="tag gray">Parent</span><small>${n.approved_parent_notes} of ${LIMIT} approved</small>`}</td>
    <td>${nice(n.absent_date)}${n.absent_end ? `<small>through ${nice(n.absent_end)}</small>` : ''}</td>
    <td>${esc(n.reason || '')}<small>${esc(n.parent_name || '')} · ${stamp(n.created_at)}</small></td>
    <td><button class="btn ghost sm" data-review="${i}">${NS[n.status][0]}</button></td>
    <td><button class="btn ghost sm" data-dl="${i}">${n.kind === 'doctor' ? 'Download' : 'PDF'}</button></td>${fx('note', i, n.sis_done, n.sis_by, n.sis_at)}</tr>`).join('') || empty(7, none);

  badge('#j-changes', H.trans.filter(c => c.status === 'new').length + H.pick.filter(r => !r.sis_done).length + H.other.filter(o => !o.sis_done).length);
  badge('#j-sio', H.sio.filter(r => !r.facts_done).length);
  badge('#j-notes', H.notes.filter(n => !n.sis_done).length);
}

// ---------- checkboxes ----------
$('#p-dash').addEventListener('change', async e => {
  const cb = e.target.closest('[data-sis]');
  if (cb) {
    const [kind, i] = cb.dataset.sis.split(':'); const on = cb.checked; cb.disabled = true;
    try {
      if (kind === 'trans') await call('staff_transport_set', { p_id: H.trans[i].id, p_status: on ? 'processed' : 'new' });
      if (kind === 'pick') await call('staff_pickup_sis', { p_id: H.pick[i].id, p_done: on });
      if (kind === 'other') await call('staff_other_sis', { p_id: H.other[i].id, p_done: on });
      if (kind === 'sio') await call('staff_signin_facts', { p_id: H.sio[i].id, p_done: on });
      if (kind === 'note') await call('staff_note_sis', { p_id: H.notes[i].id, p_done: on });
      cb.closest('tr').classList.toggle('done', on);
      clearTimeout(homeLoad.t); homeLoad.t = setTimeout(() => homeLoad(true), 1500);
    } catch (x) { cb.checked = !on; toast(emsg(x)); }
    cb.disabled = false;
    return;
  }
  if (e.target.name === 'h-show' || e.target.id === 'h-from' || e.target.id === 'h-to') homeLoad();
});
$('#p-dash').addEventListener('click', async e => {
  if (e.target.closest('input,button,a,select')) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.print) return printSlip(H.sio[+b.dataset.print]);
    if (b.dataset.sig) return showSig(H.sio[+b.dataset.sig]);
    if (b.dataset.review) return openNote(H.notes[+b.dataset.review].id);
    if (b.dataset.dl) return downloadNote(H.notes[+b.dataset.dl], b);
    return;
  }
  const tr = e.target.closest('[data-row]'); if (!tr) return;
  const [k, i] = tr.dataset.row.split(':');
  if (k === 'trans') openChange(H.trans[+i], () => homeLoad(true));
});
async function showSig(r) {
  const d = await call('staff_signin', { p_id: r.id });
  $('#modal').hidden = false;
  $('#modal-in').innerHTML = `<div class="mh"><div><h2 style="margin:0">${KIND[d.kind][0]}</h2><h1 style="font-size:1.7rem">${esc(d.student)}</h1></div><button class="x" id="m-x" aria-label="Close">×</button></div>
    <p>${esc(d.person_name)}${d.pin ? ` <span class="pin sm">${esc(d.pin)}</span>` : ''} · ${stamp(d.created_at)}</p>${d.signature ? `<img class="sigimg" src="${d.signature}" alt="Signature">` : ''}`;
  $('#m-x').onclick = closeModal;
}

// ---------- tardy / early dismissal slip (4" x 2.5" label) ----------
function printSlip(r) {
  const late = r.kind === 'late_in';
  const d = new Date(r.created_at);
  const date = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const who = r.method === 'pin' || r.method === 'office' ? `${r.person_name}${r.relationship ? ' (' + r.relationship + ')' : ''}` : 'Student (self)';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${late ? 'Tardy pass' : 'Early dismissal'}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>@page{size:4in 2.5in;margin:0}*{box-sizing:border-box}html,body{margin:0;width:4in;height:2.5in}
body{font-family:"Source Sans 3",Arial,sans-serif;color:#000;padding:.14in .18in;display:flex;flex-direction:column;gap:.03in;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.h{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #000;padding-bottom:.03in}
.h b{font-family:"Barlow Condensed",Arial Narrow,sans-serif;font-weight:800;font-size:20pt;letter-spacing:.04em;text-transform:uppercase;line-height:1}
.h span{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.n{font-family:"Barlow Condensed",Arial Narrow,sans-serif;font-weight:800;font-size:19pt;line-height:1.05;margin-top:.02in}
.r{font-size:9pt;line-height:1.25}.r b{font-weight:700}
.f{margin-top:auto;display:flex;justify-content:space-between;font-size:8pt;gap:.1in}.f span{border-top:1px solid #000;flex:1;padding-top:1px}
</style></head><body>
<div class="h"><b>${late ? 'Tardy pass' : 'Early dismissal'}</b><span>Cornerstone Christian School</span></div>
<div class="n">${esc(r.student.split(', ').reverse().join(' '))}</div>
<div class="r">Grade ${esc(grade(r.grade))} · ${esc(r.teacher || '')}</div>
<div class="r"><b>${date} · ${late ? 'Arrived' : 'Left'} ${tm(r.created_at)}</b></div>
<div class="r">Reason: ${esc(r.reason || '')}</div>
<div class="r">${late ? 'Signed in by' : 'Picked up by'}: ${esc(who)}</div>
<div class="f"><span>Office</span><span>${late ? 'Teacher' : 'Time out'}</span></div>
<script>document.fonts.ready.then(()=>{setTimeout(()=>{print();},150)});<\/script></body></html>`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:4in;height:2.5in;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => f.remove(), 60000);
}

// ---------- excused note download ----------
const safe = s => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
async function downloadNote(row, btn) {
  btn.disabled = true;
  try {
    const n = await call('staff_note', { p_id: row.id });
    const base = `${safe(n.student.split(' ').slice(-1)[0])}_${safe(n.student.split(' ')[0])}_${n.student_id}_${n.absent_date}`;
    if (n.kind === 'doctor') {
      if (!n.files.length) return toast('No file was attached to this note.');
      n.files.forEach((f, i) => {
        const ext = (f.filename.match(/\.\w+$/) || ['.' + (f.mime.split('/')[1] || 'bin')])[0];
        const a = document.createElement('a'); a.href = URL.createObjectURL(b64Blob(f.data, f.mime));
        a.download = `${base}_doctors_note${n.files.length > 1 ? '_' + (i + 1) : ''}${ext}`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      });
    } else notePdf(n, `${base}_excused_note.pdf`);
  } catch (x) { toast(emsg(x)); }
  btn.disabled = false;
}
function notePdf(n, filename) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), M = 54;
  doc.setFillColor(20, 18, 19); doc.rect(0, 0, W, 70, 'F');
  doc.setFillColor(228, 1, 13); doc.rect(0, 70, W, 4, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text('CORNERSTONE CHRISTIAN SCHOOL', M, 42);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.text('9039 Beach Boulevard · Jacksonville, FL 32216 · (904) 730-5500', M, 58);
  doc.setTextColor(20, 18, 19); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('Parent Excused Absence Note', M, 118);
  // mm/dd/yyyy dates (with time where it matters), New York time.
  const md = s => { const [y, m, d] = String(s).slice(0, 10).split('-'); return `${m}/${d}/${y}`; };
  const mdt = t => t ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(',', '') : '';
  const absent = md(n.absent_date) + (n.absent_end ? ' – ' + md(n.absent_end) : '');
  const rows = [
    ["Student's Name", n.student], ['Student ID', String(n.student_id)], ['Grade / Homeroom', `${grade(n.grade)} · ${n.teacher || ''}`],
    ['Absent Date', absent], ['Absent Reason', n.reason + (n.reason_other ? ': ' + n.reason_other : '')],
    ["Parent's Name", n.parent_name || ''], ["Parent's Phone", n.parent_phone || ''],
    ['Submitted', mdt(n.created_at) + ' (Cornerstone Parent Portal)'],
    ['Office Review', n.status === 'pending' ? 'Pending' : `${n.status[0].toUpperCase() + n.status.slice(1)} by ${n.reviewed_by || ''} ${n.reviewed_at ? '· ' + mdt(n.reviewed_at) : ''}`],
    ['Semester', String(n.semester || '').replace(/^(\d{4})-(\d{2})\s*Semester\s*(\d)$/i, (_, a, b, c) => `${a}-${a.slice(0, 2)}${b} (Semester ${c})`)]
  ];
  let y = 150; doc.setFontSize(11);
  for (const [k, v] of rows) {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(107, 100, 102); doc.text(k, M, y);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 18, 19);
    const lines = doc.splitTextToSize(String(v || '—'), W - M - 190); doc.text(lines, M + 150, y); y += 22 * Math.max(1, lines.length);
  }
  y += 14; doc.setFont('helvetica', 'normal'); doc.setTextColor(107, 100, 102); doc.text("Parent's Signature", M, y);
  doc.setDrawColor(200, 195, 195); doc.rect(M + 150, y - 14, 300, 96);
  if (n.signature) { try { doc.addImage(n.signature, 'PNG', M + 154, y - 10, 292, 88); } catch {} }
  doc.setFontSize(8.5); doc.setTextColor(107, 100, 102);
  doc.text('A parent/guardian may submit up to five (5) excused notes per student per semester. Notes must be submitted within five (5) school days of the absence.', M, 740, { maxWidth: W - 2 * M });
  doc.save(filename);
}

// ---------- notify the parent when a note is approved / rejected ----------
async function pushTo(audience, title, body, url) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(PUSH_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + data.session.access_token, apikey: SB_KEY_PUB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, url, audience }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not send.');
  return j;
}
const SB_KEY_PUB = 'sb_publishable_hnUHrqYS2un679djbzsXxg_oLYDQDp0';
window.noteReviewed = async (id, status) => {
  if (!$('#p-dash').hidden) homeLoad(true);
  if (status === 'pending') return;
  try {
    const n = await call('staff_note', { p_id: id });
    const day = new Date(n.absent_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    await pushTo({ type: 'note', note_id: id }, status === 'approved' ? 'Absence excused' : 'Excused note not approved',
      status === 'approved' ? `${n.student.split(' ')[0]}'s absence on ${day} was marked excused.` : `${n.student.split(' ')[0]}'s note for ${day} was not approved.${n.review_note ? ' ' + n.review_note : ''}`, '/#history');
  } catch {}
};

// ---------- enter a change ----------
let ESTU = null;
const PM_OPTS = ['Car Rider', 'Bus Rider', 'Afternoon Extended Care', 'Student Walker', 'Student Driver and/or Passenger', 'City Bus Rider'];
const AM_OPTS = ['Car Rider', 'Bus Rider', 'Morning Extended Care', 'Student Walker'];
function pickEStudent(s) {
  ESTU = s;
  $('#e-student').innerHTML = `<div class="card" style="background:var(--bg)"><b class="t">${esc(s.name)} · ID ${s.student_id} · Grade ${esc(grade(s.grade))}</b>
    <dl class="kv" style="padding:0"><dt>Morning</dt><dd>${esc(s.am || '—')}</dd><dt>Afternoon</dt><dd>${esc(s.pm || '—')}</dd></dl></div>`;
  drawEFields();
}
const people = s => [...s.guardians.filter(g => g.name).map(g => ({ ...g, g: 1 })), ...s.pickups.filter(p => p.name)];
const personOpts = (s, extra = '') => '<option value="">Choose…</option>' + people(s).map((p, i) => `<option value="${i}">${esc(p.name)}${p.relationship ? ' (' + esc(p.relationship) + ')' : ''}${p.pin ? ' · PIN ' + p.pin : ''}</option>`).join('') + extra + '<option value="other">Someone Else…</option>';
function drawEFields() {
  const t = $('#e-type').value, s = ESTU, F = $('#e-fields'); $('#e-err').textContent = '';
  if (!t) return F.innerHTML = '';
  if (!s) return F.innerHTML = '<p class="muted">Choose a student first.</p>';
  const nowT = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
  if (t === 'transport') F.innerHTML = `<div class="two"><label>Applies To <select id="ef-period"><option value="afternoon">Afternoon Dismissal</option><option value="morning">Morning Arrival</option></select></label>
      <label>How Long <select id="ef-ct"><option value="one_day">One Day</option><option value="date_range">Date Range</option><option value="permanent">Permanent</option></select></label></div>
    <div class="two"><label>Date <input type="date" id="ef-start" value="${TODAY}"></label><label id="ef-end-l" hidden>Through <input type="date" id="ef-end"></label></div>
    <label>New Method <select id="ef-method"></select></label>
    <label>Details <small class="muted">(bus stop, care location…)</small><input type="text" id="ef-details" list="ef-stops"></label>
    <label>Picked Up By <select id="ef-person">${personOpts(s)}</select></label>
    <div id="ef-other" class="two" hidden><label>Name <input type="text" id="ef-oname"></label><label>Relationship <input type="text" id="ef-orel"></label></div>
    <label>Notes <input type="text" id="ef-comments"></label>`;
  if (t === 'pickup_add') F.innerHTML = `<div class="two"><label>First Name <input type="text" id="ef-first"></label><label>Last Name <input type="text" id="ef-last"></label></div>
    <div class="two"><label>Relationship <input type="text" id="ef-rel"></label><label>Cell Phone <input type="tel" id="ef-phone"></label></div>
    <label>Email <small class="muted">(optional)</small><input type="email" id="ef-email"></label><label>Notes <input type="text" id="ef-comments"></label>`;
  if (t === 'pickup_remove') F.innerHTML = `<label>Remove <select id="ef-rm"><option value="">Choose…</option>${s.pickups.map(p => `<option value="${esc(p.key)}">${esc(p.name)}${p.relationship ? ' (' + esc(p.relationship) + ')' : ''}</option>`).join('')}</select></label><label>Notes <input type="text" id="ef-comments"></label>`;
  if (t === 'late_in' || t === 'early_out') F.innerHTML = `<div class="two"><label>${t === 'late_in' ? 'Signed in by' : 'Picked up by'} <select id="ef-person">${personOpts(s, t === 'late_in' ? '<option value="self">Student (Self)</option>' : '')}</select></label>
      <label>Time <input type="time" id="ef-time" value="${nowT}"></label></div>
    <div id="ef-other" class="two" hidden><label>Name <input type="text" id="ef-oname"></label><label>Relationship <input type="text" id="ef-orel"></label></div>
    <label>Reason <input type="text" id="ef-reason" maxlength="300"></label>`;
  if (t === 'other') F.innerHTML = `<label>Details <textarea id="ef-details" rows="3" maxlength="2000" placeholder="What changed? e.g. new home address, custody paperwork, allergy update…"></textarea></label>`;
  if ($('#ef-period')) {
    const sync = () => { const am = $('#ef-period').value === 'morning'; $('#ef-method').innerHTML = (am ? AM_OPTS : PM_OPTS).map(o => `<option>${o}</option>`).join(''); $('#ef-end-l').hidden = $('#ef-ct').value !== 'date_range'; };
    $('#ef-period').onchange = $('#ef-ct').onchange = sync; sync();
  }
  if ($('#ef-person')) $('#ef-person').onchange = () => $('#ef-other').hidden = $('#ef-person').value !== 'other';
}
$('#e-type').addEventListener('change', drawEFields);
$('#e-save').onclick = async () => {
  const t = $('#e-type').value, s = ESTU, err = $('#e-err'); err.textContent = '';
  if (!s) return err.textContent = 'Choose a student.';
  if (!t) return err.textContent = "Choose what's changing.";
  const v = id => ($(id)?.value || '').trim();
  const p = { type: t, student_id: s.student_id };
  const person = () => {
    const sel = v('#ef-person');
    if (sel === 'other') return { person_name: v('#ef-oname'), relationship: v('#ef-orel') };
    if (sel === 'self') return { person_name: s.name.split(', ').reverse().join(' ') + ' (student)', relationship: 'Self' };
    const x = people(s)[+sel]; return x ? { person_name: x.name, relationship: x.relationship, person_key: x.key, phone: x.phone } : {};
  };
  if (t === 'transport') {
    const pr = person();
    Object.assign(p, { period: v('#ef-period'), change_type: v('#ef-ct'), start_date: v('#ef-start'), end_date: v('#ef-end'), new_method: v('#ef-method'), new_details: v('#ef-details'),
      pickup_person: pr.person_name || '', pickup_relationship: pr.relationship || '', pickup_phone: pr.phone || '', comments: v('#ef-comments') });
  }
  if (t === 'pickup_add') Object.assign(p, { first_name: v('#ef-first'), last_name: v('#ef-last'), relationship: v('#ef-rel'), phone: v('#ef-phone'), email: v('#ef-email'), comments: v('#ef-comments') });
  if (t === 'pickup_remove') { if (!v('#ef-rm')) return err.textContent = 'Choose who to remove.'; Object.assign(p, { person_key: v('#ef-rm'), comments: v('#ef-comments') }); }
  if (t === 'late_in' || t === 'early_out') { const pr = person(); if (!pr.person_name) return err.textContent = 'Choose who signed.'; Object.assign(p, pr, { time: v('#ef-time'), reason: v('#ef-reason') }); }
  if (t === 'other') p.details = v('#ef-details');
  const b = $('#e-save'); b.disabled = true;
  try {
    const r = await call('staff_enter_change', { p });
    toast(r.pin ? `Saved. PIN for this person: ${r.pin}` : 'Saved — added to the list to enter in FACTS.');
    if (r.pin) alert(`Pick-up person added. Their PIN is ${r.pin}.`);
    $('#e-type').value = ''; $('#e-fields').innerHTML = '';
    if (window.loadStudent) loadStudent(s.student_id);
  } catch (x) {
    const m = { missing_fields: 'Fill in every field.', need_name: 'Enter first and last name.', need_phone: 'Enter a 10-digit phone.', already_on_list: 'That person is already on the list.',
      cant_remove_guardian: "Parents/guardians can't be removed here.", not_on_list: 'That person is no longer on the list.', pick_student: 'Choose a student.' }[x.message];
    err.textContent = m || emsg(x);
  }
  b.disabled = false;
};

// ---------- parent alerts ----------
let AINFO = null, ASTU = null;
window.alertInfo = alertInfo;
async function alertInfo() {
  call('staff_settings').then(x => { $('#a-paused').hidden = x.alerts_paused !== true; }).catch(() => {});
  try {
    AINFO = await call('staff_push_info');
    $('#a-info').textContent = `${AINFO.devices} phone${AINFO.devices === 1 ? '' : 's'} from ${AINFO.families} famil${AINFO.families === 1 ? 'y' : 'ies'} have alerts turned on. Alerts reach parents who added the app to their phone and turned alerts on.`;
    $('#a-log').innerHTML = AINFO.log.map(l => `<div class="row"><div class="txt"><b>${esc(l.title)}</b><p>${esc(l.body || '')} · ${stamp(l.created_at)} · sent to ${l.sent}</p></div></div>`).join('');
  } catch {}
}
$('#a-aud').onchange = () => {
  const a = $('#a-aud').value;
  $('#a-pick-l').hidden = !(a === 'grade' || a === 'teacher' || a === 'transport'); $('#a-stu-wrap').hidden = a !== 'student';
  $('#a-bus-l').hidden = true;
  if (a === 'transport') {
    $('#a-pick').innerHTML = (AINFO?.methods || []).filter(Boolean).sort().map(m => `<option>${esc(m)}</option>`).join('');
    const syncBus = () => { const bus = $('#a-pick').value === 'Bus Rider'; $('#a-bus-l').hidden = !bus;
      $('#a-bus').innerHTML = '<option value="">All Buses</option>' + (AINFO?.buses || []).sort((x, y) => +x - +y).map(b => `<option value="${esc(b)}">Bus ${esc(b)}</option>`).join(''); };
    $('#a-pick').onchange = syncBus; syncBus();
  } else $('#a-pick').onchange = null;
  if (a === 'grade') $('#a-pick').innerHTML = (AINFO?.grades || []).sort((x, y) => (x === 'K' ? -1 : y === 'K' ? 1 : +x - +y)).map(g => `<option value="${esc(g)}">${esc(g === 'K' ? 'Kindergarten' : 'Grade ' + String(g).replace(/^0/, ''))}</option>`).join('');
  if (a === 'teacher') $('#a-pick').innerHTML = (AINFO?.teachers || []).sort().map(t => `<option>${esc(t)}</option>`).join('');
};
$('#a-q').addEventListener('input', debounce(async () => {
  const q = $('#a-q').value.trim(); if (q.length < 2) return $('#a-hits').innerHTML = '';
  const rows = (await call('staff_students', { p_q: q })).filter(s => s.active).slice(0, 6);
  $('#a-hits').innerHTML = rows.map((s, i) => `<button type="button" data-i="${i}">${esc(s.name)}<small>Gr ${esc(grade(s.grade))}</small></button>`).join('');
  $('#a-hits').onclick = e => { const b = e.target.closest('button'); if (b) { ASTU = rows[+b.dataset.i]; $('#a-q').value = ASTU.name; $('#a-hits').innerHTML = ''; } };
}));
$('#a-send').onclick = async () => {
  const title = $('#a-title').value.trim(), body = $('#a-body').value.trim(), a = $('#a-aud').value;
  if (!title) return toast('Add a title.');
  const aud = a === 'all' ? { type: 'all' } : a === 'transport' ? { type: 'transport', method: $('#a-pick').value, bus: $('#a-pick').value === 'Bus Rider' ? $('#a-bus').value : '' } : a === 'grade' ? { type: 'grade', grades: [$('#a-pick').value] } : a === 'teacher' ? { type: 'teacher', teacher: $('#a-pick').value } : { type: 'student', student_id: ASTU?.student_id };
  if (a === 'student' && !ASTU) return toast('Choose a student.');
  const label = a === 'all' ? 'all families' : a === 'student' ? `${ASTU.name}'s family`
    : a === 'transport' ? `families of today's ${$('#a-pick').value === 'Bus Rider' && $('#a-bus').value ? 'Bus ' + $('#a-bus').value + ' riders' : $('#a-pick').value + 's'}` : $('#a-pick').selectedOptions[0]?.textContent;
  if (!confirm(`Send "${title}" to ${label}?`)) return;
  const b = $('#a-send'); b.disabled = true; $('#a-res').textContent = 'Sending…';
  try { const r = await pushTo(aud, title, body, '/'); $('#a-res').textContent = `Sent to ${r.sent} phone${r.sent === 1 ? '' : 's'}.`; $('#a-title').value = $('#a-body').value = ''; alertInfo(); }
  catch (x) { $('#a-res').textContent = x.message; }
  b.disabled = false;
};

// Refresh the home screen every 30 seconds while it's open.
const _homeLoad = homeLoad;
homeLoad = async (quiet) => { await _homeLoad(quiet); };
setInterval(() => { if (!document.hidden && !$('#p-dash').hidden && $('#modal').hidden) _homeLoad(true); }, 30000);
