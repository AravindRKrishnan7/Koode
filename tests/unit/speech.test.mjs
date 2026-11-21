import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe, speak } from '../../backend/src/providers/sarvam-speech.js';

const cfg = { keys: { sarvam: 'test-key' }, sttModel: 'saaras:v4', sttLanguage: 'ml-IN', ttsModel: 'bulbul:v3', ttsSpeaker: '', speechTimeoutMs: 5000 };

function stubFetch(reply, seen) {
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify(reply.body), { status: reply.status || 200 }); };
}

test('transcribe sends Saaras v4 multipart with the key in a header only', async () => {
  const seen = [];
  stubFetch({ body: { transcript: ' ഡാർക്ക് മോഡ് ', language_code: 'ml-IN' } }, seen);
  const out = await transcribe(cfg, { audio: Buffer.from('abc').toString('base64'), mime: 'audio/webm;codecs=opus' });
  assert.equal(out.transcript, 'ഡാർക്ക് മോഡ്');
  assert.equal(seen[0].url, 'https://api.sarvam.ai/speech-to-text');
  assert.equal(seen[0].init.headers['api-subscription-key'], 'test-key');
  const form = seen[0].init.body;
  assert.equal(form.get('model'), 'saaras:v4');
  assert.equal(form.get('mode'), 'transcribe');
  assert.equal(form.get('language_code'), 'ml-IN');
  assert.equal(form.get('file').type, 'audio/webm');
});

test('speak returns base64 WAV; errors and missing key are reported without the key', async () => {
  const seen = [];
  stubFetch({ body: { audios: ['UklGRg=='] } }, seen);
  const out = await speak(cfg, { text: 'ശരി', lang: 'ml-IN' });
  assert.equal(out.audio, 'UklGRg==');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, 'bulbul:v3');
  assert.equal(body.language_code, 'ml-IN');

  stubFetch({ status: 403, body: { error: { message: 'invalid key' } } }, []);
  await assert.rejects(speak(cfg, { text: 'x' }), (e) => /Sarvam HTTP 403/.test(e.message) && !e.message.includes('test-key'));
  await assert.rejects(transcribe({ ...cfg, keys: {} }, { audio: 'YQ==' }), /SARVAM_API_KEY not set/);
  await assert.rejects(transcribe(cfg, { audio: '' }), /empty audio/);
});
