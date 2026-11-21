// Verified destination catalogue (no network, no model). Shared by the side panel, the content script,
// the service worker (importScripts), the backend (createRequire) and unit tests.
//
// Every entry is checked by a person/build against the live site before it is added: exact host, valid TLS,
// the operator, and an independent link from a parent official site. URLs here are the ONLY destinations
// Koode will open for a service; a model can nominate an entry `id`, never a URL. Hosts are requested from
// Chrome one at a time (optional host permissions), only after the user confirms.
//
// Entry fields
//   id, kind ('government' | 'website'), name/ml, owner, entry (URL opened), hosts (task stays on these),
//   verified { on, by, evidence[], recheck_by }, topic (words that name the area), services[]:
//     { id, en, ml, words (when this sub-service is meant), hint (route seen on the real site, quoted labels),
//       handoff (label of the step after which the user continues alone), video { ml, en } (tutorial search) }
(() => {
  const ML = '\\u0D00-\\u0D7F';
  const CATALOGUE = [
    {
      id: 'sarathi',
      kind: 'government',
      name: 'Sarathi Parivahan (Driving Licence services)',
      ml: 'സാരഥി പരിവാഹൻ (ഡ്രൈവിംഗ് ലൈസൻസ് സേവനങ്ങൾ)',
      owner: 'Ministry of Road Transport & Highways, Government of India (hosted by NIC)',
      entry: 'https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do',
      hosts: ['sarathi.parivahan.gov.in'],
      verified: {
        on: '2026-11-22',
        by: 'Koode M2 build: live fetch + headless-Chrome inspection (human sign-off pending)',
        evidence: [
          'https://parivahan.gov.in/ (MoRTH portal) links "Driving License Related Services" to exactly this entry URL',
          'TLS certificate CN=*.parivahan.gov.in, SAN parivahan.gov.in, valid; served from 164.100.69.5 (NIC range)',
          'https://sarathi.parivahan.gov.in/ redirects to /sarathiservice/stateSelection.do (state list, title "Home")',
          'Kerala home shows "Transport Department, Government of Kerala" and the Learner Licence / Driving Licence / Others menus'
        ],
        recheck_by: '2027-02-22'
      },
      topic: ['driving licence', 'driving license', 'driving licen', 'learner licence', 'learner license', 'learners licence', 'dl', 'll',
        'sarathi', 'parivahan', 'ഡ്രൈവിംഗ് ലൈസൻസ്', 'ഡ്രൈവിങ് ലൈസൻസ്', 'ഡ്രൈവിംഗ് ലൈസെൻസ്', 'ലേണേഴ്സ് ലൈസൻസ്', 'ലേണേഴ്സ്', 'ലേണർ ലൈസൻസ്',
        'സാരഥി', 'പരിവാഹൻ', 'ഡിഎൽ', 'ലൈസൻസ് പുതുക്ക', 'ഡ്രൈവിംഗ് ടെസ്റ്റ്'],
      // Vehicle registration (RC), tax, permits and insurance are VAHAN services, not Sarathi: a request about the
      // vehicle is excluded unless it clearly names the driver's licence (driving / learner / "to drive").
      notTopic: ['vehicle', 'vehicles', 'registration', 'rc', 'rc book', 'vahan', 'number plate', 'insurance', 'permit', 'fitness', 'road tax', 'vandi', 'vandiyude',
        'വണ്ടി', 'വാഹന', 'വാഹൻ', 'രജിസ്ട്രേഷൻ', 'ആർസി', 'ആർ സി', 'നമ്പർ പ്ലേറ്റ്', 'ഇൻഷുറൻസ്', 'പെർമിറ്റ്', 'ഫിറ്റ്നസ്'],
      strongTopic: ['driving', 'learner', 'learners', 'dl', 'sarathi', 'odikkan', 'ഡ്രൈവിംഗ്', 'ഡ്രൈവിങ്', 'ലേണേഴ്സ്', 'ലേണർ', 'സാരഥി', 'ഡിഎൽ', 'ഓടിക്കാൻ', 'ഓടിക്കാനുള്ള'],
      scope: 'driving licence and learner licence services only (NOT vehicle registration/RC, vehicle tax, permits or insurance)',
      services: [
        {
          id: 'dl_details', en: 'Know your driving licence details (DL Search)', ml: 'ഡ്രൈവിംഗ് ലൈസൻസ് വിവരങ്ങൾ അറിയാൻ',
          words: ['details', 'detail', 'status', 'search', 'check', 'know', 'find', 'view', 'information', 'info',
            'വിവര', 'ഡീറ്റെയിൽ', 'സ്റ്റാറ്റസ്', 'നോക്ക', 'അറിയ', 'കാണ', 'പരിശോധിക്ക', 'തിരയ'],
          hint: 'Choose "Kerala" in the state list → close the popup with "Skip" → open the "Others" menu → "DL Search" → the user types "Mobile Number" and "Captcha" → "Generate OTP" (the user continues with the OTP alone)',
          handoff: 'Generate OTP',
          video: { ml: 'ഡ്രൈവിംഗ് ലൈസൻസ് വിവരങ്ങൾ ഓൺലൈനായി അറിയാം', en: 'driving licence details online sarathi' }
        },
        {
          id: 'dl_renewal', en: 'Renew or replace a driving licence', ml: 'ഡ്രൈവിംഗ് ലൈസൻസ് പുതുക്കാൻ / ഡ്യൂപ്ലിക്കേറ്റ്',
          words: ['renew', 'renewal', 'duplicate', 'replace', 'expired', 'address change', 'പുതുക്ക', 'ഡ്യൂപ്ലിക്കേറ്റ്', 'കാലാവധി', 'വിലാസം'],
          hint: 'Choose "Kerala" in the state list → close the popup with "Skip" → open the "Driving Licence" menu → "Services on DL (Renewal/Duplicate/AEDL/IDP/Others)" → the user enters their licence number and details themselves',
          handoff: 'Proceed',
          video: { ml: 'ഡ്രൈവിംഗ് ലൈസൻസ് പുതുക്കൽ ഓൺലൈൻ', en: 'driving licence renewal online sarathi' }
        },
        {
          id: 'learner_licence', en: 'Apply for a learner licence', ml: 'ലേണേഴ്സ് ലൈസൻസിന് അപേക്ഷിക്കാൻ',
          words: ['learner', 'learners', 'new licence', 'new license', 'apply', 'll', 'ലേണേഴ്സ്', 'ലേണർ', 'പുതിയ ലൈസൻസ്', 'അപേക്ഷ'],
          hint: 'Choose "Kerala" in the state list → close the popup with "Skip" → open the "Learner Licence" menu → "Application for New Learner Licence" → the user fills in their own details',
          handoff: 'Continue',
          video: { ml: 'ലേണേഴ്സ് ലൈസൻസ് ഓൺലൈൻ അപേക്ഷ', en: 'learner licence apply online sarathi' }
        },
        {
          id: 'application_status', en: 'Check a licence application status', ml: 'ലൈസൻസ് അപേക്ഷയുടെ നില അറിയാൻ',
          words: ['application status', 'my application', 'pending application', 'അപേക്ഷയുടെ', 'അപേക്ഷ നില', 'അപേക്ഷാ നില'],
          hint: 'Choose "Kerala" in the state list → close the popup with "Skip" → open the "Others" menu → "Application Status" → the user types their application number and date of birth themselves',
          handoff: 'Submit',
          video: { ml: 'ലൈസൻസ് അപേക്ഷ സ്റ്റാറ്റസ് ഓൺലൈൻ', en: 'driving licence application status online sarathi' }
        }
      ]
    },
    {
      // LINK-ONLY entry (guide: false): Koode confirms and opens the verified official page, then hands off.
      // It does not guide on these sites yet (not tested), so no Chrome site access is requested.
      id: 'vehicle',
      kind: 'government',
      guide: false,
      name: 'Parivahan vehicle services (Know Vehicle Details · Vahan)',
      ml: 'പരിവാഹൻ വാഹന സേവനങ്ങൾ',
      owner: 'Ministry of Road Transport & Highways, Government of India',
      entry: 'https://services.parivahan.gov.in/ntr/#/knowurdetails/login',
      hosts: ['services.parivahan.gov.in', 'vahan.parivahan.gov.in'],
      verified: {
        on: '2026-11-22',
        by: 'Koode build: live fetch + headless-Chrome inspection (human sign-off pending)',
        evidence: [
          'https://parivahan.gov.in/ (MoRTH portal) links "Know Vehicle / DL Details" to exactly the details URL',
          'Details page: "National Transport Repository — Citizen Login – Vehicle & Driving Licence Details" (MoRTH); mobile number, captcha and OTP login',
          'https://vahan.parivahan.gov.in/vahanservice/ → "VAHAN 4.0 (Citizen Services)", MoRTH header, "Enter Registration Number"; the vahan host is linked from parivahan.gov.in',
          'TLS certificate CN=*.parivahan.gov.in valid on both hosts; Vahan served from 164.100.69.3 (NIC range)',
          'Not added: analytics.parivahan.gov.in/analytics/vehiclestatusreport answered 403 Forbidden in a real browser'
        ],
        recheck_by: '2027-02-22'
      },
      topic: ['vehicle', 'vehicles', 'car', 'bike', 'motorcycle', 'scooter', 'two wheeler', 'rc', 'rc book', 'registration certificate', 'vahan', 'vandi', 'vandiyude',
        'വണ്ടി', 'വാഹന', 'വാഹനത്ത', 'കാർ', 'കാറ', 'ബൈക്ക', 'സ്കൂട്ടർ', 'ഇരുചക്ര', 'ആർസി', 'ആർ സി', 'വാഹൻ', 'വെഹിക്കിൾ'],
      // A driving licence is Sarathi's: excluded unless the request is clearly about the vehicle record itself.
      notTopic: ['driving', 'learner', 'learners', 'dl', 'sarathi', 'odikkan', 'ഡ്രൈവിംഗ്', 'ഡ്രൈവിങ്', 'ലേണേഴ്സ്', 'ലേണർ', 'സാരഥി', 'ഡിഎൽ', 'ഓടിക്കാൻ', 'ഓടിക്കാനുള്ള'],
      strongTopic: ['rc', 'rc book', 'registration', 'vahan', 'ആർസി', 'രജിസ്ട്രേഷൻ', 'വാഹൻ'],
      // Vehicle words alone ("car wash", "bike video") are not a government request: a service word, or an
      // explicit official/government/website request, is required.
      requireService: true,
      scope: 'the vehicle record: registration (RC) details, owner, tax, fitness, insurance validity, transfer and other Vahan services (NOT driving licences)',
      services: [
        {
          id: 'vehicle_details', en: 'Know your vehicle details (registration, owner, validity)', ml: 'വാഹനത്തിന്റെ വിവരങ്ങൾ അറിയാൻ',
          url: 'https://services.parivahan.gov.in/ntr/#/knowurdetails/login',
          words: ['details', 'detail', 'information', 'info', 'status', 'know', 'check', 'owner', 'validity', 'insurance', 'വിവര', 'അറിയ', 'നോക്ക', 'ഉടമ', 'സ്റ്റാറ്റസ്', 'ഡീറ്റെയിൽ', 'കാലാവധി'],
          video: { ml: 'വാഹന വിവരങ്ങൾ ഓൺലൈനായി അറിയാം', en: 'check vehicle details online parivahan' }
        },
        {
          id: 'vehicle_services', en: 'Vahan citizen services (transfer, tax, fitness, permits, duplicate RC)', ml: 'വാഹൻ സേവനങ്ങൾ (ഉടമസ്ഥാവകാശ കൈമാറ്റം, നികുതി, ഫിറ്റ്നസ്)',
          url: 'https://vahan.parivahan.gov.in/vahanservice/',
          words: ['transfer', 'ownership', 'tax', 'fitness', 'permit', 'hypothecation', 'duplicate rc', 'renew registration', 'address change', 'noc', 'pay tax',
            'കൈമാറ്റ', 'ഉടമസ്ഥാവകാശ', 'നികുതി', 'ഫിറ്റ്നസ്', 'പെർമിറ്റ്', 'പുതുക്ക', 'ടാക്സ്'],
          video: { ml: 'വാഹന ഉടമസ്ഥാവകാശ കൈമാറ്റം ഓൺലൈൻ', en: 'vahan vehicle ownership transfer online' }
        }
      ]
    }
  ];

  const norm = (t) => String(t || '').normalize('NFC').replace(/[\u200C\u200D]/g, '').toLowerCase();
  // Latin words match whole words; Malayalam stems may take suffixes (ലൈസൻസിന്റെ, പുതുക്കാൻ).
  function wordRe(w) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*');
    return /[\u0D00-\u0D7F]/.test(w)
      ? new RegExp('(?<![' + ML + '])' + esc.replace(/്$/, ''), 'u')
      : new RegExp('(?<![a-z])' + esc + '(?![a-z])');
  }
  for (const e of CATALOGUE) {
    e.topicRes = e.topic.map(wordRe);
    e.notRes = (e.notTopic || []).map(wordRe);
    e.strongRes = (e.strongTopic || []).map(wordRe);
    for (const s of e.services) s.res = s.words.map(wordRe);
  }

  // Best catalogue entry (and sub-service) a request is about, or null. A sub-service is chosen only when
  // its words appear; otherwise the user is taken to the entry page and the step planner asks/guides.
  // A request outside the entry's scope (e.g. vehicle registration for the driving-licence portal).
  function excluded(entry, text) {
    const t = norm(text);
    return !!entry && entry.notRes.some((re) => re.test(t)) && !entry.strongRes.some((re) => re.test(t));
  }

  function match(text) {
    const t = norm(text);
    let best = null;
    for (const e of CATALOGUE) {
      if (excluded(e, t)) continue;
      const hits = e.topicRes.filter((re) => re.test(t)).length;
      if (!hits) continue;
      const scored = e.services.map((s) => [s.res.filter((re) => re.test(t)).length, s]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]);
      if (e.requireService && !scored.length && !OFFICIAL.test(t) && !GOVW.test(t)) continue;
      const cand = { entry: e, service: scored.length ? scored[0][1] : null, score: hits };
      if (!best || cand.score > best.score) best = cand;
    }
    return best;
  }

  const GOVW = new RegExp('(?<![a-z])(?:government|govt|sarkar|sarkkar|parivahan)(?![a-z])|(?<![' + ML + '])(?:ഗവൺമെന്റ|ഗവണ്മെന്റ|ഗവർമെന്റ|സർക്കാർ|പരിവാഹൻ)', 'u');
  // What the user asked for: the official website, a video, or not said.
  const OFFICIAL = new RegExp('(?<![a-z])(?:official|website|web site|site|portal|online|apply online|government site|govt site|open|go to|take me)(?![a-z])|' +
    // Malayalam stems without the final virama, so case endings match (വെബ്സൈറ്റിൽ, സൈറ്റിലേക്ക്, യൂട്യൂബിൽ).
    '(?<![' + ML + '])(?:ഔദ്യോഗിക|വെബ്സൈറ്റ|വെബ്‌സൈറ്റ|സൈറ്റ|പോർട്ടൽ|ഓൺലൈൻ|ഓൺലൈനാ|സർക്കാർ സൈറ്റ|തുറക്ക|തുറന്ന|കൊണ്ടുപോക|പോകാം)', 'u');
  const VIDEO = new RegExp('(?<![a-z])(?:videos?|tutorials?|youtube|watch)(?![a-z])|(?<![' + ML + '])(?:വീഡിയോ|വിഡിയോ|ട്യൂട്ടോറിയൽ|യൂട്യൂബ|കാണിച്ചുതര)', 'u');
  function wants(text) {
    const t = norm(text);
    const v = VIDEO.test(t), o = OFFICIAL.test(t);
    return v && !o ? 'video' : o && !v ? 'official' : 'unspecified';
  }

  // Answer to an options card ("ഒന്ന്", "വെബ്സൈറ്റ്", "two", "വീഡിയോ") or a confirmation ("ശരി", "വേണ്ട").
  const CHOICE_OFFICIAL = new RegExp('^(?:1|one|first|official|website|site|ഒന്ന്|ഒന്നാമത്തേത്|ആദ്യത്തേത്|ഔദ്യോഗിക[' + ML + ']*|വെബ്സൈറ്റ്[' + ML + ']*|സൈറ്റ്[' + ML + ']*)$', 'u');
  const CHOICE_VIDEO = new RegExp('^(?:2|two|second|video|videos|tutorial|രണ്ട്|രണ്ടാമത്തേത്|വീഡിയോ[' + ML + ']*|ട്യൂട്ടോറിയൽ[' + ML + ']*)$', 'u');
  const YES = /^(?:yes|yeah|ok|okay|sure|go|open|confirm|ശരി|അതെ|ഉവ്വ്|ഓക്കെ|തുറക്കൂ|തുറന്നോളൂ|വേണം|പോകാം|ശരി തുറക്കൂ)$/u;
  const NO = /^(?:no|nope|cancel|stop|don'?t|വേണ്ട|ഇല്ല|റദ്ദാക്കൂ|വേണ്ടാ)$/u;
  const FILL = /^(?:please|koode|കൂടെ|ദയവായി|the|a|എനിക്ക്|ആ|അത്|മതി)$/u;
  function answer(text) {
    const words = norm(text).replace(/[.,!?।]/g, ' ').split(/\s+/).filter((w) => w && !FILL.test(w));
    if (!words.length || words.length > 3) return null;
    const j = words.join(' ');
    if (YES.test(j)) return 'yes';
    if (NO.test(j)) return 'no';
    if (words.every((w) => CHOICE_OFFICIAL.test(w) || YES.test(w))) return 'official';
    if (words.every((w) => CHOICE_VIDEO.test(w))) return 'video';
    return null;
  }

  const byId = (id) => CATALOGUE.find((e) => e.id === id) || null;
  const serviceOf = (entry, sid) => (entry && sid && entry.services.find((s) => s.id === sid)) || null;
  // Only entries Koode guides on count as guided sites (link-only entries are opened and handed off).
  const forHost = (host) => CATALOGUE.find((e) => e.guide !== false && e.hosts.includes(String(host || '').toLowerCase())) || null;
  const origins = (entry) => entry.hosts.map((h) => 'https://' + h + '/*');
  // The page to open: the sub-service's own verified URL, else the entry URL; always on the entry's hosts.
  const urlFor = (entry, service) => {
    const u = (service && service.url) || entry.entry;
    try { const x = new URL(u); return x.protocol === 'https:' && entry.hosts.includes(x.hostname) ? u : null; } catch (_) { return null; }
  };
  const onHosts = (entry, url) => { try { const u = new URL(url); return u.protocol === 'https:' && entry.hosts.includes(u.hostname); } catch (_) { return false; } };

  // Tutorial search for a service (M1 search shape): Malayalam first, English + "malayalam" fallback.
  function videoSearch(entry, service) {
    const v = (service && service.video) || { ml: entry.ml.split('(')[0].trim(), en: entry.name };
    const G = globalThis.KoodeGoals;
    return G ? G.planSearch({ query_ml: v.ml, query_en: v.en, content_lang: 'ml' }) : { query: v.ml, fallback: null, lang: 'ml' };
  }

  // The goal text for the step planner's TASK_HINT (trusted, from this catalogue).
  function taskHint(entry, service) {
    const base = `Official site: ${entry.name} (${entry.hosts[0]}).`;
    return (service ? `${base} Task: ${service.en}. Usual route on this site: ${service.hint}.` : `${base} Find the service the user asked for in its menus.`) +
      ' The user types every personal detail, captcha and OTP themselves.';
  }

  const api = { CATALOGUE, match, excluded, wants, urlFor, answer, byId, serviceOf, forHost, origins, onHosts, videoSearch, taskHint };
  globalThis.KoodeCatalogue = api;
  if (typeof globalThis.Koode === 'object' && globalThis.Koode) globalThis.Koode.catalogue = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
