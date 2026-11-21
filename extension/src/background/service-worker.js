// Background service worker: proxies planner requests to the Koode backend
// (keeps API keys off the page/extension) and stores per-tab task state.
const DEFAULT_BACKEND = 'http://localhost:8787';
const CONTENT_FILES = [
  'src/shared/constants.js', 'src/content/extractor.js', 'src/content/overlay.js', 'src/content/monitor.js',
  'src/content/panel.js', 'src/content/controller.js', 'src/content/main.js'
];

async function backendUrl() {
  const { backendUrl } = await chrome.storage.local.get('backendUrl');
  return backendUrl || DEFAULT_BACKEND;
}

async function plan(payload) {
  const res = await fetch((await backendUrl()) + '/api/plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({ error: 'bad JSON from backend' }));
  if (!res.ok) return { error: body.error || 'backend HTTP ' + res.status };
  return body;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  const key = 'task:' + tabId;
  (async () => {
    switch (msg && msg.type) {
      case 'koode:plan': return plan(msg.payload);
      case 'koode:saveTask': await chrome.storage.session.set({ [key]: msg.task }); return true;
      case 'koode:clearTask': await chrome.storage.session.remove(key); return true;
      case 'koode:loadTask': return (await chrome.storage.session.get(key))[key] || null;
      default: return { error: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ error: String(e && e.message || e) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove('task:' + tabId));

// Toolbar click = explicit permission to inspect the current tab (activeTab).
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    await chrome.tabs.sendMessage(tab.id, { type: 'koode:open' });
  } catch (e) {
    console.warn('Koode cannot run on this page:', e);
  }
});
