// Entry point: mounts the panel and resumes any in-progress task for this tab.
(() => {
  const K = globalThis.Koode;
  if (!K || K.started) return;
  K.started = true;
  K.panel.init({ onGoal: (g) => K.controller.start(g), onStop: () => K.controller.stop(), onRepeat: () => K.controller.repeat(),
    onMicDown: () => K.controller.micDown(), onMicUp: () => K.controller.micUp(),
    onConfirm: (g) => K.controller.confirmVoice(g), onRetryVoice: () => K.controller.retryVoice() });

  // Dim the mic up front when voice can't work here; pressing it then explains why.
  (async () => {
    const why = K.voice.supported();
    if (why) return K.panel.setVoiceAvailable(false, why === 'insecure' ? 'needs a secure (https) page' : 'recording not supported');
    let h = null;
    try { h = await chrome.runtime.sendMessage({ type: 'koode:health' }); } catch (_) {}
    if (h && h.ok && !h.voice) K.panel.setVoiceAvailable(false, 'not configured on the server');
  })();

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (!msg) return;
    if (msg.type === 'koode:open') K.panel.open();
    if (msg.type === 'koode:start') { K.panel.open(); K.controller.start(msg.goal, { voice: msg.voice }); reply({ ok: true }); }
    if (msg.type === 'koode:stop') K.controller.stop();
  });

  (async () => {
    let task = null;
    try { task = (await chrome.runtime.sendMessage({ type: 'koode:loadTask' })) || null; } catch (_) {}
    if (task && task.goal) K.controller.resume(task);
  })();
})();
