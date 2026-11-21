// Goal helpers shared by the extension and the backend: redaction, query safety, language, intent schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const G = createRequire(import.meta.url)('../../extension/src/shared/goals.js');

test('redaction: Aadhaar, phone, driving licence, PAN, vehicle, card, email, OTP', () => {
  const cases = [
    ['എന്റെ ഡ്രൈവിംഗ് ലൈസൻസ് KL07 2019 0001234 വിവരങ്ങൾ അറിയണം', 'DL_NUMBER', 'KL07'],
    ['licence kl-07/1234/2010 renew', 'DL_NUMBER', '1234'],
    ['ആധാർ 2345 6789 0123 ലിങ്ക് ചെയ്യണം', 'AADHAAR', '6789'],
    ['ആധാർ 234567890123', 'AADHAAR', '234567890123'],
    ['call +91 98470 12345 please', 'PHONE', '98470'],
    ['എന്റെ നമ്പർ 9847012345 ആണ്', 'PHONE', '9847012345'],
    ['ഫോൺ ൯൮൪൭൦൧൨൩൪൫', 'PHONE', '9847'],          // Malayalam digits
    ['pan abcpe1234f status', 'PAN', 'abcpe'],
    ['PAN ABCPE 1234 F', 'PAN', 'ABCPE'],
    ['vehicle KL 07 AB 1234 tax', 'VEHICLE_NUMBER', 'AB 1234'],
    ['card 4111 1111 1111 1111', 'CARD_NUMBER', '4111'],
    ['mail ravi.k@example.co.in', 'EMAIL', 'ravi.k'],
    ['OTP 482913 വന്നു', 'SECRET', '482913'],
    ['account no 0012 3456 789', 'NUMBER', '3456']
  ];
  for (const [text, type, leak] of cases) {
    const r = G.redact(text);
    assert.ok(r.found.includes(type), `${text} → ${JSON.stringify(r)}`);
    assert.ok(!r.text.includes(leak), `${text} leaked ${leak}: ${r.text}`);
    assert.ok(r.text.includes('[' + type + ']'), r.text);
  }
});

test('redaction keeps ordinary numbers and topics', () => {
  for (const t of ['top 10 songs 2024', 'reset gmail password video', 'pinterest tutorial', '1080p video', 'music 2024 a r rahman', 'സോളാർ പാനൽ 5 kW']) {
    assert.deepEqual(G.redact(t).found, [], t);
  }
});

test('redaction notice names what was removed, in Malayalam and English', () => {
  const n = G.redactionNotice(['DL_NUMBER', 'PHONE']);
  assert.match(n.ml, /ലൈസൻസ് നമ്പർ/); assert.match(n.en, /licence number, phone number/);
  assert.equal(G.redactionNotice([]), null);
});

test('cleanQuery: no URLs, domains, operators, placeholders or personal data; ≤ 80 chars', () => {
  assert.equal(G.cleanQuery('https://evil.com').ok, false);
  assert.equal(G.cleanQuery('www.evil.com').ok, false);
  assert.equal(G.cleanQuery('site:evil.com evil.com hack').query, 'hack');
  assert.equal(G.cleanQuery('solar panel -cheap OR "price" intitle:best').query, 'solar panel price');
  assert.equal(G.cleanQuery('[PHONE] cooking [AADHAAR]').query, 'cooking');
  assert.equal(G.cleanQuery('cooking 9847012345').query, 'cooking');
  assert.equal(G.cleanQuery('cooking @chef #recipe').query, 'cooking');
  assert.equal(G.cleanQuery('node.js tutorial').query, 'node js tutorial');
  assert.equal(G.cleanQuery('സോളാർ പാനൽ ഇൻസ്റ്റലേഷൻ').query, 'സോളാർ പാനൽ ഇൻസ്റ്റലേഷൻ');
  assert.equal(G.cleanQuery('കാര്‍ റിപ്പയര്‍').query, 'കാര്‍ റിപ്പയര്‍', 'ZWJ/ZWNJ in Malayalam are kept');
  assert.equal(G.cleanQuery('cooking‮evil​').query, 'cooking evil', 'bidi/zero-width controls removed');
  assert.equal(G.cleanQuery('кукинг').ok, false, 'other scripts (lookalikes) are dropped');
  const long = G.cleanQuery('word '.repeat(30));
  assert.ok(long.ok && long.query.length <= 80 && !/\s$/.test(long.query));
  assert.equal(G.cleanQuery('').ok, false);
  assert.equal(G.cleanQuery(42).ok, false);
});

