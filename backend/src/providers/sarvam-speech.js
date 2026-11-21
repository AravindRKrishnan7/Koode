// Sarvam speech: Saaras v4 speech-to-text and Bulbul text-to-speech (REST).
// Runs on the backend only, so SARVAM_API_KEY never reaches the extension.
const BASE = 'https://api.sarvam.ai';

// Errors carry a `code` so the extension can show the right fallback:
// not_configured | timeout | auth | rate_limited | bad_audio | upstream.
const fail = (code, message) => Object.assign(new Error(message), { code });

function codeFor(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'bad_audio';
  return 'upstream';
}

async function call(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw fail(codeFor(res.status), `Sarvam HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } catch (e) {
    if (e.name === 'AbortError') throw fail('timeout', `Sarvam did not answer within ${timeoutMs} ms`);
    if (!e.code) e.code = 'upstream';
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function transcribe(cfg, { audio, mime }) {
  if (!cfg.keys.sarvam) throw fail('not_configured', 'voice unavailable: SARVAM_API_KEY not set');
  const bytes = Buffer.from(String(audio || ''), 'base64');
  if (!bytes.length) throw fail('bad_audio', 'empty audio');
  const type = /^audio\/[\w.+-]+/.exec(mime || '')?.[0] || 'audio/webm';
  const form = new FormData();
  form.append('model', cfg.sttModel);
  form.append('mode', 'transcribe');
  form.append('language_code', cfg.sttLanguage);
  form.append('file', new Blob([bytes], { type }), 'speech.' + (type.split('/')[1] || 'webm'));
  const started = Date.now();
  const d = await call(BASE + '/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': cfg.keys.sarvam }, body: form }, cfg.speechTimeoutMs);
  return { transcript: (d.transcript || '').trim(), language_code: d.language_code || null, model: cfg.sttModel, latency_ms: Date.now() - started };
}

export async function speak(cfg, { text, lang }) {
  if (!cfg.keys.sarvam) throw fail('not_configured', 'voice unavailable: SARVAM_API_KEY not set');
  const clean = String(text || '').trim().slice(0, 500);
  if (!clean) throw fail('bad_audio', 'empty text');
  const body = { text: clean, language_code: /^[a-z]{2}-IN$/.test(lang || '') ? lang : 'ml-IN', model: cfg.ttsModel, speech_sample_rate: 22050 };
  if (cfg.ttsSpeaker) body.speaker = cfg.ttsSpeaker;
  const started = Date.now();
  const d = await call(BASE + '/text-to-speech', { method: 'POST', headers: { 'api-subscription-key': cfg.keys.sarvam, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, cfg.speechTimeoutMs);
  if (!d.audios || !d.audios[0]) throw new Error('Sarvam TTS returned no audio');
  return { audio: d.audios[0], mime: 'audio/wav', model: cfg.ttsModel, latency_ms: Date.now() - started };
}
