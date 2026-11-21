// Guidance state machine:
// observe → plan (backend) → validate ID → point → wait for user → verify → next.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page
  const C = K.constants;
  const { extractor, overlay, monitor, panel, voice } = K;

  const S = { goal: '', voice: false, history: [], step: 0, target: null, lastPlan: null, lastEvent: null, token: 0, invalidRetries: 0, rateRetries: 0, active: false };
  const RATE_RETRIES = 2; // automatic retries after a model rate limit, per step
  const SLOW_NOTICE_MS = 2500;

  const send = (msg) => chrome.runtime.sendMessage(msg);

  function persist(extra = {}) {
    const task = S.active ? { goal: S.goal, voice: S.voice, history: S.history.slice(-20), step: S.step, url: location.href, ...extra } : null;
    send({ type: task ? 'koode:saveTask' : 'koode:clearTask', task }).catch(() => {});
  }

  function record(entry) {
    S.history.push({ step: S.step, ...entry });
    panel.log(`#${S.step} ${entry.outcome}: ${entry.target_label || ''}${entry.clicked_label ? ' (clicked "' + entry.clicked_label + '")' : ''}${entry.evidence ? ' [' + entry.evidence + ']' : ''}`);
  }

  async function plan(lastEvent) {
    const my = ++S.token;
    monitor.stop();
    overlay.clear();
    S.target = null;
    panel.setState('finding');
    S.failed = false;
    S.lastEvent = lastEvent || null;
    if (S.step >= C.MAX_STEPS) return fail('Too many steps; stopping to avoid a loop.');
    const snap = extractor.snapshot();
    panel.log(`snapshot ${snap.snapshot_id}: ${snap.candidates.length} candidates`);
    const t0 = performance.now();
    let resp;
    // Normal steps take < 1 s; a longer wait is almost always the model's free-tier rate limit.
    const slow = setTimeout(() => { if (my === S.token) panel.setNotice('⏳ ഒരു നിമിഷം — AI സേവനം തിരക്കിലാണ്. · The AI service is busy; this can take up to 15 s.'); }, SLOW_NOTICE_MS);
    try {
      resp = await send({ type: 'koode:plan', payload: { goal: S.goal, snapshot: snap, history: S.history.slice(-12), last_event: lastEvent || null } });
    } catch (e) {
      resp = { error: String(e && e.message || e) };
    } finally {
      clearTimeout(slow);
    }
    if (my !== S.token || !S.active) return;
    panel.setNotice('');
    const ms = Math.round(performance.now() - t0);
    if (resp && resp.code === 'rate_limited') return rateLimited(my, lastEvent, resp.retry_after_ms, resp.scope);
    if (resp && resp.code === 'offline') return fail('Koode backend is not reachable. Is it running?', 'Koode സെർവറുമായി ബന്ധപ്പെടാനായില്ല.');
    if (!resp || resp.error) return fail('Planner unavailable: ' + (resp && resp.error || 'no response'));
    S.rateRetries = 0;
    if (resp.rate_limit_wait_ms) panel.log(`waited ${resp.rate_limit_wait_ms}ms for model rate limit`);
    if (resp.planner) panel.setPlanner(resp.planner.model || resp.planner.provider, resp.planner.mock);
    panel.log(`plan ${resp.status} ${resp.target_id || ''} in ${ms}ms (${resp.planner ? resp.planner.provider : '?'})`);
    S.lastPlan = resp;

    if (resp.status === 'done') {
      panel.setState('done');
      panel.setStep(S.step, '');
      panel.setInstruction({ ml: resp.instruction_ml || 'എല്ലാം കഴിഞ്ഞു!', en: resp.instruction_en || 'All done.', explain: resp.explanation_ml });
      say(resp.instruction_ml || 'എല്ലാം കഴിഞ്ഞു!');
      panel.setStep(S.step, '');
      S.active = false;
      persist();
      return;
    }
    if (resp.status !== 'guide') {
      panel.setState('idle');
      panel.setInstruction({ ml: resp.instruction_ml, en: resp.instruction_en || 'I could not find a matching control on this page.', explain: resp.explanation_ml });
      say(resp.instruction_ml);
      return;
    }

    // The extension, not the model, decides whether the target is real.
    const r = extractor.resolve(resp.target_id);
    if (!r.ok) {
      S.invalidRetries += 1;
      panel.log(`REJECTED target ${resp.target_id}: ${r.reason}`);
      if (S.invalidRetries > C.MAX_INVALID_TARGET_RETRIES) return fail('Could not get a valid target from the planner.');
      return plan({ type: 'invalid_target', target_id: resp.target_id, reason: r.reason });
    }
    S.invalidRetries = 0;
    S.step += 1;
    show(resp, r);
  }

  // Model rate limit outlasted the backend's back-off: count down visibly and retry the same step.
  function rateLimited(my, lastEvent, retryAfterMs, scope) {
    // A daily quota (or any wait over 30 s) won't clear during a countdown: say so instead of retrying.
    if (scope === 'day' || retryAfterMs > 30000) {
      S.rateRetries = 0;
      const min = Math.max(1, Math.round((retryAfterMs || 60000) / 60000));
      return fail(`The AI service's free daily quota is used up. Try again in about ${min} min (press Repeat).`,
        `AI സേവനത്തിന്റെ ഇന്നത്തെ സൗജന്യ പരിധി കഴിഞ്ഞു. ഏകദേശം ${min} മിനിറ്റ് കഴിഞ്ഞ് "Repeat" അമർത്തൂ.`);
    }
    if (S.rateRetries >= RATE_RETRIES) {
      S.rateRetries = 0;
      return fail('The AI service is still busy (free-tier rate limit). Press Repeat to try again.', 'AI സേവനം ഇപ്പോഴും തിരക്കിലാണ്. "Repeat" അമർത്തി വീണ്ടും ശ്രമിക്കൂ.');
    }
    S.rateRetries += 1;
    let left = Math.max(2, Math.min(20, Math.ceil((retryAfterMs || 5000) / 1000)));
    panel.setState('finding');
    const tick = () => {
      if (my !== S.token || !S.active) return;
      if (left <= 0) { panel.setNotice(''); return plan(lastEvent); }
      panel.setNotice(`⏳ AI സേവനം തിരക്കിലാണ് — ${left} സെക്കൻഡിൽ വീണ്ടും ശ്രമിക്കും. · AI busy (rate limit) — retrying in ${left} s.`);
      left -= 1;
      setTimeout(tick, 1000);
    };
    panel.log(`model rate limited; auto-retry ${S.rateRetries}/${RATE_RETRIES}`);
    tick();
  }

  function show(resp, r) {
    S.target = r;
    const sensitiveNote = r.info.sensitive ? ' 🔒 ഇത് സ്വകാര്യമാണ് — Koode ഇത് വായിക്കില്ല. നിങ്ങൾ തന്നെ ടൈപ്പ് ചെയ്യൂ.' : '';
    panel.setState('waiting');
    panel.setStep(S.step, r.info.label);
    panel.setInstruction({ ml: (resp.instruction_ml || '') + sensitiveNote, en: resp.instruction_en, explain: resp.explanation_ml });
    say(resp.instruction_ml + (r.info.sensitive ? ' ഇത് നിങ്ങൾ തന്നെ ടൈപ്പ് ചെയ്യൂ.' : ''));
    overlay.point(r.anchor, {
      text: resp.instruction_ml || resp.instruction_en,
      step: S.step,
      lost: () => onLost(r),
      rect: (rect) => panel.avoid(rect)
    });
    panel.avoid(r.anchor.getBoundingClientRect());
    const kind = monitor.watch(r, {
      verified: (ev) => onVerified(r, kind, ev),
      wrong: (info) => onWrong(r, info),
      noChange: () => {
        if (!extractor.resolve(r.id).ok) return onLost(r);
        panel.setState('waiting');
        panel.log('click on target but no page change observed');
        panel.setInstruction({ ml: 'ക്ലിക്ക് കണ്ടു, പക്ഷേ മാറ്റമൊന്നും കണ്ടില്ല. ഒന്നുകൂടി ശ്രമിക്കൂ.', en: 'I saw the click but nothing changed yet. Please try once more.' });
      },
      invalid: () => {
        panel.setInstruction({ ml: 'ഫോർമാറ്റ് ശരിയല്ലെന്ന് തോന്നുന്നു. ഒന്നുകൂടി നോക്കൂ.', en: 'That format does not look right. Please check and correct it.', explain: resp.explanation_ml });
      },
      navigating: ({ on_target }) => persist({ pending: { type: 'navigation', from: location.href, on_target, target_label: r.info.label } })
    });
    panel.log(`pointing at ${r.id} "${r.info.label}" (${r.info.role}, expect ${kind})`);
    persist();
  }

  // Target disappeared. If the user's click on it is still being verified, let the monitor decide.
  function onLost(r) {
    if (S.target !== r || monitor.isVerifying()) return;
    record({ target_label: r.info.label, outcome: 'target_lost' });
    plan({ type: 'target_lost', label: r.info.label });
  }

  function onVerified(r, kind, ev) {
    if (ev.page_alert) {
      // The page reacted with an alert (e.g. form validation): not a completed step.
      record({ target_label: r.info.label, role: r.info.role, action: kind, outcome: 'page_alert', evidence: 'alert_shown' });
      panel.setState('recovering');
      panel.setInstruction({ ml: 'പേജ് ഒരു സന്ദേശം കാണിച്ചു. എന്താണ് തിരുത്തേണ്ടതെന്ന് നോക്കാം…', en: 'The page showed a message. Let me check what needs fixing…' });
      overlay.clear();
      persist();
      return plan({ type: 'page_alert', label: r.info.label, alert: ev.page_alert });
    }
    record({ target_label: r.info.label, role: r.info.role, action: kind, outcome: 'verified', evidence: ev.evidence });
    panel.setState('verified');
    panel.setInstruction({ ml: 'ശരി! അടുത്ത ഘട്ടം നോക്കുന്നു…', en: 'Correct — checking the next step…' });
    overlay.success();
    overlay.clear();
    persist();
    plan({ type: 'step_verified', label: r.info.label, evidence: ev.evidence, diff_added: ev.diff ? ev.diff.added_count : undefined });
  }

  function onWrong(r, info) {
    record({ target_label: r.info.label, outcome: 'wrong_action', clicked_label: info.label, page_changed: info.page_changed });
    panel.setState('recovering');
    if (info.page_changed || !extractor.resolve(r.id).ok) {
      panel.setInstruction({ ml: `അത് "${info.label}" ആയിരുന്നു. പേജ് മാറി — ഞാൻ വീണ്ടും നോക്കാം.`, en: `That was "${info.label}". The page changed, so I'm re-checking.` });
      plan({ type: 'wrong_action', clicked_label: info.label, page_changed: true });
      return;
    }
    // Page unchanged: keep the same validated target and re-point.
    panel.setInstruction({
      ml: `അത് "${info.label}" ആണ്. ശരിയായത് "${r.info.label}" — അമ്പടയാളം കാണിക്കുന്നിടത്ത്.`,
      en: `That was "${info.label}". The right one is "${r.info.label}" — where the arrow points.`
    });
    say(`അത് "${info.label}" ആണ്. ശരിയായത് "${r.info.label}".`);
    overlay.point(r.anchor, { text: `"${r.info.label}"`, step: S.step, lost: () => onLost(r), rect: (rect) => panel.avoid(rect) });
  }

  function fail(msg, ml) {
    S.failed = true;
    monitor.stop();
    overlay.clear();
    panel.setNotice('');
    panel.setState('error');
    panel.setInstruction({ ml: ml || 'ക്ഷമിക്കണം, ഒരു പ്രശ്നം ഉണ്ടായി.', en: msg });
    panel.log('ERROR ' + msg);
  }

  // Spoken replies only when the user asked by voice; text on screen is always the fallback.
  let ttsCount = 0, ttsWarned = false;
  function say(text, force) {
    if ((!S.voice && !force) || !text) return;
    voice.speak(text).then((t) => {
      if (!t) return;
      panel.setVoiceInfo({ ttsCount: ++ttsCount, ttsMs: t.ms, ttsBackendMs: t.backend_ms });
      panel.log(`spoke reply (${text.length} chars) in ${t.ms}ms`);
    }, (e) => {
      panel.setVoiceInfo({ error: 'tts: ' + (e.code || e.message) });
      panel.log('voice reply failed: ' + (e.code || '') + ' ' + e.message);
      if (e.code === 'autoplay') panel.setNotice('🔇 ശബ്ദം കേൾക്കാൻ "Repeat" അമർത്തൂ. · Press Repeat to hear the instruction.');
      else if (!ttsWarned) panel.setNotice('🔇 ശബ്ദ മറുപടി ഇപ്പോൾ ലഭ്യമല്ല — മുകളിലെ നിർദ്ദേശം വായിക്കൂ. · Spoken reply unavailable; please read the text above.');
      ttsWarned = true;
    });
  }

  const MIC_ERRORS = {
    NotAllowedError: ['മൈക്ക് അനുവാദം ഇല്ല. വിലാസ ബാറിലെ 🔒 ഐക്കണിൽ ക്ലിക്ക് ചെയ്ത് മൈക്രോഫോൺ "Allow" ആക്കൂ, അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യൂ.', 'Microphone permission is blocked. Click the 🔒 icon in the address bar and allow the microphone, or type your request.'],
    NotFoundError: ['മൈക്രോഫോൺ കണ്ടെത്തിയില്ല. ദയവായി ടൈപ്പ് ചെയ്യൂ.', 'No microphone found. Please type your request.'],
    NotReadableError: ['മൈക്ക് മറ്റൊരു ആപ്പ് ഉപയോഗിക്കുന്നു. അത് അടച്ച് വീണ്ടും ശ്രമിക്കൂ, അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യൂ.', 'The microphone is in use by another app. Close it and try again, or type.'],
    InsecureContextError: ['ഈ പേജിൽ മൈക്ക് ഉപയോഗിക്കാനാവില്ല (https വേണം). ദയവായി ടൈപ്പ് ചെയ്യൂ.', 'Voice needs a secure (https) page. Please type your request here.'],
    NotSupportedError: ['ഈ ബ്രൗസറിൽ ശബ്ദം റെക്കോർഡ് ചെയ്യാനാവില്ല. ദയവായി ടൈപ്പ് ചെയ്യൂ.', 'This browser cannot record audio. Please type your request.']
  };
  MIC_ERRORS.SecurityError = MIC_ERRORS.NotAllowedError;
  MIC_ERRORS.OverconstrainedError = MIC_ERRORS.NotFoundError;
  MIC_ERRORS.AbortError = MIC_ERRORS.NotReadableError;

  const STT_ERRORS = {
    not_configured: ['ഈ Koode സെർവറിൽ ശബ്ദ സൗകര്യം ഇല്ല. ദയവായി ടൈപ്പ് ചെയ്യൂ.', 'Voice is not set up on this Koode server. Please type your request.'],
    offline: ['Koode സെർവറുമായി ബന്ധപ്പെടാനായില്ല.', 'Koode backend is not reachable. Is it running?'],
    timeout: ['ശബ്ദ സേവനം മറുപടി നൽകിയില്ല. ഒന്നുകൂടി പറയൂ, അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യൂ.', 'The speech service did not answer in time. Try again or type your request.'],
    rate_limited: ['ശബ്ദ സേവനം തിരക്കിലാണ്. കുറച്ച് സെക്കൻഡ് കഴിഞ്ഞ് പറയൂ, അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യൂ.', 'The speech service is busy. Wait a few seconds and try again, or type.'],
    auth: ['ശബ്ദ സേവനം ഇപ്പോൾ ലഭ്യമല്ല. ദയവായി ടൈപ്പ് ചെയ്യൂ.', 'The speech service rejected the request (API key problem). Please type your request.'],
    bad_audio: ['ആ റെക്കോർഡിംഗ് മനസ്സിലാക്കാനായില്ല. ഒന്നുകൂടി പറയൂ.', 'That recording could not be processed. Please try again.']
  };
  const STT_GENERIC = ['ക്ഷമിക്കണം, മനസ്സിലായില്ല. ഒന്നുകൂടി പറയൂ, അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യൂ.', "Sorry, I didn't catch that. Try again or type your request."];

  // A failed or abandoned voice attempt during guidance keeps the current step on screen.
  function guiding() {
    if (!S.active || !S.target || !S.lastPlan) return false;
    panel.setState('waiting');
    panel.setInstruction({ ml: S.lastPlan.instruction_ml, en: S.lastPlan.instruction_en, explain: S.lastPlan.explanation_ml });
    return true;
  }

  function voiceProblem([ml, en], detail) {
    if (guiding()) panel.setNotice(ml + ' · ' + en);
    else { panel.setState('idle'); panel.setInstruction({ ml, en }); }
    panel.setVoiceInfo({ error: detail });
    panel.log('voice fallback: ' + detail);
    panel.focusInput();
  }

  async function micDown() {
    voice.hush();
    S.voiceToken = (S.voiceToken || 0) + 1; // the current task continues until a new goal is confirmed
    try {
      await voice.start();
    } catch (e) {
      panel.releaseMic();
      return voiceProblem(MIC_ERRORS[e.name] || MIC_ERRORS.NotFoundError, 'mic: ' + (e.name || e.message));
    }
    if (!voice.isRecording()) return; // released before the mic opened
    panel.setState('listening');
    panel.setInstruction({ ml: 'കേൾക്കുന്നു… പറഞ്ഞു കഴിഞ്ഞാൽ ബട്ടൺ വിടൂ.', en: 'Listening… release the button when you finish.' });
  }

  async function micUp() {
    if (!voice.isRecording()) return;
    const my = S.voiceToken; // Stop (or a new goal) while transcribing cancels this voice request
    const clip = await voice.stop();
    if (my !== S.voiceToken) return;
    if (!clip) {
      if (guiding()) return;
      panel.setState('idle');
      panel.setInstruction({ ml: 'ബട്ടൺ അമർത്തിപ്പിടിച്ചുകൊണ്ട് സംസാരിക്കൂ, പറഞ്ഞു കഴിഞ്ഞ് വിടൂ.', en: 'Hold the mic button while you speak, then release it.' });
      return;
    }
    panel.setState('transcribing');
    panel.setInstruction({ ml: 'നിങ്ങൾ പറഞ്ഞത് മനസ്സിലാക്കുന്നു', en: 'Understanding what you said…' });
    const t0 = performance.now();
    let resp;
    try { resp = await voice.transcribe(clip); } catch (e) { resp = { error: String(e && e.message || e) }; }
    const ms = Math.round(performance.now() - t0);
    if (my !== S.voiceToken) return;
    panel.setVoiceInfo({ sttMs: ms, audioMs: clip.ms, peak: clip.peak });
    if (!resp || resp.error) {
      if (resp && resp.code === 'not_configured') panel.setVoiceAvailable(false, 'not configured on the server');
      return voiceProblem(STT_ERRORS[resp && resp.code] || STT_GENERIC, 'stt: ' + (resp && (resp.code || resp.error) || 'no response'));
    }
    if (!resp.transcript) {
      return voiceProblem(['ഒന്നും കേട്ടില്ല. മൈക്കിനടുത്ത് വ്യക്തമായി പറയൂ, അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യൂ.', 'I heard nothing. Speak clearly near the microphone, or type your request.'], 'stt: empty transcript (peak ' + clip.peak + ')');
    }
    panel.setVoiceInfo({ sttBackendMs: resp.latency_ms, transcriptChars: resp.transcript.length, lang: resp.language_code || '' });
    panel.log(`voice: ${clip.ms}ms audio → ${resp.transcript.length}-char transcript in ${ms}ms (${resp.model})`);
    // Nothing happens on the page until the user confirms (or corrects) what Koode heard.
    panel.setState('confirm');
    panel.setInstruction({ ml: 'ഇതാണോ നിങ്ങൾ പറഞ്ഞത്? ശരിയാണെങ്കിൽ "ശരി" അമർത്തൂ.', en: 'Is this what you said? Press ✓ to start, edit the text, or speak again.' });
    panel.confirmTranscript(resp.transcript);
    say('ഇതാണോ നിങ്ങൾ പറഞ്ഞത്? ' + resp.transcript, true);
  }

  function confirmVoice(goal) {
    panel.setVoiceInfo({ confirmedAt: Math.round(performance.now()) });
    start(goal, { voice: true });
  }

  function retryVoice() {
    voice.hush();
    if (guiding()) return;
    panel.setState('idle');
    panel.setInstruction({ ml: '🎤 അമർത്തിപ്പിടിച്ച് ഒന്നുകൂടി പറയൂ.', en: 'Hold 🎤 and say it again.' });
  }

  function start(goal, opts = {}) {
    stop(true);
    Object.assign(S, { goal, voice: !!opts.voice, history: [], step: 0, active: true, invalidRetries: 0, rateRetries: 0 });
    ttsWarned = false;
    panel.setNotice('');
    panel.setGoal(goal);
    panel.log(`goal set (${goal.length} chars)`);
    persist();
    plan({ type: 'goal_set' });
  }

  function resume(task) {
    Object.assign(S, { goal: task.goal, voice: !!task.voice, history: task.history || [], step: task.step || 0, active: true, invalidRetries: 0, rateRetries: 0 });
    panel.open();
    panel.setGoal(task.goal);
    panel.log('resumed after page load');
    const p = task.pending;
    if (p && p.type === 'navigation') {
      if (location.href !== p.from) {
        if (p.on_target) record({ target_label: p.target_label, outcome: 'verified', action: 'click', evidence: 'navigation' });
        else record({ target_label: p.target_label, outcome: 'wrong_action', clicked_label: '(navigated elsewhere)', page_changed: true });
      }
    }
    plan({ type: 'page_loaded', after_navigation: !!p });
  }

  function stop(silent) {
    S.token += 1;
    S.voiceToken = (S.voiceToken || 0) + 1;
    voice.hush();
    S.active = false;
    S.target = null;
    monitor.stop();
    overlay.clear();
    panel.setNotice('');
    persist();
    if (!silent) {
      panel.setState('stopped');
      panel.setInstruction({ ml: 'നിർത്തി. വീണ്ടും വേണമെങ്കിൽ ലക്ഷ്യം എഴുതൂ.', en: 'Stopped. Type a goal to start again.' });
      panel.log('stopped by user');
    }
  }

  function repeat() {
    // After an error (e.g. a lasting rate limit), Repeat retries the same step.
    if (S.failed && S.active && S.goal) {
      S.failed = false;
      return plan(S.lastEvent);
    }
    if (!S.target || !S.lastPlan) return;
    const v = extractor.resolve(S.target.id);
    if (!v.ok) return plan({ type: 'target_lost', label: S.target.info.label });
    const r = S.target;
    overlay.point(v.anchor, { text: S.lastPlan.instruction_ml || S.lastPlan.instruction_en, step: S.step, lost: () => onLost(r), rect: (rect) => panel.avoid(rect) });
    panel.setInstruction({ ml: S.lastPlan.instruction_ml, en: S.lastPlan.instruction_en, explain: S.lastPlan.explanation_ml });
    panel.setNotice('');
    say(S.lastPlan.instruction_ml);
  }

  K.controller = { start, stop, resume, repeat, micDown, micUp, confirmVoice, retryVoice, state: S };
})();
