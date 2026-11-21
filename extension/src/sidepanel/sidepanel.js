// Browser-level Koode companion (Chrome side panel). Works on any tab, including New Tab, where content
// scripts cannot run: Malayalam push-to-talk, rule-based routing (open a supported site / guide here /
// exit), a mirror of the in-page guidance, and playback of the guide's spoken replies.
// The planner, arrow and step verification stay in the page.
const $ = (id) => document.getElementById(id);
const Sites = self.KoodeSites;
const voice = globalThis.Koode.voice;
const send = (msg) => chrome.runtime.sendMessage(msg);
const params = new URLSearchParams(location.search);
const PINNED_TAB = Number(params.get('tabId')) || null; // tests open the panel as a window bound to one tab

const S = { tabId: null, windowId: null, site: null, url: '', voiceSession: false, confirming: false, voiceToken: 0, spoken: 0, exiting: false };

function log(t) {
  const li = document.createElement('li');
  li.textContent = new Date().toLocaleTimeString() + ' ' + t;
  $('log').appendChild(li);
  document.body.dataset.koodeLog = String($('log').children.length);
  document.body.dataset.koodeLastLog = t;
}

const STATE_LABEL = { idle: 'Ready', listening: 'Listening…', transcribing: 'Understanding…', confirm: 'Is this right?', loading: 'Opening…',
  finding: 'Finding…', waiting: 'Your turn', verified: 'Verified ✓', recovering: 'Let’s fix that', done: 'Done ✓', error: 'Problem',
  stopped: 'Stopped', login: 'Log in first', ended: 'Ended' };
function setState(st) {
  $('pill').textContent = STATE_LABEL[st] || st || '–';
  document.body.dataset.koodeState = st || '';
}

function say({ ml, en, notice }) {
  if (ml !== undefined) $('ml').textContent = ml;
  if (en !== undefined) $('en').textContent = en;
  setNotice(notice);
  document.body.dataset.koodeEn = $('en').textContent;
  document.body.dataset.koodeMl = $('ml').textContent;
}
function setNotice(text, action) {
  const n = $('notice');
  n.textContent = text || '';
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = action.label; b.id = action.id || '';
    b.addEventListener('click', action.run);
    n.appendChild(document.createElement('br'));
    n.appendChild(b);
  }
  n.classList.toggle('hidden', !text);
  if (text) document.body.dataset.koodeNotice = text; else delete document.body.dataset.koodeNotice;
}

// Speaks Malayalam through the backend (Sarvam, or the labelled mock in tests). Text stays on screen regardless.
async function speak(text) {
  if (!text) return;
  try {
    const t = await voice.speak(text);
    S.spoken += 1;
    document.body.dataset.koodeSpoken = String(S.spoken);
    if (t) log(`spoke ${text.length} chars in ${t.ms} ms`);
  } catch (e) {
    log('spoken reply failed: ' + (e.code || e.message));
    document.body.dataset.koodeVoiceError = 'tts: ' + (e.code || e.message);
  }
}
// The voice module reports level/speaking through Koode.panel hooks.
Object.assign(globalThis.Koode.panel, {
  setLevel: (v) => { $('level').style.width = Math.round(v * 100) + '%'; },
  setSpeaking: (on) => document.body.classList.toggle('speaking', !!on),
  releaseMic: () => micUp()
});

// ---- which tab this panel serves ----
async function bindTab() {
  let tab = null;
  if (PINNED_TAB) tab = await chrome.tabs.get(PINNED_TAB).catch(() => null);
  else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  S.tabId = tab ? tab.id : null;
  S.windowId = tab ? tab.windowId : null;
  S.url = (tab && tab.url) || '';
  S.site = tab ? Sites.forUrl(S.url) : null;
  const label = S.site ? S.site.name : /^chrome:\/\/newtab|^chrome-search:|^about:blank|^chrome:\/\/new-tab-page/.test(S.url) || !S.url ? 'New Tab' : 'a page Koode does not guide';
  $('where').textContent = 'ഇപ്പോഴത്തെ ടാബ് · Current tab: ' + label;
  document.body.dataset.koodeWhere = label;
  document.body.dataset.koodeTab = String(S.tabId || '');
  if (port) port.postMessage({ type: 'hello', windowId: S.windowId, tabId: PINNED_TAB });
  return tab;
}

