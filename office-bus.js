// Office portal — Settings → Bus Stops: buses (driver, school times), stops, FACTS matching, printable route schedule.
let BR = null;
const isAdmin = () => !!(ME && (ME.roles || []).includes('admin'));
const t12 = v => { if (!v) return ''; const [h, m] = v.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const longDate = iso => iso ? D(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
const BS_ERR = { admin_only: 'Only Admins can change bus stops, drivers and times.', need_bus_number: 'Enter a bus number.', bus_exists: 'That bus number already exists.', bus_has_stops: 'Move or delete this bus\'s stops first.',
  pick_bus: 'Choose a bus.', need_stop_name: 'Enter the stop name.', need_time: 'Enter a pick-up or drop-off time.', stop_no_taken: 'That stop # is already used.', stop_not_found: 'That stop no longer exists.' };
const bsMsg = e => { const m = String(e?.message || e); return BS_ERR[m.split(':')[0]] || emsg(e); };

async function busStopsLoad() {
  $('#bs-buses').innerHTML = '<p class="muted">Loading…</p>';
  try { BR = await call('staff_bus_routes'); } catch (e) { $('#bs-buses').innerHTML = `<div class="card">${esc(emsg(e))}</div>`; return; }
  $('#bs-year').value = BR.schedule.school_year || '';
  $('#bs-note').value = BR.schedule.note || '';
  $('#bs-updated').textContent = BR.schedule.updated ? 'Schedule last updated ' + longDate(BR.schedule.updated) : '';
  drawBuses(); drawFacts();
  const adm = isAdmin();
  $('#bs-year').disabled = $('#bs-note').disabled = !adm;
  $('#bs-save-sched').hidden = $('#bs-add-bus').hidden = !adm;
  $('#bs-admin-note').hidden = adm;
  $$('#bs-buses input').forEach(i => i.disabled = !adm);
  $$('#bs-buses [data-save-bus], #bs-buses [data-edit], #bs-buses [data-del], #bs-buses [data-add-stop], #bs-buses [data-del-bus]').forEach(b => b.hidden = !adm);
}

function drawBuses() {
  $('#bs-buses').innerHTML = BR.buses.map(b => `<div class="card" style="margin-bottom:14px">
    <div class="bar" style="align-items:flex-end">
      <label>Bus #<input type="text" data-f="bus" value="${esc(b.bus)}" style="width:80px"></label>
      <label class="grow">Driver<input type="text" data-f="driver" value="${esc(b.driver || '')}"></label>
      <label>Arrives at School (AM)<input type="time" data-f="school_am" value="${esc(b.school_am || '')}"></label>
      <label>Leaves School (PM)<input type="time" data-f="school_pm" value="${esc(b.school_pm || '')}"></label>
      <button class="btn ghost sm" data-save-bus="${esc(b.bus)}" type="button">Save Bus</button>
    </div>
    <div class="tw"><table class="bstbl"><thead><tr><th>Stop #</th><th>AM Pick-Up</th><th>Bus Stop</th><th>Address · ZIP</th><th>Location Details</th><th>PM Drop-Off</th><th>FACTS Match Text</th><th></th></tr></thead><tbody>
      ${b.stops.map(s => `<tr><td><b style="color:var(--red)">${s.stop_no}</b></td><td>${t12(s.am_time)}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.address || '')}</td><td>${esc(s.details || '')}</td><td>${t12(s.pm_time)}</td>
        <td><small>${esc(s.pattern || '')}</small></td><td style="white-space:nowrap"><button class="btn ghost sm" data-edit="${s.id}" type="button">Edit</button> <button class="btn ghost sm" data-del="${s.id}" type="button">Delete</button></td></tr>`).join('')
        || '<tr><td colspan="8" class="empty">No stops yet.</td></tr>'}
    </tbody></table></div>
    <div class="actions"><button class="btn sm" data-add-stop="${esc(b.bus)}" type="button">Add a Stop to Bus ${esc(b.bus)}</button>${b.stops.length ? '' : ` <button class="btn ghost sm" data-del-bus="${esc(b.bus)}" type="button">Delete Bus</button>`}<span class="cnt">${b.stops.length} stop${b.stops.length === 1 ? '' : 's'}</span></div>
  </div>`).join('') || '<div class="card">No buses yet. Tap "Add a Bus".</div>';
}

