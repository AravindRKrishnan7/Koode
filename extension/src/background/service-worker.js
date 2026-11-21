// Background service worker: proxies planner and voice requests to the Koode backend
// (keeps API keys off the page/extension), stores per-tab task state, and connects the
// browser-level side panel with the in-page guide (navigation, progress, spoken replies, exit).
importScripts('../shared/goals.js', '../shared/catalogue.js', '../shared/sites.js');
const DEFAULT_BACKEND = 'http://localhost:8787';

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

// Side panels connect with a port and say which window (and, when opened for tests, which tab) they serve.
const panels = new Set(); // { port, windowId, tabId }
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'koode-sidepanel') return;
  const p = { port, windowId: null, tabId: null };
  panels.add(p);
  port.onMessage.addListener((m) => { if (m && m.type === 'hello') { p.windowId = m.windowId; p.tabId = m.tabId || null; } });
  port.onDisconnect.addListener(() => panels.delete(p));
});
function panelFor(tab) {
  if (!tab) return null;
  for (const p of panels) if (p.tabId === tab.id) return p;
  for (const p of panels) if (!p.tabId && p.windowId === tab.windowId && tab.active) return p;
  return null;
}
function toPanels(tabId, msg) {
  for (const p of panels) if (!p.tabId || p.tabId === tabId) { try { p.port.postMessage({ ...msg, tabId }); } catch (_) {} }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Messages from a web page carry their tab; the side panel (an extension page, which may itself be a
  // tab when opened as a window) names the tab it is bound to.
  const fromExtension = (sender.url || '').startsWith('chrome-extension://' + chrome.runtime.id + '/');
  const pageTab = fromExtension ? null : sender.tab || null;
  const tabId = (pageTab && pageTab.id) || (msg && msg.tabId) || null;
  const key = 'task:' + tabId;
  (async () => {
    switch (msg && msg.type) {
      case 'koode:plan': return api('/api/plan', msg.payload);
      case 'koode:intent': return api('/api/intent', msg.payload);
      case 'koode:youtubeSearch': return youtubeSearch(msg.search, msg.goal, msg.voice, tabId, !!pageTab);
      case 'koode:serviceStatus': return serviceStatus(msg.serviceId);
      case 'koode:openService': return openService(msg, tabId, !!pageTab);
      case 'koode:grantInfo': return (await chrome.storage.session.get('grant:' + msg.grantTab))['grant:' + msg.grantTab] || null;
      case 'koode:stt': return api('/api/stt', msg.payload);
      case 'koode:tts': return api('/api/tts', msg.payload);
      case 'koode:health': return health();
      case 'koode:progress': {
        if (!pageTab) return false;
        const p = { ...msg.progress, tabId, url: pageTab.url, at: Date.now() };
        // After an exit nothing about the session is kept.
        if (p.state === 'ended') await chrome.storage.session.remove('progress:' + tabId);
        else await chrome.storage.session.set({ ['progress:' + tabId]: p });
        toPanels(tabId, { type: 'progress', progress: p });
        return true;
      }
      // Spoken replies play in the side panel when it is open for this tab (it holds the user's gesture,
      // so a freshly navigated page's autoplay policy can't block them); otherwise the page plays them.
      case 'koode:say': {
        const p = panelFor(pageTab);
        if (!p) return { routed: false };
        p.port.postMessage({ type: 'speak', text: msg.text, tabId });
        return { routed: true };
      }
      case 'koode:hush': toPanels(tabId, { type: 'hush' }); return true;
      case 'koode:panelOpen': return { open: !!panelFor(pageTab) };
      case 'koode:navigate': return navigate(msg.siteId, msg.goal, msg.voice, tabId, !!pageTab);
      case 'koode:startOnTab': return startOnTab(msg.goal, msg.voice, tabId);
      case 'koode:tabInfo': return tabInfo(tabId);
      case 'koode:exit': case 'koode:endSession': return exit(tabId, msg.voice, !!pageTab);
      case 'koode:saveTask': if (await staleWriter(tabId, sender)) return false;
        await chrome.storage.session.set({ [key]: msg.task }); return true;
      case 'koode:clearTask': if (await staleWriter(tabId, sender)) return false;
        await chrome.storage.session.remove(key); return true;
      case 'koode:loadTask': return (await chrome.storage.session.get(key))[key] || null;
      case 'koode:loadProgress': return (await chrome.storage.session.get('progress:' + tabId))['progress:' + tabId] || null;
      default: return { error: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ error: String(e && e.message || e) }));
  return true;
});

// While a requested navigation is in flight, task writes from the old page's origin are ignored.
// Kept in session storage so it survives service-worker restarts.
async function staleWriter(tabId, sender) {
  let from;
  try { from = new URL(sender.url || '').origin; } catch (_) { return true; }
  const k = 'nav:' + tabId;
  const origin = (await chrome.storage.session.get(k))[k];
  if (origin) return from !== origin;
  // A page that is unloading (its tab already shows another site) can't write: e.g. after the origin guard
  // stopped a service task, the old official page must not re-save it.
  const tab = sender.tab && sender.tab.id === tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (tab && /^https?:/.test(tab.url || '')) { try { return new URL(tab.url).origin !== from; } catch (_) { return false; } }
  return false;
}
// Any completed load ends the navigation window (destination, redirect, or abandoned navigation).
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') chrome.storage.session.remove('nav:' + tabId).catch(() => {});
});

