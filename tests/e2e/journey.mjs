// Full companion journey in a real Chrome (Chrome for Testing) with the unpacked extension:
//   New Tab → WhatsApp Web → YouTube → practice application form → Exit
// driven from the side panel by (mock) Malayalam voice. Every page action is a real CDP input event
// (isTrusted): mouse clicks and keyboard typing. Koode never clicks or types.
//
// Offline and quota-free by design: refuses to run unless the backend uses the labelled MOCK planner and
// MOCK speech (KOODE_PROVIDER=mock KOODE_SPEECH=mock). WhatsApp and YouTube are local test fixtures served
// at their real hostnames through request interception (tests/e2e/fixtures/), so no login is needed.
//
// Usage: node e2e/journey.mjs [--headed] [--only journey|editor|inpage|real] [--budget]
//   --only real  opens the real web.whatsapp.com (logged out) and www.youtube.com instead of fixtures
//   --budget  measure planner payload size per page (run once with KOODE_EXT=<old extension> to compare)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const EXT = process.env.KOODE_EXT || path.join(ROOT, 'extension');
const ARTIFACTS = path.join(ROOT, 'artifacts', 'e2e');
const BACKEND = process.env.KOODE_BACKEND || 'http://localhost:8787';
// The extension's site list opens the practice form at localhost:8787; tests serve demo pages from disk
// so they never depend on (or reach) whatever backend runs on 8787.
const DEMO_ORIGIN = 'http://localhost:8787';
const LOG = path.join(ROOT, 'backend', 'logs', 'plan-requests.jsonl');
const FIX = path.join(here, 'fixtures');
const args = process.argv.slice(2);
const headed = args.includes('--headed');
const budgetMode = args.includes('--budget');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const SECRETS = { name: 'Ravi Kumar Testcase', mobile: '9876543210', password: 'demo-Secret-4821', dob: ['01', '15', '1950'] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readLog = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '');
const logEntries = (from) => readLog().slice(from).split('\n').filter(Boolean).map((l) => JSON.parse(l));

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(os.homedir(), '.cache', 'koode-cft', 'chrome');
  if (fs.existsSync(base)) {
    const v = fs.readdirSync(base).filter((d) => d.startsWith('mac') || d.startsWith('linux')).sort().pop();
    if (v) {
      const mac = path.join(base, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
      if (fs.existsSync(mac)) return mac;
      const lin = path.join(base, v, 'chrome-linux64', 'chrome');
      if (fs.existsSync(lin)) return lin;
    }
  }
  throw new Error('Set CHROME_PATH to Chrome for Testing (branded Chrome ignores --load-extension)');
}

// A few seconds of quiet tone for Chrome's fake microphone (the mock STT does not decode it).
function fakeMicWav() {
  const file = path.join(ARTIFACTS, 'fake-mic-tone.wav');
  const rate = 16000, n = rate * 3, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 6000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}

// ---- checks ----
const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }

