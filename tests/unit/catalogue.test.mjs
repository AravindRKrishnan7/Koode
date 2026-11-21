// M2 verified-service catalogue: integrity, routing, answers, intent validation, planner hint.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { sanitizePlanRequest } from '../../backend/src/safety.js';
import { buildUserMessage } from '../../backend/src/prompt.js';
import { mockPlan } from '../../backend/src/providers/mock.js';
import { planIntent } from '../../backend/src/intent.js';

globalThis.self = globalThis;
const require = createRequire(import.meta.url);
const G = require('../../extension/src/shared/goals.js');
const Cat = require('../../extension/src/shared/catalogue.js');
require('../../extension/src/shared/sites.js');
const S = globalThis.KoodeSites;
const manifest = JSON.parse(fs.readFileSync(new URL('../../extension/manifest.json', import.meta.url)));

test('catalogue integrity: https entry on a listed host, verification record, Malayalam names, unique ids', () => {
  const ids = new Set();
  for (const e of Cat.CATALOGUE) {
    assert.ok(!ids.has(e.id)); ids.add(e.id);
    const u = new URL(e.entry);
    assert.equal(u.protocol, 'https:', e.id);
    assert.ok(e.hosts.includes(u.hostname), e.id + ' entry host is listed');
    for (const h of e.hosts) {
      assert.match(h, /^[a-z0-9.-]+$/, 'plain lowercase host');
      assert.ok(!/^\d+\.\d+\.\d+\.\d+$/.test(h) && !h.startsWith('xn--') && !h.includes('xn--'), 'no IP or punycode');
      if (e.kind === 'government') assert.ok(/\.(gov|nic)\.in$/.test(h), h + ' is a gov.in/nic.in host');
    }
    assert.match(e.verified.on, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.verified.evidence.length >= 2, 'at least two pieces of evidence');
    assert.ok(e.verified.recheck_by > e.verified.on);
    assert.match(e.ml, /[ഀ-ൿ]/);
    assert.ok(e.services.length);
    for (const s of e.services) {
      assert.match(s.ml, /[ഀ-ൿ]/);
      if (e.guide !== false) {
        assert.ok(/"[^"]+"/.test(s.hint), 'hint names on-screen labels');
        assert.ok(!/https?:|www\./.test(s.hint), 'hints never contain URLs');
      }
      assert.ok(Cat.urlFor(e, s), s.id + ': its URL is https on the entry hosts');
      assert.ok(G.cleanQuery(s.video.ml).ok && G.cleanQuery(s.video.en).ok);
    }
  }
});

test('manifest: catalogue hosts are optional (asked per host), never granted at install or as content-script matches', () => {
  const optional = manifest.optional_host_permissions || [];
  const matches = manifest.content_scripts.flatMap((c) => c.matches);
  // Link-only entries (guide: false) are opened, not guided: they need no site access at all.
  for (const e of Cat.CATALOGUE.filter((x) => x.guide !== false)) for (const o of Cat.origins(e)) {
    assert.ok(optional.includes(o), o + ' is optional');
    assert.ok(!manifest.host_permissions.includes(o), o + ' not granted at install');
    assert.ok(!matches.includes(o), o + ' not a static content-script match (that would grant it at install)');
  }
  assert.ok(!optional.some((o) => /\*\.gov\.in|<all_urls>|\*:\/\/\*/.test(o)), 'no wildcard government or all-sites access');
});

test('Sarathi is the verified driving-licence destination; entry URL is exactly the one parivahan.gov.in links to', () => {
  const e = Cat.byId('sarathi');
  assert.equal(e.entry, 'https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do');
  assert.deepEqual(e.hosts, ['sarathi.parivahan.gov.in']);
  assert.ok(e.verified.evidence.some((x) => /parivahan\.gov\.in/.test(x)));
});

