// End-to-end tests in a real Chrome (Chrome for Testing) with the unpacked
// Koode extension loaded. All user actions are real CDP input events
// (isTrusted=true): mouse clicks and keyboard typing — no element.value= or
// programmatic dispatchEvent.
//
// Usage: node e2e/run.mjs [--headed] [--only form|settings-a|settings-b|voice|stale] [--repeat N]
// Voice runs feed a Malayalam WAV (synthesised once via the backend's Sarvam TTS) into Chrome's fake microphone.
// Requires the backend running (npm start in backend/) on KOODE_BACKEND (default http://localhost:8787).
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
const LOG = path.join(ROOT, 'backend', 'logs', 'plan-requests.jsonl');
const args = process.argv.slice(2);
const headed = args.includes('--headed');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const repeat = args.includes('--repeat') ? Number(args[args.indexOf('--repeat') + 1]) : 1;

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = '/opt/.devin/chrome/chrome';
  if (fs.existsSync(base)) {
    const v = fs.readdirSync(base).filter((d) => d.startsWith('linux-')).sort().pop();
    if (v) return path.join(base, v, 'chrome-linux64', 'chrome');
  }
  return '/usr/bin/google-chrome';
}

// Sample inputs typed by the "user". These must never appear in planner logs.
const SECRETS = { name: 'Ravi Kumar Testcase', mobile: '9876543210', password: 'demo-Secret-4821', dob: ['01', '15', '1950'] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function panel(page) {
  return page.evaluate(() => {
    const h = document.querySelector('#koode-panel-root');
    const o = document.querySelector('#koode-overlay-root');
    return h ? { ...h.dataset, overlay: o ? { ...o.dataset } : null } : null;
  });
}

async function waitFor(page, pred, desc, timeout = 45000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await panel(page);
    if (last && pred(last)) return last;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${desc}; last=${JSON.stringify(last)}`);
}

async function startGoal(page, goal) {
  await page.waitForSelector('#koode-panel-root', { state: 'attached', timeout: 10000 });
  const vp = page.viewportSize();
  await page.mouse.click(vp.width - 49, vp.height - 49); // launcher (bottom-right)
  await waitFor(page, (p) => p.koodeOpen === 'true', 'panel open', 5000);
  await page.keyboard.type(goal);
  await page.keyboard.press('Enter');
}

// Spoken Malayalam goal for the voice scenario, played through Chrome's fake microphone.
const VOICE_GOAL = 'ഈ വെബ്സൈറ്റ് ഡാർക്ക് മോഡിലേക്ക് മാറ്റണം';
const VOICE_HOLD_MS = 3800;

// Build the fake-mic WAV: TTS audio with 0.6 s of silence before and 1.2 s after (PCM16 mono).
async function voiceFixture() {
  const file = path.join(ARTIFACTS, 'voice-goal-ml.wav');
  const r = await fetch(BACKEND + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: VOICE_GOAL, lang: 'ml-IN' }) });
  const body = await r.json();
  if (!r.ok && fs.existsSync(file)) return { file, seconds: null, reused: true }; // e.g. voice-fail runs with a bad key
  if (!r.ok) throw new Error('voice fixture: ' + body.error);
  const wav = Buffer.from(body.audio, 'base64');
  const dataAt = wav.indexOf('data') + 8;
  const rate = wav.readUInt32LE(24), pcm = wav.subarray(dataAt);
  const pad = (s) => Buffer.alloc(Math.round(rate * s) * 2);
  const data = Buffer.concat([pad(0.6), pcm, pad(1.2)]);
  const head = Buffer.from(wav.subarray(0, 44));
  head.write('data', 36); head.writeUInt32LE(data.length, 40); head.writeUInt32LE(36 + data.length, 4);
  fs.writeFileSync(file, Buffer.concat([head, data]));
  return { file, ttsMs: body.latency_ms, seconds: +(pcm.length / 2 / rate).toFixed(2) };
}

// Push-to-talk with a real mouse press held on the mic button. Returns the release time.
async function startVoice(page, holdMs) {
  await page.waitForSelector('#koode-panel-root', { state: 'attached', timeout: 10000 });
  const vp = page.viewportSize();
  await page.mouse.click(vp.width - 49, vp.height - 49);
  const p = await waitFor(page, (q) => q.koodeOpen === 'true' && q.koodeMicRect, 'panel open', 5000);
  const [x, y, w, h] = p.koodeMicRect.split(',').map(Number);
  await page.mouse.move(x + w / 2, y + h / 2);
  await page.mouse.down();
  await waitFor(page, (q) => q.koodeState === 'listening' || q.koodeVoiceError, 'listening', 5000);
  await sleep(holdMs);
  await page.mouse.up();
  return Date.now();
}

// The element under the centre of the highlighted rect, i.e. what the arrow points at.
async function pointedElement(page) {
  return page.evaluate(() => {
    const o = document.querySelector('#koode-overlay-root');
    if (!o || !o.dataset.koodeRect) return null;
    const [x, y, w, h] = o.dataset.koodeRect.split(',').map(Number);
    const el = document.elementsFromPoint(x + w / 2, y + h / 2).find((e) => !e.closest('#koode-overlay-root,#koode-panel-root'));
    if (!el) return null;
    const ctl = el.closest('input,select,textarea,button,a,label,[role]') || el;
    const real = ctl.tagName === 'LABEL' && ctl.control ? ctl.control : ctl;
    const r = (real.getClientRects().length && real.offsetParent !== null ? real : ctl).getBoundingClientRect();
    // Form ground truth: a correct next target is a required control still invalid, or Submit once all are valid.
    const form = real.form || document.querySelector('form');
    const formCorrect = form ? ((real.required && !real.checkValidity()) || (real.type === 'submit' && form.checkValidity())) : null;
    return { formCorrect, tag: real.tagName.toLowerCase(), type: real.type || '', role: real.getAttribute('role') || '', id: real.id, text: (real.innerText || real.getAttribute('aria-label') || '').slice(0, 40), rect: [r.left, r.top, r.width, r.height] };
  });
}

// Anchoring check: overlay rect equals the live element rect (±2px), and the arrow tip is adjacent.
async function anchorError(page) {
  return page.evaluate(() => {
    const o = document.querySelector('#koode-overlay-root');
    if (!o || !o.dataset.koodeRect) return null;
    const [x, y, w, h] = o.dataset.koodeRect.split(',').map(Number);
    const target = document.elementsFromPoint(x + w / 2, y + h / 2).find((e) => !e.closest('#koode-overlay-root,#koode-panel-root'));
    if (!target) return { error: 'nothing under rect' };
    let el = target; // climb to the element whose rect matches best
    let best = Infinity;
    for (let n = target; n && n !== document.body; n = n.parentElement) {
      const r = n.getBoundingClientRect();
      const err = Math.max(Math.abs(r.left - x), Math.abs(r.top - y), Math.abs(r.width - w), Math.abs(r.height - h));
      if (err < best) { best = err; el = n; }
    }
    const [tx, ty] = (o.dataset.koodeTip || 'NaN,NaN').split(',').map(Number);
    const tipDist = Math.max(0, x - tx, tx - (x + w), y - ty, ty - (y + h));
    return { rectErrorPx: best, tipDistancePx: Math.round(tipDist), side: o.dataset.koodeSide, visibility: o.dataset.koodeVisibility };
  });
}

async function perform(page, el) {
  const [x, y, w, h] = el.rect;
  const cx = x + Math.min(w / 2, 20), cy = y + h / 2;
  if (el.tag === 'input' && ['text', 'tel', 'password', 'date'].includes(el.type)) {
    await page.mouse.click(x + w / 2, cy);
    if (el.type === 'date') { for (const part of SECRETS.dob) await page.keyboard.type(part); }
    else await page.keyboard.type(el.type === 'tel' ? SECRETS.mobile : el.type === 'password' ? SECRETS.password : SECRETS.name, { delay: 15 });
    await page.keyboard.press('Tab');
  } else if (el.tag === 'select') {
    await page.mouse.click(x + w / 2, cy);
    await sleep(200);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await sleep(100);
    if (!(await page.evaluate(() => document.activeElement && document.activeElement.selectedIndex > 0))) {
      await page.keyboard.press('ArrowDown');
    }
  } else {
    await page.mouse.click(cx, cy);
  }
}

async function shot(page, file) {
  await page.screenshot({ path: path.join(ARTIFACTS, file), timeout: 8000, animations: 'disabled' }).catch((e) => console.warn('screenshot failed', file, e.message.split('\n')[0]));
}

function readLog() { return fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : ''; }

// expectPath: ordered target labels for the canonical route; null = judge by form validity.
async function guidedRun(page, name, { goal, voice = false, preStarted = false, maxSteps = 14, wrongClickAt = null, wrongClickSelector = null, scrollCheck = false, expectPath = null }) {
  const res = { name, goal, input: voice ? 'voice' : 'text', steps: [], wrongClick: null, anchorChecks: [], done: false, planner: null };
  let pathIdx = 0;
  const released = voice ? await startVoice(page, VOICE_HOLD_MS) : null;
  let confirmed = null;
  if (voice) {
    // Koode shows what it heard and waits; the "user" confirms with a real click on ✓.
    const c = await waitFor(page, (q) => (q.koodeState === 'confirm' && q.koodeConfirmRect) || q.koodeState === 'idle', 'transcript confirmation', 20000);
    if (c.koodeState !== 'confirm') { res.error = 'no confirmation: ' + c.koodeInstruction + ' | ' + c.koodeVoiceError; return res; }
    res.releaseToConfirmMs = Date.now() - released;
    await shot(page, `${name}-confirm.png`);
    const [x, y, w, h] = c.koodeConfirmRect.split(',').map(Number);
    await page.mouse.click(x + w / 2, y + h / 2);
    confirmed = Date.now();
  } else if (!preStarted) await startGoal(page, goal);
  let lastStep = 0;
  for (let i = 0; i < maxSteps; i++) {
    const p = await waitFor(page, (p) => (p.koodeState === 'waiting' && Number(p.koodeStep) > lastStep && p.overlay && p.overlay.koodeTip) || p.koodeState === 'done' || p.koodeState === 'error' || (p.koodeState === 'idle' && Number(p.koodeStep || 0) >= 0 && p.koodeEvents > 3), 'next step');
    res.planner = p.koodePlanner;
    if (p.koodeState === 'done') { res.done = true; res.finalInstruction = p.koodeInstruction; break; }
    if (p.koodeState !== 'waiting') { res.error = `${p.koodeState}: ${p.koodeInstruction} | ${p.koodeLastEvent}`; break; }
    if (confirmed && !res.confirmToArrowMs) res.confirmToArrowMs = Date.now() - confirmed;
    lastStep = Number(p.koodeStep);
    await sleep(400); // let smooth scroll settle before measuring
    const el = await pointedElement(page);
    const anchor = await anchorError(page);
    const step = { step: lastStep, targetLabel: p.koodeTarget, instruction: p.koodeInstruction, pointedAt: el && { tag: el.tag, type: el.type, id: el.id, text: el.text }, anchor };
    res.anchorChecks.push(anchor);
    if (expectPath) {
      step.correct = pathIdx < expectPath.length && (p.koodeTarget || '').trim().toLowerCase() === expectPath[pathIdx].toLowerCase();
      if (step.correct) pathIdx++;
    } else step.correct = !!(el && el.formCorrect);

    if (scrollCheck && el && el.type === 'password') {
      await page.mouse.wheel(0, -150); await sleep(300);
      const afterScroll = await anchorError(page);
      await page.setViewportSize({ width: 1100, height: 700 }); await sleep(300);
      const afterResize = await anchorError(page);
      await page.setViewportSize({ width: 1280, height: 800 }); await sleep(300);
      step.scrollResize = { afterScroll, afterResize };
      res.anchorChecks.push(afterScroll, afterResize);
    }

    if (wrongClickAt !== null && lastStep === wrongClickAt && !res.wrongClick) {
      const wrong = await page.$(wrongClickSelector);
      const box = await wrong.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const after = await waitFor(page, (q) => q.koodeState === 'recovering', 'recovering state', 8000);
      await sleep(300);
      const stillOnSame = await pointedElement(page);
      res.wrongClick = { clicked: wrongClickSelector, state: after.koodeState, stepBefore: lastStep, stepAfter: Number(after.koodeStep), targetBefore: p.koodeTarget, targetAfter: after.koodeTarget, instruction: after.koodeInstruction, rePointedAt: stillOnSame && stillOnSame.id, countedAsSuccess: Number(after.koodeStep) !== lastStep };
      // re-measure for perform()
    }
    const el2 = (await pointedElement(page)) || el;
    await shot(page, `${name}-step${lastStep}.png`);
    await perform(page, el2);
    res.steps.push(step);
  }
  if (voice) await waitFor(page, (q) => Number(q.koodeVoiceTtsCount || 0) > lastStep + 1 || q.koodeVoiceError, 'spoken replies', 15000).catch(() => {});
  const fin = await panel(page);
  res.finalState = fin.koodeState;
  if (voice) res.voice = Object.fromEntries(Object.entries(fin).filter(([k]) => k.startsWith('koodeVoice')).map(([k, v]) => [k.slice(10, 11).toLowerCase() + k.slice(11), v]));
  if (expectPath) res.reachedEnd = pathIdx === expectPath.length;
  await shot(page, `${name}-final.png`);
  return res;
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const health = await fetch(BACKEND + '/health').then((r) => r.json());
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koode-e2e-'));
  const wantVoice = (!only || ['voice', 'mic-denied', 'voice-fail'].includes(only)) && health.voice;
  const fixture = wantVoice ? await voiceFixture() : null;
  // mic-denied: no auto-accept, and Chrome denies the permission prompt as a user clicking "Block" would.
  const micArgs = !fixture ? [] : [only === 'mic-denied' ? '--deny-permission-prompts' : '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fixture.file}`];
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath(),
    headless: !headed,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check', ...micArgs]
  });
  const version = ctx.browser() ? ctx.browser().version() : (await (await ctx.newCDPSession(await ctx.newPage())).send('Browser.getVersion')).product;
  const logStart = readLog().length;
  const results = { browser: version, backend: health, startedAt: new Date().toISOString(), runs: [] };
  let page = ctx.pages()[0] || (await ctx.newPage());

  const scenarios = [];
  if (!only || only === 'stale') scenarios.push(['stale', null]);
  for (let r = 1; r <= repeat; r++) {
    if (!only || only === 'form') scenarios.push(['form', r]);
    if (!only || only === 'settings-a') scenarios.push(['settings-a', r]);
    if (!only || only === 'settings-b') scenarios.push(['settings-b', r]);
    if (wantVoice && only !== 'mic-denied' && only !== 'voice-fail') scenarios.push(['voice', r]);
  }
  // Needs Chrome launched with --deny-permission-prompts, so it only runs alone.
  if (only === 'mic-denied') scenarios.push(['mic-denied', null]);
  // Only meaningful against a backend started with an invalid SARVAM_API_KEY.
  if (only === 'voice-fail') scenarios.push(['voice-fail', null]);

  for (const [kind, r] of scenarios) {
    const name = r ? `${kind}-run${r}` : kind;
    // Fresh tab per scenario: task state is tab-scoped, so nothing carries over.
    const old = page;
    page = await ctx.newPage();
    await old.close().catch(() => {});
    try {
      if (kind === 'form') {
        await page.goto(BACKEND + '/demo/form.html');
        results.runs.push(await guidedRun(page, name, { goal: 'ഈ ഫോം പൂരിപ്പിക്കാൻ സഹായിക്കൂ (help me fill this form)', wrongClickAt: 3, wrongClickSelector: '#dob', scrollCheck: true }));
      } else if (kind === 'settings-a') {
        await page.goto(BACKEND + '/demo/settings.html');
        results.runs.push(await guidedRun(page, name, { goal: 'Change this website to dark mode', maxSteps: 6, wrongClickAt: 1, wrongClickSelector: '#topbar a', expectPath: ['Settings', 'Appearance', 'Dark'] }));
      } else if (kind === 'settings-b') {
        await page.goto(BACKEND + '/demo/settings.html?layout=b');
        results.runs.push(await guidedRun(page, name, { goal: 'ഈ വെബ്സൈറ്റ് ഡാർക്ക് മോഡിലേക്ക് മാറ്റണം', maxSteps: 6, expectPath: ['Menu', 'Display', 'Night mode'] }));
      } else if (kind === 'voice') {
        await page.goto(BACKEND + '/demo/settings.html?layout=b');
        const at = readLog().length;
        const run = await guidedRun(page, name, { goal: VOICE_GOAL, voice: true, maxSteps: 6, expectPath: ['Menu', 'Display', 'Night mode'] });
        // The transcript only exists server-side; read it back from the first planner request of this run.
        const first = readLog().slice(at).split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.request);
        run.transcript = first ? first.request.goal : null;
        const norm = (s) => (s || '').replace(/[\s.,!?।]+/g, '');
        run.transcriptExact = norm(run.transcript) === norm(VOICE_GOAL);
        results.runs.push(run);
      } else if (kind === 'mic-denied' || kind === 'voice-fail') {
        // Voice fails (mic permission denied / speech API rejects the key): Koode must explain and the typed fallback must still work.
        await page.goto(BACKEND + '/demo/settings.html?layout=b');
        await page.waitForSelector('#koode-panel-root', { state: 'attached', timeout: 10000 });
        const vp = page.viewportSize();
        await page.mouse.click(vp.width - 49, vp.height - 49);
        const p0 = await waitFor(page, (q) => q.koodeOpen === 'true' && q.koodeMicRect, 'panel open', 5000);
        const [x, y, w, h] = p0.koodeMicRect.split(',').map(Number);
        await page.mouse.move(x + w / 2, y + h / 2);
        await page.mouse.down();
        await sleep(kind === 'mic-denied' ? 800 : VOICE_HOLD_MS);
        await page.mouse.up();
        const p = await waitFor(page, (q) => q.koodeState === 'idle' && q.koodeVoiceError, 'voice fallback', 20000);
        await shot(page, `${kind}-fallback.png`);
        await page.keyboard.type(VOICE_GOAL); // Koode focused the text box as the fallback
        await page.keyboard.press('Enter');
        const run = await guidedRun(page, kind, { goal: VOICE_GOAL, preStarted: true, maxSteps: 6, expectPath: ['Menu', 'Display', 'Night mode'] });
        Object.assign(run, { input: 'text-after-voice-failure', voiceError: p.koodeVoiceError, fallbackMessage: p.koodeInstruction });
        results.runs.push(run);
      } else if (kind === 'stale') {
        // Only meaningful when backend runs with KOODE_FAULT=stale_first.
        await page.goto(BACKEND + '/demo/settings.html');
        await startGoal(page, 'Change this website to dark mode');
        const p = await waitFor(page, (q) => ['waiting', 'error', 'done', 'idle'].includes(q.koodeState) && Number(q.koodeEvents) > 2, 'stale test');
        const trace = await page.evaluate(() => document.querySelector('#koode-panel-root').dataset.koodeEvents);
        results.runs.push({ name, state: p.koodeState, step: p.koodeStep, target: p.koodeTarget, events: trace, note: 'see backend log for FAULT INJECTION line; extension trace shows REJECTED when fault mode on' });
        await page.evaluate(() => sessionStorage.clear());
      }
    } catch (e) {
      results.runs.push({ name, error: String(e.message || e) });
      await page.screenshot({ path: path.join(ARTIFACTS, `${name}-error.png`) }).catch(() => {});
    }
    // Stop any active task between scenarios.
    await page.evaluate(() => sessionStorage.clear()).catch(() => {});
  }

  // Privacy audit: typed values must never reach planner requests.
  const newLog = readLog().slice(logStart);
  const leaks = [SECRETS.name, SECRETS.mobile, SECRETS.password, '1950'].filter((s) => newLog.includes(s));
  results.privacy = { planRequestsLogged: newLog.split('\n').filter(Boolean).length, typedValuesFoundInPlannerPayloads: leaks };
  // Planner quality: first-shot target correctness per guided step, and per-request latency.
  const steps = results.runs.flatMap((r) => r.steps || []);
  const entries = newLog.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.result && e.result.planner && !e.result.planner.mock);
  // Model latency excludes time spent waiting out provider rate limits (429 back-off), reported separately.
  const lat = entries.map((e) => e.result.latency_ms - (e.result.rate_limit_wait_ms || 0)).sort((a, b) => a - b);
  const waits = entries.map((e) => e.result.rate_limit_wait_ms || 0).filter(Boolean);
  const pct = (q) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] : null;
  results.planner = {
    provider: health.provider, model: health.model, mock: health.mock,
    stepsJudged: steps.length, stepsCorrect: steps.filter((s) => s.correct).length,
    // retried = second model call after an invalid id or a reconsidered cannot_find
    llmRequests: entries.length, retried: entries.filter((e) => e.result.attempts > 1).length,
    cannotFind: entries.filter((e) => e.result.status === 'cannot_find').length,
    rateLimited: { requests: waits.length, totalWaitMs: waits.reduce((x, y) => x + y, 0) },
    tokensPerRequest: (() => {
      const t = entries.map((e) => e.result.tokens).filter(Boolean);
      const avg = (k) => t.length ? Math.round(t.reduce((a, x) => a + (x[k] || 0), 0) / t.length) : null;
      return { requests: t.length, prompt: avg('prompt'), completion: avg('completion') };
    })(),
    latencyMs: { mean: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null, p50: pct(0.5), p95: pct(0.95), max: lat[lat.length - 1] ?? null }
  };
  const vr = results.runs.filter((r) => r.input === 'voice');
  const num = (xs) => xs.map(Number).filter((x) => x > 0);
  const stat = (xs) => xs.length ? { mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), max: Math.max(...xs) } : null;
  if (fixture || vr.length) results.voice = {
    fixture: fixture && { seconds: fixture.seconds, note: 'Sarvam Bulbul TTS voice, not a human recording' },
    runs: vr.length, completed: vr.filter((r) => r.done && r.reachedEnd).length, transcriptsExact: vr.filter((r) => r.transcriptExact).length,
    sttRoundTripMs: stat(num(vr.map((r) => r.voice && r.voice.sttMs))), sttSarvamMs: stat(num(vr.map((r) => r.voice && r.voice.sttBackendMs))),
    releaseToConfirmMs: stat(num(vr.map((r) => r.releaseToConfirmMs))), confirmToArrowMs: stat(num(vr.map((r) => r.confirmToArrowMs))),
    ttsRequestToPlayingMs: stat(num(vr.map((r) => r.voice && r.voice.ttsMs))), ttsSarvamMs: stat(num(vr.map((r) => r.voice && r.voice.ttsBackendMs))),
    spokenReplies: vr.map((r) => Number(r.voice && r.voice.ttsCount || 0)), errors: vr.map((r) => r.voice && r.voice.error).filter(Boolean)
  };
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await ctx.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