async function tabInfo(tabId) {
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  const site = tab && self.KoodeSites.forUrl(tab.url || '');
  return { tabId: tab && tab.id, windowId: tab && tab.windowId, url: tab && tab.url, title: tab && tab.title, site: site && { id: site.id, name: site.name, ml: site.ml } };
}

// User asked to open a supported site: navigate that tab (New Tab included) and hand the remaining
// goal to the page, which resumes it after load (and after the page is ready) from tab-scoped storage.
async function navigate(siteId, goal, voice, tabId, fromPage) {
  const site = self.KoodeSites.SITES.find((s) => s.id === siteId);
  if (!site) return { error: 'unsupported site' };
  if (!tabId) return { error: 'no tab' };
  // Stop the old page first (no persist, monitor off) so its navigation handler cannot overwrite the new task.
  if (!fromPage) await chrome.tabs.sendMessage(tabId, { type: 'koode:stop', quiet: true }).catch(() => {});
  await chrome.storage.session.set({ ['nav:' + tabId]: new URL(site.url).origin });
  // `arrival` lets the new page report when it is ready even without a follow-up goal.
  goal = self.KoodeGoals.redact(String(goal || '')).text;
  await chrome.storage.session.set({ ['task:' + tabId]: { goal: goal || '', voice: !!voice, history: [], step: 0, url: site.url, fresh: true, arrival: site.id } });
  await chrome.storage.session.remove('progress:' + tabId);
  toPanels(tabId, { type: 'navigating', site: { id: site.id, name: site.name, ml: site.ml }, goal: goal || '' });
  await chrome.tabs.update(tabId, { url: site.url });
  return { ok: true, tabId, site: site.name };
}

