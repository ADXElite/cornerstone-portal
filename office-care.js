// Office portal — Extended Care (morning + afterschool). View only here; staff sign students in/out at /care, parents at the kiosk.
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
      <div class="tw"><table><thead><tr><th>Student</th><th>Student #</th><th>Date of Birth</th><th>Grade</th><th>Teacher</th><th>Since</th><th>Signed In By</th></tr></thead><tbody>
      ${g.map(s => `<tr><td><b>${esc(s.last)}, ${esc(s.first)}</b></td><td>${esc(s.student_id)}</td><td>${cmd(s.birth_date)}</td><td>${esc(grade(s.grade))}</td><td>${esc(s.teacher || '')}</td><td>${ctm(s.in_at)}</td><td>${s.in_how === 'auto' ? 'Automatic (3:00 PM)' : esc(s.in_by || '')}${s.in_how === 'kiosk' ? ' · kiosk' : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
  }).join('') || '<div class="card">No one is signed in to extended care right now.</div>';
}

// ---------- Afterschool ----------
let CP = null, CP_LOC = 'all';
async function carePm(quiet) {
  if (!quiet) $('#cp-rows').innerHTML = '<tr><td colspan="6" class="empty">Loading…</td></tr>';
  try { CP = await call('care_list', { p_session: 'pm' }); } catch (e) { toast(emsg(e)); return; }
  drawCarePm();
}
function drawCarePm() {
  const q = $('#cp-q').value.trim().toLowerCase();
  const st = CP.students.filter(s => (CP_LOC === 'all' || s.location === CP_LOC) && (!q || `${s.first} ${s.last}`.toLowerCase().includes(q)));
  const here = st.filter(s => s.signed_in && !s.out_at).length, out = st.filter(s => s.out_at).length;
  $('#cp-count').textContent = `${st.length} students · ${here} here now · ${out} picked up${CP.attendance_in ? '' : ' · today\'s attendance isn\'t in yet'}`;
  const today = s => s.day_status === 'absent' ? '<span class="tag">Absent</span>' : s.day_status === 'dismissed' ? '<span class="tag gray">Checked Out Early</span>' : s.day_status === 'late' ? '<span class="tag warn">Late</span>' : '<span class="tag ok">Present</span>';
  $('#cp-rows').innerHTML = st.map(s => `<tr class="click" data-id="${s.student_id}">
      <td><b>${esc(s.last)}, ${esc(s.first)}</b><small>#${esc(s.student_id)}${s.birth_date ? ' · DOB ' + cmd(s.birth_date) : ''} · Gr ${esc(grade(s.grade))} · ${esc(s.teacher || '')} · tap for pick-up people</small></td>
      <td>${cloc(s.location)}${s.enrolled ? '' : '<small>Not on today\'s list</small>'}</td><td>${today(s)}</td>
      <td>${s.signed_in ? `<b>${ctm(s.in_at)}</b><small>${s.in_how === 'auto' ? 'Automatic' : esc(s.in_by || '')}</small>` : '<span class="muted">—</span>'}</td>
      <td>${s.out_at ? `<b>${ctm(s.out_at)}</b><small>${s.out_how === 'kiosk' ? 'Kiosk' : esc(s.out_by || '')}</small>` : s.signed_in ? '<span class="tag ok">Here now</span>' : '<span class="muted">—</span>'}</td>
      <td>${esc(s.out_person_name || '')}${s.out_relationship ? `<small>${esc(s.out_relationship)}</small>` : ''}</td></tr>
    <tr class="cp-more" data-for="${s.student_id}" hidden><td colspan="6"></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No students.</td></tr>';
}
$('#cp-loc').addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (!b) return; CP_LOC = b.dataset.l; $$('#cp-loc button').forEach(x => x.setAttribute('aria-pressed', x === b)); if (CP) drawCarePm(); });
$('#cp-q').addEventListener('input', debounce(() => CP && drawCarePm(), 200));
$('#cp-rows').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const more = $(`#cp-rows tr[data-for="${tr.dataset.id}"]`); if (!more.hidden) return more.hidden = true;
  more.hidden = false; more.firstElementChild.innerHTML = '<span class="muted">Loading…</span>';
  try {
    const r = await call('care_people', { p_student: +tr.dataset.id });
    more.firstElementChild.innerHTML = `<b>Who can pick up${r.student.birth_date ? ` · DOB ${cmd(r.student.birth_date)}` : ''}</b>
      <div class="tw" style="margin-top:6px"><table><thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Type</th><th>PIN</th></tr></thead><tbody>
      ${r.people.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.relationship || '')}</td><td>${esc(p.phone || '')}</td><td>${esc(p.type)}</td><td>${p.pin ? `<span class="pin sm">${esc(p.pin)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">None on file.</td></tr>'}
      </tbody></table></div>`;
  } catch (x) { more.firstElementChild.textContent = emsg(x); }
});

// ---------- Morning ----------
let CA = null;
async function careAm(quiet) {
  if (!quiet) $('#ca-rows').innerHTML = '<tr><td colspan="5" class="empty">Loading…</td></tr>';
  try { CA = await call('care_list', { p_session: 'am' }); } catch (e) { toast(emsg(e)); return; }
  drawCareAm();
}
function drawCareAm() {
  const q = $('#ca-q').value.trim().toLowerCase();
  const st = CA.students.filter(s => !q || `${s.first} ${s.last}`.toLowerCase().includes(q))
    .sort((a, b) => (b.signed_in - a.signed_in) || a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
  $('#ca-count').textContent = `${CA.students.filter(s => s.enrolled).length} signed up · ${CA.students.filter(s => s.signed_in).length} came today · ${CA.students.filter(s => s.signed_in && !s.out_at).length} here now`;
  $('#ca-rows').innerHTML = st.map(s => `<tr>
      <td><b>${esc(s.last)}, ${esc(s.first)}</b><small>#${esc(s.student_id)}${s.birth_date ? ' · DOB ' + cmd(s.birth_date) : ''} · Gr ${esc(grade(s.grade))} · ${esc(s.teacher || '')}</small></td>
      <td>${s.enrolled ? 'Yes' : '<span class="tag warn">Not signed up</span>'}</td>
      <td>${s.signed_in ? `<b>${ctm(s.in_at)}</b>` : '<span class="muted">Not here today</span>'}</td>
      <td>${esc(s.in_by || '')}${s.in_how === 'kiosk' ? '<small>Kiosk</small>' : ''}</td>
      <td>${s.out_at ? `${ctm(s.out_at)}${s.out_how === 'auto' ? '<small>Automatic</small>' : ''}` : s.signed_in ? '<span class="tag ok">Here now</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No students.</td></tr>';
}
$('#ca-q').addEventListener('input', debounce(() => CA && drawCareAm(), 200));

// ---------- Sign-in / sign-out sheets ----------
function monday(iso) { const d = D(iso); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d.toLocaleDateString('en-CA'); }
function addDays(iso, n) { const d = D(iso); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); }
function careSheets() {
  if (!$('#cs-date').value) $('#cs-date').value = TODAY;
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
  $('#cs-count').textContent = `${st.length} students`;
  const title = ses === 'am' ? 'Morning Care' : loc === 'all' ? 'Afterschool Care' : `Afterschool Care — ${loc}`;
  const sub = `Cornerstone Christian School · ${week ? `Week of ${cmd(from)} – ${cmd(to)}` : D(from).toLocaleDateString('en-US', { weekday: 'long' }) + ' ' + cmd(from)}`;
  const nm = s => `<b>${esc(s.last)}, ${esc(s.first)}</b>${loc === 'all' && ses === 'pm' ? ' ' + cloc(s.location) : ''}`;
  const sigImg = d => d && d.signature ? `<img src="${d.signature}" alt="Signature">` : '';
  const outBy = d => d ? esc(d.out_person_name || (d.out_how === 'auto' ? 'Automatic 8:30' : '')) : '';
  let html;
  if (!week) {
    html = `<section class="csheet"><h3>${esc(title)} — Daily Sign-In / Sign-Out</h3><p class="small" style="margin:2px 0 8px;color:#555">${sub}</p>
      <table><colgroup><col style="width:18%"><col style="width:9%"><col style="width:11.5%"><col style="width:9.5%"><col style="width:9.5%">${ses === 'pm' ? '<col style="width:18.5%"><col style="width:23%">' : '<col style="width:41.5%">'}</colgroup>
      <thead><tr><th>Student</th><th>Student #</th><th>Date of Birth</th><th>Sign-In</th><th>Sign-Out</th>${ses === 'pm' ? '<th>Signed Out By (Parent)</th><th>Parent Signature</th>' : '<th>Notes</th>'}</tr></thead><tbody>
      ${st.map(s => { const d = s.days[from]; return `<tr><td>${nm(s)}</td><td>${esc(s.student_id)}</td><td>${cmd(s.birth_date)}</td><td>${d ? ctm(d.in_at) : ''}</td><td>${d ? ctm(d.out_at) : ''}</td>${ses === 'pm' ? `<td>${outBy(d)}${d && d.out_relationship ? ` <span style="color:#555">(${esc(d.out_relationship)})</span>` : ''}</td><td>${sigImg(d)}</td>` : `<td>${d && d.out_how === 'auto' ? 'Signed out automatically 8:30 AM' : ''}</td>`}</tr>`; }).join('')}
      </tbody></table></section>`;
  } else {
    const days = [0, 1, 2, 3, 4].map(i => addDays(from, i));
    html = `<section class="csheet week"><h3>${esc(title)} — Weekly Sign-In / Sign-Out</h3><p class="small" style="margin:2px 0 8px;color:#555">${sub}</p>
      <table><colgroup><col style="width:14%"><col style="width:7.5%"><col style="width:8%">${days.map(() => '<col>').join('')}</colgroup>
      <thead><tr><th>Student</th><th>Student #</th><th>DOB</th>${days.map(d => `<th>${D(d).toLocaleDateString('en-US', { weekday: 'short' })} ${cmd(d).slice(0, 5)}</th>`).join('')}</tr></thead><tbody>
      ${st.map(s => `<tr><td>${nm(s)}</td><td>${esc(s.student_id)}</td><td>${cmd(s.birth_date)}</td>${days.map(day => { const d = s.days[day]; return `<td>${d ? `In ${ctm(d.in_at)}${d.out_at ? ` · Out ${ctm(d.out_at)}` : ''}${ses === 'pm' && d.out_person_name ? `<br>${esc(d.out_person_name)}` : ''}${sigImg(d)}` : 'In ____ Out ____'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></section>`;
  }
  $('#cs-area').innerHTML = st.length ? html : '<div class="card">No students for this sheet.</div>';
}
$('#cs-print').addEventListener('click', () => {
  let s = $('#cs-page'); if (!s) { s = document.createElement('style'); s.id = 'cs-page'; document.head.appendChild(s); }
  s.textContent = $('#cs-kind').value === 'week' ? '@page{size:letter landscape;margin:.35in}' : '@page{size:letter portrait;margin:.4in}';
  window.print();
  setTimeout(() => { s.textContent = ''; }, 1000);
});

// Keep "Signed In Now" and the rosters fresh while open.
setInterval(() => {
  if (document.hidden) return;
  const v = location.hash.slice(1).split('?')[0];
  if (v === 'carenow') careNow(true); else if (v === 'carepm' && CP) carePm(true); else if (v === 'caream' && CA) careAm(true);
}, 30000);
window.careNow = careNow; window.carePm = carePm; window.careAm = careAm; window.careSheets = careSheets;
