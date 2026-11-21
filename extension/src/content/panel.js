// Floating assistant UI (closed shadow DOM so page CSS can't break it).
// Exposes state on host data-attributes for automated tests.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page

  let host, root, els = {}, handlers = {};

  const STATE_LABEL = {
    idle: 'Ready', listening: 'Listening…', transcribing: 'Understanding…', confirm: 'Is this right?', finding: 'Finding…', waiting: 'Your turn',
    verifying: 'Checking…', verified: 'Verified ✓', recovering: 'Let’s fix that', done: 'Done ✓', error: 'Problem', stopped: 'Stopped'
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
    button.mic { border: 1.5px solid #e2d6c8; border-radius: 10px; width: 40px; background: #fff; color: #1f2340; cursor: pointer; touch-action: none; user-select: none; display: flex; align-items: center; justify-content: center; }
    button.mic.on { background: #d92d20; border-color: #d92d20; color: #fff; box-shadow: 0 0 0 4px rgba(217,45,32,.25); animation: ring 1s ease-in-out infinite; }
    @keyframes ring { 50% { box-shadow: 0 0 0 8px rgba(217,45,32,.12); } }
    button.go { border: none; border-radius: 10px; padding: 0 14px; font: 700 14px inherit; color: #fff; background: #ff6a00; cursor: pointer; }
    .row { display: flex; gap: 6px; margin-top: 8px; }
    .row button { flex: 1; border: 1px solid #e2d6c8; background: #fff; border-radius: 9px; padding: 6px; font: 600 12px inherit; cursor: pointer; color: #1f2340; }
    .card[data-s=listening] .pill { background: #d92d20; }
    .card[data-s=transcribing] .pill, .card[data-s=finding] .pill, .card[data-s=confirm] .pill { background: #3b5bdb; }
    .card[data-s=waiting] .pill { background: #ff6a00; }
    .card[data-s=verified] .pill, .card[data-s=done] .pill { background: #12b76a; }
    .card[data-s=error] .pill, .card[data-s=recovering] .pill { background: #f79009; }
    .card[data-s=done] header { background: linear-gradient(135deg,#067647,#12b76a); }
    .card[data-s=finding] .instr-ml::after, .card[data-s=transcribing] .instr-ml::after { content: ' …'; animation: blink 1s steps(2) infinite; }
    @keyframes blink { 50% { opacity: .2; } }
    .speak { display: none; font-size: 15px; animation: blink 0.8s ease-in-out infinite; }
    .card.speaking .speak { display: inline; }
    .meter { height: 6px; border-radius: 3px; background: #f1e3d3; margin-top: 8px; overflow: hidden; display: none; }
    .card[data-s=listening] .meter { display: block; }
    .meter i { display: block; height: 100%; width: 0; background: linear-gradient(90deg,#12b76a,#f79009,#d92d20); transition: width .08s; }
    .notice { font-size: 12px; color: #7a4b16; background: #fef0c7; border-radius: 8px; padding: 6px 9px; margin-top: 8px; }
    .confirm { margin-top: 10px; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 12px; padding: 9px 10px; }
    .confirm .heard { font-size: 16px; font-weight: 700; color: #1f2340; margin: 2px 0 4px; }
    .confirm .hint { font-size: 11.5px; color: #59607f; }
    .confirm .btns { display: flex; gap: 6px; margin-top: 8px; }
    .confirm button { flex: 1; border-radius: 9px; padding: 8px 6px; font: 700 13px inherit; cursor: pointer; border: 1px solid #c7d2fe; background: #fff; color: #1f2340; }
    .confirm button.yes { background: #12b76a; border-color: #12b76a; color: #fff; }
    .celebrate { display: none; text-align: center; font-size: 40px; line-height: 1; margin-bottom: 6px; color: #12b76a; }
    .card[data-s=done] .celebrate { display: block; animation: pop .5s cubic-bezier(.2,1.6,.4,1); }
    @keyframes pop { 0% { transform: scale(.2); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
    button.mic.unavail { opacity: .45; }
    button.mic:focus-visible, .confirm button:focus-visible { outline: 3px solid #ffa45c; outline-offset: 1px; }
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
          <header><span class="name">Koode</span><span class="ml">കൂടെ</span><span class="speak" title="Speaking">🔊</span><span class="pill">Ready</span><button class="min" title="Minimise">–</button></header>
          <div class="body">
            <div class="celebrate">✓</div>
            <div class="instr-ml">എന്താണ് ചെയ്യേണ്ടത്? 🎤 അമർത്തിപ്പിടിച്ച് പറയൂ, അല്ലെങ്കിൽ എഴുതൂ.</div>
            <div class="instr-en">What would you like to do? Hold 🎤 and speak, or type.</div>
            <div class="explain hidden"></div>
            <div class="meter"><i></i></div>
            <div class="notice hidden" role="status"></div>
            <div class="confirm hidden">
              <div class="hint">ഞാൻ കേട്ടത് · I heard:</div>
              <div class="heard"></div>
              <div class="hint">തെറ്റുണ്ടെങ്കിൽ താഴെ തിരുത്തൂ · Wrong? Edit it below, or say it again.</div>
              <div class="btns"><button class="yes" type="button">✓ ശരി, തുടങ്ങാം</button><button class="again" type="button">🎤 വീണ്ടും പറയാം</button></div>
            </div>
            <form><input placeholder="e.g. Help me fill this form" aria-label="Your goal" /><button class="mic" type="button" title="Hold to speak (Malayalam)" aria-label="Hold to speak"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg></button><button class="go" type="submit">Guide</button></form>
            <div class="row"><button class="repeat" type="button">Repeat</button><button class="stop" type="button">Stop</button></div>
            <div class="meta"><span class="step">Step –</span><span class="badge">planner: –</span></div>
            <details><summary>Trace</summary><ol class="trace"></ol></details>
          </div>
        </div>
      </div>`;
    const q = (s) => root.querySelector(s);
    els = { wrap: q('.wrap'), launcher: q('.launcher'), card: q('.card'), pill: q('.pill'), ml: q('.instr-ml'), en: q('.instr-en'),
      explain: q('.explain'), form: q('form'), input: q('input'), mic: q('.mic'), step: q('.step'), badge: q('.badge'), trace: q('.trace'),
      meter: q('.meter i'), notice: q('.notice'), confirm: q('.confirm'), heard: q('.heard'), yes: q('.yes'), again: q('.again') };
    els.launcher.addEventListener('click', () => open());
    q('.min').addEventListener('click', () => { els.card.classList.add('hidden'); els.launcher.classList.remove('hidden'); });
    // While a transcript is awaiting confirmation, Enter/Guide confirms the (possibly edited) text as a voice goal.
    els.form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    els.yes.addEventListener('click', () => submit());
    els.again.addEventListener('click', () => { hideConfirm(); if (handlers.onRetryVoice) handlers.onRetryVoice(); });
    // Push-to-talk: record while the mic button (or Space/Enter on it) is held down.
    els.mic.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      els.mic.setPointerCapture(e.pointerId);
      pressMic();
    });
    els.mic.addEventListener('pointerup', () => releaseMic());
    els.mic.addEventListener('pointercancel', () => releaseMic());
    els.mic.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) pressMic();
    });
    els.mic.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); releaseMic(); } });
    els.mic.addEventListener('blur', () => releaseMic());
    q('.stop').addEventListener('click', () => handlers.onStop && handlers.onStop());
    q('.repeat').addEventListener('click', () => handlers.onRepeat && handlers.onRepeat());
    // Keep page shortcuts from firing while typing in Koode.
    els.input.addEventListener('keydown', (e) => e.stopPropagation());
    document.documentElement.appendChild(host);
    setState('idle');
  }

  function open() { els.card.classList.remove('hidden'); els.launcher.classList.add('hidden'); host.dataset.koodeOpen = 'true'; els.input.focus(); micRect(); }

  function submit() {
    const g = els.input.value.trim();
    if (!g) return;
    const voiceGoal = !els.confirm.classList.contains('hidden');
    hideConfirm();
    if (voiceGoal) { if (handlers.onConfirm) handlers.onConfirm(g); } else if (handlers.onGoal) handlers.onGoal(g);
  }

  function pressMic() {
    if (els.mic.classList.contains('on')) return;
    hideConfirm();
    els.mic.classList.add('on');
    if (handlers.onMicDown) handlers.onMicDown();
  }

  // Show the recognised speech for confirmation; the text is also put in the input for correction.
  function confirmTranscript(text) {
    els.heard.textContent = text;
    els.input.value = text;
    els.confirm.classList.remove('hidden');
    els.yes.focus();
    const r = els.yes.getBoundingClientRect();
    host.dataset.koodeConfirmRect = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    micRect();
  }

  function hideConfirm() {
    els.confirm.classList.add('hidden');
    delete host.dataset.koodeConfirmRect;
  }

  function setVoiceAvailable(ok, reason = '') {
    els.mic.classList.toggle('unavail', !ok);
    els.mic.title = ok ? 'Hold to speak (Malayalam)' : 'Voice unavailable: ' + reason;
    host.dataset.koodeVoiceAvailable = String(!!ok);
  }

  function setLevel(v) { els.meter.style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%'; }

  function setSpeaking(on) {
    els.card.classList.toggle('speaking', !!on);
    host.dataset.koodeSpeaking = String(!!on);
  }

  function setNotice(text) {
    els.notice.textContent = text || '';
    els.notice.classList.toggle('hidden', !text);
    if (text) host.dataset.koodeNotice = text; else delete host.dataset.koodeNotice;
  }

  function focusInput() { els.input.focus(); }

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
    els.card.dataset.s = state;
    els.pill.textContent = STATE_LABEL[state] || state;
    if (state !== 'confirm') hideConfirm();
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

  K.panel = { init, open, setState, setInstruction, setStep, setPlanner, setGoal, log, avoid, releaseMic, setVoiceInfo,
    confirmTranscript, setVoiceAvailable, setLevel, setSpeaking, setNotice, focusInput };
})();
