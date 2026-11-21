// MOCK INTENT — NOT AI. Deterministic keyword stand-in for /api/intent, used only with the mock provider
// (tests, rehearsals). Responses carry planner.mock = true. A tiny glossary supplies English fallback
// queries for the test fixtures; it is not a translator.
//
// Tests can also queue raw "model output" strings (POST /test/intent-queue, local clients only) to check
// that malicious or malformed model answers are rejected by the same validation a real model gets.
import { safety, Catalogue } from '../goals.js';

const queue = [];

export function queueIntents(list) {
  for (const t of Array.isArray(list) ? list : []) if (typeof t === 'string') queue.push(t.slice(0, 2000));
  return queue.length;
}
export function nextQueuedIntent() {
  return queue.length ? queue.shift() : undefined;
}

const ML = 'ഀ-ൿ';
const SERVICE = /licen[cs]e|ലൈസൻസ്|aadha?ar|ആധാർ|ration|റേഷൻ|passport|പാസ്പോർട്ട്|certificate|സർട്ടിഫിക്കറ്റ്|pension|പെൻഷൻ|voter|വോട്ടർ|pan card|പാൻ കാർഡ്|land tax|ഭൂനികുതി|കരം|electricity bill|കറന്റ് ബിൽ|വൈദ്യുതി ബിൽ|വില്ലേജ്|psc|പി\s?എസ്\s?സി|registration|രജിസ്ട്രേഷൻ|\brc\b|ആർസി|vahan|വാഹൻ|government|ഗവൺമെന്റ്|സർക്കാർ/i;
const LEARN = /പഠിക്ക|പഠിപ്പ|learn|how to|എങ്ങനെ|tutorial|ട്യൂട്ടോറിയൽ|ക്ലാസ്|class|വീഡിയോ|video|ഉണ്ടാക്ക|recipe|റെസിപ്പി|കാണണം|കേൾക്കണം|പാട്ട്|song/i;
const ON_PAGE = new RegExp('(?<![a-z])(this|here)(?![a-z])|(?<![' + ML + '])(ഈ|ഇവിടെ|ഇത്)(?![' + ML + '])', 'i');
// Words that carry no topic.
const DROP = new RegExp('^(?:എനിക്ക്|ഞാൻ|എന്റെ|എങ്ങനെ|ആണ്|ഒന്ന്|കുറച്ച്|വേണം|ഉള്ള|കുറിച്ച്|കുറിച്ചുള്ള|പറ്റി|വിവരങ്ങൾ|' +
  '(?:പഠിക്ക|പഠിപ്പ|കാണ|കേൾക്ക|അറിയ|ചെയ്യ|തിരയ|തിരഞ്ഞ|ഉണ്ടാക്ക|വീഡിയോ|ട്യൂട്ടോറിയൽ)[' + ML + ']*|' +
  'i|me|my|want|to|learn|how|videos?|tutorials?|show|watch|please|about|the|a|an|\\[[A-Z_]+\\])$', 'i');
const GLOSSARY = {
  'സോളാർ': 'solar', 'പാനൽ': 'panel', 'ഇൻസ്റ്റലേഷൻ': 'installation', 'തെങ്ങ്': 'coconut tree', 'തെങ്ങിൽ': 'coconut tree',
  'കയറാൻ': 'climbing', 'കയറ്റം': 'climbing', 'മീൻ': 'fish', 'കറി': 'curry', 'ബിരിയാണി': 'biryani', 'കൃഷി': 'farming',
  'ഡ്രൈവിംഗ്': 'driving', 'ലൈസൻസ്': 'licence', 'പുതുക്കാൻ': 'renewal', 'റേഷൻ': 'ration', 'കാർഡ്': 'card', 'ആധാർ': 'aadhaar',
  'പാട്ട്': 'songs', 'ഇംഗ്ലീഷ്': 'english', 'മൊബൈൽ': 'mobile', 'ബാങ്കിംഗ്': 'banking'
};

export function mockIntent(req) {
  const t = req.goal.toLowerCase();
  if (safety(t) !== 'ok') return { type: 'unsupported' };
  const words = t.replace(/[.,!?]/g, ' ').split(/\s+/).filter((w) => w && !DROP.test(w));
  const query_ml = words.join(' ');
  const query_en = words.map((w) => GLOSSARY[w] || (/^[a-z0-9]+$/.test(w) ? w : '')).filter(Boolean).join(' ');
  if (SERVICE.test(t)) {
    // Nominates a catalogue id only when the catalogue's own words match (a model gets the same list).
    const m = Catalogue.match(t);
    return { type: 'service', service_id: m ? m.entry.id : '', subservice_id: m && m.service ? m.service.id : '', wants: Catalogue.wants(t), query_ml, query_en, content_lang: 'ml' };
  }
  if (ON_PAGE.test(t) && req.site_id) return { type: 'on_page' };
  if (LEARN.test(t) && query_ml) return { type: 'youtube_search', query_ml, query_en, content_lang: 'ml' };
  return { type: 'ask', question_ml: 'എന്താണ് ചെയ്യേണ്ടതെന്ന് കുറച്ചുകൂടി പറയാമോ? (mock)' };
}