// ---- requests (typed or confirmed speech) ----
async function handle(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!raw) return;
  S.voiceSession = !!opts.voice;
  S.exiting = false;
  clearTimeout(closeTimer);
  await bindTab();
  const c = Sites.classify(raw, { siteId: S.site && S.site.id });
  document.body.dataset.koodeIntent = c.type + (c.site ? ':' + c.site.id : '');
  log(`request (${raw.length} chars, ${opts.voice ? 'voice' : 'typed'}) → ${c.type}${c.site ? ' ' + c.site.id : ''}`);
  const talk = (ml, en) => { say({ ml, en }); if (opts.voice) speak(ml); };
  switch (c.type) {
    case 'exit': return exit(opts.voice);
    case 'navigate': {
      setState('loading');
      talk(`${c.site.ml} തുറക്കുന്നു…`, `Opening ${c.site.name}…`);
      const r = await send({ type: 'koode:navigate', tabId: S.tabId, siteId: c.site.id, goal: c.goal, voice: !!opts.voice });
      if (r && r.error) { setState('error'); return say({ ml: 'തുറക്കാനായില്ല.', en: 'Could not open it: ' + r.error }); }
      document.body.dataset.koodeNavigated = c.site.id;
      log('opening ' + c.site.name + (c.goal ? ' with a follow-up request' : ''));
      return;
    }
    case 'already_here': setState('idle'); return talk(`${c.site.ml} ഇതിനകം തുറന്നിട്ടുണ്ട്. എന്താണ് ചെയ്യേണ്ടത്?`, `${c.site.name} is already open. What would you like to do here?`);
    case 'need_link': setState('idle'); return talk('നിങ്ങളുടെ Google Form ലിങ്ക് (WhatsApp, ഇമെയിൽ) തുറക്കൂ; അവിടെ ഞാൻ സഹായിക്കാം. പരിശീലനത്തിന് "അപേക്ഷാ ഫോം തുറക്കൂ" എന്ന് പറയൂ.',
      'Open your Google Form link (from WhatsApp or email) and I will help there. To practise, say “open the application form”.');
    case 'which_site': setState('idle'); return talk('ഏത് വെബ്സൈറ്റ് വേണം? ഉദാ: "വാട്സ്ആപ്പ് തുറക്കൂ", "യൂട്യൂബ് തുറക്കൂ", "അപേക്ഷാ ഫോം തുറക്കൂ".',
      'Which website? I can open: ' + Sites.SITES.map((s) => s.name).join(', ') + '.');
    case 'guide': {
      setState('finding');
      say({ ml: 'ശരി, ഈ പേജിൽ നോക്കുന്നു…', en: 'Okay — looking at this page…' });
      const r = await send({ type: 'koode:startOnTab', tabId: S.tabId, goal: c.goal, voice: !!opts.voice });
      if (r && r.error) { setState('error'); return say({ ml: 'ഈ പേജിൽ Koode തയ്യാറായിട്ടില്ല. പേജ് റീലോഡ് ചെയ്യൂ.', en: r.error }); }
      log('guiding on ' + (S.site ? S.site.name : 'this page'));
      return;
    }
    default: return;
  }
}

async function exit(byVoice) {
  S.exiting = true;
  hideConfirm();
  await send({ type: 'koode:exit', tabId: S.tabId, voice: !!byVoice });
  ended(true, byVoice);
}

// Session over: show goodbye, speak it if the user was talking, then close the panel.
let closeTimer = 0;
function ended(mine, byVoice) {
  setState('ended');
  const ml = 'ശരി, Koode അവസാനിപ്പിച്ചു. നന്ദി! വീണ്ടും വേണമെങ്കിൽ Koode ബട്ടൺ അമർത്തൂ.';
  say({ ml, en: 'Okay — Koode session ended. Thank you! Click the Koode button whenever you need help again.' });
  log('session ended');
  S.voiceSession = false;
  clearTimeout(closeTimer);
  const close = () => {
    if (params.get('stay') === '1') return; // tests keep the window to read its state
    if (chrome.sidePanel && chrome.sidePanel.close && S.windowId && !PINNED_TAB) chrome.sidePanel.close({ windowId: S.windowId }).catch(() => window.close());
    else window.close();
  };
  if (mine && byVoice) speak('ശരി, Koode അവസാനിപ്പിച്ചു. നന്ദി!').finally(() => { closeTimer = setTimeout(close, 1500); });
  else if (mine) closeTimer = setTimeout(close, 2500);
}

// ---- push-to-talk ----
let pressed = false;
async function micDown() {
  if (pressed) return;
  pressed = true;
  S.voiceToken += 1;
  voice.hush();
  hideConfirm();
  $('mic').classList.add('on');
  try {
    await voice.start();
  } catch (e) {
    pressed = false;
    $('mic').classList.remove('on');
    return micProblem(e);
  }
  if (!voice.isRecording()) return;
  setState('listening');
  say({ ml: 'കേൾക്കുന്നു… പറഞ്ഞു കഴിഞ്ഞാൽ ബട്ടൺ വിടൂ.', en: 'Listening… release the button when you finish.' });
}