// ---- page (in-page guide) helpers ----
async function pageState(page) {
  return page.evaluate(() => {
    const h = document.querySelector('#koode-panel-root');
    const o = document.querySelector('#koode-overlay-root');
    return h ? { ...h.dataset, overlay: o ? { ...o.dataset } : null } : null;
  }).catch(() => null);
}
async function waitPage(page, pred, desc, timeout = 30000) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < timeout) { last = await pageState(page); if (last && pred(last)) return last; await sleep(100); }
  throw new Error(`timeout waiting for ${desc}; last=${JSON.stringify(last)}`);
}
async function pointedElement(page) {
  return page.evaluate(() => {
    const o = document.querySelector('#koode-overlay-root');
    if (!o || !o.dataset.koodeRect) return null;
    const [x, y, w, h] = o.dataset.koodeRect.split(',').map(Number);
    const el = document.elementsFromPoint(x + w / 2, y + h / 2).find((e) => !e.closest('#koode-overlay-root,#koode-panel-root'));
    if (!el) return null;
    const ctl = el.closest('input,select,textarea,button,a,label,[role],[contenteditable]') || el;
    const real = ctl.tagName === 'LABEL' && ctl.control ? ctl.control : ctl;
    const r = (real.getClientRects().length && real.offsetParent !== null ? real : ctl).getBoundingClientRect();
    return { tag: real.tagName.toLowerCase(), type: real.type || '', role: real.getAttribute('role') || '', id: real.id, name: real.getAttribute('name') || '',
      label: real.getAttribute('aria-label') || (real.innerText || '').slice(0, 60), inPrivate: !!real.closest('#pane-side,#main'), rect: [r.left, r.top, r.width, r.height] };
  });
}
async function perform(page, el, text) {
  const [x, y, w, h] = el.rect;
  const cy = y + h / 2;
  if (text !== undefined) { await page.mouse.click(x + Math.min(w / 2, 40), cy); await page.keyboard.type(text, { delay: 20 }); return; }
  if (el.tag === 'input' && ['text', 'tel', 'password', 'date'].includes(el.type)) {
    await page.mouse.click(x + w / 2, cy);
    if (el.type === 'date') { for (const part of SECRETS.dob) await page.keyboard.type(part); }
    else await page.keyboard.type(el.type === 'tel' ? SECRETS.mobile : el.type === 'password' ? SECRETS.password : SECRETS.name, { delay: 15 });
    await page.keyboard.press('Tab');
  } else if (el.tag === 'select') {
    // macOS opens a native popup on click: close it, then choose by type-ahead (a trusted change event).
    await page.mouse.click(x + w / 2, cy); await sleep(200);
    await page.keyboard.press('Escape'); await sleep(100);
    await page.keyboard.type('Er'); await sleep(150);
    await page.keyboard.press('Tab');
  } else await page.mouse.click(x + Math.min(w / 2, 20), cy);
}
// Guided steps until done: waits for each arrow, then performs the user's action on what it points at.
async function followSteps(page, name, { maxSteps = 12, act } = {}) {
  const steps = []; let last = 0;
  for (let i = 0; i < maxSteps; i++) {
    const p = await waitPage(page, (q) => (q.koodeState === 'waiting' && Number(q.koodeStep) > last && q.overlay && q.overlay.koodeTip) || q.koodeState === 'done' || q.koodeState === 'error', `${name} next step`, 30000);
    if (p.koodeState !== 'waiting') return { steps, state: p.koodeState, instruction: p.koodeInstruction, planner: p.koodePlanner };
    last = Number(p.koodeStep);
    await sleep(350);
    const el = await pointedElement(page);
    steps.push({ step: last, target: p.koodeTarget, pointedAt: el && { tag: el.tag, id: el.id, name: el.name, label: el.label, inPrivate: el.inPrivate } });
    await page.screenshot({ path: path.join(ARTIFACTS, `journey-${name}-step${last}.png`) }).catch(() => {});
    if (act) await act(el, p); else await perform(page, el);
  }
  return { steps, state: 'max_steps' };
}

