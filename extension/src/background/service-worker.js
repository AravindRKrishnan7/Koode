// Background service worker: proxies planner and voice requests to the Koode backend
// (keeps API keys off the page/extension) and stores per-tab task state.
importScripts('../shared/sites.js');
const DEFAULT_BACKEND = 'http://localhost:8787';
const CONTENT_FILES = [
  'src/shared/constants.js', 'src/shared/sites.js', 'src/content/extractor.js', 'src/content/overlay.js', 'src/content/monitor.js',
  'src/content/voice.js', 'src/content/panel.js', 'src/content/controller.js', 'src/content/main.js'
];

async function backendUrl() {
  const { backendUrl } = await chrome.storage.local.get('backendUrl');
  return backendUrl || DEFAULT_BACKEND;
}

async function api(route, payload) {
  let res;
  try {
    res = await fetch((await backendUrl()) + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
  } catch (_) {
    return { error: 'Koode backend not reachable', code: 'offline' };
  }
  const body = await res.json().catch(() => ({ error: 'bad JSON from backend' }));
  if (!res.ok) return { error: body.error || 'backend HTTP ' + res.status, code: body.code, retry_after_ms: body.retry_after_ms, scope: body.scope };
  return body;
}

async function health() {
  try {
    const res = await fetch((await backendUrl()) + '/health');
    return await res.json();
  } catch (_) {
    return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  const key = 'task:' + tabId;
  (async () => {
    switch (msg && msg.type) {
      case 'koode:plan': return api('/api/plan', msg.payload);
      case 'koode:stt': return api('/api/stt', msg.payload);
      case 'koode:tts': return api('/api/tts', msg.payload);
      case 'koode:health': return health();
      // Side panel ⇄ page: the companion session lives here so it survives navigation between sites.
      case 'koode:progress': {
        const p = { ...msg.progress, tabId, url: sender.tab && sender.tab.url, at: Date.now() };
        await chrome.storage.session.set({ progress: p });
        chrome.runtime.sendMessage({ type: 'koode:progress', progress: p }).catch(() => {});
        return true;
      }
      case 'koode:navigate': return navigate(msg.siteId, msg.goal, msg.voice);
      case 'koode:startOnTab': return startOnTab(msg.goal, msg.voice);
      case 'koode:activeTab': return activeTabInfo();
      case 'koode:endSession': return endSession();
      case 'koode:saveTask': await chrome.storage.session.set({ [key]: msg.task }); return true;
      case 'koode:clearTask': await chrome.storage.session.remove(key); return true;
      case 'koode:loadTask': return (await chrome.storage.session.get(key))[key] || null;
      default: return { error: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ error: String(e && e.message || e) }));
  return true;
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function activeTabInfo() {
  const tab = await activeTab();
  const site = tab && self.KoodeSites.forUrl(tab.url || '');
  return { tabId: tab && tab.id, url: tab && tab.url, title: tab && tab.title, site: site && { id: site.id, name: site.name } };
}

// User asked to open a supported site: navigate the current tab (New Tab included) and hand the
// remaining goal to the page, which resumes it after load from tab-scoped task storage.
async function navigate(siteId, goal, voice) {
  const site = self.KoodeSites.SITES.find((s) => s.id === siteId);
  if (!site) return { error: 'unsupported site' };
  const tab = await activeTab();
  if (!tab) return { error: 'no active tab' };
  if (goal) await chrome.storage.session.set({ ['task:' + tab.id]: { goal, voice: !!voice, history: [], step: 0, url: site.url, fresh: true } });
  else await chrome.storage.session.remove('task:' + tab.id);
  await chrome.tabs.update(tab.id, { url: site.url });
  return { ok: true, tabId: tab.id, site: site.name };
}

async function startOnTab(goal, voice) {
  const tab = await activeTab();
  if (!tab || !self.KoodeSites.forUrl(tab.url || '')) return { error: 'unsupported page' };
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'koode:start', goal, voice: !!voice });
  } catch (_) {
    return { error: 'Koode is not loaded on this page yet; reload the page.' };
  }
}

async function endSession() {
  const tab = await activeTab();
  if (tab) { await chrome.storage.session.remove('task:' + tab.id); chrome.tabs.sendMessage(tab.id, { type: 'koode:stop' }).catch(() => {}); }
  await chrome.storage.session.remove('progress');
  return { ok: true };
}

// Toolbar opens the side panel on any page, including the New Tab page.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

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