async function micUp() {
  if (!pressed) return;
  pressed = false;
  $('mic').classList.remove('on');
  if (!voice.isRecording()) return;
  const my = S.voiceToken;
  const clip = await voice.stop();
  if (my !== S.voiceToken) return;
  if (!clip) { setState('idle'); return say({ ml: 'ബട്ടൺ അമർത്തിപ്പിടിച്ചുകൊണ്ട് സംസാരിക്കൂ, പറഞ്ഞു കഴിഞ്ഞ് വിടൂ.', en: 'Hold the mic button while you speak, then release it.' }); }
  setState('transcribing');
  say({ ml: 'നിങ്ങൾ പറഞ്ഞത് മനസ്സിലാക്കുന്നു…', en: 'Understanding what you said…' });
  const t0 = performance.now();
  let resp;
  try { resp = await voice.transcribe(clip); } catch (e) { resp = { error: String(e && e.message || e) }; }
  if (my !== S.voiceToken) return;
  document.body.dataset.koodeSttMs = String(Math.round(performance.now() - t0));
  document.body.dataset.koodeAudioMs = String(clip.ms);
  if (!resp || resp.error) {
    setState('idle');
    const why = { not_configured: 'ഈ Koode സെർവറിൽ ശബ്ദ സൗകര്യം ഇല്ല. ദയവായി ടൈപ്പ് ചെയ്യൂ. · Voice is not set up on this server; please type.',
      offline: 'Koode സെർവറുമായി ബന്ധപ്പെടാനായില്ല. · Koode backend is not reachable. Is it running?',
      timeout: 'ശബ്ദ സേവനം മറുപടി നൽകിയില്ല. ഒന്നുകൂടി പറയൂ. · The speech service did not answer in time; try again or type.',
      rate_limited: 'ശബ്ദ സേവനം തിരക്കിലാണ്. കുറച്ച് കഴിഞ്ഞ് പറയൂ. · The speech service is busy; try again shortly or type.' }[resp && resp.code];
    document.body.dataset.koodeVoiceError = 'stt: ' + (resp && (resp.code || resp.error) || 'no response');
    return say({ ml: 'ക്ഷമിക്കണം, മനസ്സിലായില്ല.', en: "Sorry, I didn't catch that.", notice: why || 'ഒന്നുകൂടി പറയൂ, അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യൂ. · Try again or type your request.' });
  }
  if (!resp.transcript) { setState('idle'); return say({ ml: 'ഒന്നും കേട്ടില്ല. മൈക്കിനടുത്ത് വ്യക്തമായി പറയൂ.', en: 'I heard nothing. Speak clearly near the microphone, or type.' }); }
  log(`voice: ${clip.ms} ms audio → ${resp.transcript.length}-char transcript (${resp.model})`);
  // Nothing happens until the user confirms (or corrects) what Koode heard.
  setState('confirm');
  S.confirming = true;
  $('heard').textContent = resp.transcript;
  $('goal').value = resp.transcript;
  $('confirm').classList.remove('hidden');
  document.body.dataset.koodeHeard = resp.transcript;
  say({ ml: 'ഇതാണോ നിങ്ങൾ പറഞ്ഞത്? ശരിയാണെങ്കിൽ "ശരി" അമർത്തൂ.', en: 'Is this what you said? Press ✓, edit the text, or speak again.' });
  $('yes').focus();
  speak('ഇതാണോ നിങ്ങൾ പറഞ്ഞത്? ' + resp.transcript);
}

function hideConfirm() {
  S.confirming = false;
  $('confirm').classList.add('hidden');
  delete document.body.dataset.koodeHeard;
}

// The side panel can't always show Chrome's microphone prompt itself; a one-time extension tab grants it.
function micProblem(e) {
  setState('idle');
  const name = e && e.name;
  document.body.dataset.koodeVoiceError = 'mic: ' + (name || e.message);
  log('mic problem: ' + name);
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    say({ ml: 'മൈക്ക് അനുവാദം വേണം.', en: 'Koode needs microphone permission.' });
    return setNotice('ഒരു തവണ മാത്രം: താഴെ അമർത്തി "Allow" തിരഞ്ഞെടുക്കൂ, എന്നിട്ട് വീണ്ടും മൈക്ക് അമർത്തൂ. · One time only: press below, choose “Allow”, then hold the mic again.',
      { label: '🎤 മൈക്ക് അനുവദിക്കുക · Allow microphone', id: 'grant', run: () => chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/mic.html') }) });
  }
  const msg = { NotFoundError: 'മൈക്രോഫോൺ കണ്ടെത്തിയില്ല. ദയവായി ടൈപ്പ് ചെയ്യൂ. · No microphone found; please type.',
    NotReadableError: 'മൈക്ക് മറ്റൊരു ആപ്പ് ഉപയോഗിക്കുന്നു. · The microphone is in use by another app.' }[name];
  say({ ml: 'മൈക്ക് ഉപയോഗിക്കാനായില്ല.', en: 'Could not use the microphone.', notice: msg || 'ദയവായി ടൈപ്പ് ചെയ്യൂ. · Please type your request.' });
}

const mic = $('mic');
mic.addEventListener('pointerdown', (e) => { e.preventDefault(); mic.setPointerCapture(e.pointerId); micDown(); });
mic.addEventListener('pointerup', () => micUp());
mic.addEventListener('pointercancel', () => micUp());
mic.addEventListener('keydown', (e) => { if (e.key !== ' ' && e.key !== 'Enter') return; e.preventDefault(); if (!e.repeat) micDown(); });
mic.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); micUp(); } });
mic.addEventListener('blur', () => micUp());

