// Regression (live test, 0.5.1): on YouTube, a vehicle-registration / licence request went to the YouTube page
// planner ("no controls to find a vehicle licence number") instead of a search or the intent planner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planIntent } from '../../backend/src/intent.js';

globalThis.self = globalThis;
const require = createRequire(import.meta.url);
const G = require('../../extension/src/shared/goals.js');
const Cat = require('../../extension/src/shared/catalogue.js');
require('../../extension/src/shared/sites.js');
const S = globalThis.KoodeSites;
const onYT = (t) => S.classify(G.redact(t).text, { siteId: 'youtube' });

// The transcript from the live test (already on youtube.com/results).
const LIVE = 'എനിക്ക് എന്റെ വണ്ടിയുടെ ലൈസൻസ് നമ്പർ കുറിച്ച് അറിയണമായിരുന്നു. അപ്പോൾ അതിന് ഗവൺമെന്റ് വെബ്സൈറ്റ്സ് ഏതേലും ഉണ്ടോ? ഉണ്ടെങ്കിൽ എനിക്ക് അങ്ങോട്ട് പോകണം.';

test('live transcript on YouTube → the verified VEHICLE service (official, link-only), never the page planner or Sarathi', async () => {
  const r = onYT(LIVE);
  assert.deepEqual([r.type, r.entry.id, r.want], ['service', 'vehicle', 'official']);
  assert.notEqual(Cat.match(LIVE).entry.id, 'sarathi', 'vehicle licence/registration is not the driving-licence portal');
  const { result } = await planIntent({ goal: LIVE, site_id: 'youtube' }, { provider: 'mock', model: 'mock' });
  assert.deepEqual([result.type, result.service_id], ['service', 'vehicle']);
});

test('explicit video requests search YouTube even when already on YouTube (Malayalam, English, Manglish)', () => {
  const cases = [
    ['വാഹന രജിസ്ട്രേഷനെ കുറിച്ചുള്ള വീഡിയോകൾ കാണണം', /വാഹന രജിസ്ട്രേഷ/],
    ['എന്റെ വണ്ടിയുടെ രജിസ്ട്രേഷൻ എങ്ങനെ ചെയ്യാം എന്നതിന്റെ വീഡിയോ വേണം', /^വണ്ടിയുടെ രജിസ്ട്രേഷൻ എങ്ങനെ ചെയ്യാം$/],
    ['ആർസി ബുക്ക് ട്രാൻസ്ഫർ ട്യൂട്ടോറിയൽ വീഡിയോ', /ആർസി ബുക്ക് ട്രാൻസ്ഫർ/],
    ['show me videos about my vehicle registration', /^vehicle registration$/],
    ['vehicle RC transfer tutorial video', /^vehicle rc transfer tutorial$/],
    ['search for vehicle registration', /^vehicle registration$/],
    ['vandiyude registration video kanikku', /^vandiyude registration$/],
    ['youtube il RC book video venam', /^rc book$/],
    ['enikku vandi registration kurichu ulla video kananam', /^vandi registration$/],
    ['driving test tips video', /^driving test tips$/],
    ['ഡ്രൈവിംഗ് ടെസ്റ്റ് എങ്ങനെ പാസാകാം വീഡിയോ', /ഡ്രൈവിംഗ് ടെസ്റ്റ് എങ്ങനെ പാസാകാം/]
  ];
  for (const [t, q] of cases) {
    const r = onYT(t);
    assert.equal(r.type, 'youtube_search', t + ' → ' + r.type);
    assert.match(r.search.query, q, t + ' → "' + r.search.query + '"');
    assert.ok(G.youtubeResultsUrl(r.search.query), 'query is a valid search');
  }
});

test('a driving-licence video request (catalogue topic) still becomes a search of the user’s own topic', () => {
  const r = onYT('ഡ്രൈവിംഗ് ലൈസൻസ് പുതുക്കൽ വീഡിയോ');
  assert.equal(r.type, 'youtube_search');
  assert.match(r.search.query, /ഡ്രൈവിംഗ് ലൈസൻസ് പുതുക്കൽ/);
});