test('routing: ambiguous → options; explicit official → confirm; explicit video → tutorial; YouTube named → M1 search', () => {
  const c = (t, here = null) => S.classify(t, { siteId: here });
  let r = c('എനിക്ക് ഡ്രൈവിംഗ് ലൈസൻസ് വിവരങ്ങൾ അറിയണം');
  assert.deepEqual([r.type, r.entry.id, r.service.id, r.want], ['service', 'sarathi', 'dl_details', 'unspecified']);
  r = c('I want to check my driving licence details');
  assert.deepEqual([r.type, r.service.id, r.want], ['service', 'dl_details', 'unspecified']);
  r = c('ഡ്രൈവിംഗ് ലൈസൻസ് പുതുക്കാൻ ഔദ്യോഗിക വെബ്സൈറ്റ് തുറക്കൂ');
  assert.deepEqual([r.service.id, r.want], ['dl_renewal', 'official']);
  assert.equal(c('ലൈസൻസ് വിവരങ്ങൾ sarathi വെബ്സൈറ്റിൽ നോക്കണം').want, 'official');
  assert.equal(c('open the driving licence official website').want, 'official');
  // Explicit video: a search of the user's own topic (the catalogue query is used for the options card's tutorial).
  r = c('ഡ്രൈവിംഗ് ലൈസൻസ് പുതുക്കൽ വീഡിയോ');
  assert.deepEqual([r.type, r.search.query, r.serviceId], ['youtube_search', 'ഡ്രൈവിംഗ് ലൈസൻസ് പുതുക്കൽ', 'sarathi']);
  assert.equal(Cat.videoSearch(Cat.byId('sarathi'), Cat.serviceOf(Cat.byId('sarathi'), 'dl_renewal')).query, 'ഡ്രൈവിംഗ് ലൈസൻസ് പുതുക്കൽ ഓൺലൈൻ');
  assert.equal(c('ലേണേഴ്സ് ലൈസൻസിന് അപേക്ഷിക്കണം', 'youtube').service.id, 'learner_licence');
  assert.equal(c('യൂട്യൂബിൽ ഡ്രൈവിംഗ് ലൈസൻസ് പുതുക്കൽ വീഡിയോ', 'whatsapp').type, 'youtube_search');
  // On the official site already: guide here.
  r = c('DL details', 'sarathi');
  assert.deepEqual([r.type, r.serviceId], ['guide', 'sarathi']);
});

test('routing: unverified services and loose words never open a site by rule', () => {
  const c = (t) => S.classify(t, { siteId: null });
  assert.equal(c('എനിക്ക് റേഷൻ കാർഡ് അപേക്ഷിക്കണം').type, 'intent', '"apply" alone no longer opens the practice form');
  assert.equal(c('software license key').type, 'intent', 'licence without driving context is not Sarathi');
  assert.equal(c('അപേക്ഷാ ഫോം തുറക്കൂ').site.id, 'practiceform');
});

test('forUrl: only the exact https catalogue host is a guided service site', () => {
  assert.equal(S.forUrl('https://sarathi.parivahan.gov.in/sarathiservice/dlSearch.do').id, 'sarathi');
  for (const u of ['http://sarathi.parivahan.gov.in/', 'https://sarathi.parivahan.gov.in.evil.com/', 'https://evil-sarathi.parivahan.gov.in.co/', 'https://parivahan.gov.in/']) {
    assert.equal(S.forUrl(u), null, u);
  }
  const e = Cat.byId('sarathi');
  assert.ok(Cat.onHosts(e, 'https://sarathi.parivahan.gov.in/x'));
  assert.ok(!Cat.onHosts(e, 'https://not-official.example/'));
  assert.ok(!Cat.onHosts(e, 'http://sarathi.parivahan.gov.in/'));
});

test('answers to the options / confirmation cards', () => {
  for (const [t, a] of [['ഒന്ന്', 'official'], ['1', 'official'], ['വെബ്സൈറ്റ്', 'official'], ['ഔദ്യോഗിക സൈറ്റ്', 'official'], ['രണ്ട്', 'video'], ['വീഡിയോ', 'video'],
    ['ശരി', 'yes'], ['അതെ', 'yes'], ['ok', 'yes'], ['വേണ്ട', 'no'], ['cancel', 'no'], ['സോളാർ പാനൽ വീഡിയോകൾ കാണണം ഇപ്പോൾ', null]]) {
    assert.equal(Cat.answer(t), a, t);
  }
});

test('intent: only a catalogue id can be nominated; URLs/hosts as service_id are dropped', () => {
  let v = G.validateIntent({ type: 'service', service_id: 'sarathi', subservice_id: 'dl_renewal', wants: 'official' });
  assert.deepEqual([v.intent.service_id, v.intent.subservice_id, v.intent.wants], ['sarathi', 'dl_renewal', 'official']);
  v = G.validateIntent({ type: 'service', service_id: 'https://evil.gov.in/login', subservice_id: 'x', wants: 'go' });
  assert.deepEqual([v.intent.service_id, v.intent.subservice_id, v.intent.wants], ['', '', 'unspecified']);
  v = G.validateIntent({ type: 'service', service_id: 'sarathi', subservice_id: '../evil' });
  assert.equal(v.intent.subservice_id, '');
  v = G.validateIntent({ type: 'youtube_search', query_en: 'x y', service_id: 'sarathi' });
  assert.equal(v.intent.service_id, '', 'only service intents carry an id');
  const a = G.intentToAction({ type: 'service', service_id: 'sarathi', subservice_id: 'learner_licence', wants: 'unspecified' });
  assert.deepEqual([a.kind, a.entry.id, a.service.id, a.want], ['service', 'sarathi', 'learner_licence', 'unspecified']);
  const u = G.intentToAction({ type: 'service', service_id: '', query_ml: 'റേഷൻ കാർഡ്', query_en: 'ration card' });
  assert.deepEqual([u.kind, u.reason], ['say', 'service_not_verified']);
  assert.ok(u.offer && u.offer.query, 'a tutorial is offered, not started');
});

