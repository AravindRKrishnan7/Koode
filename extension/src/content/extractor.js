// Page perception: builds a privacy-filtered snapshot of visible interactive
// elements with snapshot-scoped temporary IDs. Never reads input values.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page
  const C = K.constants;

  let seq = 0;
  let registry = new Map(); // id -> { el, anchor }
  let currentSnapshotId = null;

  const clean = (s, max = C.MAX_LABEL) =>
    (s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  const humanize = (s) => clean((s || '').replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));

  function isKoodeUi(el) {
    return C.UI_HOST_IDS.some((id) => el.id === id || el.closest('#' + id));
  }

  function isRendered(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[aria-hidden="true"],[inert]')) return false;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  }

  function isTextEntry(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (el.isContentEditable || el.getAttribute('role') === 'textbox') return true;
    if (tag !== 'input') return false;
    const t = (el.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'file', 'range', 'color', 'hidden'].includes(t);
  }

  function implicitRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (['checkbox', 'radio', 'range'].includes(t)) return t === 'range' ? 'slider' : t;
      if (['submit', 'button', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'file') return 'file';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return 'generic';
  }

  // Text of a node with any form controls removed (labels may wrap inputs).
  function textWithoutControls(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('input,select,textarea,[contenteditable]').forEach((n) => n.remove());
    return clean(clone.textContent);
  }

  function labelFor(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(textWithoutControls).join(' ');
      if (t) return clean(t);
    }
    if (el.labels && el.labels.length) {
      const t = Array.from(el.labels).map(textWithoutControls).join(' ');
      if (t) return clean(t);
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el.type || '').toLowerCase();
      // Button-type input values are developer-provided captions, not user data.
      if (['submit', 'button', 'reset'].includes(t)) return clean(el.value || t);
      if (t === 'image') return clean(el.alt);
    }
    if (isTextEntry(el) || tag === 'select') {
      return clean(el.getAttribute('placeholder') || el.title || humanize(el.name || el.id));
    }
    return (
      textWithoutControls(el) ||
      clean(el.title) ||
      clean(el.querySelector('img[alt]')?.alt) ||
      clean(el.querySelector('svg title')?.textContent)
    );
  }

  function sectionFor(el) {
    const fs = el.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg) return clean(lg.textContent, 60);
    }
    const group = el.closest('[role=radiogroup],[role=group]');
    if (group) {
      const gl = group.getAttribute('aria-label') ||
        (group.getAttribute('aria-labelledby') && document.getElementById(group.getAttribute('aria-labelledby'))?.textContent);
      if (gl) return clean(gl, 60);
    }
    const region = el.closest('[role=dialog],dialog,[role=tabpanel],nav,header,footer,aside,form,section');
    if (!region) return '';
    const rl = region.getAttribute('aria-label') ||
      (region.getAttribute('aria-labelledby') && document.getElementById(region.getAttribute('aria-labelledby'))?.textContent);
    if (rl) return clean(rl, 60);
    const h = region.querySelector('h1,h2,h3,h4,legend');
    return h ? clean(h.textContent, 60) : region.tagName.toLowerCase();
  }

  function isSensitive(el, label) {
    if (el.tagName.toLowerCase() === 'input' && (el.type || '').toLowerCase() === 'password') return true;
    if (C.SENSITIVE_AUTOCOMPLETE_RE.test(el.getAttribute('autocomplete') || '')) return true;
    const hay = [label, el.name, el.id, el.getAttribute('placeholder')].join(' ');
    return C.SENSITIVE_RE.test(hay);
  }

  // State metadata only. Text values are reduced to booleans.
  function stateFor(el, role) {
    const s = {};
    const tag = el.tagName.toLowerCase();
    if (isDisabled(el)) s.disabled = true;
    if (el.required || el.getAttribute('aria-required') === 'true') s.required = true;
    if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemradio' || role === 'menuitemcheckbox') {
      s.checked = typeof el.checked === 'boolean' && tag === 'input' ? el.checked : el.getAttribute('aria-checked') === 'true';
    }
    for (const a of ['expanded', 'selected', 'pressed', 'current']) {
      const v = el.getAttribute('aria-' + a);
      if (v !== null && v !== 'false') s[a] = v === 'true' ? true : clean(v, 20);
    }
    if (isTextEntry(el)) {
      const filled = el.isContentEditable ? (el.textContent || '').trim().length > 0 : (el.value || '').length > 0;
      s.filled = filled;
      if (filled && el.validity) s.valid = el.validity.valid;
    }
    if (tag === 'select') {
      const opt = el.options[el.selectedIndex];
      s.has_selection = !!opt && opt.value !== '' && !opt.disabled;
    }
    return s;
  }

  function optionsFor(el) {
    if (el.tagName.toLowerCase() !== 'select') return undefined;
    return Array.from(el.options).filter((o) => o.value !== '').slice(0, 15).map((o) => clean(o.textContent, 40));
  }

  function anchorFor(el) {
    if (isRendered(el)) return el;
    // Custom-styled checkboxes/radios often hide the input but show the label.
    const role = implicitRole(el);
    if ((role === 'checkbox' || role === 'radio') && el.labels) {
      const lab = Array.from(el.labels).find(isRendered);
      if (lab) return lab;
    }
    return null;
  }

  // Native :disabled also covers controls inside a disabled <fieldset>.
  function isDisabled(el) {
    return (typeof el.matches === 'function' && el.matches(':disabled')) || el.getAttribute('aria-disabled') === 'true';
  }

  // Visible text of a container, skipping private subtrees and form-field contents.
  function safeText(root) {
    let out = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === Node.TEXT_NODE) out += c.nodeValue + ' ';
        else if (c.nodeType === Node.ELEMENT_NODE) {
          if (c.matches(C.PRIVATE_SELECTOR) || c.matches('input,textarea,select,[contenteditable=""],[contenteditable=true],script,style') || c.getAttribute('aria-hidden') === 'true') continue;
          walk(c);
        }
      }
    };
    walk(root);
    return out;
  }

  function collectContext() {
    const out = [];
    const nodes = document.querySelectorAll('h1,h2,h3,[role=alert],[role=status],[aria-live],legend,[role=dialog] [id$=title]');
    for (const n of nodes) {
      if (out.length >= C.MAX_CONTEXT) break;
      if (isKoodeUi(n) || n.closest(C.PRIVATE_SELECTOR) || !isRendered(n)) continue;
      const text = clean(safeText(n), C.MAX_CONTEXT_TEXT);
      if (!text) continue;
      const kind = n.matches('[role=alert],[aria-live=assertive]') ? 'alert' : n.matches('[role=status],[aria-live]') ? 'status' : n.tagName.toLowerCase();
      if (!out.some((o) => o.text === text)) out.push({ kind, text });
    }
    return out;
  }

  function collectElements() {
    const all = Array.from(document.querySelectorAll(C.INTERACTIVE_SELECTOR));
    const picked = [];
    const set = new Set();
    for (const el of all) {
      if (isKoodeUi(el) || el.closest(C.PRIVATE_SELECTOR)) continue;
      if (el.tagName.toLowerCase() === 'input' && (el.type || '').toLowerCase() === 'hidden') continue;
      const anchor = anchorFor(el);
      if (!anchor) continue;
      // Skip descendants of an already-picked interactive element (e.g. span inside a button).
      let p = el.parentElement, nested = false;
      while (p) { if (set.has(p)) { nested = true; break; } p = p.parentElement; }
      if (nested) continue;
      set.add(el);
      picked.push({ el, anchor });
    }
    return picked;
  }

  function describe(el, anchor) {
    const role = implicitRole(el);
    const label = labelFor(el);
    const r = (anchor || el).getBoundingClientRect();
    const inViewport = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    const sensitive = isSensitive(el, label);
    const c = {
      role,
      tag: el.tagName.toLowerCase(),
      label: label || '(unlabelled ' + role + ')',
      section: sectionFor(el) || undefined,
      state: stateFor(el, role),
      in_viewport: inViewport,
      bbox: { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }
    };
    if (el.tagName.toLowerCase() === 'input') c.type = (el.type || 'text').toLowerCase();
    if (sensitive) c.sensitive = true;
    const options = optionsFor(el);
    if (options) c.options = options;
    return c;
  }

  function prioritise(items) {
    if (items.length <= C.MAX_CANDIDATES) return items;
    const inView = items.filter((i) => { const r = i.anchor.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    const rest = items.filter((i) => !inView.includes(i));
    const keep = new Set(inView.concat(rest).slice(0, C.MAX_CANDIDATES));
    return items.filter((i) => keep.has(i));
  }

  // Builds a new snapshot; previous IDs become stale immediately.
  function snapshot() {
    seq += 1;
    currentSnapshotId = 's' + seq;
    registry = new Map();
    const items = prioritise(collectElements());
    const candidates = items.map((item, i) => {
      const id = currentSnapshotId + '_' + (i + 1);
      registry.set(id, item);
      return { id, ...describe(item.el, item.anchor) };
    });
    return {
      snapshot_id: currentSnapshotId,
      origin: location.origin,
      path: location.pathname,
      title: clean(document.title, 100),
      viewport: { w: innerWidth, h: innerHeight },
      candidates,
      context: collectContext()
    };
  }

  // Lightweight signature of observable page state, used as verification evidence.
  function stateSignature() {
    const parts = [location.href.split('#')[0], location.hash];
    for (const { el, anchor } of collectElements()) {
      const d = describe(el, anchor);
      parts.push(d.role + '|' + d.label + '|' + JSON.stringify(d.state));
    }
    for (const det of document.querySelectorAll('details')) if (!isKoodeUi(det)) parts.push('details|' + det.open);
    for (const c of collectContext()) parts.push('ctx|' + c.kind + '|' + c.text);
    return parts.join('\n');
  }

  function diffSignatures(a, b) {
    const A = new Set(a.split('\n')), B = new Set(b.split('\n'));
    const added = [...B].filter((x) => !A.has(x)), removed = [...A].filter((x) => !B.has(x));
    return { added: added.slice(0, 6), removed: removed.slice(0, 6), added_count: added.length, removed_count: removed.length };
  }

  // Validates a model-chosen ID against the live DOM right now.
  function resolve(id) {
    if (typeof id !== 'string' || !id) return { ok: false, reason: 'missing_id' };
    if (!id.startsWith(currentSnapshotId + '_')) return { ok: false, reason: 'stale_snapshot_id' };
    const item = registry.get(id);
    if (!item) return { ok: false, reason: 'unknown_id' };
    if (!item.el.isConnected) return { ok: false, reason: 'detached' };
    const anchor = anchorFor(item.el);
    if (!anchor) return { ok: false, reason: 'not_visible' };
    if (isDisabled(item.el)) return { ok: false, reason: 'disabled' };
    return { ok: true, id, el: item.el, anchor, info: describe(item.el, anchor) };
  }

  // Describes an arbitrary clicked node (for wrong-click reporting). Label only.
  function describeClicked(node) {
    const el = node && node.closest ? node.closest(C.INTERACTIVE_SELECTOR) : null;
    if (!el || isKoodeUi(el) || el.closest(C.PRIVATE_SELECTOR)) return null;
    const role = implicitRole(el);
    return { el, role, label: labelFor(el) || '(unlabelled ' + role + ')' };
  }

  K.extractor = { snapshot, resolve, stateSignature, diffSignatures, describeClicked, isTextEntry, implicitRole, isRendered, labelFor };
})();
