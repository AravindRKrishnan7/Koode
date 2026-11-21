// Action monitor: watches real user input on the page and reports
// correct actions only when page evidence confirms the expected change.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page
  const C = K.constants;

  let active = null; // { target, kind, cb, cleanup[] }

  // Derives the verifiable action from the element itself, not from the model.
  function actionKind(el) {
    const tag = el.tagName.toLowerCase();
    const role = K.extractor.implicitRole(el);
    if (K.extractor.isTextEntry(el)) return 'fill';
    if (tag === 'select') return 'select';
    if (role === 'checkbox' || role === 'radio' || role === 'switch') return 'check';
    return 'click';
  }

  function isOnTarget(node, target) {
    if (!node || !target) return false;
    if (target.el.contains(node) || target.anchor.contains(node)) return true;
    const label = node.closest && node.closest('label');
    return !!(label && (label.control === target.el || label.contains(target.el)));
  }

  function isKoodeUi(node) {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return !!(el && C.UI_HOST_IDS.some((id) => el.closest('#' + id)));
  }

  function isChecked(el) {
    if (el.tagName.toLowerCase() === 'input') return el.checked;
    return el.getAttribute('aria-checked') === 'true';
  }

  // Waits for observable DOM/URL change relative to `before`. Resolves with a
  // diff on change, or null on timeout. A click alone is never success.
  function waitForChange(before, timeoutMs) {
    return new Promise((resolve) => {
      let done = false, debounce = 0;
      const finish = (val) => { if (done) return; done = true; mo.disconnect(); clearTimeout(t); clearTimeout(debounce); window.removeEventListener('hashchange', check); window.removeEventListener('popstate', check); resolve(val); };
      const check = () => {
        const now = K.extractor.stateSignature();
        if (now !== before) finish(K.extractor.diffSignatures(before, now));
      };
      const mo = new MutationObserver(() => { clearTimeout(debounce); debounce = setTimeout(check, 120); });
      mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      window.addEventListener('hashchange', check);
      window.addEventListener('popstate', check);
      const t = setTimeout(() => { check(); finish(null); }, timeoutMs);
      setTimeout(check, 60);
    });
  }

  function stop() {
    if (!active) return;
    active.cleanup.forEach((f) => f());
    active = null;
  }

  function settle(quietMs = 150, maxMs = 1000) {
    return new Promise((resolve) => {
      let quiet;
      const done = () => { mo.disconnect(); clearTimeout(quiet); clearTimeout(cap); resolve(); };
      const mo = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, quietMs); });
      mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      quiet = setTimeout(done, quietMs);
      const cap = setTimeout(done, maxMs);
    });
  }

  // cb: { verified(evidence), wrong(info), noChange(), invalid(info), navigating() }
  // opts.fillIdleMs: also accept a fill once typing pauses (search boxes whose results the user picks
  // from a private area, e.g. WhatsApp contacts), instead of waiting for change/blur.
  function watch(target, cb, opts = {}) {
    stop();
    const kind = actionKind(target.el);
    const initialChecked = kind === 'check' ? isChecked(target.el) : null;
    const initialIndex = kind === 'select' ? target.el.selectedIndex : null;
    const st = { target, kind, cb, cleanup: [], busy: false };
    active = st;
    const on = (type, fn, opts = true) => { document.addEventListener(type, fn, opts); st.cleanup.push(() => document.removeEventListener(type, fn, opts)); };
    const isCurrent = () => active === st;

    // Page handlers for change/input often run after our capture listener; wait until the
    // DOM is quiet so the next snapshot reflects the result of the user's action.
    const verify = async (evidence) => {
      if (!isCurrent() || st.verifying) return;
      st.verifying = true;
      await settle();
      if (!isCurrent()) return;
      stop();
      cb.verified({ kind, ...evidence });
    };

    const handleWrong = async (node, how) => {
      const info = K.extractor.describeClicked(node);
      if (!info || st.busy) return;
      st.busy = true;
      const before = K.extractor.stateSignature();
      const diff = await waitForChange(before, C.WRONG_CLICK_EVIDENCE_TIMEOUT_MS);
      st.busy = false;
      if (!isCurrent()) return;
      cb.wrong({ role: info.role, label: info.label, how, page_changed: !!diff, diff });
    };

    on('click', async (e) => {
      if (!e.isTrusted || isKoodeUi(e.target) || !isCurrent()) return;
      if (isOnTarget(e.target, target)) {
        // Clicking a radio that is already selected leaves it selected: that is the requested state.
        if (kind === 'check' && initialChecked && K.extractor.implicitRole(target.el) === 'radio') {
          setTimeout(() => { if (isCurrent() && isChecked(target.el)) verify({ evidence: 'already_selected', checked: true }); }, 200);
          return;
        }
        if (kind !== 'click' || st.busy) return; // fill/check/select verify via their own events
        st.busy = true;
        st.lastClickOnTarget = true;
        const before = st.beforeClick || K.extractor.stateSignature();
        const diff = await waitForChange(before, C.CLICK_EVIDENCE_TIMEOUT_MS);
        st.busy = false;
        if (!isCurrent()) return;
        // Alert text stays out of the event (it may echo typed values); the planner reads the live context.
        if (diff && diff.added.some((l) => l.startsWith('ctx|alert|'))) verify({ evidence: 'dom_change', diff, page_alert: true });
        else if (diff) verify({ evidence: 'dom_change', diff });
        else cb.noChange();
        return;
      }
      st.lastClickOnTarget = false;
      handleWrong(e.target, 'click');
    });

    // Capture pre-click state as early as possible (before page handlers run).
    on('pointerdown', (e) => {
      if (e.isTrusted && isOnTarget(e.target, target) && kind === 'click') st.beforeClick = K.extractor.stateSignature();
    });

    const fillCheck = (e) => {
      if (!e.isTrusted || kind !== 'fill' || !isOnTarget(e.target, target)) return;
      const el = target.el;
      const filled = el.isContentEditable ? el.textContent.trim().length > 0 : (el.value || '').length > 0;
      if (!filled) return;
      if (el.validity && !el.validity.valid) { cb.invalid({ reason: 'invalid_format', message: el.validationMessage ? 'format' : '' }); return; }
      verify({ evidence: 'field_filled', valid: true });
    };
    on('change', fillCheck);
    on('focusout', fillCheck);
    if (kind === 'fill' && opts.fillIdleMs) {
      let idle = 0;
      on('input', (e) => {
        if (!e.isTrusted || !isOnTarget(e.target, target)) return;
        clearTimeout(idle);
        idle = setTimeout(() => fillCheck({ isTrusted: true, target: target.el }), opts.fillIdleMs);
      });
      st.cleanup.push(() => clearTimeout(idle));
    }

    on('change', (e) => {
      if (!e.isTrusted || !isOnTarget(e.target, target)) return;
      if (kind === 'select') {
        const opt = target.el.options[target.el.selectedIndex];
        if (target.el.selectedIndex !== initialIndex && opt && opt.value !== '') verify({ evidence: 'selection_changed' });
      } else if (kind === 'check') {
        if (isChecked(target.el) !== initialChecked || (K.extractor.implicitRole(target.el) === 'radio' && isChecked(target.el))) {
          verify({ evidence: 'checked_state', checked: isChecked(target.el) });
        }
      }
    });

    // ARIA switches/checkboxes (non-input) report via attribute change.
    if (kind === 'check' && target.el.tagName.toLowerCase() !== 'input') {
      const mo = new MutationObserver(() => { if (isChecked(target.el) !== initialChecked) verify({ evidence: 'aria_checked', checked: isChecked(target.el) }); });
      mo.observe(target.el, { attributes: true, attributeFilter: ['aria-checked'] });
      st.cleanup.push(() => mo.disconnect());
    }

    const onHide = () => { if (isCurrent()) cb.navigating({ on_target: !!st.lastClickOnTarget }); };
    window.addEventListener('pagehide', onHide);
    st.cleanup.push(() => window.removeEventListener('pagehide', onHide));
    return kind;
  }

  // True while a target click/change is being verified (the target may vanish meanwhile, e.g. on submit).
  const isVerifying = () => !!(active && (active.busy || active.verifying));

  K.monitor = { watch, stop, actionKind, waitForChange, isVerifying };
})();
