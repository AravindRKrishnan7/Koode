// Page readiness: wait until a freshly loaded (or SPA-navigated) page has rendered before taking a
// snapshot, so the planner isn't asked about a loading screen. Runs locally; nothing is sent anywhere.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page

  // Per-site signals. `ready`: the app shell Koode guides on is rendered. `login`: a sign-in screen
  // the user must complete themselves (Koode never logs in). Only presence checks; no text leaves the page.
  const SITES = {
    'web.whatsapp.com': {
      ready: '#side [contenteditable=true], #side input, #side [role=textbox], [data-testid=chat-list-search], #pane-side',
      login: () => !visible('#side, #pane-side') &&
        !!(document.querySelector('canvas[aria-label], [data-ref] canvas, [data-testid=qrcode], [data-testid=link-device-qrcode]') ||
          /scan (the|this) qr|log ?in to whatsapp|link with phone|steps to log in|use whatsapp on your computer/i.test((document.body && document.body.innerText || '').slice(0, 4000)))
    },
    'www.youtube.com': { ready: 'input[name=search_query], ytd-searchbox input, #search-input input, input#search' }
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (sel) => Array.from(document.querySelectorAll(sel)).some((el) => K.extractor.isRendered(el));

  // Resolves after `quietMs` without structural DOM changes, or after `maxMs`.
  function quiet(quietMs = 400, maxMs = 2500) {
    return new Promise((resolve) => {
      let t;
      const done = () => { mo.disconnect(); clearTimeout(t); clearTimeout(cap); resolve(); };
      const mo = new MutationObserver((recs) => {
        if (recs.every((r) => isKoode(r.target))) return;
        clearTimeout(t); t = setTimeout(done, quietMs);
      });
      mo.observe(document.documentElement, { subtree: true, childList: true });
      t = setTimeout(done, quietMs);
      const cap = setTimeout(done, maxMs);
    });
  }
  const isKoode = (n) => { const el = n && n.nodeType === 1 ? n : n && n.parentElement; return !!(el && el.closest && el.closest('#koode-panel-root,#koode-overlay-root')); };

  function loaded(maxMs) {
    if (document.readyState === 'complete') return Promise.resolve();
    return new Promise((resolve) => { const t = setTimeout(resolve, maxMs); addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true }); });
  }

  // opts: { cancelled(): bool, onLogin(): void, onReady(): void, maxMs, loginMaxMs }
  // Resolves { ok, reason: 'ready'|'timeout'|'cancelled'|'login_timeout', waitedMs }.
  async function wait(opts = {}) {
    const t0 = performance.now();
    const cancelled = opts.cancelled || (() => false);
    const site = SITES[location.host];
    const maxMs = opts.maxMs || 10000;
    await loaded(Math.min(maxMs, 8000));
    let reason = 'ready';
    if (site) {
      let loginShown = false;
      const loginDeadline = performance.now() + (opts.loginMaxMs || 5 * 60 * 1000);
      let deadline = performance.now() + maxMs;
      for (;;) {
        if (cancelled()) return { ok: false, reason: 'cancelled', waitedMs: Math.round(performance.now() - t0) };
        if (visible(site.ready)) break;
        if (site.login && site.login()) {
          if (!loginShown) { loginShown = true; if (opts.onLogin) opts.onLogin(); }
          deadline = loginDeadline; // the user is logging in on their phone: keep waiting, without planner calls
        }
        if (performance.now() > deadline) { reason = loginShown ? 'login_timeout' : 'timeout'; break; }
        await sleep(300);
      }
      if (reason === 'login_timeout') return { ok: false, reason, waitedMs: Math.round(performance.now() - t0) };
    }
    await quiet(400, 2500);
    if (cancelled()) return { ok: false, reason: 'cancelled', waitedMs: Math.round(performance.now() - t0) };
    if (opts.onReady) opts.onReady();
    return { ok: true, reason, waitedMs: Math.round(performance.now() - t0) };
  }

  K.ready = { wait, quiet, isLoginScreen: () => !!(SITES[location.host] && SITES[location.host].login && SITES[location.host].login()) };
})();
