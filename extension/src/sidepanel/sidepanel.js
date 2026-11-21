// Browser-level Koode companion (Chrome side panel). Works on any tab, including New Tab:
// opens supported sites on request and mirrors the in-page guidance. Planner/voice stay in the page.
const $ = (id) => document.getElementById(id);
const Sites = self.KoodeSites;
const send = (msg) => chrome.runtime.sendMessage(msg);

function log(t) {
  const li = document.createElement('li');
  li.textContent = new Date().toLocaleTimeString() + ' ' + t;
  $('log').appendChild(li);
  document.body.dataset.koodeLog = String($('log').children.length);
}

function say({ ml, en, notice }) {
  if (ml !== undefined) $('ml').textContent = ml;
  if (en !== undefined) $('en').textContent = en;
  $('notice').textContent = notice || '';
  $('notice').classList.toggle('hidden', !notice);
  document.body.dataset.koodeEn = en || '';
}

async function refreshWhere() {
  const t = await send({ type: 'koode:activeTab' });
  const url = (t && t.url) || '';
  const label = t && t.site ? t.site.name : /^chrome:\/\/newtab|^chrome-search:|^about:blank/.test(url) || !url ? 'New Tab' : 'Unsupported page';
  $('where').textContent = 'Current tab: ' + label;
  document.body.dataset.koodeWhere = label;
  return t;
}

function showProgress(p) {
  if (!p) return;
  $('pill').textContent = p.state || '–';
  document.body.dataset.koodeState = p.state || '';
  document.body.dataset.koodeStep = String(p.step || 0);
  if (p.ml || p.en) say({ ml: p.ml, en: p.en });
  if (p.site) $('where').textContent = 'Current tab: ' + p.site + (p.active ? ' · guiding' : '');
}

async function handle(text) {
  const goal = text.trim();
  if (!goal) return;
  log('request (' + goal.length + ' chars)');
  const m = Sites.match(goal);
  const tab = await refreshWhere();
  if (m && (m.explicitOpen || !tab || !tab.site)) {
    // Navigation only on an explicit request naming a supported site; the rest of the request continues there.
    const rest = m.rest.replace(/^(and|then|ഉം|എന്നിട്ട്)\s+/i, '').trim();
    say({ ml: `${m.site.name} തുറക്കുന്നു…`, en: `Opening ${m.site.name}…` });
    const r = await send({ type: 'koode:navigate', siteId: m.site.id, goal: rest.length > 3 ? rest : '' });
    if (r && r.error) return say({ ml: 'തുറക്കാനായില്ല.', en: 'Could not open it: ' + r.error });
    document.body.dataset.koodeNavigated = m.site.id;
    log('opened ' + m.site.name + (rest.length > 3 ? ' with a follow-up goal' : ''));
    if (rest.length <= 3) say({ ml: `${m.site.name} തുറന്നു. ഇനി എന്ത് ചെയ്യണം?`, en: `${m.site.name} is open. What next?` });
    return;
  }
  if (!tab || !tab.site) {
    return say({ ml: 'ഏത് വെബ്സൈറ്റ് വേണം? ഉദാ: "WhatsApp തുറക്കൂ".', en: 'Which website? I can open: ' + Sites.SITES.map((s) => s.name).join(', ') + '.' });
  }
  const r = await send({ type: 'koode:startOnTab', goal });
  if (r && r.error) say({ ml: 'ഈ പേജിൽ Koode തയ്യാറായിട്ടില്ല.', en: r.error });
  else log('guiding on ' + tab.site.name);
}

$('f').addEventListener('submit', (e) => { e.preventDefault(); handle($('goal').value); $('goal').value = ''; });
$('end').addEventListener('click', async () => {
  await send({ type: 'koode:endSession' });
  say({ ml: 'സെഷൻ അവസാനിപ്പിച്ചു. നന്ദി!', en: 'Session ended. Thank you!' });
  $('pill').textContent = 'Ended';
  document.body.dataset.koodeState = 'ended';
  log('session ended');
});
for (const s of Sites.SITES) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = s.name;
  b.addEventListener('click', () => handle('open ' + s.words[0]));
  $('sitelist').appendChild(b);
}
chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === 'koode:progress') showProgress(msg.progress); });
chrome.tabs.onActivated.addListener(refreshWhere);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete') refreshWhere(); });
(async () => { await refreshWhere(); const { progress } = await chrome.storage.session.get('progress'); showProgress(progress); })();