$('yes').addEventListener('click', () => submit());
$('again').addEventListener('click', () => { hideConfirm(); $('goal').value = ''; voice.hush(); setState('idle'); say({ ml: 'മൈക്ക് അമർത്തിപ്പിടിച്ച് ഒന്നുകൂടി പറയൂ.', en: 'Hold the mic and say it again.' }); mic.focus(); });
// While a transcript awaits confirmation, Go/Enter confirms the (possibly edited) text as a spoken request.
function submit() {
  const text = $('goal').value;
  const byVoice = S.confirming;
  hideConfirm();
  $('goal').value = '';
  voice.hush();
  handle(text, { voice: byVoice });
}
$('f').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
$('end').addEventListener('click', () => exit(S.voiceSession));
for (const s of Sites.SITES) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = s.name; b.dataset.site = s.id;
  b.addEventListener('click', () => handle('open ' + s.words[0]));
  $('sitelist').appendChild(b);
}

// ---- mirror of the in-page guide ----
function showProgress(p) {
  if (!p || (S.tabId && p.tabId !== S.tabId) || S.exiting) return;
  if (p.state) setState(p.state);
  document.body.dataset.koodeStep = String(p.step || 0);
  if (p.ml || p.en) say({ ml: p.ml, en: p.en });
  if (p.site) $('where').textContent = 'ഇപ്പോഴത്തെ ടാബ് · Current tab: ' + p.site + (p.active ? ' · guiding' : '');
  if (p.arrived) document.body.dataset.koodeArrived = p.siteId || '';
  if (p.login) document.body.dataset.koodeLogin = 'true';
}

let port = null;
function connect() {
  port = chrome.runtime.connect({ name: 'koode-sidepanel' });
  port.postMessage({ type: 'hello', windowId: S.windowId, tabId: PINNED_TAB });
  port.onMessage.addListener((m) => {
    if (!m || (S.tabId && m.tabId && m.tabId !== S.tabId)) return;
    if (m.type === 'progress') showProgress(m.progress);
    if (m.type === 'speak') speak(m.text);
    if (m.type === 'hush') voice.hush();
    if (m.type === 'navigating') { S.exiting = false; delete document.body.dataset.koodeArrived; delete document.body.dataset.koodeLogin; }
    if (m.type === 'ended' && !S.exiting) { S.exiting = true; ended(false); }
  });
  // A service-worker restart drops the port; reconnect so replies keep reaching this panel.
  port.onDisconnect.addListener(() => setTimeout(connect, 300));
}

chrome.tabs.onActivated.addListener(() => { if (!PINNED_TAB) bindTab().then(loadProgress); });
chrome.tabs.onUpdated.addListener((id, info) => { if (id === S.tabId && (info.status === 'complete' || info.url)) bindTab(); });

async function loadProgress() {
  const p = S.tabId && await send({ type: 'koode:loadProgress', tabId: S.tabId });
  if (p) showProgress(p);
}

(async () => {
  await bindTab();
  connect();
  await loadProgress();
  const h = await send({ type: 'koode:health' }).catch(() => null);
  const why = voice.supported();
  if (why || (h && h.ok && !h.voice)) {
    mic.classList.add('unavail');
    mic.title = why ? 'Recording not supported here' : 'Voice is not configured on the Koode server';
    document.body.dataset.koodeVoiceAvailable = 'false';
  } else document.body.dataset.koodeVoiceAvailable = 'true';
  if (h && h.ok === false) setNotice('Koode സെർവർ ഓഫാണ്. · The Koode backend is not running.');
  const labels = [];
  if (h && h.mock) labels.push('MOCK planner (not AI)');
  if (h && h.speech === 'mock') labels.push('MOCK speech (not Sarvam)');
  if (labels.length) { $('mock').textContent = labels.join(' · '); $('mock').classList.remove('hidden'); }
  document.body.dataset.koodeSpeech = (h && h.speech) || '';
  document.body.dataset.koodeReady = 'true';
})();
