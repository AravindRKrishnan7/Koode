// Entry point: mounts the panel and resumes any in-progress task for this tab.
(() => {
  const K = globalThis.Koode;
  if (!K || K.started) return;
  K.started = true;
  K.panel.init({ onGoal: (g) => K.controller.start(g), onStop: () => K.controller.stop(), onRepeat: () => K.controller.repeat() });

  chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === 'koode:open') K.panel.open(); });

  (async () => {
    let task = null;
    try { task = (await chrome.runtime.sendMessage({ type: 'koode:loadTask' })) || null; } catch (_) {}
    if (task && task.goal) K.controller.resume(task);
  })();
})();
