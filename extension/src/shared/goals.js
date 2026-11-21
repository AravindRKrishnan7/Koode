// Goal understanding helpers (no network, no model). Shared by the side panel, the content script, the
// service worker (importScripts), the backend (createRequire) and unit tests.
//
//   redact(text)            → { text, found }   personal numbers replaced by [PHONE], [AADHAAR], … before
//                                               anything leaves the browser or reaches a model
//   cleanQuery(q)           → { ok, query } | { ok:false, reason }   plain-text YouTube query: no URLs,
//                                               domains, search operators or personal data; ≤ 80 chars
//   youtubeResultsUrl(q)    → the only URL a search can produce (https://www.youtube.com/results?…), or null
//   detectLang(text)        → { lang, cuts }    requested content language ("…ഇംഗ്ലീഷിൽ", "in hindi"), default ml
//   planSearch(intent)      → { query, fallback, lang }   Malayalam-first query with an English fallback that
//                                               keeps the requested content language ("… malayalam")
//   validateIntent(obj)     → { ok, intent }    strict check of the intent planner's JSON (model output)
//   intentToAction(resp, ctx) → what the UI does next: youtube_search | guide | say (+ optional offer)
(() => {
  // ---------------------------------------------------------------- personal-data redaction
  const ML_DIGIT0 = 0x0d66; // ൦
  const toAscii = (s) => s.replace(/[൦-൯]/g, (d) => String(d.charCodeAt(0) - ML_DIGIT0));
  const STATES = '(?:AN|AP|AR|AS|BR|CG|CH|DD|DL|DN|GA|GJ|HP|HR|JH|JK|KA|KL|LA|LD|MH|ML|MN|MP|MZ|NL|OD|OR|PB|PY|RJ|SK|TN|TR|TS|UK|UP|WB)';
  const NB = '(?<![A-Za-z0-9])', NA = '(?![A-Za-z0-9])';
  // Order matters: specific formats first, then any remaining long digit run.
  const PII = [
    ['EMAIL', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g],
    // Secrets named in the request: "OTP 482913", "PIN 4321", "password abc123", "ഒടിപി 4821".
    // The value must contain a digit, so topics ("reset password video") are kept.
    ['SECRET', /(?<![A-Za-z])(?:otp|o t p|pin|mpin|upi pin|cvv|password|passcode|പാസ്‌?വേഡ്|ഒടിപി|ഓടിപി|പിൻ)(?![A-Za-z])(?:\s*(?:is|number|no|നമ്പർ|ആണ്|:|-))*\s*(?=[A-Za-z@#$%^&*!_-]*\d)[A-Za-z0-9@#$%^&*!_-]{3,}/gi],
    // Driving licence: KL07 2019 0001234 (state, RTO, year, serial) and older KL-07/1234/2010.
    ['DL_NUMBER', new RegExp(NB + STATES + '[\\s-]?\\d{2}[\\s-]?(?:19|20)\\d{2}[\\s-]?\\d{7}' + NA, 'gi')],
    ['DL_NUMBER', new RegExp(NB + STATES + '[\\s-]?\\d{1,2}[\\s/-]+\\d{3,7}[\\s/-]+(?:19|20)\\d{2}' + NA, 'gi')],
    // PAN: AAAPA1234A (4th letter is the holder type). Spaced forms only in capitals ("ABCPE 1234 F").
    ['PAN', /(?<![A-Za-z0-9])[A-Za-z]{3}[PCHFATBLJG][A-Za-z]\d{4}[A-Za-z](?![A-Za-z0-9])/gi],
    ['PAN', /(?<![A-Za-z0-9])[A-Z]{3}[PCHFATBLJG][A-Z]\s\d{4}\s?[A-Z](?![A-Za-z0-9])/g],
    // Vehicle registration: KL 07 AB 1234.
    ['VEHICLE_NUMBER', new RegExp(NB + STATES + '[\\s-]?\\d{1,2}[\\s-]?[A-Za-z]{1,3}[\\s-]?\\d{4}' + NA, 'gi')],
    // Card numbers (16+ digits in groups of 4) before Aadhaar, so no fragment is left behind.
    ['CARD_NUMBER', /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?:[\s-]?\d{1,3})?(?!\d)/g],
    // Aadhaar: 12 digits, first 2–9, often grouped 4-4-4.
    ['AADHAAR', /(?<!\d)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g],
    // Indian mobile: optional +91 / 0, then 10 digits starting 6–9, optionally split 5+5.
    ['PHONE', /(?<![\d+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g],
    // Anything else with 6+ digits (account, card, application, OTP read out digit by digit).
    ['NUMBER', /(?<!\d)\d(?:[\s.-]?\d){5,}(?!\d)/g]
  ];

  function redact(text) {
    let s = toAscii(String(text || '').normalize('NFC'));
    const found = [];
    for (const [type, re] of PII) {
      re.lastIndex = 0;
      s = s.replace(re, () => { if (!found.includes(type)) found.push(type); return '[' + type + ']'; });
    }
    return { text: s.replace(/\s+/g, ' ').trim(), found };
  }

  const PII_ML = { EMAIL: 'ഇമെയിൽ', SECRET: 'രഹസ്യ കോഡ്', DL_NUMBER: 'ലൈസൻസ് നമ്പർ', PAN: 'PAN നമ്പർ', VEHICLE_NUMBER: 'വാഹന നമ്പർ',
    AADHAAR: 'ആധാർ നമ്പർ', PHONE: 'ഫോൺ നമ്പർ', CARD_NUMBER: 'കാർഡ് നമ്പർ', NUMBER: 'നമ്പർ' };
  const PII_EN = { EMAIL: 'email address', SECRET: 'secret code', DL_NUMBER: 'licence number', PAN: 'PAN', VEHICLE_NUMBER: 'vehicle number',
    AADHAAR: 'Aadhaar number', PHONE: 'phone number', CARD_NUMBER: 'card number', NUMBER: 'number' };
  function redactionNotice(found) {
    if (!found || !found.length) return null;
    return {
      ml: `🔒 നിങ്ങൾ പറഞ്ഞ ${found.map((t) => PII_ML[t]).join(', ')} Koode ആർക്കും അയച്ചില്ല. ആവശ്യമെങ്കിൽ വെബ്സൈറ്റിൽ നിങ്ങൾ തന്നെ ടൈപ്പ് ചെയ്യണം.`,
      en: `🔒 Koode removed your ${found.map((t) => PII_EN[t]).join(', ')} before using the request. If a website needs it, type it there yourself.`
    };
  }

  // ---------------------------------------------------------------- search queries
  const MAX_QUERY = 80;
  const LANGS = { ml: 'malayalam', en: 'english', hi: 'hindi', ta: 'tamil', kn: 'kannada', te: 'telugu' };
  // Topic safety, in three tiers:
  //  - self_harm: never searched; Koode answers with a helpline instead (no network call at all).
  //  - HARD: explicit, weapon-making or drug-buying searches, always refused.
  //  - SENSITIVE words are allowed with an educational context ("sex education", "suicide prevention",
  //    "rape law", "ganja addiction recovery", "ലഹരി വിമുക്തി ബോധവൽക്കരണം"), refused alone.
  const SELF_HARM = /(?<![a-z])(?:kill myself|end my life|want to die|suicide (?:method|methods|ways|tips)|how to (?:commit )?suicide|how to die|painless death)(?![a-z])|ആത്മഹത്യ ചെയ്യാൻ|ആത്മഹത്യ ചെയ്യുന്ന(?:ത്| വിധം)|എങ്ങനെ മരിക്കാം|മരിക്കണം|ജീവിതം അവസാനിപ്പിക്ക/i;
  const HARD = /(?<![a-z])(?:porn\w*|xxx|hentai|onlyfans|nudes|naked (?:girls?|women|men|pics?|photos?|videos?)|escorts?|call girls?|sex (?:videos?|chat|movies?|clips?|photos?)|sexy (?:videos?|girls?|photos?)|bomb making|make (?:a )?bomb|build (?:a )?bomb|buy (?:drugs|weed|ganja|cocaine|mdma|charas))(?![a-z])|പോൺ|നഗ്ന\s?(?:ചിത്ര|വീഡിയോ|ഫോട്ടോ)|സെക്സ് (?:വീഡിയോ|ചാറ്റ്|സിനിമ)|ബോംബ് ഉണ്ടാക്ക|കഞ്ചാവ് വാങ്ങ|കഞ്ചാവ് എവിടെ/i;
  const SENSITIVE = /(?<![a-z])(?:sex|sexy|sexual|rape|suicide|ganja|cocaine|mdma|nude)(?![a-z])|സെക്സ്|ലൈംഗിക|ആത്മഹത്യ|കഞ്ചാവ്|ബലാത്സംഗ|ലഹരി|മയക്കുമരുന്ന്/i;
  const EDU = /(?<![a-z])(?:education|educational|awareness|prevention|preventing|prevent|helpline|support|safety|history|law|laws|legal|rights|recovery|rehab|rehabilitation|de-?addiction|addiction|quit|quitting|health|biology|puberty|survivors?|counsell?ing|counsell?or|victims?|science|class|classes|lecture|documentary|news|ratio|determination|chromosomes?|reproduction|reproductive|harassment|abuse|consent|ipc|bns|pocso|police|treatment|effects|side effects)(?![a-z])|വിദ്യാഭ്യാസ|ബോധവൽക്കരണ|ബോധവത്കരണ|പ്രതിരോധ|സുരക്ഷ|ചരിത്ര|നിയമ|ആരോഗ്യ|ഹെൽപ്‌?ലൈൻ|കൗൺസില|വിമുക്ത|ചികിത്സ|ക്ലാസ്|ഡോക്യുമെന്ററി|വാർത്ത|പോക്സോ|അതിക്രമ|ദോഷഫല|ദൂഷ്യഫല/i;
  function safety(text) {
    const s = String(text || '').normalize('NFC');
    if (SELF_HARM.test(s)) return 'self_harm';
    if (HARD.test(s)) return 'unsafe';
    if (SENSITIVE.test(s) && !EDU.test(s)) return 'unsafe';
    return 'ok';
  }
  // Domain-like tokens are dropped: a query is text for YouTube's search box, never a place to go.
  const TLD = /(?:^|[a-z0-9-])\.(?:com|in|org|net|io|co|gov|nic|edu|info|biz|xyz|top|site|online|link|app|me|ly|be|tk|ru|cn|club|live|shop|store|tv|us|uk|ai)(?:$|[/.:?#])/i;
  const KEEP = /[^\p{Script=Latin}\p{Script=Malayalam}0-9‌‍ '&-]/gu;
  const INVISIBLE = /[\u0000-\u001f\u007f­​‎‏‪-‮⁠-⁯﻿]/g;
  const hasMalayalam = (s) => /[ഀ-ൿ]/.test(s || '');

  function cleanQuery(q) {
    if (typeof q !== 'string') return { ok: false, reason: 'not_text' };
    let s = q.normalize('NFC').replace(INVISIBLE, ' ');
    const safe0 = safety(s);
    if (safe0 !== 'ok') return { ok: false, reason: safe0 };
    const tokens = s.split(/\s+/).filter(Boolean).filter((w) => !(
      /:/.test(w) ||                         // schemes and operators (site:, intitle:, https:)
      /^[-+@#~]/.test(w) ||                  // exclusion/required/handle/hashtag operators
      /^(?:OR|AND|NOT|\|)$/.test(w) ||       // boolean operators
      /^www\./i.test(w) || /[\\/]/.test(w) || TLD.test(w) ||
      /^\[[A-Z_]+\]$/.test(w)                // redaction placeholders
    ));
    s = tokens.join(' ').replace(KEEP, ' ');
    // Personal numbers never go into a query, even if a model put them there.
    s = redact(s).text.replace(/\[[A-Z_]+\]/g, ' ');
    s = s.replace(/(?:^|\s)[-'&]+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > MAX_QUERY) s = s.slice(0, MAX_QUERY).replace(/\s+\S*$/, '').trim() || s.slice(0, MAX_QUERY);
    if ((s.match(/\p{L}/gu) || []).length < 2) return { ok: false, reason: 'empty' };
    const safe1 = safety(s);
    if (safe1 !== 'ok') return { ok: false, reason: safe1 };
    return { ok: true, query: s };
  }

  function youtubeResultsUrl(q) {
    const c = cleanQuery(q);
    return c.ok ? 'https://www.youtube.com/results?search_query=' + encodeURIComponent(c.query).replace(/%20/g, '+') : null;
  }

  // Requested content language: only an explicit "in English" / "ഇംഗ്ലീഷിൽ" / "hindi videos" counts
  // ("ഇംഗ്ലീഷ് പഠിക്കണം" — learn English — is a topic, and the videos stay Malayalam).
  const LANG_RES = [
    ['en', /(?<![a-z])in english(?![a-z])|(?<![a-z])english (?:video|videos|language)(?![a-z])|ഇംഗ്ലീഷിൽ|ഇംഗ്ലീഷിലുള്ള|ഇംഗ്ലീഷ് വീഡിയോ[ഀ-ൿ]*/g],
    ['hi', /(?<![a-z])in hindi(?![a-z])|(?<![a-z])hindi (?:video|videos)(?![a-z])|ഹിന്ദിയിൽ|ഹിന്ദിയിലുള്ള|ഹിന്ദി വീഡിയോ[ഀ-ൿ]*/g],
    ['ta', /(?<![a-z])in tamil(?![a-z])|(?<![a-z])tamil (?:video|videos)(?![a-z])|തമിഴിൽ|തമിഴിലുള്ള|തമിഴ് വീഡിയോ[ഀ-ൿ]*/g],
    ['kn', /(?<![a-z])in kannada(?![a-z])|കന്നഡയിൽ/g],
    ['te', /(?<![a-z])in telugu(?![a-z])|തെലുങ്കിൽ/g],
    ['ml', /(?<![a-z])in malayalam(?![a-z])|മലയാളത്തിൽ|മലയാളത്തിലുള്ള/g]
  ];
  function detectLang(text) {
    const t = String(text || '').toLowerCase();
    for (const [lang, re] of LANG_RES) {
      re.lastIndex = 0;
      const cuts = [];
      let m;
      while ((m = re.exec(t))) cuts.push({ start: m.index, end: m.index + m[0].length });
      if (cuts.length) return { lang, cuts };
    }
    return { lang: 'ml', cuts: [] };
  }

  // Adds the content language to an English query ("solar panel installation" → "… malayalam").
  function withLang(q, lang) {
    if (!q || lang === 'en') return q || null;
    const name = LANGS[lang] || LANGS.ml;
    if (new RegExp('(?<![a-z])' + name + '(?![a-z])', 'i').test(q) || (lang === 'ml' && /മലയാളം/.test(q))) return q;
    const c = cleanQuery((q.length + name.length + 1 > MAX_QUERY ? q.slice(0, MAX_QUERY - name.length - 1).replace(/\s+\S*$/, '') : q) + ' ' + name);
    return c.ok ? c.query : q;
  }

  // Malayalam-first: the Malayalam query runs first; the English query (+ the content language) is the
  // fallback when results are thin. Other requested languages search in English + that language.
  function planSearch({ query_ml, query_en, content_lang } = {}) {
    const lang = LANGS[content_lang] ? content_lang : 'ml';
    const ml = cleanQuery(query_ml || '').query || null;
    const en = cleanQuery(query_en || '').query || null;
    let query, fallback = null;
    if (lang === 'ml') {
      query = ml || withLang(en, 'ml');
      fallback = ml && en ? withLang(en, 'ml') : null;
    } else if (lang === 'en') {
      query = en || ml;
    } else {
      query = en ? withLang(en, lang) : ml ? withLang(ml, lang) : null;
    }
    if (fallback && fallback === query) fallback = null;
    return query ? { query, fallback, lang } : null;
  }

  // ---------------------------------------------------------------- intent planner output
  const TYPES = new Set(['youtube_search', 'service', 'on_page', 'ask', 'unsupported']);
  const WANTS = new Set(['official', 'video', 'unspecified']);
  function cleanText(v, max) {
    if (typeof v !== 'string') return '';
    const s = v.normalize('NFC').replace(INVISIBLE, ' ').split(/\s+/).filter((w) => !(/:\/\//.test(w) || /^www\./i.test(w) || TLD.test(w))).join(' ');
    return redact(s).text.slice(0, max).trim();
  }

  // Everything outside this schema is dropped: the model can nominate a query, never a URL or a site.
  function validateIntent(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'not_an_object' };
    if (!TYPES.has(obj.type)) return { ok: false, reason: 'bad_type' };
    const content_lang = LANGS[obj.content_lang] ? obj.content_lang : 'ml';
    const qm = cleanQuery(obj.query_ml), qe = cleanQuery(obj.query_en);
    const harm = [qm.reason, qe.reason].find((r) => r === 'self_harm' || r === 'unsafe');
    if (harm) return { ok: true, intent: { type: 'unsupported', content_lang, query_ml: '', query_en: '', question_ml: '', reason: harm === 'self_harm' ? 'self_harm' : 'unsafe_query' } };
    const intent = { type: obj.type, content_lang, query_ml: qm.ok ? qm.query : '', query_en: qe.ok ? qe.query : '', question_ml: cleanText(obj.question_ml, 160),
      service_id: '', subservice_id: '', wants: WANTS.has(obj.wants) ? obj.wants : 'unspecified' };
    // A service can only be nominated by a verified catalogue id; anything else (a URL, a host, an unknown id)
    // means "no verified destination".
    const Cat = globalThis.KoodeCatalogue;
    const entry = intent.type === 'service' && Cat && typeof obj.service_id === 'string' ? Cat.byId(obj.service_id) : null;
    if (entry) {
      intent.service_id = entry.id;
      const sub = Cat.serviceOf(entry, obj.subservice_id);
      if (sub) intent.subservice_id = sub.id;
    }
    if (intent.type === 'youtube_search' && !intent.query_ml && !intent.query_en) return { ok: false, reason: 'no_valid_query', intent };
    if (intent.type !== 'ask') intent.question_ml = '';
    if (intent.type !== 'service') { intent.service_id = ''; intent.subservice_id = ''; }
    return { ok: true, intent };
  }

  // ---------------------------------------------------------------- what the UI does with an intent
  const MSG = {
    service: {
      ml: 'ഈ സേവനത്തിന്റെ ഔദ്യോഗിക വെബ്സൈറ്റ് Koode ഇതുവരെ പരിശോധിച്ച് ഉറപ്പാക്കിയിട്ടില്ല. തെറ്റായ സൈറ്റിലേക്ക് പോകാതിരിക്കാൻ ഊഹിച്ച് ഒരു സൈറ്റും തുറക്കില്ല.',
      en: "Koode hasn't verified an official website for this service yet, so it won't guess one (a wrong site could be a scam)."
    },
    choose: { ml: 'എങ്ങനെ സഹായിക്കണം? 1) ഔദ്യോഗിക സർക്കാർ വെബ്സൈറ്റിലേക്ക് പോകാം, അല്ലെങ്കിൽ 2) മലയാളം ട്യൂട്ടോറിയൽ കാണാം. "ഒന്ന്" അല്ലെങ്കിൽ "രണ്ട്" എന്ന് പറയൂ.',
      en: 'How should I help? 1) Go to the official government website, or 2) watch a Malayalam tutorial. Say "one" or "two", or press a button.' },
    optOfficial: { ml: 'ഔദ്യോഗിക വെബ്സൈറ്റിലേക്ക് പോകാം', en: 'Go to the official website' },
    optVideo: { ml: 'മലയാളം ട്യൂട്ടോറിയൽ കാണാം', en: 'Watch a Malayalam tutorial' },
    cancelled: { ml: 'ശരി, തുറക്കുന്നില്ല.', en: "Okay, I won't open it." },
    needGrant: { ml: 'Chrome അനുവാദം ചോദിക്കാൻ താഴെയുള്ള "✓ തുറക്കാം" ബട്ടൺ അമർത്തൂ.', en: 'Press the "✓ Open" button below so Chrome can ask for access to this site (one time).' },
    handoff: { ml: 'ഔദ്യോഗിക സൈറ്റ് തുറന്നു. ഈ സൈറ്റിൽ Koode ഇപ്പോൾ ഘട്ടം ഘട്ടമായി നയിക്കില്ല; സൈറ്റിലെ നിർദ്ദേശങ്ങൾ പിന്തുടരൂ. വാഹന നമ്പർ, മൊബൈൽ നമ്പർ, OTP എന്നിവ നിങ്ങൾ തന്നെ നൽകൂ.',
      en: "The official site is open. Koode doesn't guide step by step on this site yet, so follow the site's own steps. You type the vehicle number, mobile number and OTP yourself." },
    offSite: { ml: 'ഇത് ഔദ്യോഗിക സൈറ്റ് അല്ല. Koode ഇവിടെ നിർദ്ദേശങ്ങൾ നിർത്തി. തിരികെ പോകാൻ ബ്രൗസറിലെ "Back" അമർത്തൂ.',
      en: 'This is not the official site, so Koode has paused guidance. Use the browser Back button to return.' },
    offer: { ml: 'ഇതിനെക്കുറിച്ചുള്ള വീഡിയോകൾ കാണാം', en: 'Show videos about it' },
    on_page: { ml: 'ഈ പേജിൽ Koode-ന് ഇപ്പോൾ സഹായിക്കാനാവില്ല. വീഡിയോ വേണമെങ്കിൽ "… വീഡിയോ" എന്ന് പറയൂ.', en: 'Koode cannot guide this page yet. For videos, say "… video".' },
    ask: { ml: 'കുറച്ചുകൂടി വ്യക്തമായി പറയാമോ? ഉദാ: "സോളാർ പാനൽ ഇൻസ്റ്റലേഷൻ വീഡിയോകൾ".', en: 'Could you say a little more about what you want? e.g. “solar panel installation videos”.' },
    unsupported: { ml: 'ക്ഷമിക്കണം, അതിന് Koode-ന് സഹായിക്കാനാവില്ല.', en: "Sorry, Koode can't help with that." },
    // Tele-MANAS: India's free 24×7 mental-health helpline (14416 or 1-800-891-4416); 112: emergency.
    selfHarm: { ml: 'നിങ്ങൾ ഒറ്റയ്ക്കല്ല. ഇപ്പോൾ തന്നെ ആരോടെങ്കിലും സംസാരിക്കൂ: Tele-MANAS ഹെൽപ്‌ലൈൻ 14416 (സൗജന്യം, 24 മണിക്കൂറും, മലയാളത്തിലും). അപകടസാധ്യതയുണ്ടെങ്കിൽ 112 വിളിക്കൂ.',
      en: "You're not alone. Please talk to someone now: Tele-MANAS helpline 14416 (free, 24×7, Malayalam available). If you are in danger, call 112." },
    offline: { ml: 'Koode സെർവറുമായി ബന്ധപ്പെടാനായില്ല.', en: 'Koode backend is not reachable. Is it running?' },
    busy: { ml: 'AI സേവനം തിരക്കിലാണ്. കുറച്ച് കഴിഞ്ഞ് വീണ്ടും പറയൂ.', en: 'The AI service is busy (rate limit). Try again in a moment.' },
    error: { ml: 'ക്ഷമിക്കണം, അഭ്യർത്ഥന മനസ്സിലാക്കാനായില്ല. ഒന്നുകൂടി പറയൂ.', en: 'Sorry, I could not work out that request. Please try again.' },
    noQuery: { ml: 'എന്ത് തിരയണമെന്ന് മനസ്സിലായില്ല. ഒന്നുകൂടി പറയൂ.', en: 'I could not tell what to search for. Please say it again.' }
  };
  const searchText = (q) => ({ ml: `യൂട്യൂബിൽ “${q}” തിരയുന്നു…`, en: `Searching YouTube for “${q}”…` });

  // resp: /api/intent response (or { error, code }). ctx.guidable: Koode can guide the current page.
  function intentToAction(resp, ctx = {}) {
    if (!resp || resp.error) {
      const m = resp && resp.code === 'offline' ? MSG.offline : resp && resp.code === 'rate_limited' ? MSG.busy : MSG.error;
      return { kind: 'say', ...m, reason: (resp && (resp.code || resp.error)) || 'no_response' };
    }
    if (resp.reason === 'self_harm') return { kind: 'say', ...MSG.selfHarm, reason: 'self_harm' };
    // A model "unsupported" with no safety reason, for a request that clearly names a verified service
    // (live: "information about my car through a government website"), offers that service instead.
    if (resp.type === 'unsupported' && !resp.reason && ctx.goal && globalThis.KoodeCatalogue) {
      const m = globalThis.KoodeCatalogue.match(ctx.goal);
      if (m) return { kind: 'service', entry: m.entry, service: m.service, want: globalThis.KoodeCatalogue.wants(ctx.goal) };
    }
    switch (resp.type) {
      case 'youtube_search': {
        const search = planSearch(resp);
        return search ? { kind: 'youtube_search', search } : { kind: 'say', ...MSG.noQuery, reason: 'no_query' };
      }
      case 'service': {
        // Only a verified catalogue entry can be opened; otherwise explain, and offer (never start) a tutorial search.
        const Cat = globalThis.KoodeCatalogue;
        let entry = Cat && resp.service_id ? Cat.byId(resp.service_id) : null;
        // A model nomination outside the entry's scope (vehicle RC → driving-licence portal) is not trusted.
        if (entry && ctx.goal && Cat.excluded(entry, ctx.goal)) entry = null;
        if (entry) return { kind: 'service', entry, service: Cat.serviceOf(entry, resp.subservice_id), want: resp.wants || 'unspecified' };
        const offer = planSearch(resp);
        return { kind: 'say', ...MSG.service, offer: offer || null, offerLabel: MSG.offer, reason: 'service_not_verified' };
      }
      case 'on_page': return ctx.guidable ? { kind: 'guide' } : { kind: 'say', ...MSG.on_page, reason: 'page_not_guidable' };
      case 'ask': return { kind: 'say', ml: resp.question_ml || MSG.ask.ml, en: MSG.ask.en, reason: 'ask' };
      default: return { kind: 'say', ...MSG.unsupported, reason: 'unsupported' };
    }
  }

  const api = { redact, redactionNotice, safety, cleanQuery, youtubeResultsUrl, detectLang, withLang, planSearch, validateIntent, intentToAction,
    searchText, hasMalayalam, LANGS, MSG, MAX_QUERY };
  globalThis.KoodeGoals = api;
  if (typeof globalThis.Koode === 'object' && globalThis.Koode) globalThis.Koode.goals = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