test('cleanQuery refuses explicit, weapon-making and drug-buying searches', () => {
  for (const q of ['porn videos', 'how to make a bomb', 'സെക്സ് വീഡിയോ', 'buy ganja', 'sex chat', 'naked photos', 'ganja', 'sexy', 'rape', 'കഞ്ചാവ് വാങ്ങാൻ', 'നഗ്ന ചിത്രങ്ങൾ']) {
    assert.equal(G.cleanQuery(q).reason, 'unsafe', q);
  }
});

test('legitimate educational searches on sensitive topics are allowed', () => {
  for (const q of ['sex education for teenagers', 'suicide prevention helpline', 'rape law in india', 'ganja addiction recovery', 'drugs for diabetes',
    'atom bomb history', 'bomb disposal squad', 'sex ratio kerala', 'sexual harassment at workplace law', 'puberty health class',
    'ലൈംഗിക വിദ്യാഭ്യാസം', 'ലഹരി വിമുക്തി ബോധവൽക്കരണം', 'ആത്മഹത്യ പ്രതിരോധം', 'പോക്സോ നിയമം', 'കഞ്ചാവ് ദോഷഫലങ്ങൾ', 'Sussex university', 'essex cricket']) {
    assert.ok(G.cleanQuery(q).ok, q + ' → ' + JSON.stringify(G.cleanQuery(q)));
  }
});

test('self-harm requests are never searched; they get a helpline answer', () => {
  for (const q of ['how to commit suicide', 'i want to die', 'kill myself', 'ആത്മഹത്യ ചെയ്യാൻ എളുപ്പ വഴി', 'എനിക്ക് മരിക്കണം']) {
    assert.equal(G.safety(q), 'self_harm', q);
    assert.equal(G.cleanQuery(q).reason, 'self_harm', q);
  }
  assert.equal(G.safety('suicide prevention'), 'ok');
  const v = G.validateIntent({ type: 'youtube_search', query_en: 'painless death methods' });
  assert.deepEqual([v.intent.type, v.intent.reason], ['unsupported', 'self_harm']);
  const a = G.intentToAction(v.intent);
  assert.equal(a.reason, 'self_harm');
  assert.match(a.ml, /14416/); assert.match(a.en, /14416/); assert.match(a.en, /112/);
});

test('youtubeResultsUrl: the only URL a search can produce', () => {
  assert.equal(G.youtubeResultsUrl('solar panel installation'), 'https://www.youtube.com/results?search_query=solar+panel+installation');
  const ml = G.youtubeResultsUrl('സോളാർ പാനൽ');
  assert.ok(ml.startsWith('https://www.youtube.com/results?search_query=%E0%B4'));
  assert.equal(new URL(ml).searchParams.get('search_query'), 'സോളാർ പാനൽ');
  assert.equal(G.youtubeResultsUrl('https://evil.com'), null);
  // Parameter injection is impossible: everything is one percent-encoded search_query value.
  const inj = new URL(G.youtubeResultsUrl('&search_query=x&redirect=evil'));
  assert.deepEqual([...inj.searchParams.keys()], ['search_query']);
  assert.equal(inj.pathname, '/results');
  for (const q of ['javascript:alert(1)', '../../evil', 'evil.com/login']) {
    const u = G.youtubeResultsUrl(q);
    assert.ok(u === null || new URL(u).origin === 'https://www.youtube.com', q);
  }
});

test('planSearch: Malayalam first, English fallback keeps the content language', () => {
  assert.deepEqual(G.planSearch({ query_ml: 'തെങ്ങ് കയറ്റം', query_en: 'coconut tree climbing' }),
    { query: 'തെങ്ങ് കയറ്റം', fallback: 'coconut tree climbing malayalam', lang: 'ml' });
  assert.deepEqual(G.planSearch({ query_en: 'solar panel installation' }), { query: 'solar panel installation malayalam', fallback: null, lang: 'ml' });
  assert.deepEqual(G.planSearch({ query_ml: 'സോളാർ', query_en: 'solar malayalam' }), { query: 'സോളാർ', fallback: 'solar malayalam', lang: 'ml' });
  assert.deepEqual(G.planSearch({ query_ml: 'പാചകം', query_en: 'cooking', content_lang: 'en' }), { query: 'cooking', fallback: null, lang: 'en' });
  assert.deepEqual(G.planSearch({ query_en: 'cooking', content_lang: 'hi' }), { query: 'cooking hindi', fallback: null, lang: 'hi' });
  assert.equal(G.planSearch({ query_ml: 'https://evil.com' }), null);
});