function drawFacts() {
  const f = BR.facts_stops, bad = f.filter(x => !x.matched_id).length;
  $('#bs-facts').innerHTML = `<p class="small" style="margin:0 0 6px"><b>${f.length - bad} of ${f.length}</b> FACTS stops matched${bad ? ` · <b style="color:var(--red)">${bad} not matched</b>` : ''}</p>
    <div class="tw"><table><thead><tr><th>Stop in FACTS</th><th>Students</th><th>Matches</th></tr></thead><tbody>
    ${f.map(x => `<tr><td>${esc(x.stop)}</td><td>${x.students}</td><td>${x.matched_id ? `Bus ${esc(x.matched_bus)} · ${esc(x.matched_name)}` : '<span class="tag">Not matched</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No bus riders in the FACTS file.</td></tr>'}
    </tbody></table></div>`;
}

function stopForm(s) {
  const [addr, zip] = String(s.address || '').split(/\s*·\s*/);
  $('#bs-edit').innerHTML = `<div class="card" style="border:2px solid var(--red);margin-bottom:14px">
    <b class="t">${s.id ? 'Edit Stop' : 'Add a Stop'}</b>
    <div class="bar">
      <label>Bus<select id="sf-bus">${BR.buses.map(b => `<option value="${esc(b.bus)}" ${b.bus === s.bus ? 'selected' : ''}>Bus ${esc(b.bus)}${b.driver ? ' — ' + esc(b.driver) : ''}</option>`).join('')}</select></label>
      <label>Stop #<input type="number" id="sf-no" min="1" value="${s.stop_no ?? ''}" placeholder="Next" style="width:90px"></label>
      <label class="grow">Bus Stop Name<input type="text" id="sf-name" value="${esc(s.name || '')}" maxlength="100"></label>
    </div>
    <div class="bar">
      <label class="grow">Address<input type="text" id="sf-addr" value="${esc(addr || '')}" maxlength="120" placeholder="Street address, or Intersection"></label>
      <label>ZIP<input type="text" id="sf-zip" value="${esc(zip || '')}" maxlength="10" style="width:100px"></label>
      <label class="grow">Location Details<input type="text" id="sf-det" value="${esc(s.details || '')}" maxlength="120" placeholder="e.g. Parking Lot"></label>
    </div>
    <div class="bar">
      <label>AM Pick-Up<input type="time" id="sf-am" value="${esc(s.am_time || '')}"></label>
      <label>PM Drop-Off<input type="time" id="sf-pm" value="${esc(s.pm_time || '')}"></label>
      <label class="grow">FACTS Match Text <small class="muted">(words from the FACTS stop name; leave blank to use the stop name)</small><input type="text" id="sf-pat" value="${esc(s.pattern || '')}" maxlength="80"></label>
    </div>
    <p class="err" id="sf-err"></p>
    <div class="actions"><button class="btn sm" id="sf-save" type="button">Save Stop</button><button class="btn ghost sm" id="sf-cancel" type="button">Cancel</button></div>
  </div>`;
  $('#bs-edit').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#sf-cancel').onclick = () => $('#bs-edit').innerHTML = '';
  $('#sf-save').onclick = async () => {
    const v = id => $(id).value.trim();
    const address = [v('#sf-addr'), v('#sf-zip')].filter(Boolean).join(' · ');
    try {
      await call('staff_bus_stop_save', { p: { id: s.id || null, bus: v('#sf-bus'), stop_no: v('#sf-no'), name: v('#sf-name'), address, details: v('#sf-det'), am_time: v('#sf-am'), pm_time: v('#sf-pm'), pattern: v('#sf-pat') } });
      $('#bs-edit').innerHTML = ''; toast('Stop saved'); busStopsLoad();
    } catch (e) { $('#sf-err').textContent = bsMsg(e); }
  };
}

$('#bs-buses').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const all = BR.buses.flatMap(x => x.stops);
  if (b.dataset.edit) return stopForm(all.find(s => s.id === +b.dataset.edit));
  if (b.dataset.addStop) return stopForm({ bus: b.dataset.addStop });
  if (b.dataset.del) {
    const s = all.find(x => x.id === +b.dataset.del);
    if (!confirm(`Delete the stop "${s.name}" from Bus ${s.bus}?`)) return;
    try { await call('staff_bus_stop_delete', { p_id: s.id }); toast('Stop deleted'); busStopsLoad(); } catch (x) { toast(bsMsg(x)); }
  }
  if (b.dataset.delBus) { try { await call('staff_bus_delete', { p_bus: b.dataset.delBus }); toast('Bus deleted'); busStopsLoad(); } catch (x) { toast(bsMsg(x)); } }
  if (b.dataset.saveBus !== undefined) {
    const card = b.closest('.card'), f = k => card.querySelector(`[data-f="${k}"]`).value.trim();
    try { await call('staff_bus_save', { p_bus: f('bus'), p_driver: f('driver'), p_school_am: f('school_am'), p_school_pm: f('school_pm'), p_old_bus: b.dataset.saveBus || null }); toast('Bus saved'); busStopsLoad(); }
    catch (x) { toast(bsMsg(x)); }
  }
});
$('#bs-add-bus').addEventListener('click', () => {
  const n = prompt('New bus number (for example 6):'); if (!n) return;
  call('staff_bus_save', { p_bus: n, p_driver: '', p_school_am: '', p_school_pm: '' }).then(() => { toast('Bus added'); busStopsLoad(); }).catch(x => toast(bsMsg(x)));
});
$('#bs-save-sched').addEventListener('click', async () => {
  try { await call('staff_bus_schedule_save', { p_school_year: $('#bs-year').value, p_note: $('#bs-note').value }); toast('Saved'); busStopsLoad(); } catch (x) { toast(bsMsg(x)); }
});

// ---------- printable schedule (same layout as the 2026–2027 Bus Routes sheet) ----------
function scheduleHtml() {
  const sc = BR.schedule;
  const rows = BR.buses.filter(b => b.stops.length).map(b => {
    const stops = [...b.stops].sort((x, y) => (x.am_time || '99').localeCompare(y.am_time || '99') || x.stop_no - y.stop_no);
    return `<tr class="bus"><td colspan="6">BUS #${esc(b.bus)} &nbsp; Driver: ${esc(b.driver || '—')} <span>&nbsp;·&nbsp; ${stops.length} stops</span></td></tr>
      ${stops.map(s => `<tr><td class="t">${t12(s.am_time)}</td><td class="t">${esc(s.name)}</td><td>${esc(s.address || '')}</td><td>${esc(s.details || '')}</td><td class="t c">${t12(s.pm_time)}</td><td class="n">${s.stop_no}</td></tr>`).join('')}
      <tr class="school"><td class="t">${t12(b.school_am)}</td><td class="t">Cornerstone Christian School</td><td>9039 Beach Blvd. · 32216</td><td></td><td class="t c">${t12(b.school_pm)}</td><td class="n">★</td></tr>`;
  }).join('');
  return `<div class="bsched">
    <div class="hd"><img src="/icons/logo-horizontal.webp" alt="Cornerstone Christian School"><div class="ttl"><h2>Bus Routes</h2><b>${esc(sc.school_year || '')} School Year</b><i>${sc.updated ? 'Updated ' + longDate(sc.updated) : ''}</i></div></div>
    ${sc.note ? `<div class="bar">${esc(sc.note)}</div>` : ''}
    <table><colgroup><col style="width:10%"><col style="width:29%"><col style="width:23%"><col style="width:23%"><col style="width:9%"><col style="width:6%"></colgroup>
      <thead><tr><th class="c">AM<br>Pick-Up</th><th>Bus Stop</th><th>Address · ZIP</th><th>Location Details</th><th class="c">PM<br>Drop-Off</th><th class="c">Stop<br>#</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="ft">Cornerstone Christian School · 9039 Beach Blvd., Jacksonville, FL 32216</div></div>`;
}
$('#bs-print').addEventListener('click', async () => {
  if (!BR) await busStopsLoad();
  let host = $('#bs-print-host'); if (!host) { host = document.createElement('div'); host.id = 'bs-print-host'; document.body.appendChild(host); }
  host.innerHTML = scheduleHtml();
  await Promise.all([...host.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 3000); })));
  let st = $('#bs-page'); if (!st) { st = document.createElement('style'); st.id = 'bs-page'; document.head.appendChild(st); }
  st.textContent = '@page{size:letter portrait;margin:.35in}';
  // Shrink to one page if the routes run long (about 10in of printable height).
  const el = host.firstElementChild; host.style.cssText = 'display:block;position:absolute;left:-9999px;top:0'; el.style.zoom = '';
  const h = el.scrollHeight, max = 9.85 * 96; if (h > max) el.style.zoom = (max / h).toFixed(3);
  host.style.cssText = '';
  document.body.classList.add('print-sched');
  await new Promise(r => setTimeout(r, 300));
  window.print();
  setTimeout(() => { document.body.classList.remove('print-sched'); $('#bs-page').textContent = ''; }, 800);
});
window.busStopsLoad = busStopsLoad;