test('intent prompt lists catalogue ids (never URLs); mock nominates only on catalogue words', async () => {
  let seen = '';
  await planIntent({ goal: 'വണ്ടി ഓടിക്കാൻ ലൈസൻസ് വേണം' }, { provider: 'groq', model: 'x' }, { llm: async (_c, sys, user) => { seen = sys + user; return '{"type":"ask"}'; } });
  assert.match(seen, /VERIFIED_SERVICES/);
  assert.match(seen, /"id":"sarathi"/);
  assert.ok(!/https?:\/\//.test(seen.slice(seen.indexOf('VERIFIED_SERVICES'))), 'no URLs given to the model');
  const { result } = await planIntent({ goal: 'ഡ്രൈവിംഗ് ലൈസൻസ് പുതുക്കണം' }, { provider: 'mock', model: 'mock' });
  assert.deepEqual([result.type, result.service_id, result.subservice_id], ['service', 'sarathi', 'dl_renewal']);
  const r2 = await planIntent({ goal: 'റേഷൻ കാർഡ് അപേക്ഷ' }, { provider: 'mock', model: 'mock' });
  assert.deepEqual([r2.result.type, r2.result.service_id], ['service', '']);
});

test('planner request: TASK_HINT passes (redacted), labels/context lose personal numbers, 40 options kept', () => {
  const states = Array.from({ length: 37 }, (_, i) => 'State ' + i).concat('Kerala');
  const req = sanitizePlanRequest({
    goal: 'DL details', task_hint: Cat.taskHint(Cat.byId('sarathi'), Cat.byId('sarathi').services[0]) + ' 9847012345',
    snapshot: { candidates: [{ id: 's1_1', role: 'combobox', label: 'st Name', state: {}, options: states }, { id: 's1_2', role: 'link', label: 'Licence KL07 2019 0001234 of RAVI', state: {} }],
      context: [{ kind: 'status', text: 'Mobile 9847012345 verified' }] }
  });
  assert.match(req.task_hint, /Usual route/);
  assert.ok(!req.task_hint.includes('9847012345'));
  assert.equal(req.snapshot.candidates[0].options.length, 38);
  assert.ok(req.snapshot.candidates[0].options.includes('Kerala'));
  assert.equal(req.snapshot.candidates[1].label, 'Licence [DL_NUMBER] of RAVI');
  assert.equal(req.snapshot.context[0].text, 'Mobile [PHONE] verified');
  assert.match(buildUserMessage(req), /"TASK_HINT"/);
  assert.ok(!/"TASK_HINT"/.test(buildUserMessage(sanitizePlanRequest({ goal: 'x', snapshot: { candidates: [] } }))), 'no hint → payload unchanged');
});

test('mock planner follows the hint route: first step present on the page and not yet done', () => {
  const hint = Cat.taskHint(Cat.byId('sarathi'), Cat.byId('sarathi').services[0]);
  const base = { goal: 'x', task_hint: hint, history: [], snapshot: { path: '/x', context: [], candidates: [] } };
  const cand = (id, role, label, state = {}, options) => ({ id, role, label, state, options });
  let p = mockPlan({ ...base, snapshot: { ...base.snapshot, candidates: [cand('a', 'link', 'Login'), cand('b', 'combobox', 'st Name', { has_selection: false }, ['Kerala', 'Goa'])] } });
  assert.equal(p.target_id, 'b');
  p = mockPlan({ ...base, history: [{ outcome: 'verified', target_label: 'Skip' }], snapshot: { ...base.snapshot, candidates: [cand('a', 'button', 'Skip'), cand('c', 'link', 'Others')] } });
  assert.equal(p.target_id, 'c');
  p = mockPlan({ ...base, snapshot: { ...base.snapshot, candidates: [cand('m', 'textbox', 'Enter Mobile Number Here', { filled: true }), cand('k', 'textbox', 'Enter Captcha Here', { filled: false })] } });
  assert.equal(p.target_id, 'k');
});