// ---- side panel helpers ----
const panelState = (sp) => sp.evaluate(() => ({ ...document.body.dataset })).catch(() => null);
async function waitPanel(sp, pred, desc, timeout = 20000) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < timeout) { last = await panelState(sp); if (last && pred(last)) return last; await sleep(100); }
  throw new Error(`timeout waiting for panel ${desc}; url=${sp.url()} last=${JSON.stringify(last)}`);
}
// Push-to-talk in the side panel with a real mouse press; the mock STT returns `transcript`, then the user confirms ✓.
async function speak(sp, transcript, { confirm = true } = {}) {
  await fetch(BACKEND + '/test/stt-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcripts: [transcript] }) });
  const box = await sp.locator('#mic').boundingBox();
  await sp.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sp.mouse.down();
  await waitPanel(sp, (q) => q.koodeState === 'listening' || q.koodeVoiceError, 'listening', 5000);
  await sleep(1300);
  await sp.mouse.up();
  const c = await waitPanel(sp, (q) => q.koodeState === 'confirm' || (q.koodeVoiceError && q.koodeState === 'idle'), 'transcript confirmation', 10000);
  if (c.koodeState !== 'confirm') throw new Error('no confirmation: ' + c.koodeVoiceError);
  if (c.koodeHeard !== transcript) throw new Error('heard ' + c.koodeHeard);
  if (confirm) await sp.locator('#yes').click();
  return c;
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const health = await fetch(BACKEND + '/health').then((r) => r.json());
  // Quota guard: this suite must never spend Groq or Sarvam credits.
  if (!(health.mock && health.speech === 'mock') && process.env.KOODE_E2E_ALLOW_PAID !== '1') {
    throw new Error(`refusing to run: backend must be MOCK planner + MOCK speech (got provider=${health.provider}, speech=${health.speech}). Start it with KOODE_PROVIDER=mock KOODE_SPEECH=mock.`);
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koode-journey-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath(), headless: !headed, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fakeMicWav()}`, '--autoplay-policy=user-gesture-required']
  });
  // Fixture hosts: WhatsApp and YouTube stand-ins, Google Forms respondent page and editor.
  // `--only real` skips them and opens the real sites (no account; mock planner, so no model quota).
  const served = [];
  await ctx.route((u) => u.origin === DEMO_ORIGIN && u.pathname.startsWith('/demo/'), (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/demo\/?/, '') || 'index.html';
    const file = path.resolve(ROOT, 'demo-site', rel);
    if (!file.startsWith(path.join(ROOT, 'demo-site')) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
  });
  if (only !== 'real') await ctx.route(/^https:\/\/(web\.whatsapp\.com|www\.youtube\.com|docs\.google\.com)\//, (route) => {
    const u = new URL(route.request().url());
    served.push(u.host + u.pathname);
    let file = null;
    if (u.host === 'web.whatsapp.com' && route.request().resourceType() === 'document') file = path.join(FIX, 'whatsapp.html');
    else if (u.host === 'www.youtube.com' && route.request().resourceType() === 'document') file = path.join(FIX, 'youtube.html');
    else if (u.host === 'docs.google.com' && /\/viewform$/.test(u.pathname)) file = path.join(ROOT, 'demo-site', 'gforms.html');
    else if (u.host === 'docs.google.com' && /\/edit$/.test(u.pathname)) file = path.join(FIX, 'gforms-editor.html');
    if (!file) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(file) });
  });
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 10000 }));
  const extId = new URL(sw.url()).host;
  // Point the extension at the test backend (chrome.storage.local backendUrl override).
  await sw.evaluate((u) => chrome.storage.local.set({ backendUrl: u }), BACKEND);
  const version = await (await ctx.newCDPSession(ctx.pages()[0] || (await ctx.newPage()))).send('Browser.getVersion').then((v) => v.product).catch(() => '?');
  const results = { browser: version, backend: health, extension: EXT, startedAt: new Date().toISOString() };
  const logStart = readLog().length;

  const tabIdOf = async (urlPrefix) => sw.evaluate(async (p) => (await chrome.tabs.query({})).filter((t) => (t.url || t.pendingUrl || '').startsWith(p)).map((t) => t.id).pop(), urlPrefix);
  const openPanel = async (tabId) => {
    await sw.evaluate((u) => chrome.windows.create({ url: u, type: 'popup', width: 400, height: 860 }), `chrome-extension://${extId}/src/sidepanel/sidepanel.html?tabId=${tabId}&stay=1`);
    let sp = null; // the page event fires before the URL commits, so look the page up by URL
    for (let i = 0; i < 100 && !sp; i++) { sp = ctx.pages().find((p) => p.url().includes('sidepanel.html?tabId=' + tabId)); if (!sp) await sleep(100); }
    if (!sp) throw new Error('side panel window did not open');
    await waitPanel(sp, (q) => q.koodeReady === 'true', 'panel ready', 10000);
    return sp;
  };
  const session = async (tabId) => sw.evaluate(async (id) => chrome.storage.session.get(['task:' + id, 'progress:' + id, 'nav:' + id]), tabId);

  if (budgetMode) {
    results.budget = await budget(ctx);
  }

  if (!budgetMode && (!only || only === 'journey')) {
    const t0 = Date.now();
    const page = ctx.pages()[0];
    await page.goto('chrome://newtab/').catch(() => page.goto('about:blank'));
    const tabId = (await tabIdOf('chrome://new')) || (await tabIdOf('about:blank'));
    if (!tabId) throw new Error('New Tab tab not found: ' + (await sw.evaluate(async () => JSON.stringify((await chrome.tabs.query({})).map((t) => t.url || t.pendingUrl)))));
    const sp = await openPanel(tabId);
    await page.bringToFront();
    const p0 = await panelState(sp);
    check('side panel opens for the New Tab page', p0.koodeWhere === 'New Tab', p0.koodeWhere);
    check('side panel shows MOCK labels (planner + speech)', /MOCK planner/.test(await sp.locator('#mock').innerText()) && /MOCK speech/.test(await sp.locator('#mock').innerText()));

    // 1) New Tab → WhatsApp by voice; WhatsApp shows its QR login: Koode waits, no planner calls.
    let at = readLog().length;
    await speak(sp, 'വാട്സ്ആപ്പ് തുറന്ന് ഒരാളെ തിരയണം');
    let q = await waitPanel(sp, (x) => x.koodeNavigated === 'whatsapp', 'navigate whatsapp');
    check('voice on New Tab routes to WhatsApp (rule-based, no model)', q.koodeIntent === 'navigate:whatsapp', q.koodeIntent);
    await page.waitForURL(/web\.whatsapp\.com/, { timeout: 10000 });
    q = await waitPanel(sp, (x) => x.koodeLogin === 'true', 'whatsapp login notice', 15000);
    const pl = await waitPage(page, (x) => x.koodeState === 'login', 'page login state', 10000);
    check('WhatsApp QR login detected; user asked to scan on their phone', /QR/.test(q.koodeMl || '') && pl.koodeState === 'login', q.koodeMl);
    check('QR code left uncovered: in-page card stays closed while the side panel shows the instruction', pl.koodeOpen !== 'true', pl.koodeOpen);
    await sleep(2500);
    check('no planner calls while waiting for WhatsApp login', logEntries(at).length === 0, logEntries(at).length);
    await page.screenshot({ path: path.join(ARTIFACTS, 'journey-whatsapp-login.png') });
    await page.evaluate(() => window.__fixtureLogin()); // the user scans the QR code on their phone
    const wa = await followSteps(page, 'whatsapp', {
      maxSteps: 3,
      act: async (el) => {
        await perform(page, el, 'Amma');
      }
    });
    check('WhatsApp: arrow on the search box only', wa.steps.length === 1 && /search/i.test(wa.steps[0].pointedAt?.label || '') && !wa.steps[0].pointedAt?.inPrivate, wa.steps);
    check('WhatsApp: hand-off after typing (user picks the contact)', wa.state === 'done' && /never reads your chats/.test(wa.instruction || ''), wa.instruction);
    check('WhatsApp guidance used the local privacy rule, not a model', /WhatsApp privacy rule/.test(wa.planner || ''), wa.planner);
    // The user opens the chat themselves (a click inside the private chat list): not a "wrong click".
    await page.locator('.chat').first().click();
    await sleep(800);
    const afterChat = await pageState(page);
    check('clicking a contact in the private chat list is not treated as a wrong action', afterChat.koodeState === 'done', afterChat.koodeState);
    check('nothing from WhatsApp was sent to the planner', logEntries(at).filter((e) => e.request).length === 0, logEntries(at).length);
    const spokenWa = Number((await panelState(sp)).koodeSpoken || 0);
    check('spoken replies played in the side panel (confirm, opening, login, step, hand-off)', spokenWa >= 4, spokenWa);

    // 2) WhatsApp → YouTube with a follow-up search, in natural Malayalam.
    at = readLog().length;
    await speak(sp, 'യൂട്യൂബ് തുറന്ന് google forms tutorial തിരയൂ');
    q = await waitPanel(sp, (x) => x.koodeNavigated === 'youtube', 'navigate youtube');
    check('"യൂട്യൂബ് തുറന്ന് … തിരയൂ" from WhatsApp opens YouTube', q.koodeIntent === 'navigate:youtube', q.koodeIntent);
    await page.waitForURL(/www\.youtube\.com/, { timeout: 10000 });
    const yt = await followSteps(page, 'youtube', {
      maxSteps: 5,
      act: async (el) => {
        if (el && el.name === 'search_query') { await perform(page, el, 'google forms tutorial'); await page.keyboard.press('Enter'); }
        else await perform(page, el);
      }
    });
    check('YouTube: search box → typed query → matching video → done', yt.state === 'done' && yt.steps[0]?.pointedAt?.name === 'search_query' && /Google Forms Tutorial/i.test(yt.steps[yt.steps.length - 1]?.pointedAt?.label || ''), yt.steps.map((s) => s.pointedAt?.label));
    const ytReq = logEntries(at).filter((e) => e.request);
    check('YouTube: first snapshot taken after the feed rendered (readiness)', ytReq[0] && ytReq[0].request.snapshot.candidates.length > 20, ytReq[0]?.request.snapshot.candidates.length);
    results.youtubePayload = ytReq.map((e) => ({ path: e.request.snapshot.path, candidates: e.request.snapshot.candidates.length, bytes: JSON.stringify(e.request).length }));

    // 3) YouTube → practice application form (arrival), then a spoken goal for the form.
    await speak(sp, 'അപേക്ഷാ ഫോം തുറക്കൂ');
    q = await waitPanel(sp, (x) => x.koodeArrived === 'practiceform', 'arrived at practice form', 15000);
    check('"അപേക്ഷാ ഫോം തുറക്കൂ" opens the practice application form and announces it', /localhost:8787\/demo\/form\.html/.test(page.url()) && /തുറന്നു/.test(q.koodeMl || ''), q.koodeMl);
    await speak(sp, 'ഈ ഫോം പൂരിപ്പിക്കാൻ സഹായിക്കൂ');
    q = await waitPanel(sp, (x) => x.koodeIntent === 'guide', 'guide intent');
    const form = await followSteps(page, 'form', { maxSteps: 12 });
    const formDone = await page.evaluate(() => !document.getElementById('done').hidden);
    check('practice form: guided field by field; the user submitted; done', form.state === 'done' && formDone, { steps: form.steps.map((s) => s.target), state: form.state });
    const mirror = await panelState(sp);
    check('side panel mirrors the in-page step state', mirror.koodeState === 'done', mirror.koodeState);

    // 4) Exit by voice.
    await speak(sp, 'നിർത്താം');
    q = await waitPanel(sp, (x) => x.koodeState === 'ended', 'ended');
    const pe = await waitPage(page, (x) => x.koodeOpen !== 'true', 'in-page panel closed', 6000).catch(() => pageState(page));
    const ss = await session(tabId);
    check('exit: goodbye in the side panel, in-page guide closed, no arrow, session state cleared',
      /നന്ദി/.test(q.koodeMl || '') && pe.koodeOpen !== 'true' && !(pe.overlay && pe.overlay.koodeRect) && Object.keys(ss).length === 0, { ml: q.koodeMl, open: pe.koodeOpen, session: Object.keys(ss) });
    await sleep(1500);
    check('exit goodbye spoken', Number((await panelState(sp)).koodeSpoken || 0) > spokenWa);
    await page.screenshot({ path: path.join(ARTIFACTS, 'journey-exit-page.png') });
    await sp.screenshot({ path: path.join(ARTIFACTS, 'journey-exit-panel.png') });
    results.journeyMs = Date.now() - t0;
    await sp.close();
  }

  if (!budgetMode && (!only || only === 'editor')) {
    // Google Forms: respondent page guided; the owner's editor never gets the content script.
    const p = await ctx.newPage();
    await p.goto('https://docs.google.com/forms/d/FIXTURE_FORM/edit');
    await sleep(1500);
    check('Google Forms editor (/edit): Koode does not load', !(await p.$('#koode-panel-root')));
    await p.goto('https://docs.google.com/forms/d/e/FIXTURE_FORM/viewform');
    await p.waitForSelector('#koode-panel-root', { state: 'attached', timeout: 8000 }).catch(() => {});
    check('Google Forms respondent page (/viewform): Koode loads', !!(await p.$('#koode-panel-root')));
    await p.close();
  }

  if (!budgetMode && (!only || only === 'inpage')) {
    // Typed requests in the in-page panel use the same routing: open a site, then exit.
    const p = await ctx.newPage();
    await p.goto(DEMO_ORIGIN + '/demo/form.html');
    await p.waitForSelector('#koode-panel-root', { state: 'attached', timeout: 8000 });
    const vp = p.viewportSize();
    await p.mouse.click(vp.width - 49, vp.height - 49);
    await waitPage(p, (x) => x.koodeOpen === 'true', 'in-page panel open', 5000);
    await p.keyboard.type('open youtube'); await p.keyboard.press('Enter');
    await p.waitForURL(/www\.youtube\.com/, { timeout: 10000 });
    const arr = await waitPage(p, (x) => x.koodeState === 'idle' && /is open/.test(x.koodeInstruction || ''), 'arrival on youtube', 15000);
    check('in-page typed "open youtube" navigates and announces arrival', !!arr, arr && arr.koodeInstruction);
    // Koode focused its input on arrival.
    await p.keyboard.type('exit'); await p.keyboard.press('Enter');
    const ex = await waitPage(p, (x) => x.koodeOpen === 'false', 'closed after exit', 6000).catch(() => null);
    check('in-page typed "exit" ends the session and closes the panel', !!ex && ex.koodeState === 'ended', ex && ex.koodeState);
    await p.close();
  }

  if (only === 'real') {
    // Real web.whatsapp.com (logged out) and real www.youtube.com: readiness, login detection, first arrow.
    const page = ctx.pages()[0];
    await page.goto('chrome://newtab/').catch(() => {});
    const tabId = await tabIdOf('chrome://new');
    const sp = await openPanel(tabId);
    let at = readLog().length;
    await speak(sp, 'വാട്സ്ആപ്പ് തുറക്കൂ');
    await page.waitForURL(/web\.whatsapp\.com/, { timeout: 15000 });
    const wa = await waitPage(page, (x) => ['login', 'idle', 'error'].includes(x.koodeState) && x.koodeEvents > 2, 'real WhatsApp state', 45000).catch((e) => ({ error: e.message.slice(0, 300) }));
    await page.screenshot({ path: path.join(ARTIFACTS, 'real-whatsapp.png') });
    // Headless Chrome gets WhatsApp's "update your browser" page, so only honesty is checkable here: Koode
    // must not claim WhatsApp is ready and must not call the planner. The QR-login path needs a headed run.
    check('real WhatsApp (headless): login screen detected, or "did not finish loading" — never "ready"; no planner calls',
      (wa.koodeState === 'login' || wa.koodeState === 'error') && logEntries(at).length === 0, { state: wa.koodeState, instruction: wa.koodeInstruction, calls: logEntries(at).length });
    at = readLog().length;
    await speak(sp, 'യൂട്യൂബ് തുറന്ന് google forms tutorial തിരയൂ');
    await page.waitForURL(/www\.youtube\.com/, { timeout: 15000 });
    const yt = await waitPage(page, (x) => (x.koodeState === 'waiting' && x.overlay && x.overlay.koodeTip) || x.koodeState === 'error' || x.koodeState === 'idle' && x.koodeEvents > 4, 'real YouTube arrow', 45000).catch((e) => ({ error: e.message.slice(0, 300) }));
    await sleep(400);
    const el = await pointedElement(page);
    await page.screenshot({ path: path.join(ARTIFACTS, 'real-youtube.png') });
    const req = logEntries(at).filter((e) => e.request);
    check('real YouTube: arrow on the search box after the page was ready', yt.koodeState === 'waiting' && /search/i.test((el && (el.name + ' ' + el.label)) || ''), { state: yt.koodeState, err: yt.error, pointed: el && { tag: el.tag, name: el.name, label: el.label } });
    results.realYoutube = req.map((e) => ({ path: e.request.snapshot.path, candidates: e.request.snapshot.candidates.length, context: e.request.snapshot.context.length, userChars: JSON.stringify(e.request).length }));
    await sp.close();
  }

  // Privacy audit across everything sent to the planner during this run.
  const newLog = readLog().slice(logStart);
  const leaks = [SECRETS.name, SECRETS.mobile, SECRETS.password, '1950', 'SECRET-', 'Fixture-Contact', 'Fixture-Group', 'Amma', 'OWNER-PRIVATE'].filter((s) => newLog.includes(s));
  const waOrigin = logEntries(logStart).filter((e) => e.request && /whatsapp/.test(e.request.snapshot.origin || '')).length;
  results.privacy = { planRequests: logEntries(logStart).filter((e) => e.request).length, leaks, whatsappRequests: waOrigin };
  if (!budgetMode) check('privacy: no typed values, chat names, messages or editor content in planner payloads', leaks.length === 0 && waOrigin === 0, results.privacy);
  results.checks = checks;
  results.passed = checks.filter((c) => c.ok).length;
  results.failed = checks.filter((c) => !c.ok).length;
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(ARTIFACTS, budgetMode ? 'budget-report.json' : 'journey-report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ browser: results.browser, passed: results.passed, failed: results.failed, journeyMs: results.journeyMs, youtubePayload: results.youtubePayload, realYoutube: results.realYoutube, budget: results.budget, privacy: results.privacy }, null, 2));
  await ctx.close();
  if (results.failed) process.exitCode = 1;
}

// Planner payload per page: the first planner request after a typed goal in the in-page panel.
async function budget(ctx) {
  const { buildUserMessage, SYSTEM_PROMPT } = await import(path.join(ROOT, 'backend', 'src', 'prompt.js'));
  const pages = [
    ['youtube-home', 'https://www.youtube.com/', 'search for google forms tutorial'],
    ['practice-form', DEMO_ORIGIN + '/demo/form.html', 'ഈ ഫോം പൂരിപ്പിക്കാൻ സഹായിക്കൂ'],
    ['gforms-structure', DEMO_ORIGIN + '/demo/gforms.html', 'Fill in this form'],
    ['settings-b', DEMO_ORIGIN + '/demo/settings.html?layout=b', 'ഈ വെബ്സൈറ്റ് ഡാർക്ക് മോഡിലേക്ക് മാറ്റണം']
  ];
  const out = [];
  for (const [name, url, goal] of pages) {
    const p = await ctx.newPage();
    await p.goto(url);
    await p.waitForSelector('#koode-panel-root', { state: 'attached', timeout: 8000 });
    await sleep(1200); // feed renders (fixture loads it after 600 ms)
    const at = readLog().length;
    const vp = p.viewportSize();
    await p.mouse.click(vp.width - 49, vp.height - 49);
    await sleep(300);
    await p.keyboard.type(goal); await p.keyboard.press('Enter');
    const t0 = Date.now();
    let e;
    while (!(e = logEntries(at).find((x) => x.request)) && Date.now() - t0 < 15000) await sleep(150);
    if (e) {
      const msg = buildUserMessage(e.request);
      out.push({ page: name, candidates: e.request.snapshot.candidates.length, context: e.request.snapshot.context.length, userMessageChars: msg.length, systemPromptChars: SYSTEM_PROMPT.length });
    } else out.push({ page: name, error: 'no planner request' });
    await p.close();
  }
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
