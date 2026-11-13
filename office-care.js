// Office portal — Extended Care (morning + afterschool). Staff sign students in/out at /care, parents at the kiosk.
// The office can pick any date (from 11/13/2026) and correct whether a student was here, with times.
const ctm = t => t ? new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '';
const cmd = d => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${m}/${dd}/${y}`; };
const cloc = l => l ? `<span class="cloc ${esc(l)}">${esc(l)}</span>` : '';

// ---------- Signed in now ----------
async function careNow(quiet) {
  if (!quiet) $('#cn-list').innerHTML = '<p class="muted">Loading…</p>';
  let list; try { list = await call('staff_care_now'); } catch (e) { $('#cn-list').innerHTML = `<div class="card">${esc(emsg(e))}</div>`; return; }
  const groups = [['pm', 'KHA', 'Afterschool Care — KHA'], ['pm', 'SP', 'Afterschool Care — SP'], ['am', null, 'Morning Care']];
  $('#cn-count').textContent = `${list.length} signed in now`;
  $('#cn-list').innerHTML = groups.map(([ses, loc, title]) => {
    const g = list.filter(s => s.session === ses && (ses === 'am' || (s.location || 'SP') === loc));
    if (!g.length) return '';
    return `<h2 style="margin:14px 0 6px">${esc(title)} <span class="muted" style="font-size:1rem">${g.length}</span></h2>
      <div class="tw"><table><thead><tr><th>Student</th><th>Student #</th><th>Grade</th><th>Teacher</th><th>Since</th><th>Signed In By</th></tr></thead><tbody>
      ${g.map(s => `<tr><td><b>${esc(s.last)}, ${esc(s.first)}</b></td><td>${esc(s.student_id)}</td><td>${esc(grade(s.grade))}</td><td>${esc(s.teacher || '')}</td><td>${ctm(s.in_at)}</td><td>${s.in_how === 'auto' ? 'Automatic (3:00 PM)' : esc(s.in_by || '')}${s.in_how === 'kiosk' ? ' · kiosk' : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
  }).join('') || '<div class="card">No one is signed in to extended care right now.</div>';
}

// ---------- Afterschool ----------
let CP = null, CP_LOC = 'all';
async function carePm(quiet) {
  if (!quiet) $('#cp-rows').innerHTML = '<tr><td colspan="6" class="empty">Loading…</td></tr>';
  const day = careDay('#cp-date');
  try { CP = day === TODAY ? await call('care_list', { p_session: 'pm' }) : await call('staff_care_day', { p_session: 'pm', p_day: day }); } catch (e) { toast(emsg(e)); return; }
  CP.day = day; drawCarePm();
}
function drawCarePm() {
  const q = $('#cp-q').value.trim().toLowerCase();
  const st = CP.students.filter(s => (CP_LOC === 'all' || s.location === CP_LOC) && (!q || `${s.first} ${s.last}`.toLowerCase().includes(q)));
  const here = st.filter(s => s.signed_in && !s.out_at).length, out = st.filter(s => s.out_at).length;
  const isToday = CP.day === TODAY;
  $('#cp-dayh').textContent = isToday ? 'Today' : 'Day';
  $('#cp-count').textContent = isToday ? `${st.length} students · ${here} here now · ${out} picked up${CP.attendance_in ? '' : ' · today\'s attendance isn\'t in yet'}`
    : `${cmd(CP.day)} · ${st.filter(s => s.signed_in).length} here · ${out} picked up`;
  const today = s => !isToday ? (s.signed_in ? '<span class="tag ok">Here</span>' : '<span class="tag gray">Not Here</span>') : s.day_status === 'absent' ? '<span class="tag">Absent</span>' : s.day_status === 'dismissed' ? '<span class="tag gray">Checked Out Early</span>' : s.day_status === 'late' ? '<span class="tag warn">Late</span>' : '<span class="tag ok">Present</span>';
  $('#cp-rows').innerHTML = st.map(s => `<tr class="click" data-id="${s.student_id}">
      <td><b>${esc(s.last)}, ${esc(s.first)}</b><small>#${esc(s.student_id)} · Gr ${esc(grade(s.grade))} · ${esc(s.teacher || '')} · tap for pick-up people</small></td>
      <td>${cloc(s.location)}${s.enrolled ? '' : '<small>Not on today\'s list</small>'}</td><td>${today(s)}</td>
      <td>${s.signed_in ? `<b>${ctm(s.in_at)}</b><small>${s.in_how === 'auto' ? 'Automatic' : esc(s.in_by || '')}</small>` : '<span class="muted">—</span>'}</td>
      <td>${s.out_at ? `<b>${ctm(s.out_at)}</b><small>${s.out_how === 'kiosk' ? 'Kiosk' : esc(s.out_by || '')}</small>` : s.signed_in ? (isToday ? '<span class="tag ok">Here now</span>' : '<span class="tag warn">No sign-out</span>') : '<span class="muted">—</span>'}</td>
      <td>${esc(s.out_person_name || '')}${s.out_relationship ? `<small>${esc(s.out_relationship)}</small>` : ''}</td>
      <td class="noprint"><button class="btn ghost sm" data-cedit="pm:${s.student_id}">Edit</button></td></tr>
    <tr class="cp-more" data-for="${s.student_id}" hidden><td colspan="7"></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No students.</td></tr>';
}
$('#cp-loc').addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (!b) return; CP_LOC = b.dataset.l; $$('#cp-loc button').forEach(x => x.setAttribute('aria-pressed', x === b)); if (CP) drawCarePm(); });
$('#cp-q').addEventListener('input', debounce(() => CP && drawCarePm(), 200));
$('#cp-rows').addEventListener('click', async e => {
  if (e.target.closest('[data-cedit]')) return;
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const more = $(`#cp-rows tr[data-for="${tr.dataset.id}"]`); if (!more.hidden) return more.hidden = true;
  more.hidden = false; more.firstElementChild.innerHTML = '<span class="muted">Loading…</span>';
  try {
    const r = await call('care_people', { p_student: +tr.dataset.id });
    more.firstElementChild.innerHTML = `<b>Who can pick up</b>
      <div class="tw" style="margin-top:6px"><table><thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Type</th><th>PIN</th></tr></thead><tbody>
      ${r.people.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.relationship || '')}</td><td>${esc(p.phone || '')}</td><td>${esc(p.type)}</td><td>${p.pin ? `<span class="pin sm">${esc(p.pin)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">None on file.</td></tr>'}
      </tbody></table></div>`;
  } catch (x) { more.firstElementChild.textContent = emsg(x); }
});

// ---------- Morning ----------
let CA = null;
async function careAm(quiet) {
  if (!quiet) $('#ca-rows').innerHTML = '<tr><td colspan="5" class="empty">Loading…</td></tr>';
  const day = careDay('#ca-date');
  try { CA = day === TODAY ? await call('care_list', { p_session: 'am' }) : await call('staff_care_day', { p_session: 'am', p_day: day }); } catch (e) { toast(emsg(e)); return; }
  CA.day = day; drawCareAm();
}
function drawCareAm() {
  const q = $('#ca-q').value.trim().toLowerCase();
  const st = CA.students.filter(s => !q || `${s.first} ${s.last}`.toLowerCase().includes(q))
    .sort((a, b) => (b.signed_in - a.signed_in) || a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
  const isToday = CA.day === TODAY;
  $('#ca-count').textContent = `${isToday ? '' : cmd(CA.day) + ' · '}${CA.students.filter(s => s.enrolled).length} signed up · ${CA.students.filter(s => s.signed_in).length} came${isToday ? ' today · ' + CA.students.filter(s => s.signed_in && !s.out_at).length + ' here now' : ''}`;
  $('#ca-rows').innerHTML = st.map(s => `<tr>
      <td><b>${esc(s.last)}, ${esc(s.first)}</b><small>#${esc(s.student_id)} · Gr ${esc(grade(s.grade))} · ${esc(s.teacher || '')}</small></td>
      <td>${s.enrolled ? 'Yes' : '<span class="tag warn">Not signed up</span>'}</td>
      <td>${s.signed_in ? `<b>${ctm(s.in_at)}</b>` : `<span class="muted">Not here${CA.day === TODAY ? ' today' : ''}</span>`}</td>
      <td>${esc(s.in_by || '')}${s.in_how === 'kiosk' ? '<small>Kiosk</small>' : ''}</td>
      <td>${s.out_at ? `${ctm(s.out_at)}${s.out_how === 'auto' ? '<small>Automatic</small>' : ''}` : s.signed_in ? (CA.day === TODAY ? '<span class="tag ok">Here now</span>' : '<span class="tag warn">No sign-out</span>') : ''}</td>
      <td class="noprint"><button class="btn ghost sm" data-cedit="am:${s.student_id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No students.</td></tr>';
}
$('#ca-q').addEventListener('input', debounce(() => CA && drawCareAm(), 200));

// ---------- date picker + office corrections ----------
const CARE_START = '2026-11-13';
function careDay(sel) {
  const el = $(sel);
  if (!el.value) el.value = TODAY < CARE_START ? CARE_START : TODAY;
  el.max = TODAY > CARE_START ? TODAY : CARE_START;
  return el.value;
}
$('#cp-date').addEventListener('change', () => carePm());
$('#ca-date').addEventListener('change', () => careAm());
const hm = t => t ? new Date(t).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }) : '';
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cedit]'); if (!b) return;
  e.stopPropagation();
  const [ses, id] = b.dataset.cedit.split(':'), L = ses === 'pm' ? CP : CA, s = L.students.find(x => String(x.student_id) === id);
  const pm = ses === 'pm';
  $('#modal').hidden = false;
  $('#modal-in').innerHTML = `<div class="mh"><div><h2 style="margin:0">${pm ? 'Afterschool Care' : 'Morning Care'} · ${cmd(L.day)}</h2><h1 style="font-size:1.7rem">${esc(s.first)} ${esc(s.last)}</h1></div><button class="x" id="m-x" aria-label="Close">×</button></div>
    <div class="segs" id="ce-here" style="margin:6px 0 12px"><button type="button" data-h="1" aria-pressed="${!!s.signed_in}">Was Here</button><button type="button" data-h="0" aria-pressed="${!s.signed_in}">Not Here</button></div>
    <div id="ce-times" ${s.signed_in ? '' : 'hidden'}>
      <div class="two"><label>Sign-In Time<input type="time" id="ce-in" value="${hm(s.in_at) || (pm ? '15:00' : '07:00')}"></label>
      <label>Sign-Out Time<input type="time" id="ce-out" value="${hm(s.out_at)}"></label></div>
      ${pm ? `<div class="two"><label>Picked Up By<input type="text" id="ce-who" maxlength="80" value="${esc(s.out_person_name || '')}" placeholder="Name (optional)"></label>
        <label>Location<select id="ce-loc"><option ${s.location === 'KHA' ? 'selected' : ''}>KHA</option><option ${s.location !== 'KHA' ? 'selected' : ''}>SP</option></select></label></div>` : ''}
      <p class="hint">Leave Sign-Out Time blank if they haven't been picked up yet.</p>
    </div>
    <div class="actions"><button class="btn" id="ce-save">Save</button><button class="btn ghost" id="ce-no">Cancel</button></div><p class="err" id="m-err"></p>`;
  let here = !!s.signed_in;
  $('#ce-here').onclick = ev => { const h = ev.target.closest('[data-h]'); if (!h) return; here = h.dataset.h === '1';
    $$('#ce-here button').forEach(x => x.setAttribute('aria-pressed', x === h)); $('#ce-times').hidden = !here; };
  $('#m-x').onclick = $('#ce-no').onclick = closeModal;
  $('#ce-save').onclick = async () => {
    try {
      await call('staff_care_set', { p_student: +id, p_session: ses, p_day: L.day, p_here: here,
        p_in: here ? $('#ce-in').value || null : null, p_out: here ? $('#ce-out').value || null : null,
        p_out_name: pm && here ? $('#ce-who').value : null, p_location: pm && here ? $('#ce-loc').value : null });
      closeModal(); toast('Saved'); pm ? carePm(true) : careAm(true);
    } catch (x) { $('#m-err').textContent = emsg(x); }
  };
}, true);