// Automatic YouTube search: the service worker builds the results URL itself from a re-validated plain-text
// query (no URL is ever accepted in a message), then the page continues with grounded guidance.
// If the current page has input the user typed (e.g. a half-filled form), the results open in a new tab
// so nothing is lost.
async function youtubeSearch(search, goal, voice, tabId, fromPage) {
  const G = self.KoodeGoals;
  const q = G.cleanQuery(search && search.query);
  if (!q.ok) return { error: 'invalid search query', reason: q.reason };
  const url = G.youtubeResultsUrl(q.query);
  const fb = search.fallback ? G.cleanQuery(search.fallback) : null;
  const s = { query: q.query, fallback: fb && fb.ok && fb.query !== q.query ? fb.query : null, lang: G.LANGS[search.lang] ? search.lang : 'ml',
    attempt: search.attempt === 2 ? 2 : 1 };
  s.lazyFallback = !!search.lazyFallback && !s.fallback && s.attempt === 1;
  const task = { goal: G.redact(String(goal || '')).text.slice(0, 300) || q.query, voice: !!voice, history: [], step: 0, url, fresh: true, arrival: 'youtube', search: s };
  if (!tabId) return { error: 'no tab' };
  const unsaved = await chrome.tabs.sendMessage(tabId, { type: 'koode:hasUnsavedInput' }).then((r) => !!(r && r.unsaved), () => false);
  if (unsaved) {
    const from = await chrome.tabs.get(tabId).catch(() => null);
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true, ...(from ? { windowId: from.windowId, index: from.index + 1, openerTabId: from.id } : {}) });
    await chrome.storage.session.set({ ['nav:' + tab.id]: new URL(url).origin, ['task:' + tab.id]: task });
    toPanels(tab.id, { type: 'navigating', site: { id: 'youtube', name: 'YouTube', ml: 'യൂട്യൂബ്' }, goal: task.goal });
    await chrome.tabs.update(tab.id, { url });
    return { ok: true, tabId: tab.id, newTab: true, query: s.query, url };
  }
  if (!fromPage) await chrome.tabs.sendMessage(tabId, { type: 'koode:stop', quiet: true }).catch(() => {});
  await chrome.storage.session.set({ ['nav:' + tabId]: new URL(url).origin, ['task:' + tabId]: task });
  await chrome.storage.session.remove('progress:' + tabId);
  toPanels(tabId, { type: 'navigating', site: { id: 'youtube', name: 'YouTube', ml: 'യൂട്യൂബ്' }, goal: task.goal });
  await chrome.tabs.update(tabId, { url });
  return { ok: true, tabId, newTab: false, query: s.query, url };
}

// ---- verified services (catalogue.js) ----
// Chrome access is per host and optional: requested only after the user confirms, only for that entry's
// hosts. Content scripts for a catalogue host are registered only once its host permission is granted.
const CONTENT_JS = chrome.runtime.getManifest().content_scripts[0].js;
async function serviceStatus(serviceId) {
  const e = self.KoodeCatalogue.byId(serviceId);
  if (!e) return { error: 'unknown service' };
  return { granted: await chrome.permissions.contains({ origins: self.KoodeCatalogue.origins(e) }), hosts: e.hosts };
}
async function syncServiceScripts() {
  const Cat = self.KoodeCatalogue;
  const have = new Set((await chrome.scripting.getRegisteredContentScripts().catch(() => [])).map((r) => r.id));
  for (const e of Cat.CATALOGUE) {
    const id = 'koode-svc-' + e.id;
    const granted = await chrome.permissions.contains({ origins: Cat.origins(e) }).catch(() => false);
    if (granted && !have.has(id)) {
      await chrome.scripting.registerContentScripts([{ id, matches: Cat.origins(e), js: CONTENT_JS, runAt: 'document_idle', persistAcrossSessions: true }]).catch((err) => console.warn('register', id, err.message));
    } else if (!granted && have.has(id)) await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
  }
}
chrome.permissions.onAdded.addListener(() => syncServiceScripts());
chrome.permissions.onRemoved.addListener(() => syncServiceScripts());
chrome.runtime.onInstalled.addListener(() => syncServiceScripts());
chrome.runtime.onStartup.addListener(() => syncServiceScripts());
syncServiceScripts();

