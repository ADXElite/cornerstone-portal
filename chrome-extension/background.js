// Cornerstone Portal Dismissal Board
// Every minute: inside the dismissal window (2:35–3:30 PM New York time, Monday–Friday) make sure the
// board is open full-screen; at the end of the window close it. If a teacher closes the board during
// the window, it stays closed for the rest of that day. Clicking the toolbar icon opens it any time.
const BOARD_URL = 'https://portal.csjax.org/classroom';
const DEFAULTS = { board: '', start: '14:35', end: '15:30', weekdaysOnly: true };

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tick') tick(); });
function setup() { chrome.alarms.create('tick', { periodInMinutes: 1 }); tick(); }

function nyNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, weekday: p.weekday };
}
const validHm = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const clean = v => String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

// IT can preset values per group of devices in Google Admin (Apps & extensions → this extension → Policy for extensions).
async function settings() {
  let m = {};
  try { m = await chrome.storage.managed.get(null); } catch (_) {}
  return {
    board: clean(m.board || DEFAULTS.board),
    start: validHm(m.start) ? m.start : DEFAULTS.start,
    end: validHm(m.end) ? m.end : DEFAULTS.end,
    weekdaysOnly: typeof m.weekdaysOnly === 'boolean' ? m.weekdaysOnly : DEFAULTS.weekdaysOnly
  };
}
// The teacher's chosen class, saved with Chrome sync so it follows their school account to any Chromebook.
async function chosenBoard() {
  try { const { board } = await chrome.storage.sync.get('board'); if (board) return clean(board); } catch (_) {}
  const { board } = await chrome.storage.local.get('board'); return clean(board);
}

async function ourWindow() {
  const { winId } = await chrome.storage.session.get('winId');
  if (winId == null) return null;
  try { return await chrome.windows.get(winId); } catch (_) { return null; }
}
async function openBoard() {
  const s = await settings();
  const board = s.board || await chosenBoard();
  const url = BOARD_URL + (board ? '?board=' + encodeURIComponent(board) : '');
  const w = await chrome.windows.create({ url, type: 'popup', state: 'fullscreen', focused: true });
  await chrome.storage.session.set({ winId: w.id, closing: false });
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const s = await settings();
    const now = nyNow();
    const weekend = now.weekday === 'Sat' || now.weekday === 'Sun';
    const inWindow = !(s.weekdaysOnly && weekend) && now.hm >= s.start && now.hm < s.end;
    const win = await ourWindow();
    if (!inWindow) {
      const { manual } = await chrome.storage.session.get('manual');
      if (win && !manual) { await chrome.storage.session.set({ closing: true }); await chrome.windows.remove(win.id); }
      return;
    }
    if (win) return;
    const { dismissedDate } = await chrome.storage.local.get('dismissedDate');
    if (dismissedDate === now.date) return;   // teacher closed it today — leave it closed
    await chrome.storage.session.set({ manual: false });
    await openBoard();
  } catch (e) {
    console.warn('Dismissal board:', e);
  } finally {
    busy = false;
  }
}

// Toolbar icon: open the board now (outside the window it stays open until the teacher closes it).
chrome.action.onClicked.addListener(async () => {
  const win = await ourWindow();
  if (win) return chrome.windows.update(win.id, { focused: true });
  await chrome.storage.session.set({ manual: true });
  await chrome.storage.local.remove('dismissedDate');
  await openBoard();
});

chrome.windows.onRemoved.addListener(async id => {
  const { winId, closing } = await chrome.storage.session.get(['winId', 'closing']);
  if (id !== winId) return;
  await chrome.storage.session.remove(['winId', 'closing', 'manual']);
  if (!closing) await chrome.storage.local.set({ dismissedDate: nyNow().date });
});

// Messages from the board page (relayed by bridge.js).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !sender.tab) return;
  if (msg.type === 'select-board') {
    const board = clean(msg.board);
    if (board) { chrome.storage.local.set({ board }); chrome.storage.sync.set({ board }).catch(() => {}); }
  }
  if (msg.type === 'close-board') {
    chrome.storage.session.get('winId').then(({ winId }) =>
      sender.tab.windowId === winId ? chrome.windows.remove(winId) : chrome.tabs.remove(sender.tab.id)   // only ever close our own window
    ).catch(() => {});
  }
});
