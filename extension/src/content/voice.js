// Push-to-talk recording and spoken replies. Audio goes to the Koode backend
// (via the service worker), which calls Sarvam; no API key in the extension.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page

  const MAX_RECORD_MS = 25000; // Sarvam REST accepts up to 30 s
  const MIN_RECORD_MS = 400;
  let rec = null, starting = null, chunks = [], stream = null, startedAt = 0, autoStop = null, player = null;

  const send = (msg) => chrome.runtime.sendMessage(msg);

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // A release that arrives while the mic is still opening waits for it (see stop()).
  function start() {
    if (!rec && !starting) starting = open().finally(() => { starting = null; });
    return starting || Promise.resolve();
  }

  async function open() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start(250);
    startedAt = performance.now();
    autoStop = setTimeout(() => K.panel && K.panel.releaseMic(), MAX_RECORD_MS);
  }

  // Stops recording; resolves to { audio, mime, ms } or null if too short.
  async function stop() {
    if (starting) await starting.catch(() => {});
    clearTimeout(autoStop);
    const r = rec;
    rec = null;
    if (!r) return Promise.resolve(null);
    return new Promise((resolve) => {
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const ms = Math.round(performance.now() - startedAt);
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        if (ms < MIN_RECORD_MS || !blob.size) return resolve(null);
        resolve({ audio: await blobToBase64(blob), mime: blob.type.split(';')[0], ms });
      };
      r.stop();
    });
  }

  function cancel() { stop().catch(() => {}); }

  async function transcribe(clip) {
    return send({ type: 'koode:stt', payload: { audio: clip.audio, mime: clip.mime } });
  }

  // Speak Malayalam text; a newer call interrupts an older one. Resolves to timing info.
  async function speak(text, lang = 'ml-IN') {
    if (!text) return null;
    const t0 = performance.now();
    const resp = await send({ type: 'koode:tts', payload: { text, lang } });
    if (!resp || resp.error) throw new Error(resp && resp.error || 'no response');
    if (player) player.pause();
    player = new Audio(`data:${resp.mime};base64,${resp.audio}`);
    const me = player;
    await new Promise((resolve, reject) => {
      me.onplaying = resolve;
      me.onerror = () => reject(new Error('audio playback failed'));
      me.play().catch(reject);
    });
    return { ms: Math.round(performance.now() - t0), backend_ms: resp.latency_ms };
  }

  function hush() { if (player) player.pause(); }

  K.voice = { start, stop, cancel, transcribe, speak, hush, isRecording: () => !!(rec || starting) };
})();
