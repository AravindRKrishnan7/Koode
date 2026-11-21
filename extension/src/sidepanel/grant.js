// One-time grant page, opened when a verified service was confirmed in the in-page panel (web pages cannot ask
// Chrome for permissions). Asks for the catalogue entry's hosts only, then opens the service in the original tab.
const Cat = self.KoodeCatalogue;
const $ = (id) => document.getElementById(id);
let info = null, entry = null;
(async () => {
  const me = await chrome.tabs.getCurrent();
  info = await chrome.runtime.sendMessage({ type: 'koode:grantInfo', grantTab: me.id });
  entry = info && Cat.byId(info.serviceId);
  if (!entry) { $('what').textContent = 'Nothing to open. You can close this tab.'; return; }
  $('what').innerHTML = '';
  const b = document.createElement('b'); b.textContent = entry.ml + ' · ' + entry.name;
  const h = document.createElement('span'); h.className = 'host'; h.textContent = entry.hosts.join(', ');
  $('what').append(b, document.createElement('br'), h, document.createTextNode(` · പരിശോധിച്ചത് / verified ${entry.verified.on}`));
  $('allow').disabled = false;
  document.body.dataset.koodeGrantReady = entry.id;
})();
$('allow').addEventListener('click', () => {
  // Must be called directly from the click (user gesture).
  chrome.permissions.request({ origins: Cat.origins(entry) }).then(async (ok) => {
    document.body.dataset.koodeGranted = String(ok);
    if (!ok) { $('status').textContent = 'അനുവാദം നൽകിയില്ല; ഒന്നും തുറന്നില്ല. · Access not granted; nothing was opened.'; return; }
    const r = await chrome.runtime.sendMessage({ type: 'koode:openService', tabId: info.tabId, serviceId: info.serviceId, subId: info.subId, goal: info.goal, voice: info.voice });
    if (r && r.error) { $('status').textContent = 'Could not open: ' + r.error; return; }
    window.close();
  });
});
$('cancel').addEventListener('click', () => window.close());
