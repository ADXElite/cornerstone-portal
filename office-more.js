// Office: Students list + student detail (enter a change), Buses & car line (printable bus rosters, today's attendance).
// Uses helpers from office.js / office-home.js ($, call, esc, nice, stamp, grade, toast, TODAY, pickEStudent, TODAY_TAG ...).

// ---------- students list ----------
let SL = [], SLF = false;
async function loadStudentList() {
  const arch = document.querySelector('input[name=sl-arch]:checked').value === '1';
  $('#sl-rows').innerHTML = '<tr><td colspan="5" class="empty">Loading…</td></tr>';
  SL = await call('staff_student_list', { p_archived: arch });
  if (!SLF) {
    SLF = true;
    const all = await call('staff_student_list', { p_archived: false });
    $('#sl-grade').innerHTML = '<option value="">All grades</option>' + [...new Set(all.map(s => s.grade).filter(Boolean))].sort((a, b) => a === 'K' ? -1 : b === 'K' ? 1 : +a - +b)
      .map(g => `<option value="${esc(g)}">${esc(g === 'K' ? 'Kindergarten' : 'Grade ' + String(g).replace(/^0/, ''))}</option>`).join('');
    $('#sl-teacher').innerHTML = '<option value="">All teachers</option>' + [...new Set(all.flatMap(s => [s.teacher, s.board]).filter(Boolean))].sort().map(t => `<option>${esc(t)}</option>`).join('');
  }
  drawStudentList();
}
function drawStudentList() {
  const g = $('#sl-grade').value, t = $('#sl-teacher').value;
  const arch = document.querySelector('input[name=sl-arch]:checked').value === '1';
  const list = SL.filter(s => (!g || s.grade === g) && (!t || s.teacher === t || s.board === t));
  $('#sl-count').textContent = `${list.length} student${list.length === 1 ? '' : 's'}`;
  const letters = [...new Set(list.map(s => (s.last || '?')[0].toUpperCase()))];
  $('#sl-az').innerHTML = letters.map(l => `<a href="#students" data-l="${l}">${l}</a>`).join('');
  let cur = '';
  $('#sl-rows').innerHTML = list.map(s => {
    const l = (s.last || '?')[0].toUpperCase(); const anchor = l !== cur ? ` id="sl-${l}"` : ''; cur = l;
    const way = s.method ? s.method + (s.bus ? ' ' + s.bus : '') : '—';
    return `<tr class="click"${anchor} data-id="${s.student_id}"><td><a href="#student?id=${s.student_id}" style="font-weight:700">${esc(s.last)}, ${esc(s.first)}</a><small>ID ${s.student_id}</small></td>
      <td>${esc(grade(s.grade))}</td><td>${esc(s.teacher || '')}${s.board && s.board !== s.teacher ? `<small>board: ${esc(s.board)}</small>` : ''}</td>
      <td>${arch ? `<span class="tag gray">Archived</span><small>${s.archived_at ? nice(new Date(s.archived_at).toLocaleDateString('en-CA')) : ''}</small>` : s.today ? `<span class="tag ${TODAY_TAG[s.today][1]}">${TODAY_TAG[s.today][0]}</span>` : ''}</td>
      <td>${arch ? '' : esc(way)}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">No students.</td></tr>';
}
$('#sl-rows').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a')) location.hash = '#student?id=' + tr.dataset.id; });
$('#sl-az').addEventListener('click', e => { const a = e.target.closest('[data-l]'); if (!a) return; e.preventDefault(); document.getElementById('sl-' + a.dataset.l)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
['#sl-grade', '#sl-teacher'].forEach(x => $(x).addEventListener('change', drawStudentList));
document.querySelectorAll('input[name=sl-arch]').forEach(r => r.addEventListener('change', loadStudentList));

// ---------- student detail ----------
const STATUS_NOTE = { pending: ['Pending', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', ''] };
async function loadStudent(id) {
  if (!id) return (location.hash = '#students');
  $('#st-head').innerHTML = '<p class="muted">Loading…</p>'; $('#st-left').innerHTML = $('#st-right').innerHTML = '';
  const s = await call('staff_student', { p_id: +id });
  if (!s) return ($('#st-head').innerHTML = '<div class="card">Student not found.</div>');
  const arch = !s.active;
  $('#sec-enter').hidden = arch;
  if (!arch) { pickEStudent(s); $('#e-type').value = ''; $('#e-fields').innerHTML = ''; $('#e-err').textContent = ''; }
  const pl = s.plan || {};
  const dis = s.dismissal;
  $('#st-head').innerHTML = `<div class="stu"><div class="stu-h"><div class="av">${esc(s.name.split(', ')[1]?.[0] || s.name[0])}</div>
    <div><b style="font-size:1.4rem">${esc(s.name.split(', ').reverse().join(' '))}</b><small>ID ${s.student_id} · ${esc(grade(s.grade) === 'K' ? 'Kindergarten' : 'Grade ' + grade(s.grade))} · Homeroom ${esc(s.teacher || '—')}${s.board && s.board !== s.teacher ? ' · Dismissal board ' + esc(s.board) : ''}</small></div>
    <span style="margin-left:auto">${arch ? `<span class="tag gray">Archived ${s.archived_at ? stamp(s.archived_at) : ''}</span>` : s.today ? `<span class="tag ${TODAY_TAG[s.today][1]}">${TODAY_TAG[s.today][0]}</span>` : ''}</span></div></div>`;
  const people = [
    ...s.guardians.filter(g => g.name).map(g => `<div class="row"><div class="txt"><b>${esc(g.name)} <span class="tag ok">Parent/guardian</span></b><p>${esc([g.relationship, g.phone, g.email].filter(Boolean).join(' · '))}</p></div>${g.pin ? `<span class="pin sm">${g.pin}</span>` : ''}</div>`),
    ...s.pickups.filter(p => p.name).map(p => `<div class="row"><div class="txt"><b>${esc(p.name)}${p.pending ? ' <span class="tag warn">Added in portal</span>' : ''}</b><p>${esc([p.relationship, p.phone].filter(Boolean).join(' · '))}</p></div>${p.pin ? `<span class="pin sm">${p.pin}</span>` : ''}</div>`)];
  $('#st-left').innerHTML = `
    ${arch ? '' : `<div class="card"><b class="t">Today</b><dl class="kv" style="padding:0">
      <dt>Going home</dt><dd>${esc(pl.method || '—')}${pl.bus ? ' · Bus ' + esc(pl.bus) : ''}${pl.stop && pl.method === 'Bus Rider' ? `<small style="display:block;color:var(--muted)">${esc(pl.stop)}</small>` : ''}${pl.changed ? ' <span class="tag warn">Changed today</span>' : ''}${pl.pickup_person ? ` · with ${esc(pl.pickup_person)}` : ''}</dd>
      <dt>Dismissed</dt><dd>${dis ? `${dis.kind === 'bus' ? 'On Bus ' + esc(dis.bus || '') : 'Picked up by ' + esc(dis.person || '')} · ${stamp(dis.at)} <small style="color:var(--muted)">(${esc(dis.by)})</small>` : 'Not yet'}</dd></dl></div>`}
    <div class="card"><b class="t">On file</b><dl class="kv" style="padding:0"><dt>Morning</dt><dd>${esc(s.am || '—')}</dd><dt>Afternoon</dt><dd>${esc(s.pm || '—')}</dd>
      <dt>Parent notes</dt><dd>${s.parent_notes_approved} of ${LIMIT} approved this semester · ${s.doctor_notes} doctor's note${s.doctor_notes === 1 ? '' : 's'}</dd></dl></div>
    <div><h2>Parents &amp; pick-up people</h2><div class="list">${people.join('') || '<div class="empty">None on file.</div>'}</div></div>`;
  const hist = (title, rows, fn) => `<details class="card" ${rows.length ? 'open' : ''}><summary><b class="t">${title} (${rows.length})</b></summary><div class="list" style="margin-top:8px">${rows.map(fn).join('') || '<div class="empty">None.</div>'}</div></details>`;
  $('#st-right').innerHTML =
    hist('Excused notes', s.notes, n => `<div class="row"><div class="txt"><b>${n.kind === 'doctor' ? "Doctor's note" : 'Parent note'} · ${nice(n.absent_date)}${n.absent_end ? ' – ' + nice(n.absent_end) : ''}</b><p>${esc(n.reason || '')} · ${stamp(n.created_at)}</p></div><span class="tag ${STATUS_NOTE[n.status][1]}">${STATUS_NOTE[n.status][0]}</span></div>`)
    + hist('Dismissal changes', s.changes, c => `<div class="row"><div class="txt"><b>${esc(c.new_method)}${c.new_details ? ' — ' + esc(c.new_details) : ''}</b><p>${when(c)} · ${c.period} · ${esc(c.submitted_name || '')}${c.pickup_person ? ' · with ' + esc(c.pickup_person) : ''}</p></div><span class="tag ${TS[c.status][1]}">${TS[c.status][0]}</span></div>`)
    + hist('Late sign-ins & early check-outs', s.signins, r => `<div class="row"><div class="txt"><b>${KIND[r.kind][0]} · ${stamp(r.created_at)}</b><p>${esc(r.person_name || '')} · ${esc(r.reason || '')}</p></div>${r.facts_done ? '<span class="tag ok">In FACTS</span>' : ''}</div>`)
    + hist('Pick-up list changes', s.pickup_requests, r => `<div class="row"><div class="txt"><b>${r.action === 'add' ? 'Added' : 'Removed'} ${esc(r.name)}</b><p>${r.source === 'office' ? 'Office' : 'Parent'} · ${stamp(r.created_at)}</p></div>${r.sis_done ? '<span class="tag ok">In FACTS</span>' : ''}</div>`)
    + hist('Attendance (last 30 school days)', s.attendance, a => `<div class="row"><div class="txt"><b>${nice(a.date)}</b></div><span class="tag ${a.status === 'P' ? 'ok' : ''}">${a.status === 'P' ? 'Present' : 'Absent'}</span></div>`)
    + hist('Afternoon dismissals', s.dismissals, d => `<div class="row"><div class="txt"><b>${nice(d.day)}</b><p>${d.kind === 'bus' ? 'Bus ' + esc(d.bus || '') : 'Car line · ' + esc(d.person || '')} · ${new Date(d.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}</p></div></div>`);
}
window.loadStudent = loadStudent;

// ---------- buses & car line ----------
async function loadBuses() {
  call('staff_today_summary').then(t => {
    $('#h-today').innerHTML = `<b>Today's attendance:</b> ${t.present} present · ${t.late} signed in late · ${t.absent} absent · ${t.dismissed} checked out early
      <small class="muted" style="display:block">${t.attendance_in ? 'Attendance file received ' + stamp(t.attendance_at) : "Today's attendance file hasn't arrived yet (sent around 11:30 AM) — everyone counts as present until then."}</small>
      ${t.absent_list.length ? `<details><summary class="muted small">Absent list (${t.absent_list.length})</summary><p class="small">${t.absent_list.map(a => esc(a.name) + ' (' + esc(grade(a.grade)) + ')').join(', ')}</p></details>` : ''}`;
  }).catch(() => {});
  call('staff_dismissal_progress').then(p => {
    $('#bz-progress').innerHTML = `<b>Dismissal so far:</b> Car line ${p.car_done} of ${p.car_total} picked up · Buses ${p.bus_done} of ${p.bus_total} on board`;
  }).catch(() => {});
  $('#bz-print').innerHTML = '<p class="muted">Loading rosters…</p>';
  const rosters = await call('staff_bus_rosters');
  $('#bz-buttons').innerHTML = rosters.map((r, i) => `<button class="btn ghost sm" data-b="${i}">Print Bus ${esc(r.bus)}</button>`).join('') + '<button class="btn sm" data-b="all">Print all buses</button>';
  $('#bz-print').innerHTML = rosters.map((r, i) => rosterHtml(r, i)).join('') || '<div class="card">No bus riders today.</div>';
  $('#bz-buttons').onclick = e => {
    const b = e.target.closest('[data-b]'); if (!b) return;
    document.querySelectorAll('#bz-print .roster').forEach((el, i) => el.classList.toggle('noprint', b.dataset.b !== 'all' && String(i) !== b.dataset.b));
    window.print();
    setTimeout(() => document.querySelectorAll('#bz-print .roster').forEach(el => el.classList.remove('noprint')), 500);
  };
}
function rosterHtml(r, i) {
  const by = {}; for (const s of r.students) (by[s.stop] ||= []).push(s);
  const riding = r.students.filter(s => s.status === 'present' || s.status === 'late').length;
  const date = new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const label = s => s.status === 'absent' ? 'ABSENT' : s.status === 'dismissed' ? 'Checked out early' : s.status === 'late' ? 'Present (late)' : 'Present';
  return `<section class="roster" data-i="${i}">
    <h3><span>Bus ${esc(r.bus)}</span><small style="font-family:var(--body);font-size:.9rem;font-weight:600;text-transform:none">${date} · ${riding} riding of ${r.students.length}</small></h3>
    <p class="small" style="margin:2px 0 0;color:#6B6466">Cornerstone Christian School · Afternoon route · printed ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${r.attendance_in ? '' : ' · attendance not in yet'}</p>
    ${Object.keys(by).map(stop => `<h4>${esc(stop.replace(/^Bus\s*\d+\s*-\s*/i, ''))} <span style="font-weight:400;color:#6B6466">(${by[stop].length})</span></h4>
      <table><tbody>${by[stop].map(s => `<tr class="${s.status === 'absent' || s.status === 'dismissed' ? 'abs' : ''}">
        <td style="width:30px"><span class="chk"></span></td><td><b>${esc(s.name)}</b>${s.changed ? ' <b style="color:#E4010D">· changed today</b>' : ''}</td>
        <td>${esc(grade(s.grade))}</td><td>${esc((s.teacher || '').replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/, ''))}</td>
        <td style="text-decoration:none"><b>${label(s)}</b></td></tr>`).join('')}</tbody></table>`).join('')}
  </section>`;
}
window.loadBuses = loadBuses;
