// Office home screen: Change requests · Late sign-in & early sign-out · Excused notes · Enter a change · Parent alerts.
// Uses helpers from office.js ($, call, esc, nice, stamp, grade, toast, openNote, openChange, closeModal, b64Blob, ...).
const PUSH_URL = 'https://cvvdwhgdiqnoqgxtgzfw.supabase.co/functions/v1/portal-push';
const H = { trans: [], pick: [], other: [], sio: [], notes: [] };
const showMode = () => 'todo';
const fx = (kind, i, done, by, at, lock) => `<td class="c"><input type="checkbox" class="fx" data-sis="${kind}:${i}" ${done ? 'checked' : ''}${lock ? ` disabled title="${lock}"` : ''} aria-label="Entered in FACTS">${lock ? '<small>Review first</small>' : ''}${done && by ? `<small>${esc(String(by).split('@')[0])}${at ? ' · ' + stamp(at) : ''}</small>` : ''}</td>`;
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
  drawBanAlerts();
  refreshBadges();
}

function drawHome() {
  const empty = (n, t) => `<tr><td colspan="${n}" class="empty">${t}</td></tr>`;
  const all = showMode() === 'all';
  const none = all ? 'Nothing in these dates.' : 'All caught up.';
  const badge = (id, n) => { const el = $(id); if (!el) return; el.hidden = !n; el.textContent = n; };
  const todo = a => a.filter(x => x.sis_done === false || x.facts_done === false || x.status === 'new').length;

  $('#c-trans').textContent = `(${H.trans.length})`;
  $('#h-trans').innerHTML = H.trans.map((c, i) => `<tr class="click ${c.status !== 'new' ? 'is-done' : ''}" data-row="trans:${i}">
    <td><b>${esc(c.student)}</b><small>Gr ${esc(grade(c.grade))} · ${esc(c.teacher || '')}</small></td>
    <td>${when(c)}<small>${c.period === 'afternoon' ? 'Afternoon' : 'Morning'} · ${TYPE[c.change_type]}</small></td>
    <td><small>${esc(c.current_method || '—')}</small><b>→ ${esc(c.new_method)}</b>${c.new_details && c.new_details !== 'Not on pickup list' ? `<small>${esc(c.new_details)}</small>` : ''}</td>
    <td>${c.pickup_person ? `<b>${esc(c.pickup_person)}${c.pickup_pin ? ` <span class="pin sm">${c.pickup_pin}</span>` : ''}</b><small>${esc(c.pickup_relationship || '')}${c.new_details === 'Not on pickup list' ? ' · not on pick-up list' : ''}</small>` : '—'}</td>
    <td>${src(stamp(c.created_at), c.submitted_name)}</td>${fx('trans', i, c.status !== 'new', c.processed_by, c.processed_at)}</tr>`).join('') || empty(6, none);

  $('#c-pick').textContent = `(${H.pick.length})`;
  $('#h-pick').innerHTML = H.pick.map((r, i) => `<tr class="${r.sis_done ? 'is-done' : ''}">
    <td><b>${esc(r.student)}</b><small>Gr ${esc(grade(r.grade))} · ${esc(r.teacher || '')}</small></td>
    <td><span class="tag ${r.action === 'add' ? 'ok' : ''}">${r.action === 'add' ? 'Add' : 'Remove'}</span>${pickState(r)}</td>
    <td><b>${esc([r.first_name, r.last_name].filter(Boolean).join(' '))}${r.pin && r.action === 'add' ? ` <span class="pin sm">${r.pin}</span>` : ''}</b><small>${esc(r.relationship || '')}</small></td>
    <td>${esc(r.phone || '')}<small>${esc(r.email || '')}</small></td>
    <td>${src(stamp(r.created_at), r.submitted_name || r.submitted_by)}${r.comments ? `<small>“${esc(r.comments)}”</small>` : ''}</td>${fx('pick', i, r.sis_done, r.sis_by, r.sis_at)}</tr>`).join('') || empty(6, none);

  $('#h-other-wrap').hidden = !H.other.length;
  $('#c-other').textContent = `(${H.other.length})`;
  $('#h-other').innerHTML = H.other.map((o, i) => `<tr class="${o.sis_done ? 'is-done' : ''}"><td><b>${esc(o.student)}</b><small>Gr ${esc(grade(o.grade))}</small></td>
    <td style="white-space:pre-wrap">${esc(o.details)}</td><td>${src(stamp(o.created_at), o.created_by)}</td>${fx('other', i, o.sis_done, o.sis_by, o.sis_at)}</tr>`).join('');

  $('#h-sio').innerHTML = H.sio.map((r, i) => {
    const multi = all; const d = new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    return `<tr class="${r.facts_done ? 'is-done' : ''}">
    <td><b>${tm(r.created_at)}</b><small>${multi || d !== TODAY ? nice(d) + ' · ' : ''}<span class="tag ${KIND[r.kind][1]}" style="margin-top:4px">${KIND[r.kind][0]}</span></small></td>
    <td><b>${esc(r.student)}</b><small>Gr ${esc(grade(r.grade))} · ${esc(r.teacher || '')}</small></td>
    <td>${r.method === 'pin' || r.method === 'office' ? `<b>${esc(r.person_name)}${r.pin ? ` <span class="pin sm">${esc(r.pin)}</span>` : ''}</b><small>${esc(r.relationship || '')}${r.method === 'office' ? ' · entered by office' : ''}</small>` : `<b>Student (Self)</b><small>${HOW[r.method]}</small>`}</td>
    <td>${esc(r.reason || '')}${r.has_signature ? `<small><button class="link" data-sig="${i}" style="padding:0">View Signature</button></small>` : ''}</td>
    <td><button class="btn ghost sm" data-print="${i}">Print</button></td>${fx('sio', i, r.facts_done, r.facts_by, r.facts_at)}</tr>`; }).join('') || empty(6, none);

  const NS = { pending: ['Pending', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', ''] };
  $('#h-notes').innerHTML = H.notes.map((n, i) => `<tr class="${n.sis_done ? 'is-done' : ''}">
    <td><b>${esc(n.student)}</b><small>ID ${n.student_id} · Gr ${esc(grade(n.grade))}</small></td>
    <td>${n.kind === 'doctor' ? `<span class="tag">Doctor</span><small>${n.files} file${n.files === 1 ? '' : 's'}</small>` : `<span class="tag gray">Parent</span><small>${n.approved_parent_notes} of ${LIMIT} approved</small>`}</td>
    <td>${nice(n.absent_date)}${n.absent_end ? `<small>through ${nice(n.absent_end)}</small>` : ''}</td>
    <td>${esc(n.reason || '')}<small>${esc(n.parent_name || '')} · ${stamp(n.created_at)}</small></td>
    <td><button class="btn ghost sm" data-review="${i}">${NS[n.status][0]}</button></td>
    <td><button class="btn ghost sm" data-dl="${i}">${n.kind === 'doctor' ? 'Download' : 'PDF'}</button></td>${fx('note', i, n.sis_done, n.sis_by, n.sis_at, n.status === 'pending' && !n.sis_done ? 'Approve or reject this note first' : '')}</tr>`).join('') || empty(7, none);

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
      cb.closest('tr').classList.toggle('is-done', on);
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
${late ? '' : `<div class="f"><span>Office</span><span>Time out</span></div>`}
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
// One note as a jsPDF document. filename → saves it; no filename → returns the document (for combining).
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
  doc.text(n.kind === 'doctor' ? "Doctor's Excused Absence Note" : 'Parent Excused Absence Note', M, 118);
  // mm/dd/yyyy dates (with time where it matters), New York time.
  const md = s => { const [y, m, d] = String(s).slice(0, 10).split('-'); return `${m}/${d}/${y}`; };
  const mdt = t => t ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(',', '') : '';
  const absent = md(n.absent_date) + (n.absent_end ? ' – ' + md(n.absent_end) : '');
  const rows = [
    ["Student's Name", n.student], ['Student ID', String(n.student_id)], ['Grade / Homeroom', `${grade(n.grade)} · ${n.teacher || ''}`],
    ['Absent Date', absent], ['Absent Reason', n.reason + (n.reason_other ? ': ' + n.reason_other : '')],
    ...(n.kind === 'doctor' ? [['Doctor / Office', n.provider || ''], ['Attached Files', n.files && n.files.length ? n.files.map(f => f.filename).join(', ') : 'None']] : []),
    ["Parent's Name", n.parent_name || ''], ["Parent's Phone", n.parent_phone || ''],
    ...(n.comments ? [['Parent Comments', n.comments]] : []),
    ...(n.review_note ? [['Office Note', n.review_note]] : []),
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
  if (n.kind !== 'doctor' || n.signature) {
    y += 14; doc.setFont('helvetica', 'normal'); doc.setTextColor(107, 100, 102); doc.text("Parent's Signature", M, y);
    doc.setDrawColor(200, 195, 195); doc.rect(M + 150, y - 14, 300, 96);
    if (n.signature) { try { doc.addImage(n.signature, 'PNG', M + 154, y - 10, 292, 88); } catch {} }
  }
  doc.setFontSize(8.5); doc.setTextColor(107, 100, 102);
  doc.text(n.kind === 'doctor' ? "Doctor's notes do not count toward the five (5) parent notes per semester. The doctor's note file(s) follow this page."
    : 'A parent/guardian may submit up to five (5) excused notes per student per semester. Notes must be submitted within five (5) school days of the absence.', M, 740, { maxWidth: W - 2 * M });
  if (!filename) return doc;
  doc.save(filename);
}

// ---------- several notes → one PDF (note pages + doctor's note photos/PDFs) ----------
let PDFLIB = null;
const loadPdfLib = () => PDFLIB || (PDFLIB = new Promise((ok, no) => {
  const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  sc.onload = () => ok(window.PDFLib); sc.onerror = () => { PDFLIB = null; no(new Error('Could not load the PDF tool. Check the internet connection and try again.')); };
  document.head.appendChild(sc);
}));
async function imageToPng(blob) {
  const img = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
  return new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
}
async function notesPdf(ids, filename, progress) {
  const { bytes, skipped } = await notesPdfBytes(ids, progress);
  savePdf(bytes, filename);
  return skipped;
}
function savePdf(bytes, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function notesPdfBytes(ids, progress) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const out = await PDFDocument.create(); const font = await out.embedFont(StandardFonts.Helvetica);
  const skipped = [];
  for (let k = 0; k < ids.length; k++) {
    progress && progress(k + 1, ids.length);
    const n = await call('staff_note', { p_id: ids[k] });
    const one = await PDFDocument.load(notePdf(n).output('arraybuffer'));
    (await out.copyPages(one, one.getPageIndices())).forEach(pg => out.addPage(pg));
    for (const f of (n.kind === 'doctor' ? n.files : [])) {
      try {
        const bytes = Uint8Array.from(atob(f.data), ch => ch.charCodeAt(0));
        if (f.mime === 'application/pdf') {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg));
          continue;
        }
        const im = f.mime === 'image/jpeg' ? await out.embedJpg(bytes) : f.mime === 'image/png' ? await out.embedPng(bytes) : await out.embedPng(await imageToPng(new Blob([bytes], { type: f.mime })));
        const pg = out.addPage([612, 792]); const M = 36, cap = 18;
        const sc = Math.min((612 - 2 * M) / im.width, (792 - 2 * M - cap) / im.height, 1);
        pg.drawText(`${n.student} · Doctor's note · ${f.filename}`, { x: M, y: 792 - M + 4, size: 9, font, color: rgb(.42, .39, .4) });
        pg.drawImage(im, { x: (612 - im.width * sc) / 2, y: 792 - M - cap - im.height * sc, width: im.width * sc, height: im.height * sc });
      } catch { skipped.push(`${n.student}: ${f.filename}`); }
    }
  }
  return { bytes: await out.save(), skipped };
}

// ---------- manual alerts (Settings → Alerts) ----------
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
  // The parent's "Absence Excused" push is queued by the database when a note is approved.
  if (!$('#p-dash').hidden) homeLoad(true);
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
let STOPS = null;
const busStops = async () => STOPS || (STOPS = await call('staff_bus_stop_list'));
function drawEFields() {
  const t = $('#e-type').value, s = ESTU, F = $('#e-fields'); $('#e-err').textContent = '';
  if (!t) return F.innerHTML = '';
  if (!s) return F.innerHTML = '<p class="muted">Choose a student first.</p>';
  const nowT = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
  if (t === 'transport') F.innerHTML = `<div class="two"><label>Applies To <select id="ef-period"><option value="afternoon">Afternoon Dismissal</option><option value="morning">Morning Arrival</option></select></label>
      <label>How Long <select id="ef-ct"><option value="one_day">One Day</option><option value="date_range">Date Range</option><option value="weekly">Repeating (Weekly)</option><option value="permanent">Permanent</option></select></label></div>
    <fieldset id="ef-days" class="days" hidden><legend>Which days?</legend>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => `<label><input type="checkbox" value="${i + 1}"><span>${d}</span></label>`).join('')}</fieldset>
    <label id="ef-every-l" hidden>Repeats <select id="ef-every"><option value="1">Every Week</option><option value="2">Every Other Week (starting the week of the start date)</option></select></label>
    <div class="two"><label><span id="ef-start-t">Date</span> <input type="date" id="ef-start" value="${TODAY}"></label><label id="ef-end-l" hidden><span id="ef-end-t">Through</span> <input type="date" id="ef-end"></label></div>
    <p class="small" id="ef-next" hidden style="margin:0;font-weight:700"></p>
    <label>New Method <select id="ef-method"></select></label>
    <label id="ef-stop-l" hidden>Bus Stop <small class="muted">(required — afternoon drop-off order)</small><select id="ef-stop"><option value="">Loading stops…</option></select></label>
    <label id="ef-care-l" hidden>Afterschool Care Location <select id="ef-care"><option value="Afterschool Care - SP">Afterschool Care - SP</option><option value="Afterschool Care - KHA">Afterschool Care - KHA</option></select></label>
    <label id="ef-drv-l" hidden>Student Driver's Full Name <input type="text" id="ef-drv" maxlength="120"></label>
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
    const syncM = () => { const m = $('#ef-method').value, am = $('#ef-period').value === 'morning';
      $('#ef-stop-l').hidden = m !== 'Bus Rider'; $('#ef-care-l').hidden = am || m !== 'Afternoon Extended Care'; $('#ef-drv-l').hidden = m !== 'Student Driver and/or Passenger'; };
    const sync = () => { const am = $('#ef-period').value === 'morning'; $('#ef-method').innerHTML = (am ? AM_OPTS : PM_OPTS).map(o => `<option>${o}</option>`).join(''); const ct = $('#ef-ct').value; $('#ef-end-l').hidden = ct !== 'date_range' && ct !== 'weekly'; $('#ef-days').hidden = $('#ef-every-l').hidden = ct !== 'weekly'; efNext();
      $('#ef-end-t').textContent = ct === 'weekly' ? 'Until (optional — blank keeps it going)' : 'Through'; $('#ef-start-t').textContent = ct === 'weekly' || ct === 'permanent' ? 'Starting' : ct === 'date_range' ? 'From' : 'Date'; syncM(); };
    $('#ef-period').onchange = $('#ef-ct').onchange = sync; $('#ef-method').onchange = syncM;
    $$('#ef-days input').forEach(i => i.onchange = efNext); $('#ef-every').onchange = $('#ef-start').onchange = $('#ef-end').onchange = efNext; sync();
    busStops().then(stops => { if (!$('#ef-stop')) return; const buses = [...new Set(stops.map(x => x.bus))];
      $('#ef-stop').innerHTML = '<option value="">Choose a Stop…</option>' + buses.map(b => `<optgroup label="${esc(b)}">${stops.filter(x => x.bus === b).map(x => `<option value="${esc(x.stop)}">${esc(x.label)}</option>`).join('')}</optgroup>`).join(''); })
      .catch(() => { if ($('#ef-stop')) $('#ef-stop').innerHTML = '<option value="">Could not load stops — refresh the page</option>'; });
  }
  if ($('#ef-person')) $('#ef-person').onchange = () => $('#ef-other').hidden = $('#ef-person').value !== 'other';
}
// Preview the next dates a repeating change applies (weeks counted from the start date's week).
function efNext() {
  const el = $('#ef-next'); if (!el) return;
  const weekly = $('#ef-ct').value === 'weekly', days = $$('#ef-days input:checked').map(i => +i.value), n = +$('#ef-every').value, start = $('#ef-start').value, end = $('#ef-end').value;
  const out = [];
  if (weekly && start && days.length) {
    const mon = x => { const y = new Date(x); y.setDate(y.getDate() - ((y.getDay() + 6) % 7)); y.setHours(12, 0, 0, 0); return y; };
    const d = new Date(start + 'T12:00:00'), m0 = mon(d);
    for (let i = 0; i < 400 && out.length < 4; i++, d.setDate(d.getDate() + 1)) {
      if (end && d.toLocaleDateString('en-CA') > end) break;
      const iso = ((d.getDay() + 6) % 7) + 1, wk = Math.round((mon(d) - m0) / 6048e5);
      if (days.includes(iso) && wk % n === 0) out.push(`${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getMonth() + 1}/${d.getDate()}`);
    }
  }
  el.hidden = !out.length; el.textContent = out.length ? `Next: ${out.join(' · ')} …` : '';
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
    const m = v('#ef-method'); let details = '';
    if (m === 'Bus Rider') { details = v('#ef-stop'); if (!details) return err.textContent = 'Choose a bus stop.'; }
    if (m === 'Afternoon Extended Care' && v('#ef-period') === 'afternoon') details = v('#ef-care');
    if (m === 'Student Driver and/or Passenger') { if (!v('#ef-drv')) return err.textContent = "Enter the student driver's full name."; details = 'Student driver: ' + v('#ef-drv'); }
    const ct = v('#ef-ct'), weekdays = ct === 'weekly' ? $$('#ef-days input:checked').map(i => +i.value) : [];
    if (ct === 'weekly' && !weekdays.length) return err.textContent = 'Pick at least one day of the week.';
    Object.assign(p, { period: v('#ef-period'), change_type: ct, start_date: v('#ef-start'), end_date: v('#ef-end'), weekdays, week_interval: ct === 'weekly' ? +v('#ef-every') : 1, new_method: m, new_details: details, comments: v('#ef-comments') });
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
      cant_remove_guardian: "Parents/guardians can't be removed here.", not_on_list: 'That person is no longer on the list.', pick_student: 'Choose a student.', need_bus: 'Choose a bus stop from the list.', need_weekdays: 'Pick at least one day of the week.', bad_range: 'Check the dates — the end date must be on or after the start date.' }[x.message];
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
    $('#a-info').textContent = `Sends a push alert to the ${AINFO.devices} phone${AINFO.devices === 1 ? '' : 's'} (${AINFO.families} famil${AINFO.families === 1 ? 'y' : 'ies'}) with alerts turned on, plus an email and a text to every parent/guardian on file for the families you pick.`;
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
  try {
    // Email + text are queued first (they reach every parent on file); then the push alert to phones with the app.
    const m = await call('staff_message_send', { p_title: title, p_body: body, p_aud: aud });
    let push = '';
    try { const r = await pushTo(aud, title, body, '/'); push = `${r.sent} push alert${r.sent === 1 ? '' : 's'}, `; } catch (x) { push = `push alerts failed (${x.message}), `; }
    $('#a-res').textContent = `Sending: ${push}${m.emails} email${m.emails === 1 ? '' : 's'}, ${m.texts} text${m.texts === 1 ? '' : 's'}.`;
    $('#a-title').value = $('#a-body').value = ''; alertInfo();
  }
  catch (x) { $('#a-res').textContent = emsg(x); }
  b.disabled = false;
};

// Refresh the home screen every 30 seconds while it's open.
const _homeLoad = homeLoad;
homeLoad = async (quiet) => { await _homeLoad(quiet); };
setInterval(() => { if (!document.hidden && !$('#p-dash').hidden && $('#modal').hidden) _homeLoad(true); }, 30000);


// ---------- BANNED person alerts (kiosk PIN, car line, extended care) ----------
const BAN_PLACE = { kiosk: 'Front office kiosk', carline: 'Car line', care: 'Extended care' };
async function drawBanAlerts() {
  let list = []; try { list = await call('staff_ban_alerts'); } catch { return; }
  $('#sec-ban').hidden = !list.length;
  $('#ban-list').innerHTML = list.map(a => `<div class="row banned"><div class="txt"><b>${esc(a.person)}${a.relationship ? ' (' + esc(a.relationship) + ')' : ''} — BANNED for <a href="#student?id=${a.student_id}">${esc(a.student)}</a></b>
      <p>${esc(BAN_PLACE[a.place] || a.place)} · ${esc(a.detail || '')} · ${stamp(a.at)}${a.by ? ' · ' + esc(String(a.by).split('@')[0]) : ''}</p></div>
      <button class="btn ghost sm" data-ban-seen="${a.id}" type="button">Seen</button></div>`).join('');
}
$('#ban-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-ban-seen]'); if (!b) return;
  b.disabled = true; try { await call('staff_ban_alert_seen', { p_id: +b.dataset.banSeen }); drawBanAlerts(); refreshBadges(); } catch (x) { toast(emsg(x)); b.disabled = false; }
});
setInterval(() => { if (!document.hidden && (location.hash || '#dash').startsWith('#dash')) drawBanAlerts(); }, 30000);
window.drawBanAlerts = drawBanAlerts;

// ---------- pick-up requests: approve (check off) or reject ----------
// Checking off a parent's request approves it; Reject undoes it. Both send the parent a push alert and an email.
function pickState(r) {
  if (r.status === 'cancelled') return '<small>Cancelled</small>';
  if (r.status === 'rejected') return `<small><b style="color:var(--red)">Rejected</b>${r.review_note ? ' · ' + esc(r.review_note) : ''}</small>`;
  if (r.source === 'parent' && r.status === 'active' && !r.sis_done) return '<small><button class="link" data-pkreject="' + r.id + '" style="padding:0;color:var(--red)">Reject</button></small>';
  return '';
}
function rejectPickup(id, done) {
  $('#modal').hidden = false;
  $('#modal-in').innerHTML = `<div class="mh"><div><h2 style="margin:0">Pick-Up Person</h2><h1 style="font-size:1.7rem">Reject Request</h1></div><button class="x" id="m-x" aria-label="Close">×</button></div>
    <p>An added person comes off the pick-up list (their PIN stops working for this student). A removed person goes back on. The parent gets a push alert and an email.</p>
    <label style="display:block"><span class="hint">Reason (included in the parent's email)</span><textarea id="m-rj" rows="2" maxlength="500" style="width:100%"></textarea></label>
    <div class="actions"><button class="btn" id="m-go">Reject Request</button><button class="btn ghost" id="m-no">Keep It</button></div><p class="err" id="m-err"></p>`;
  $('#m-x').onclick = $('#m-no').onclick = closeModal;
  $('#m-go').onclick = async () => {
    try { await call('staff_pickup_reject', { p_id: id, p_note: $('#m-rj').value }); closeModal(); toast('Rejected'); done(); refreshBadges(); }
    catch (e) { $('#m-err').textContent = emsg(e); }
  };
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-pkreject]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  rejectPickup(b.dataset.pkreject, () => { if (window.loadPickChanges && !$('#pk-rows').closest('[hidden]')) loadPickChanges(); if (!$('#p-dash').hidden) homeLoad(true); });
}, true);
