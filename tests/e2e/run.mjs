// End-to-end tests in a real Chrome (Chrome for Testing) with the unpacked
// Koode extension loaded. All user actions are real CDP input events
// (isTrusted=true): mouse clicks and keyboard typing — no element.value= or
// programmatic dispatchEvent.
//
// Usage: node e2e/run.mjs [--headed] [--only form|settings-a|settings-b|stale] [--repeat N]
// Requires the backend running (npm start in backend/) on KOODE_BACKEND (default http://localhost:8787).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const EXT = path.join(ROOT, 'extension');
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
    return { tag: real.tagName.toLowerCase(), type: real.type || '', role: real.getAttribute('role') || '', id: real.id, text: (real.innerText || real.getAttribute('aria-label') || '').slice(0, 40), rect: [r.left, r.top, r.width, r.height] };
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

async function guidedRun(page, name, { goal, maxSteps = 14, wrongClickAt = null, wrongClickSelector = null, scrollCheck = false }) {
  const res = { name, goal, steps: [], wrongClick: null, anchorChecks: [], done: false, planner: null };
  await startGoal(page, goal);
  let lastStep = 0;
  for (let i = 0; i < maxSteps; i++) {
    const p = await waitFor(page, (p) => (p.koodeState === 'waiting' && Number(p.koodeStep) > lastStep && p.overlay && p.overlay.koodeTip) || p.koodeState === 'done' || p.koodeState === 'error' || (p.koodeState === 'idle' && Number(p.koodeStep || 0) >= 0 && p.koodeEvents > 3), 'next step');
    res.planner = p.koodePlanner;
    if (p.koodeState === 'done') { res.done = true; res.finalInstruction = p.koodeInstruction; break; }
    if (p.koodeState !== 'waiting') { res.error = `${p.koodeState}: ${p.koodeInstruction} | ${p.koodeLastEvent}`; break; }
    lastStep = Number(p.koodeStep);
    await sleep(400); // let smooth scroll settle before measuring
    const el = await pointedElement(page);
    const anchor = await anchorError(page);
    const step = { step: lastStep, targetLabel: p.koodeTarget, instruction: p.koodeInstruction, pointedAt: el && { tag: el.tag, type: el.type, id: el.id, text: el.text }, anchor };
    res.anchorChecks.push(anchor);

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
  const fin = await panel(page);
  res.finalState = fin.koodeState;
  await shot(page, `${name}-final.png`);
  return res;
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const health = await fetch(BACKEND + '/health').then((r) => r.json());
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koode-e2e-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath(),
    headless: !headed,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check']
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
  }

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
        results.runs.push(await guidedRun(page, name, { goal: 'Change this website to dark mode', maxSteps: 6, wrongClickAt: 1, wrongClickSelector: '#topbar a' }));
      } else if (kind === 'settings-b') {
        await page.goto(BACKEND + '/demo/settings.html?layout=b');
        results.runs.push(await guidedRun(page, name, { goal: 'ഈ വെബ്സൈറ്റ് ഡാർക്ക് മോഡിലേക്ക് മാറ്റണം', maxSteps: 6 }));
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
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await ctx.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