test('detectLang: only an explicit "in English" / "ഇംഗ്ലീഷിൽ" changes the content language', () => {
  assert.equal(G.detectLang('cooking videos in english').lang, 'en');
  assert.equal(G.detectLang('പാചകം ഇംഗ്ലീഷിൽ').lang, 'en');
  assert.equal(G.detectLang('ഹിന്ദിയിൽ പാട്ട്').lang, 'hi');
  assert.equal(G.detectLang('ഇംഗ്ലീഷ് പഠിക്കണം').lang, 'ml', 'learning English is a topic');
  assert.equal(G.detectLang('learn english grammar').lang, 'ml');
});

test('validateIntent: strict schema; URLs, sites and unknown types from the model are rejected', () => {
  assert.equal(G.validateIntent({ type: 'navigate', url: 'https://evil.com' }).reason, 'bad_type');
  assert.equal(G.validateIntent(null).reason, 'not_an_object');
  assert.equal(G.validateIntent([]).reason, 'not_an_object');
  // A search whose only "queries" are URLs/operators has nothing left.
  assert.equal(G.validateIntent({ type: 'youtube_search', query_ml: 'https://evil.com', query_en: 'site:evil.com' }).reason, 'no_valid_query');
  // Extra fields (url, service_id, candidate_host) never survive.
  const v = G.validateIntent({ type: 'service', url: 'https://evil.gov.in', candidate_host: 'evil.gov.in', query_ml: 'ലൈസൻസ് [DL_NUMBER]', query_en: 'licence renewal', content_lang: 'xx' });
  assert.ok(v.ok);
  assert.deepEqual(Object.keys(v.intent).sort(), ['content_lang', 'query_en', 'query_ml', 'question_ml', 'type']);
  assert.deepEqual([v.intent.query_ml, v.intent.content_lang], ['ലൈസൻസ്', 'ml']);
  // Unsafe queries turn the whole intent into "unsupported".
  assert.equal(G.validateIntent({ type: 'youtube_search', query_en: 'porn' }).intent.type, 'unsupported');
  // A question cannot carry a link or personal data.
  const a = G.validateIntent({ type: 'ask', question_ml: 'evil.com തുറക്കട്ടെ? 9847012345' });
  assert.ok(!/evil\.com|9847/.test(a.intent.question_ml), a.intent.question_ml);
});

test('intentToAction: search runs; government services are not opened in M1 (video offer only)', () => {
  const s = G.intentToAction({ type: 'youtube_search', query_ml: 'തെങ്ങ് കയറ്റം', query_en: 'coconut tree climbing', content_lang: 'ml' });
  assert.deepEqual([s.kind, s.search.query, s.search.fallback], ['youtube_search', 'തെങ്ങ് കയറ്റം', 'coconut tree climbing malayalam']);
  const svc = G.intentToAction({ type: 'service', query_ml: 'ഡ്രൈവിംഗ് ലൈസൻസ്', query_en: 'driving licence', content_lang: 'ml' });
  assert.equal(svc.kind, 'say');
  assert.equal(svc.reason, 'service_not_verified');
  assert.equal(svc.offer.query, 'ഡ്രൈവിംഗ് ലൈസൻസ്');
  assert.ok(!('url' in svc) && !('site' in svc));
  assert.equal(G.intentToAction({ type: 'on_page' }, { guidable: true }).kind, 'guide');
  assert.equal(G.intentToAction({ type: 'on_page' }, { guidable: false }).kind, 'say');
  assert.equal(G.intentToAction({ type: 'unsupported' }).kind, 'say');
  assert.equal(G.intentToAction({ error: 'x', code: 'offline' }).reason, 'offline');
  assert.equal(G.intentToAction({ error: 'x', code: 'rate_limited' }).reason, 'rate_limited');
});
