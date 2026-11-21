// MOCK SPEECH — NOT SARVAM. Offline stand-in for /api/stt and /api/tts used only by tests and
// rehearsals with KOODE_SPEECH=mock. No network calls. Responses carry model "mock-stt"/"mock-tts"
// and /health reports speech:"mock" so every UI can label it.
//
// Speech-to-text cannot understand the audio: it returns the next transcript queued by the local test
// runner (POST /test/stt-queue), or KOODE_MOCK_TRANSCRIPT, after checking that audio was recorded.
const queue = [];

export function queueTranscripts(list) {
  for (const t of Array.isArray(list) ? list : []) if (typeof t === 'string') queue.push(t.slice(0, 300));
  return queue.length;
}

export async function mockTranscribe(cfg, { audio }) {
  const bytes = Buffer.from(String(audio || ''), 'base64');
  if (!bytes.length) throw Object.assign(new Error('empty audio'), { code: 'bad_audio' });
  const started = Date.now();
  const transcript = queue.length ? queue.shift() : (process.env.KOODE_MOCK_TRANSCRIPT || '');
  return { transcript, language_code: 'ml-IN', model: 'mock-stt', mock: true, audio_bytes: bytes.length, latency_ms: Date.now() - started };
}

// A short, quiet two-tone chime (PCM16 mono WAV) so the playback path is exercised without a real voice.
export async function mockSpeak(cfg, { text }) {
  const clean = String(text || '').trim();
  if (!clean) throw Object.assign(new Error('empty text'), { code: 'bad_audio' });
  const rate = 16000, secs = Math.min(1.2, 0.25 + clean.length / 400), n = Math.round(rate * secs);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const f = i < n / 2 ? 523 : 659;
    const env = Math.min(1, i / 400, (n - i) / 400);
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * f * i) / rate) * 2500 * env), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return { audio: Buffer.concat([head, data]).toString('base64'), mime: 'audio/wav', model: 'mock-tts', mock: true, latency_ms: 0 };
}
