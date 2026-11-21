// Supported websites and rule-based intent routing (no model quota).
// Shared by the service worker (importScripts), the side panel (<script>), the content script and unit tests.
//
// classify(text, { siteId }) → one of
//   { type: 'exit' }                                   end the companion session
//   { type: 'navigate', site, goal }                   open a supported site in this tab; goal continues there
//   { type: 'already_here', site }                     asked to open the site that is already open (no further goal)
//   { type: 'guide', goal }                            guide on the current page with the grounded planner
//   { type: 'need_link' }                              "open Google Forms" without a form: the user must open their form link
//   { type: 'youtube_search', search, goal }           rule fast path: a video/search request with a clear topic →
//                                                      search = { query, lang, fallback:null, lazyFallback } (no model)
//   { type: 'service', entry, service, want, goal }    a verified catalogue destination (catalogue.js) is meant;
//                                                      want: official | video | unspecified (→ offer both)
//   { type: 'intent', goal }                           open-ended request (no site named, or a learning request on a page
//                                                      that is not about it): ask the intent planner (/api/intent)
// Text is expected to be redacted already (KoodeGoals.redact).
(() => {
  const SITES = [
    { id: 'whatsapp', name: 'WhatsApp Web', ml: 'വാട്സ്ആപ്പ്', url: 'https://web.whatsapp.com/', host: 'web.whatsapp.com',
      words: ['whatsapp', 'whats app', 'വാട്സ്ആപ്പ്', 'വാട്സാപ്പ്', 'വാട്ട്സ്ആപ്പ്', 'വാട്ട്സാപ്പ്', 'വാട്സപ്പ്', 'വാട്സ് ആപ്പ്', 'വാട്സ്അപ്പ്', 'വാട്ട്സപ്പ്'] },
    { id: 'youtube', name: 'YouTube', ml: 'യൂട്യൂബ്', url: 'https://www.youtube.com/', host: 'www.youtube.com',
      words: ['youtube', 'you tube', 'യൂട്യൂബ്', 'യുട്യൂബ്', 'യൂടൂബ്', 'യൂ ട്യൂബ്', 'യൂറ്റ്യൂബ്', 'യുടൂബ്'] },
    { id: 'practiceform', name: 'Practice application form', ml: 'അപേക്ഷാ ഫോം', url: 'http://localhost:8787/demo/form.html', host: 'localhost', path: '/demo/form.html',
      words: ['application form', 'practice form', 'apply form', 'travel card form', 'അപേക്ഷാ ഫോം', 'അപേക്ഷ ഫോം', 'അപേക്ഷാഫോം', 'ആപ്ലിക്കേഷൻ ഫോം', 'പ്രാക്ടീസ് ഫോം'],
      // A bare "form" names the practice form only together with an open verb (or from a page Koode can't guide).
      weak: ['form', 'ഫോം'] }
  ];
  const GOOGLE_FORMS = { id: 'googleforms', name: 'Google Forms' };
  const GOOGLE_FORM_WORDS = ['google form', 'google forms', 'ഗൂഗിൾ ഫോം', 'ഗൂഗിൾ ഫോംസ്', 'ഗൂഗിൾഫോം'];

  // Private areas per site: never extracted, never sent to the planner (e.g. chats and messages).
  const PRIVATE = {
    'web.whatsapp.com': '#main, #pane-side, [data-testid=conversation-panel-wrapper], [data-testid=chat-list], [role=application]'
  };

  const ML = '\\u0D00-\\u0D7F';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // One pattern per word. Malayalam words take case suffixes ("യൂട്യൂബിൽ", "വാട്സാപ്പിലേക്ക്"):
  // a trailing virama may be replaced by a vowel sign, and more Malayalam letters may follow.
  function wordRe(w) {
    const ml = /[ഀ-ൿ]/.test(w);
    if (!ml) return new RegExp('(?<![a-z0-9])' + esc(w).replace(/ /g, '\\s*') + 's?(?![a-z0-9])', 'g');
    const stem = w.replace(/്$/, '');
    return new RegExp('(?<![' + ML + '])' + esc(stem).replace(/ /g, '\\s*') + '[' + ML + ']*', 'g');
  }
  for (const s of SITES) { s.res = s.words.map(wordRe); s.weakRes = (s.weak || []).map(wordRe); }
  const GOOGLE_FORM_RES = GOOGLE_FORM_WORDS.map(wordRe);

  // "Open" verbs. English phrases precede the site; Malayalam verbs usually follow it (തുറന്ന്, തുറക്കൂ, പോകൂ…).
  const OPEN_EN = /(?<![a-z])(open|opening|go to|goto|go on|launch|visit|take me to|switch to|bring up|load)(?![a-z])/g;
  const OPEN_ML = new RegExp('(?<![' + ML + '])(?:തുറ|പോക|പോയ|പോവ|പോകൂ|എടുക്ക|എടുത്ത|കാണിക്ക|കാണിച്ച|ഓപ്പൺ|ഓപ്പണ|കയറ|കേറ)[' + ML + ']*(?:\\s+ചെയ്[' + ML + ']*)?', 'g');
  // "on YouTube", "search YouTube for…", or a Malayalam locative ending ("യൂട്യൂബിൽ", "…ലേക്ക്").
  const ATTACH_EN = /(?:^|\s)(?:on|in|at|into|search|find|play|watch|use)\s*$/;
  const LOCATIVE_ML = /(?:ിൽ|ൽ|ില്|ിലേക്ക്|ലേക്ക്|ിലേ|ിലെ)$/;

  const CONNECT = /^(?:and|then|and then|also|&|after that|എന്നിട്ട്|എന്നിട്ടു|എന്നിട്ട|അതിനു ശേഷം|ശേഷം|പിന്നെ|അവിടെ|അതിൽ)\s+/;
  const FILLER = /(?<![a-z])(please|pls|kindly|the|a|an|web|website|site|page|app)(?![a-z])/g;
  const ADDRESS = /^(?:koode|കൂടേ|hey koode|ദയവായി|please|ok|okay|ശരി)[\s,]+/;

  // Exit: the whole (short) utterance consists of exit words and politeness/filler words.
  const EXIT_PHRASES = ['exit', 'quit', 'bye', 'goodbye', 'good bye', 'close', 'close koode', 'stop', 'stop koode', 'end', 'end session',
    'end the session', 'finish', 'i am done', 'im done', 'that is all', 'thats all', 'thats', 'sign off', 'log off'];
  const EXIT_ML = new RegExp('^(?:നിർത്ത[' + ML + ']*|മതി[' + ML + ']*|അവസാനിപ്പി[' + ML + ']*|പുറത്തുകട[' + ML + ']*|പുറത്ത്|കടക്ക[' + ML + ']*|ബൈ|ഗുഡ്ബൈ|ഗുഡ്\\s?ബൈ|എക്സിറ്റ്|ക്ലോസ്)$');
  const EXIT_OK = new Set(['koode', 'കൂടെ', 'കൂടേ', 'session', 'സെഷൻ', 'ഇനി', 'ശരി', 'ok', 'okay', 'please', 'ദയവായി', 'നന്ദി', 'thanks', 'thank', 'you', 'now',
    'എല്ലാം', 'കഴിഞ്ഞു', 'ചെയ്യൂ', 'ചെയ്യുക', 'ചെയ്യാം', 'ആക്കൂ', 'all', 'for', 'today', 'ഇന്ന്', 'ഇത്ര', 'ഇത്രയും', 'ഇപ്പോൾ']);

  function normalize(text) {
    return String(text || '').normalize('NFC').replace(/[‌‍]/g, '').toLowerCase()
      .replace(/[’'`]/g, '').replace(/[.,!?;:।॥"“”‘()\[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isExit(t) {
    const tokens = t.split(' ').filter(Boolean);
    if (!tokens.length || tokens.length > 6) return false;
    const joined = tokens.filter((w) => !EXIT_OK.has(w)).join(' ');
    if (!joined) return false;
    if (EXIT_PHRASES.includes(joined)) return true;
    const rest = joined.split(' ');
    return rest.every((w) => EXIT_ML.test(w) || EXIT_PHRASES.includes(w)) && rest.length <= 3;
  }

  function findAll(re, t) {
    re.lastIndex = 0;
    const out = [];
    let m;
    while ((m = re.exec(t))) { out.push({ start: m.index, end: m.index + m[0].length, text: m[0] }); if (!m[0].length) re.lastIndex++; }
    return out;
  }

  function mentions(t, allowWeak) {
    const out = [];
    for (const s of SITES) {
      for (const re of s.res) for (const m of findAll(re, t)) out.push({ site: s, ...m, weak: false });
      if (allowWeak) for (const re of s.weakRes) for (const m of findAll(re, t)) out.push({ site: s, ...m, weak: true });
    }
    // Drop a mention contained in a longer one (e.g. "form" inside "application form", "ഫോം" inside "ഗൂഗിൾ ഫോം").
    const gf = GOOGLE_FORM_RES.flatMap((re) => findAll(re, t));
    return out.filter((m) => !out.some((o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start))
      .filter((m) => !gf.some((g) => g.start <= m.start && g.end >= m.end))
      .sort((a, b) => a.start - b.start);
  }

  const gap = (a, b) => (a.end <= b.start ? b.start - a.end : a.start >= b.end ? a.start - b.end : 0);

  function cleanRest(t, cuts) {
    let s = t;
    for (const c of cuts.sort((a, b) => b.start - a.start)) s = s.slice(0, c.start) + ' ' + s.slice(c.end);
    s = s.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 3; i++) s = s.replace(ADDRESS, '').replace(CONNECT, '').replace(/^(?:on|in|at|to)\s+/, '').trim();
    s = s.replace(/\s+(?:and|then|ഉം)$/, '').replace(/\s+/g, ' ').trim();
    return s.replace(/[\s&,]+$/, '').length >= 2 ? s : '';
  }

  // ---- YouTube search rule (no model) ----
  // Search verbs ("തിരയൂ", "search for") count only on YouTube or when YouTube is named: on WhatsApp
  // "ഒരാളെ തിരയണം" means its own search box. Video words ("വീഡിയോകൾ", "videos") count anywhere.
  const SEARCH_EN = /(?<![a-z])(?:search(?:ing)?(?: for| about)?|find(?: me)?|look(?:ing)? for|look up)(?![a-z])/g;
  const SEARCH_ML = new RegExp('(?<![' + ML + '])(?:തിരയ|തിരഞ്ഞ|സെർച്ച്|സേർച്ച്|കണ്ടെത്ത)[' + ML + ']*(?:\\s+ചെയ്[' + ML + ']*)?', 'g');
  const VIDEO = new RegExp('(?<![a-z])videos?(?![a-z])|(?<![' + ML + '])(?:വീഡിയോ|വിഡിയോ|വീഡിയൊ)[' + ML + ']*', 'g');
  const WATCH = new RegExp('(?<![a-z])(?:i want to (?:watch|see|listen to)|i want|want to (?:watch|see|listen to)|show me|watch|see|listen to|listen|play|some|me)(?![a-z])|(?<![' + ML + '])(?:കാണ|കാണി|കേൾക്ക|കേൾപ്പ|പ്ലേ|വേണ|തരൂ|എനിക്ക്|കുറച്ച്|ചില)[' + ML + ']*', 'g');
  const WATCH_VERB = new RegExp('(?<![a-z])(?:watch|see|listen(?: to)?|play)(?![a-z])|(?<![' + ML + '])(?:കാണ|കേൾക്ക|പ്ലേ)[' + ML + ']*', 'g');
  // Postpositions that only link the topic to "video" ("…യെ കുറിച്ചുള്ള വീഡിയോ", "videos about …").
  const LINK = new RegExp('(?<![a-z])(?:about|on|of|for|related to)(?![a-z])|(?<![' + ML + '])(?:കുറിച്ച്|കുറിച്ചുള്ള|കുറിച്ചു|പറ്റി|പറ്റിയുള്ള|സംബന്ധിച്ച|സംബന്ധിച്ചുള്ള|ഉള്ള|ഉളള|ആയ)(?![' + ML + '])', 'g');
  // Player controls and actions on a video that is already open are goals for the page, not searches.
  const NOT_SEARCH = new RegExp('(?<![a-z])(?:stop|pause|resume|mute|unmute|volume|full ?screen|skip|like|dislike|subscribe|share|comment|download|upload|record|call|send|close|exit|speed|captions?|subtitles?|quality|settings|delete|remove)(?![a-z])' +
    '|(?<![a-z])(?:this|that|these|current|my)(?![a-z])' +
    '|(?<![' + ML + '])(?:ഈ|ആ|ഇത്|അത്|ഇതിന്റെ|അതിന്റെ|എന്റെ)(?![' + ML + '])' +
    '|(?<![' + ML + '])(?:നിർത്ത|പോസ്|ശബ്ദം|ഫുൾ|സബ്സ്ക്രൈബ്|ലൈക്ക്|ഷെയർ|അയയ്ക്ക|അയക്ക|അയച്ച|കോൾ|ഡൗൺലോഡ്|അപ്‌ലോഡ്|റെക്കോർഡ്|ഡിലീറ്റ്)', '');
  // Learning requests without a clear search phrase go to the intent planner.
  const LEARN = new RegExp('(?<![a-z])(?:learn|learning|how to|how do i|teach me|tutorials?|classes?|recipe)(?![a-z])|(?<![' + ML + '])(?:പഠിക്ക|പഠിപ്പ|പഠനം|എങ്ങനെ|ട്യൂട്ടോറിയൽ|ക്ലാസ്|റെസിപ്പി|ഉണ്ടാക്കുന്ന)', '');

  // t: normalised text. opts.searchVerbs: search verbs count. Returns { query, lang, fallback, lazyFallback } or null.
  function searchFrom(t, opts = {}) {
    if (!t || NOT_SEARCH.test(t)) return null;
    const verbs = opts.searchVerbs ? findAll(SEARCH_EN, t).concat(findAll(SEARCH_ML, t)) : [];
    const vids = findAll(VIDEO, t);
    // With YouTube named, "watch / listen to …" also asks for a search ("യൂട്യൂബിൽ പോയി പാട്ട് കേൾക്കണം").
    const plays = opts.watchVerbs ? findAll(WATCH_VERB, t) : [];
    if (!verbs.length && !vids.length && !plays.length) return null;
    const G = globalThis.KoodeGoals;
    const lang = G ? G.detectLang(t) : { lang: 'ml', cuts: [] };
    let q = cleanRest(t, verbs.concat(vids, findAll(WATCH, t), lang.cuts));
    for (let i = 0; i < 2; i++) q = q.replace(LINK_EDGE, '').trim();
    q = q.replace(new RegExp(LINK.source, 'g'), (m, off, all) => (off === 0 || off + m.length === all.length ? ' ' : m)).replace(/\s+/g, ' ').trim();
    const c = G ? G.cleanQuery(q) : { ok: !!q, query: q };
    if (!c.ok) return null;
    let query = c.query;
    if (lang.lang !== 'ml' && lang.lang !== 'en' && G) query = G.withLang(query, lang.lang);
    // The user's own words are searched as said; for a Malayalam query with thin results, Koode asks the
    // intent planner for an English fallback only then (one model call, only when needed).
    return { query, lang: lang.lang, fallback: null, lazyFallback: lang.lang === 'ml' && /[\u0D00-\u0D7F]/.test(query) };
  }
  const LINK_EDGE = new RegExp('^(?:about|on|of|for)\\s+|\\s+(?:about|on|of|for)$|(?<![' + ML + '])(?:കുറിച്ച്|കുറിച്ചുള്ള|പറ്റി|പറ്റിയുള്ള|ഉള്ള|ആയ)$', 'g');

  // ctx.siteId: id of the site open in the tab (forUrl(url).id), or null for New Tab / pages Koode can't guide.
  function classify(text, ctx = {}) {
    const t = normalize(text).replace(ADDRESS, '');
    if (!t) return { type: 'none' };
    if (isExit(t)) return { type: 'exit' };
    const here = ctx.siteId || null;
    const guidable = !!here;
    const opens = findAll(OPEN_EN, t).concat(findAll(OPEN_ML, t));
    const ms = mentions(t, true).filter((m) => !m.weak || opens.some((o) => gap(o, m) <= 12) || !guidable);
    // How strongly each mention asks to go there.
    const scored = ms.map((m) => {
      const verb = opens.filter((o) => gap(o, m) <= 14).sort((a, b) => gap(a, m) - gap(b, m))[0] || null;
      const attached = ATTACH_EN.test(t.slice(0, m.start)) || LOCATIVE_ML.test(m.text);
      return { ...m, verb, attached, score: (verb ? 2 : 0) + (attached ? 1 : 0) };
    });
    const strong = scored.filter((m) => m.score > 0).sort((a, b) => b.score - a.score || a.start - b.start);
    // On a page Koode can guide, only an explicit "open X" / "on X" switches sites; a passing mention
    // ("search for a WhatsApp tutorial" on YouTube) stays a goal for this page.
    const pick = strong[0] || (!guidable ? scored[0] : null);
    // A verified service ("ഡ്രൈവിംഗ് ലൈസൻസ് വിവരങ്ങൾ…") wins over a loose site word (e.g. "അപേക്ഷ"); an explicit
    // "on YouTube / open WhatsApp" still goes to that site.
    const Cat = globalThis.KoodeCatalogue;
    const cm = Cat && Cat.match(t);
    if (cm && !(pick && (pick.verb || pick.attached) && pick.site.id !== 'practiceform')) {
      if (cm.entry.id === here) return { type: 'guide', goal: String(text).trim(), serviceId: cm.entry.id, subId: cm.service && cm.service.id };
      return { type: 'service', entry: cm.entry, service: cm.service, want: Cat.wants(t), goal: String(text).trim() };
    }
    if (pick) {
      const cuts = [pick];
      if (pick.verb) cuts.push(pick.verb);
      const goal = cleanRest(t, cuts);
      // "YouTube-ൽ … തിരയൂ" / "open YouTube and search for …": open the results page directly.
      if (pick.site.id === 'youtube' && goal) {
        const search = searchFrom(goal, { searchVerbs: true, watchVerbs: true });
        if (search) return { type: 'youtube_search', search, goal };
      }
      if (pick.site.id === here) return goal ? { type: 'guide', goal } : { type: 'already_here', site: pick.site };
      return { type: 'navigate', site: pick.site, goal };
    }
    const gf = GOOGLE_FORM_RES.some((re) => findAll(re, t).length);
    if (gf && here !== 'googleforms' && opens.length && cleanRest(t, opens.concat(GOOGLE_FORM_RES.flatMap((re) => findAll(re, t)))) === '') return { type: 'need_link' };
    const search = searchFrom(t, { searchVerbs: here === 'youtube' });
    if (search) return { type: 'youtube_search', search, goal: String(text).trim() };
    if (!guidable) return { type: 'intent', goal: String(text).trim() };
    // A learning request on a page that isn't about it ("തെങ്ങ് കയറാൻ പഠിക്കണം" on WhatsApp): the intent
    // planner decides; "how do I fill this form" (refers to the page) stays a goal for this page.
    if (LEARN.test(t) && !NOT_SEARCH.test(t)) return { type: 'intent', goal: String(text).trim() };
    return { type: 'guide', goal: String(text).trim() };
  }

  // Backwards-compatible helper: { site, explicitOpen, rest } when a supported site is named.
  function match(text) {
    const c = classify(text, {});
    if (c.type !== 'navigate') return null;
    const t = normalize(text);
    return { site: c.site, explicitOpen: findAll(OPEN_EN, t).length + findAll(OPEN_ML, t).length > 0, rest: c.goal };
  }

  // Pages the content script runs on (manifest matches); not all are navigation targets.
  // Google Forms: only respondent pages (viewform / formResponse), never the editor or the forms list.
  function forUrl(url) {
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      const pf = SITES.find((s) => s.path && s.path === u.pathname);
      return pf || { id: 'demo', name: 'Koode demo page' };
    }
    if (u.hostname === 'docs.google.com') return isGoogleFormRespondentPath(u.pathname) ? GOOGLE_FORMS : null;
    const Cat = globalThis.KoodeCatalogue;
    const ce = Cat && u.protocol === 'https:' && Cat.forHost(u.hostname);
    if (ce) return { id: ce.id, name: ce.name, ml: ce.ml, catalogue: true, kind: ce.kind };
    return SITES.find((s) => s.host === u.hostname && !s.path) || null;
  }
  function isGoogleFormRespondentPath(p) {
    return /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[\w-]+\/(?:viewform|formResponse)\/?$/.test(p);
  }

  const api = { SITES, PRIVATE, GOOGLE_FORMS, classify, searchFrom, match, forUrl, normalize, isGoogleFormRespondentPath };
  // In a content script: extend the private selector for this site (constants.js loads first).
  const K0 = typeof window !== 'undefined' && globalThis.Koode;
  if (K0 && K0.constants && typeof location !== 'undefined' && PRIVATE[location.host] && !K0.constants.sitePrivate) {
    K0.constants.sitePrivate = true;
    K0.constants.PRIVATE_SELECTOR += ',' + PRIVATE[location.host];
  }
  if (typeof globalThis.Koode === 'object' || typeof window !== 'undefined') (globalThis.Koode = globalThis.Koode || {}).sites = api;
  if (typeof self !== 'undefined') self.KoodeSites = api;
})();
