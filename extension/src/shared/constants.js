// Shared constants for all Koode content-script modules.
// Modules attach to the isolated-world global `Koode` (no bundler needed).
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page
  K.constants = {
    MAX_CANDIDATES: 150,
    MAX_LABEL: 80,
    MAX_CONTEXT: 20,
    MAX_CONTEXT_TEXT: 120,
    MAX_STEPS: 25,
    MAX_INVALID_TARGET_RETRIES: 2,
    CLICK_EVIDENCE_TIMEOUT_MS: 2500,
    WRONG_CLICK_EVIDENCE_TIMEOUT_MS: 900,
    INTERACTIVE_SELECTOR: [
      'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
      '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=menuitemradio]',
      '[role=menuitemcheckbox]', '[role=checkbox]', '[role=radio]', '[role=switch]', '[role=option]',
      '[role=combobox]', '[role=textbox]', '[role=treeitem]', '[contenteditable=""]',
      '[contenteditable=true]', '[onclick]', '[tabindex]:not([tabindex="-1"])'
    ].join(','),
    // Elements inside these containers are never extracted or sent anywhere.
    PRIVATE_SELECTOR: '[data-koode-private],[data-private]',
    SENSITIVE_RE: /pass(word|code)|\bpin\b|otp|one[\s-]?time|cvv|cvc|card\s*(number|no)|credit|debit|iban|account\s*(number|no)|aadhaa?r|\bssn\b|secret|security\s*code|verification\s*code/i,
    SENSITIVE_AUTOCOMPLETE_RE: /^(current-password|new-password|one-time-code|cc-)/i,
    UI_HOST_IDS: ['koode-panel-root', 'koode-overlay-root']
  };
})();