// Opens a verified service after the user confirmed it. msg: { serviceId, subId, goal, voice }. The URL comes
// from the catalogue only. Without Chrome access yet: from the side panel the panel asks Chrome itself (it holds
// the click); from a web page a one-time grant page is opened (pages cannot ask for permissions).
async function openService(msg, tabId, fromPage) {
  const Cat = self.KoodeCatalogue;
  const e = Cat.byId(msg.serviceId);
  if (!e) return { error: 'unknown service' };
  if (!tabId) return { error: 'no tab' };
  const sub = Cat.serviceOf(e, msg.subId);
  const goal = self.KoodeGoals.redact(String(msg.goal || '')).text.slice(0, 300) || (sub ? sub.en : e.name);
  if (!(await chrome.permissions.contains({ origins: Cat.origins(e) }))) {
    if (!fromPage) return { error: 'permission_needed', code: 'permission_needed' };
    const grantTab = await chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/grant.html'), active: true });
    await chrome.storage.session.set({ ['grant:' + grantTab.id]: { serviceId: e.id, subId: sub && sub.id, goal, voice: !!msg.voice, tabId } });
    return { ok: true, needsGrant: true, grantTab: grantTab.id };
  }
  await syncServiceScripts();
  const task = { goal, voice: !!msg.voice, history: [], step: 0, url: e.entry, fresh: true, arrival: e.id, service: { id: e.id, sub: sub && sub.id } };
  const toNav = async (id) => {
    await chrome.storage.session.set({ ['nav:' + id]: new URL(e.entry).origin, ['task:' + id]: task });
    await chrome.storage.session.remove('progress:' + id);
    toPanels(id, { type: 'navigating', site: { id: e.id, name: e.name, ml: e.ml }, goal });
    await chrome.tabs.update(id, { url: e.entry, active: true });
  };
  const target = tabId;
  const unsaved = await chrome.tabs.sendMessage(target, { type: 'koode:hasUnsavedInput' }).then((r) => !!(r && r.unsaved), () => false);
  if (unsaved) {
    const from = await chrome.tabs.get(target).catch(() => null);
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true, ...(from ? { windowId: from.windowId, index: from.index + 1, openerTabId: from.id } : {}) });
    await toNav(tab.id);
    return { ok: true, tabId: tab.id, newTab: true, host: e.hosts[0] };
  }
  if (!fromPage) await chrome.tabs.sendMessage(target, { type: 'koode:stop', quiet: true }).catch(() => {});
  await toNav(target);
  return { ok: true, tabId: target, newTab: false, host: e.hosts[0] };
}

// Origin guard: a service task stays on its verified hosts. If the tab goes anywhere else (a redirect, a link
// to another site), guidance pauses and the side panel says why. Koode never follows the user off-site.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url || !/^https?:/.test(info.url)) return;
  const k = 'task:' + tabId;
  const task = (await chrome.storage.session.get(k))[k];
  if (!task || !task.service) return;
  const e = self.KoodeCatalogue.byId(task.service.id);
  if (e && self.KoodeCatalogue.onHosts(e, info.url)) return;
  await chrome.storage.session.remove([k, 'nav:' + tabId]);
  const m = self.KoodeGoals.MSG.offSite;
  const p = { state: 'stopped', ml: m.ml, en: m.en, offSite: true, tabId, at: Date.now() };
  await chrome.storage.session.set({ ['progress:' + tabId]: p });
  toPanels(tabId, { type: 'progress', progress: p });
});

async function startOnTab(goal, voice, tabId) {
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab || !self.KoodeSites.forUrl(tab.url || '')) return { error: 'unsupported page' };
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'koode:start', goal, voice: !!voice });
  } catch (_) {
    return { error: 'Koode is not loaded on this page yet; reload the page.' };
  }
}

// Clean exit: forget the task, the navigation lock and the progress mirror; close the in-page guide;
// tell the side panel so it can say goodbye and close.
async function exit(tabId, voice, fromPage) {
  if (tabId) {
    await chrome.storage.session.remove(['task:' + tabId, 'nav:' + tabId, 'progress:' + tabId]);
    if (!fromPage) await chrome.tabs.sendMessage(tabId, { type: 'koode:exit' }).catch(() => {});
  }
  toPanels(tabId, { type: 'ended', voice: !!voice });
  return { ok: true };
}

// Toolbar opens the side panel on any page, including the New Tab page.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(['task:' + tabId, 'nav:' + tabId, 'progress:' + tabId]));
