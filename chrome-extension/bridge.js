// Runs on portal.csjax.org/classroom: tells the page the extension is installed and relays
// its "Close board" button and the teacher's class choice to the extension.
document.documentElement.dataset.launcher = '1';
window.addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin || !e.data) return;
  if (e.data.ccsKiosk === 'close') chrome.runtime.sendMessage({ type: 'close-board' });
  if (e.data.ccsKiosk === 'select' && typeof e.data.board === 'string') chrome.runtime.sendMessage({ type: 'select-board', board: e.data.board });
});
