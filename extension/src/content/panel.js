// Floating assistant UI (closed shadow DOM so page CSS can't break it).
// Exposes state on host data-attributes for automated tests.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page

  let host, root, els = {}, handlers = {};

  const STATE_LABEL = {
    idle: 'Ready', listening: 'Listening…', transcribing: 'Understanding…', finding: 'Finding…', waiting: 'Your turn', verifying: 'Checking…',
    verified: 'Verified ✓', recovering: 'Let’s fix that', done: 'Done ✓', error: 'Problem', stopped: 'Stopped'
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; font-family: "Noto Sans Malayalam","Noto Sans",system-ui,-apple-system,sans-serif; color: #1f2340; }
    .wrap.left { right: auto; left: 20px; }
    .wrap.top { bottom: auto; top: 20px; }
    .launcher { width: 58px; height: 58px; border-radius: 50%; border: none; cursor: pointer; color: #fff; font: 700 20px inherit;
      background: radial-gradient(circle at 30% 30%, #ffa45c, #ff6a00); box-shadow: 0 8px 22px rgba(255,106,0,.45); }
    .card { width: 340px; background: #fffdf9; border-radius: 18px; box-shadow: 0 16px 40px rgba(31,35,64,.28); overflow: hidden; border: 1px solid #f1e3d3; }
    .hidden { display: none !important; }
    header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: linear-gradient(135deg,#1f2340,#38407a); color: #fff; }
    header .name { font-weight: 800; font-size: 15px; }
    header .ml { opacity: .8; font-size: 13px; }
    header .pill { margin-left: auto; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,.18); }
    header .min { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; padding: 0 2px; }
    .body { padding: 12px 14px 14px; }
    .instr-ml { font-size: 16px; line-height: 1.5; font-weight: 600; min-height: 24px; }
    .instr-en { font-size: 13px; color: #59607f; margin-top: 4px; }
    .explain { font-size: 12.5px; color: #7a4b16; background: #fff1e0; border-radius: 10px; padding: 6px 9px; margin-top: 8px; }
    .meta { display: flex; justify-content: space-between; font-size: 11px; color: #8a8fa8; margin-top: 10px; }
    .badge.mock { color: #b42318; font-weight: 700; }
    form { display: flex; gap: 6px; margin-top: 12px; }
    input { flex: 1; min-width: 0; border: 1.5px solid #e2d6c8; border-radius: 10px; padding: 9px 10px; font: inherit; font-size: 14px; outline: none; }
    input:focus { border-color: #ff7a1a; }
    button.mic { border: 1.5px solid #e2d6c8; border-radius: 10px; width: 40px; font-size: 18px; background: #fff; cursor: pointer; touch-action: none; user-select: none; }
    button.mic.on { background: #d92d20; border-color: #d92d20; box-shadow: 0 0 0 4px rgba(217,45,32,.25); }
    button.go { border: none; border-radius: 10px; padding: 0 14px; font: 700 14px inherit; color: #fff; background: #ff6a00; cursor: pointer; }
    .row { display: flex; gap: 6px; margin-top: 8px; }
    .row button { flex: 1; border: 1px solid #e2d6c8; background: #fff; border-radius: 9px; padding: 6px; font: 600 12px inherit; cursor: pointer; color: #1f2340; }
    details { margin-top: 10px; font-size: 11px; color: #59607f; }
    details ol { max-height: 140px; overflow: auto; padding-left: 18px; margin: 6px 0 0; }
  `;

  function init(h) {
    handlers = h || {};
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'koode-panel-root';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="wrap">
        <button class="launcher" title="Koode — കൂടെ">കൂ</button>
        <div class="card hidden">
          <header><span class="name">Koode</span><span class="ml">കൂടെ</span><span class="pill">Ready</span><button class="min" title="Minimise">–</button></header>
          <div class="body">
            <div class="instr-ml">എന്താണ് ചെയ്യേണ്ടത്? 🎤 അമർത്തിപ്പിടിച്ച് പറയൂ, അല്ലെങ്കിൽ എഴുതൂ.</div>
            <div class="instr-en">What would you like to do? Hold 🎤 and speak, or type.</div>
            <div class="explain hidden"></div>
            <form><input placeholder="e.g. Help me fill this form" aria-label="Your goal" /><button class="mic" type="button" title="Hold to speak (Malayalam)" aria-label="Hold to speak">🎤</button><button class="go" type="submit">Guide</button></form>
            <div class="row"><button class="repeat" type="button">Repeat</button><button class="stop" type="button">Stop</button></div>
            <div class="meta"><span class="step">Step –</span><span class="badge">planner: –</span></div>
            <details><summary>Trace</summary><ol class="trace"></ol></details>
          </div>
        </div>
      </div>`;
    const q = (s) => root.querySelector(s);
    els = { wrap: q('.wrap'), launcher: q('.launcher'), card: q('.card'), pill: q('.pill'), ml: q('.instr-ml'), en: q('.instr-en'),
      explain: q('.explain'), form: q('form'), input: q('input'), mic: q('.mic'), step: q('.step'), badge: q('.badge'), trace: q('.trace') };
    els.launcher.addEventListener('click', () => open());
    q('.min').addEventListener('click', () => { els.card.classList.add('hidden'); els.launcher.classList.remove('hidden'); });
    els.form.addEventListener('submit', (e) => { e.preventDefault(); const g = els.input.value.trim(); if (g && handlers.onGoal) handlers.onGoal(g); });
    // Push-to-talk: record while the mic button is held down.
    els.mic.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      els.mic.setPointerCapture(e.pointerId);
      els.mic.classList.add('on');
      if (handlers.onMicDown) handlers.onMicDown();
    });
    els.mic.addEventListener('pointerup', () => releaseMic());
    els.mic.addEventListener('pointercancel', () => releaseMic());
    q('.stop').addEventListener('click', () => handlers.onStop && handlers.onStop());
    q('.repeat').addEventListener('click', () => handlers.onRepeat && handlers.onRepeat());
    // Keep page shortcuts from firing while typing in Koode.
    els.input.addEventListener('keydown', (e) => e.stopPropagation());
    document.documentElement.appendChild(host);
    setState('idle');
  }

  function open() { els.card.classList.remove('hidden'); els.launcher.classList.add('hidden'); host.dataset.koodeOpen = 'true'; els.input.focus(); micRect(); }

  function releaseMic() {
    if (!els.mic.classList.contains('on')) return;
    els.mic.classList.remove('on');
    if (handlers.onMicUp) handlers.onMicUp();
  }

  // Mic position for automated tests (the shadow root is closed).
  function micRect() {
    const r = els.mic.getBoundingClientRect();
    host.dataset.koodeMicRect = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
  }

  function setVoiceInfo(info) {
    for (const [k, v] of Object.entries(info)) host.dataset['koodeVoice' + k[0].toUpperCase() + k.slice(1)] = String(v);
  }

  function setState(state) {
    host.dataset.koodeState = state;
    els.pill.textContent = STATE_LABEL[state] || state;
  }

  function setInstruction({ ml = '', en = '', explain = '' } = {}) {
    els.ml.textContent = ml;
    els.en.textContent = en;
    els.explain.textContent = explain;
    els.explain.classList.toggle('hidden', !explain);
    host.dataset.koodeInstruction = en;
  }

  function setStep(n, targetLabel) {
    els.step.textContent = n ? 'Step ' + n : 'Step –';
    host.dataset.koodeStep = String(n || 0);
    if (targetLabel !== undefined) host.dataset.koodeTarget = targetLabel || '';
  }

  function setPlanner(name, isMock) {
    els.badge.textContent = isMock ? 'MOCK test harness (not AI)' : 'model: ' + name;
    els.badge.classList.toggle('mock', !!isMock);
    host.dataset.koodePlanner = name;
  }

  function setGoal(goal) { els.input.value = goal || ''; }

  function log(msg) {
    const li = document.createElement('li');
    li.textContent = new Date().toLocaleTimeString() + ' ' + msg;
    els.trace.appendChild(li);
    while (els.trace.children.length > 60) els.trace.firstChild.remove();
    els.trace.scrollTop = els.trace.scrollHeight;
    const n = Number(host.dataset.koodeEvents || 0) + 1;
    host.dataset.koodeEvents = String(n);
    host.dataset.koodeLastEvent = msg;
  }

  // Move the panel to the other side if it would cover the target.
  function avoid(rect) {
    if (!rect) return;
    const hits = () => { const c = els.wrap.getBoundingClientRect(); return !(rect.right < c.left || rect.left > c.right || rect.bottom < c.top || rect.top > c.bottom); };
    if (!hits()) return;
    // Try the four corners; stay put if every corner overlaps (very large targets).
    const before = [els.wrap.classList.contains('left'), els.wrap.classList.contains('top')];
    for (const [left, top] of [[false, false], [true, false], [false, true], [true, true]]) {
      els.wrap.classList.toggle('left', left);
      els.wrap.classList.toggle('top', top);
      if (!hits()) return micRect();
    }
    els.wrap.classList.toggle('left', before[0]);
    els.wrap.classList.toggle('top', before[1]);
  }

  K.panel = { init, open, setState, setInstruction, setStep, setPlanner, setGoal, log, avoid, releaseMic, setVoiceInfo };
})();
