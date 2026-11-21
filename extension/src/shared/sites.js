// Supported websites for user-requested navigation (narrow host permissions in manifest.json).
// Matching is rule-based so "open WhatsApp" works without spending model quota.
(() => {
  const SITES = [
    { id: 'whatsapp', name: 'WhatsApp Web', url: 'https://web.whatsapp.com/', host: 'web.whatsapp.com',
      words: ['whatsapp', 'whats app', 'വാട്സ്ആപ്പ്', 'വാട്സാപ്പ്', 'വാട്ട്സ്ആപ്പ്', 'വാട്സപ്പ്'] },
    { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/', host: 'www.youtube.com',
      words: ['youtube', 'you tube', 'യൂട്യൂബ്', 'യുട്യൂബ്', 'യൂടൂബ്'] },
    { id: 'gforms', name: 'Practice form (Google Forms style)', url: 'http://localhost:8787/demo/gforms.html', host: 'localhost',
      words: ['application form', 'practice form', 'registration form', 'അപേക്ഷ', 'ഫോം'] }
  ];
  // Private areas per site: never extracted, never sent to the planner (e.g. chats and messages).
  const PRIVATE = {
    'web.whatsapp.com': '#main, #pane-side, [data-testid=conversation-panel-wrapper], [role=application]'
  };
  const OPEN_WORDS = /\b(open|go to|launch|visit|take me to)\b|(?:തുറക്ക|പോക|എടുക്ക|കാണിക്ക)[\u0D00-\u0D7F]*/i;

  // Returns { site, rest } when the request names a supported site, else null.
  function match(text) {
    const t = String(text || '').toLowerCase();
    for (const s of SITES) {
      const w = s.words.find((x) => t.includes(x.toLowerCase()));
      if (w) return { site: s, explicitOpen: OPEN_WORDS.test(t), rest: t.replace(w.toLowerCase(), ' ').replace(OPEN_WORDS, ' ').replace(/\b(please|the|a|an|web|website|site)\b/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(and|then)\s+/, '') };
    }
    return null;
  }

  // Pages the content script runs on (manifest host permissions); not all are navigation targets.
  function forUrl(url) {
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return { id: 'demo', name: 'Koode demo page' };
    if (u.hostname === 'docs.google.com' && u.pathname.startsWith('/forms/')) return { id: 'googleforms', name: 'Google Forms' };
    return SITES.find((s) => s.host === u.hostname && s.host !== 'localhost') || null;
  }

  const api = { SITES, PRIVATE, match, forUrl };
  // In a content script: extend the private selector for this site (constants.js loads first).
  const K0 = typeof window !== 'undefined' && globalThis.Koode;
  if (K0 && K0.constants && typeof location !== 'undefined' && PRIVATE[location.host] && !K0.constants.sitePrivate) {
    K0.constants.sitePrivate = true;
    K0.constants.PRIVATE_SELECTOR += ',' + PRIVATE[location.host];
  }
  if (typeof globalThis.Koode === 'object' || typeof window !== 'undefined') (globalThis.Koode = globalThis.Koode || {}).sites = api;
  if (typeof self !== 'undefined') self.KoodeSites = api;
})();