test('vehicle registration / RC never routes to Sarathi (it goes to the vehicle entry); driving licence still does', () => {
  for (const t of ['വണ്ടിയുടെ ലൈസൻസ് പുതുക്കണം', 'vehicle registration details', 'RC book details online', 'എന്റെ വാഹനത്തിന്റെ രജിസ്ട്രേഷൻ വിവരങ്ങൾ']) {
    assert.equal(Cat.match(t).entry.id, 'vehicle', t);
    assert.ok(Cat.excluded(Cat.byId('sarathi'), t), t + ' is outside Sarathi');
    const r = onYT(t);
    assert.deepEqual([r.type, r.entry.id], ['service', 'vehicle'], t + ' (on YouTube too, not the page planner)');
  }
  for (const [t, sub] of [['എനിക്ക് ഡ്രൈവിംഗ് ലൈസൻസ് വിവരങ്ങൾ അറിയണം', 'dl_details'], ['driving licence renewal', 'dl_renewal'], ['ലേണേഴ്സ് ലൈസൻസിന് അപേക്ഷിക്കണം', 'learner_licence']]) {
    const r = onYT(t);
    assert.deepEqual([r.type, r.entry.id, r.service.id], ['service', 'sarathi', sub], t);
  }
  assert.ok(!Cat.excluded(Cat.byId('sarathi'), 'വണ്ടി ഓടിക്കാൻ ലൈസൻസ് എടുക്കണം'), '"licence to drive a vehicle" is a driving licence');
});

test('a model that nominates Sarathi for a vehicle-RC request is not trusted', () => {
  const a = G.intentToAction({ type: 'service', service_id: 'sarathi', subservice_id: 'dl_details', wants: 'official', query_ml: 'വാഹന രജിസ്ട്രേഷൻ' },
    { guidable: true, goal: 'എന്റെ വണ്ടിയുടെ രജിസ്ട്രേഷൻ വിവരങ്ങൾ ഗവൺമെന്റ് സൈറ്റിൽ' });
  assert.deepEqual([a.kind, a.reason], ['say', 'service_not_verified']);
  const ok = G.intentToAction({ type: 'service', service_id: 'sarathi', wants: 'official' }, { guidable: true, goal: 'വണ്ടി ഓടിക്കാൻ ലൈസൻസ് വേണം' });
  assert.equal(ok.kind, 'service');
});

test('commands about the open video, and page-specific questions, stay on the page', () => {
  for (const t of ['stop the video', 'pause this video', 'ഈ വീഡിയോ നിർത്തൂ', 'like this video', 'ഈ വീഡിയോ ഫുൾ സ്ക്രീൻ ആക്കൂ', 'subscribe to this channel']) {
    assert.equal(onYT(t).type, 'guide', t);
  }
  assert.equal(S.classify('ഈ ഫോമിൽ ലൈസൻസ് നമ്പർ എവിടെ', { siteId: 'googleforms' }).type, 'guide');
  assert.equal(S.classify('ലൈസൻസ് നമ്പർ ഫീൽഡ് ഏതാണ്', { siteId: 'sarathi' }).type, 'guide', 'on the official site, guide here');
  assert.equal(S.classify('ഒരാളെ തിരയണം', { siteId: 'whatsapp' }).type, 'guide');
  assert.equal(S.classify('send my video to amma', { siteId: 'whatsapp' }).type, 'guide');
});

test('intent prompt tells the model the Sarathi entry excludes vehicle registration', async () => {
  let seen = '';
  await planIntent({ goal: 'x' }, { provider: 'groq', model: 'x' }, { llm: async (_c, sys, user) => { seen = sys + user; return '{"type":"ask"}'; } });
  assert.match(seen, /NOT vehicle registration/);
});

// ---- Live 0.5.2: "I want information about my car through a government website" → model said "unsupported" ----
const CAR_LIVE = 'എനിക്ക് എന്റെ കാറിനെപ്പറ്റിയുള്ള വിവരങ്ങൾ അറിയാൻ വേണ്ടി ഗവൺമെന്റ് വെബ്സൈറ്റ് കാണാം.';

