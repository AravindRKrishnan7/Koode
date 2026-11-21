// Push-to-talk recording and spoken replies. Audio goes to the Koode backend
// (via the service worker), which calls Sarvam; no API key in the extension.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page

  const MAX_RECORD_MS = 25000; // Sarvam REST accepts up to 30 s
  const MIN_RECORD_MS = 400;
  let rec = null, starting = null, chunks = [], stream = null, startedAt = 0, autoStop = null;
  let ctx = null, source = null, meterRaf = 0, peak = 0;

  const send = (msg) => chrome.runtime.sendMessage(msg);
  const panel = () => K.panel || {};
  const named = (name, message) => Object.assign(new Error(message), { name });

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // Web Audio is not subject to the page's media-src CSP (an <audio> data: URL is).
  function audioCtx() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Chrome only exposes the microphone to secure pages (https, localhost).
  function supported() {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'insecure';
    if (typeof MediaRecorder === 'undefined') return 'unsupported';
    return '';
  }

  // A release that arrives while the mic is still opening waits for it (see stop()).
  function start() {
    audioCtx(); // unlock playback during the user's press
    if (!rec && !starting) starting = open().finally(() => { starting = null; });
    return starting || Promise.resolve();
  }

  async function open() {
    const why = supported();
    if (why === 'insecure') throw named('InsecureContextError', 'microphone needs a secure (https) page');
    if (why) throw named('NotSupportedError', 'recording not supported in this browser');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start(250);
    startedAt = performance.now();
    autoStop = setTimeout(() => panel().releaseMic && panel().releaseMic(), MAX_RECORD_MS);
    meter(stream);
  }

  // Live input level, so the user can see the microphone is hearing them.
  function meter(s) {
    peak = 0;
    try {
      const c = audioCtx();
      const src = c.createMediaStreamSource(s);
      const an = c.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) * (v - 128);
        const level = Math.min(1, Math.sqrt(sum / buf.length) / 40);
        peak = Math.max(peak, level);
        if (panel().setLevel) panel().setLevel(level);
        meterRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (_) { /* meter is cosmetic */ }
  }

  function stopMeter() {
    cancelAnimationFrame(meterRaf);
    meterRaf = 0;
    if (panel().setLevel) panel().setLevel(0);
  }

  // Stops recording; resolves to { audio, mime, ms, peak } or null if too short.
  async function stop() {
    if (starting) await starting.catch(() => {});
    clearTimeout(autoStop);
    stopMeter();
    const r = rec;
    rec = null;
    if (!r) return null;
    return new Promise((resolve) => {
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const ms = Math.round(performance.now() - startedAt);
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        if (ms < MIN_RECORD_MS || !blob.size) return resolve(null);
        resolve({ audio: await blobToBase64(blob), mime: blob.type.split(';')[0], ms, peak: +peak.toFixed(2) });
      };
      r.stop();
    });
  }

  function cancel() { stop().catch(() => {}); }

  async function transcribe(clip) {
    return send({ type: 'koode:stt', payload: { audio: clip.audio, mime: clip.mime } });
  }

  // Speak text; a newer call interrupts an older one. Resolves once audio starts, with timing info.
  async function speak(text, lang = 'ml-IN') {
    if (!text) return null;
    const t0 = performance.now();
    const resp = await send({ type: 'koode:tts', payload: { text, lang } });
    if (!resp || resp.error) throw Object.assign(new Error(resp && resp.error || 'no response'), { code: resp && resp.code });
    const c = audioCtx();
    if (c.state !== 'running') await c.resume().catch(() => {});
    if (c.state !== 'running') throw Object.assign(new Error('audio blocked until you click on the page'), { code: 'autoplay' });
    const bytes = Uint8Array.from(atob(resp.audio), (ch) => ch.charCodeAt(0));
    const buf = await c.decodeAudioData(bytes.buffer);
    hush();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    source = src;
    src.onended = () => { if (source === src) { source = null; if (panel().setSpeaking) panel().setSpeaking(false); } };
    src.start();
    if (panel().setSpeaking) panel().setSpeaking(true);
    return { ms: Math.round(performance.now() - t0), backend_ms: resp.latency_ms, audio_ms: Math.round(buf.duration * 1000) };
  }

  function hush() {
    const s = source;
    source = null;
    if (s) { try { s.stop(); } catch (_) {} }
    if (panel().setSpeaking) panel().setSpeaking(false);
  }

  K.voice = { start, stop, cancel, transcribe, speak, hush, supported, isRecording: () => !!(rec || starting), isSpeaking: () => !!source };
})();
