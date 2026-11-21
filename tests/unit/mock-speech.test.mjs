// Labelled offline speech stand-in: never calls Sarvam, refused in judging mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockTranscribe, mockSpeak, queueTranscripts } from '../../backend/src/providers/mock-speech.js';

test('mock STT returns queued transcripts in order and needs recorded audio', async () => {
  globalThis.fetch = () => { throw new Error('network must not be used'); };
  queueTranscripts(['വാട്സ്ആപ്പ് തുറക്കൂ', 'exit']);
  const a = await mockTranscribe({}, { audio: Buffer.from('abc').toString('base64') });
  const b = await mockTranscribe({}, { audio: Buffer.from('abc').toString('base64') });
  assert.equal(a.transcript, 'വാട്സ്ആപ്പ് തുറക്കൂ'); assert.equal(b.transcript, 'exit');
  assert.equal(a.model, 'mock-stt'); assert.equal(a.mock, true);
  await assert.rejects(mockTranscribe({}, { audio: '' }), (e) => e.code === 'bad_audio');
});

test('mock TTS returns a valid PCM WAV labelled mock', async () => {
  const r = await mockSpeak({}, { text: 'നന്ദി' });
  const wav = Buffer.from(r.audio, 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.ok(wav.length > 1000); assert.equal(r.model, 'mock-tts');
});

test('KOODE_SPEECH=mock is refused together with KOODE_REQUIRE_LLM=1 (judging mode)', async () => {
  const old = { ...process.env };
  Object.assign(process.env, { KOODE_SPEECH: 'mock', KOODE_REQUIRE_LLM: '1', GROQ_API_KEY: 'test-not-a-key' });
  const { loadConfig } = await import('../../backend/src/config.js?judging');
  assert.throws(() => loadConfig(), /not allowed/);
  process.env.KOODE_REQUIRE_LLM = '0';
  assert.equal(loadConfig().speech, 'mock');
  for (const k of ['KOODE_SPEECH', 'KOODE_REQUIRE_LLM', 'GROQ_API_KEY']) { if (k in old) process.env[k] = old[k]; else delete process.env[k]; }
});
