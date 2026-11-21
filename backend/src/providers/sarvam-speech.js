// Sarvam speech: Saaras v4 speech-to-text and Bulbul text-to-speech (REST).
// Runs on the backend only, so SARVAM_API_KEY never reaches the extension.
const BASE = 'https://api.sarvam.ai';

async function call(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`Sarvam HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

export async function transcribe(cfg, { audio, mime }) {
  if (!cfg.keys.sarvam) throw new Error('voice unavailable: SARVAM_API_KEY not set');
  const bytes = Buffer.from(String(audio || ''), 'base64');
  if (!bytes.length) throw new Error('empty audio');
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
  if (!cfg.keys.sarvam) throw new Error('voice unavailable: SARVAM_API_KEY not set');
  const clean = String(text || '').trim().slice(0, 500);
  if (!clean) throw new Error('empty text');
  const body = { text: clean, language_code: /^[a-z]{2}-IN$/.test(lang || '') ? lang : 'ml-IN', model: cfg.ttsModel, speech_sample_rate: 22050 };
  if (cfg.ttsSpeaker) body.speaker = cfg.ttsSpeaker;
  const started = Date.now();
  const d = await call(BASE + '/text-to-speech', { method: 'POST', headers: { 'api-subscription-key': cfg.keys.sarvam, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, cfg.speechTimeoutMs);
  if (!d.audios || !d.audios[0]) throw new Error('Sarvam TTS returned no audio');
  return { audio: d.audios[0], mime: 'audio/wav', model: cfg.ttsModel, latency_ms: Date.now() - started };
}