// ---------- Sign-in / sign-out sheets ----------
function monday(iso) { const d = D(iso); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d.toLocaleDateString('en-CA'); }
function addDays(iso, n) { const d = D(iso); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); }
// Afternoon care staff sign-in shown on the daily PM sheet.
const PM_SIGN_IN_BY = 'Wendy Cruz', PM_SIGN_IN_SIG = '/img/wendy-cruz-signature.png';
function careSheets() {
  if (!$('#cs-date').value) $('#cs-date').value = TODAY < CARE_START ? CARE_START : TODAY;
  syncSheetForm(); buildSheet();
}
function syncSheetForm() {
  $('#cs-loc').disabled = $('#cs-ses').value === 'am';
  $('#cs-dl').firstChild.textContent = $('#cs-kind').value === 'week' ? 'Week of' : 'Date';
}
['#cs-ses', '#cs-loc', '#cs-kind', '#cs-date'].forEach(id => $(id).addEventListener('change', () => { syncSheetForm(); buildSheet(); }));
async function buildSheet() {
  const ses = $('#cs-ses').value, loc = ses === 'am' ? 'all' : $('#cs-loc').value, week = $('#cs-kind').value === 'week';
  const from = week ? monday($('#cs-date').value || TODAY) : ($('#cs-date').value || TODAY), to = week ? addDays(from, 4) : from;
  $('#cs-area').innerHTML = '<p class="muted">Loading…</p>';
  let r; try { r = await call('staff_care_sheet', { p_from: from, p_to: to, p_session: ses, p_loc: loc }); } catch (e) { $('#cs-area').innerHTML = `<div class="card">${esc(emsg(e))}</div>`; return; }
  const st = r.students;
  $('#cs-count').textContent = `${st.length} student${st.length === 1 ? '' : 's'} signed in`;
  const title = ses === 'am' ? 'Morning Care' : loc === 'all' ? 'Afterschool Care' : `Afterschool Care — ${loc}`;
  const nm = s => `<b>${esc(s.last)}, ${esc(s.first)}</b>${loc === 'all' && ses === 'pm' ? ' ' + cloc(s.location) : ''}`;
  const sigImg = d => d && d.signature ? `<img src="${d.signature}" alt="Signature">` : '';
  const outBy = d => d ? esc(d.out_person_name || (d.out_how === 'auto' ? 'Automatic 8:30' : '')) : '';
  const dayLine = day => `Cornerstone Christian School · ${D(day).toLocaleDateString('en-US', { weekday: 'long' })} ${cmd(day)}`;
  // One daily-format sheet. Weekly = one of these per weekday (each its own page in the PDF).
  const daySheet = (day, rows) => `<section class="csheet"><h3>${esc(title)} — Daily Sign-In / Sign-Out</h3><p class="small" style="margin:2px 0 8px;color:#555">${dayLine(day)}</p>
      <table><colgroup>${ses === 'pm' ? '<col style="width:13%"><col style="width:8%"><col style="width:9%"><col style="width:11%"><col style="width:13%"><col style="width:9%"><col style="width:15%"><col style="width:22%">' : '<col style="width:20%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:50%">'}</colgroup>
      <thead><tr><th>Student</th><th>Student #</th>${ses === 'pm' ? `<th>Sign-In</th><th>Signed In By</th><th>Sign-In Signature</th><th>Sign-Out</th><th>Signed Out By (Parent)</th><th>Parent Signature</th>` : '<th>Sign-In</th><th>Sign-Out</th><th>Notes</th>'}</tr></thead><tbody>
      ${rows.map(s => { const d = s.days[day]; return `<tr><td>${nm(s)}</td><td>${esc(s.student_id)}</td><td>${d ? ctm(d.in_at) : ''}</td>${ses === 'pm' ? `<td>${d ? esc(PM_SIGN_IN_BY) : ''}</td><td>${d ? `<img src="${PM_SIGN_IN_SIG}" alt="Signature">` : ''}</td>` : ''}<td>${d ? ctm(d.out_at) : ''}</td>${ses === 'pm' ? `<td>${outBy(d)}${d && d.out_relationship ? ` <span style="color:#555">(${esc(d.out_relationship)})</span>` : ''}</td><td>${sigImg(d)}</td>` : `<td>${d && d.out_how === 'auto' ? 'Signed out automatically 8:30 AM' : ''}</td>`}</tr>`; }).join('')}
      </tbody></table></section>`;
  let html;
  if (!week) html = daySheet(from, st);
  else {
    // Each day lists the students signed in that day; a day with nobody yet (future/blank) lists the week's students to fill in by hand.
    html = [0, 1, 2, 3, 4].map(i => addDays(from, i)).map(day => { const on = st.filter(s => s.days[day]); return daySheet(day, on.length ? on : st); }).join('');
  }
  $('#cs-area').innerHTML = st.length ? html : '<div class="card">No students were signed in for this sheet.</div>';
  CS_NAME = `${title.replace(/ — /g, ' ')} Sign-In Sheet ${week ? 'Week of ' + cmd(from).replace(/\//g, '-') : cmd(from).replace(/\//g, '-')}.pdf`;
}
let CS_NAME = 'Care Sign-In Sheet.pdf';
// Export the sheets on screen as a letter-portrait PDF: each daily sheet starts a new page; long rosters continue onto extra pages, split between rows.
$('#cs-print').addEventListener('click', async () => {
  const secs = [...document.querySelectorAll('#cs-area .csheet')], btn = $('#cs-print');
  if (!secs.length) return;
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'Creating PDF…';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:740px;background:#fff';
  document.body.appendChild(host);
  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
    const M = 29, PW = pdf.internal.pageSize.getWidth() - 2 * M, PH = pdf.internal.pageSize.getHeight() - 2 * M;
    let first = true;
    for (const sec of secs) {
      const c = sec.cloneNode(true); c.style.cssText = 'border:0;border-radius:0;margin:0;padding:0';
      host.replaceChildren(c);
      await Promise.all([...c.querySelectorAll('img')].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
      const canvas = await html2canvas(c, { scale: 2, backgroundColor: '#fff', logging: false });
      const k = PW / c.offsetWidth, pageCss = PH / k, sc = canvas.width / c.offsetWidth;   // pageCss: CSS px that fit on one page
      const top0 = c.getBoundingClientRect().top, rel = el => el.getBoundingClientRect().bottom - top0;
      const head = rel(c.querySelector('thead')), cut = [...c.querySelectorAll('tbody tr')].map(rel), total = c.offsetHeight;
      // Page 1 = title + header + rows; continuation pages repeat the title + column headers, then the next rows. Breaks fall between rows.
      let y = 0;
      while (y < total - 1) {
        const lead = y ? head : 0, end0 = Math.min(total, y + pageCss - lead);
        let end = end0;
        if (end < total) { const fit = cut.filter(v => v > y + 1 && v <= end0); if (fit.length) end = fit[fit.length - 1]; }
        const part = document.createElement('canvas'), g = part.getContext('2d');
        part.width = canvas.width; part.height = Math.ceil((lead + end - y) * sc);
        g.fillStyle = '#fff'; g.fillRect(0, 0, part.width, part.height);
        if (lead) g.drawImage(canvas, 0, 0, canvas.width, Math.round(head * sc), 0, 0, canvas.width, Math.round(head * sc));
        g.drawImage(canvas, 0, Math.round(y * sc), canvas.width, Math.round((end - y) * sc), 0, Math.round(lead * sc), canvas.width, Math.round((end - y) * sc));
        if (!first) pdf.addPage(); first = false;
        pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', M, M, PW, (lead + end - y) * k);
        y = end;
      }
    }
    pdf.save(CS_NAME);
  } catch (e) { alert('Could not create the PDF: ' + (e && e.message || e)); }
  finally { host.remove(); btn.disabled = false; btn.textContent = label; }
});

// Keep "Signed In Now" and the rosters fresh while open.
setInterval(() => {
  if (document.hidden) return;
  const v = location.hash.slice(1).split('?')[0];
  if (v === 'carenow') careNow(true); else if (v === 'carepm' && CP) carePm(true); else if (v === 'caream' && CA) careAm(true);
}, 30000);
window.careNow = careNow; window.carePm = carePm; window.careAm = careAm; window.careSheets = careSheets;