test('vehicle information requests (Malayalam, English, Manglish) → verified vehicle entry, official route, never Sarathi', () => {
  const cases = [
    [CAR_LIVE, null, 'vehicle_details', 'official'],
    ['I want information about my car through a government website', null, 'vehicle_details', 'official'],
    ['check my vehicle RC details', 'youtube', 'vehicle_details', 'unspecified'],
    ['ente car-nte details government website il nokkanam', null, 'vehicle_details', 'official'],
    ['enikku ente vandiyude RC details venam', 'whatsapp', 'vehicle_details', 'unspecified'],
    ['എന്റെ ബൈക്കിന്റെ ഇൻഷുറൻസ് കാലാവധി അറിയണം', null, 'vehicle_details', 'unspecified'],
    ['vehicle ownership transfer online', 'youtube', 'vehicle_services', 'official'],
    ['വാഹന നികുതി ഓൺലൈനായി അടയ്ക്കണം', null, 'vehicle_services', 'official']
  ];
  for (const [t, here, sub, want] of cases) {
    const r = S.classify(G.redact(t).text, { siteId: here });
    assert.deepEqual([r.type, r.entry && r.entry.id, r.service && r.service.id, r.want], ['service', 'vehicle', sub, want], t);
  }
});

test('vehicle words alone are not a government request; video and driving-licence requests keep their routes', () => {
  assert.notEqual(S.classify('car wash near me', { siteId: null }).type, 'service');
  assert.equal(S.classify('bike repair video', { siteId: 'youtube' }).type, 'youtube_search');
  assert.equal(S.classify('vandiyude registration video kanikku', { siteId: 'youtube' }).type, 'youtube_search');
  assert.equal(S.classify('എനിക്ക് ഡ്രൈവിംഗ് ലൈസൻസ് വിവരങ്ങൾ അറിയണം', { siteId: null }).entry.id, 'sarathi');
  assert.equal(Cat.match('വണ്ടി ഓടിക്കാൻ ലൈസൻസ് എടുക്കണം'), null, 'licence to drive is not the vehicle record');
});

test('vehicle entry is link-only: verified URLs, no guidance, no site access, analytics page excluded', () => {
  const e = Cat.byId('vehicle');
  assert.equal(e.guide, false);
  assert.equal(Cat.urlFor(e, Cat.serviceOf(e, 'vehicle_details')), 'https://services.parivahan.gov.in/ntr/#/knowurdetails/login');
  assert.equal(Cat.urlFor(e, Cat.serviceOf(e, 'vehicle_services')), 'https://vahan.parivahan.gov.in/vahanservice/');
  assert.equal(S.forUrl('https://vahan.parivahan.gov.in/vahanservice/'), null, 'not a guided site');
  assert.ok(!JSON.stringify(Cat.CATALOGUE.map((x) => [x.entry, x.services.map((s) => s.url)])).includes('analytics.parivahan'), '403 page not offered');
  assert.equal(Cat.urlFor({ ...e, entry: 'https://evil.example/x' }, null), null, 'URLs off the entry hosts are refused');
});

test('model "unsupported" without a safety reason → the matching verified service; real safety refusals stay refusals', () => {
  const a = G.intentToAction({ type: 'unsupported', content_lang: 'ml', query_ml: '', query_en: '' }, { guidable: false, goal: CAR_LIVE });
  assert.deepEqual([a.kind, a.entry.id, a.want], ['service', 'vehicle', 'official']);
  assert.equal(G.intentToAction({ type: 'unsupported', reason: 'unsafe_query' }, { goal: CAR_LIVE }).kind, 'say');
  assert.equal(G.intentToAction({ type: 'unsupported' }, { goal: 'play loud music' }).kind, 'say');
});

test('intent prompt: personal vehicle/licence information is a service, not unsupported; vehicle scope listed', async () => {
  let seen = '';
  await planIntent({ goal: 'x' }, { provider: 'groq', model: 'x' }, { llm: async (_c, sys, user) => { seen = sys + user; return '{"type":"ask"}'; } });
  assert.match(seen, /never unsupported/);
  assert.match(seen, /"id":"vehicle"/);
});
