// Guidance state machine:
// observe → plan (backend) → validate ID → point → wait for user → verify → next.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page
  const C = K.constants;
  const { extractor, overlay, monitor, panel, voice } = K;
  const G = K.goals;
  const THIN_RESULTS = 3; // fewer videos than this on a results page → try the fallback query

  const S = { goal: '', voice: false, history: [], step: 0, target: null, lastPlan: null, lastEvent: null, token: 0, invalidRetries: 0, rateRetries: 0, active: false };
  const RATE_RETRIES = 2; // automatic retries after a model rate limit, per step
  const SLOW_NOTICE_MS = 2500;

  const send = (msg) => chrome.runtime.sendMessage(msg);
  // Mirror state to the side panel (instructions and step only; no page content beyond labels).
  const mirror = { state: 'idle' };
  const setState0 = panel.setState, setInstruction0 = panel.setInstruction;
  const here = () => (K.sites && K.sites.forUrl(location.href)) || null;
  const progress = (extra) => send({ type: 'koode:progress', progress: { ...mirror, goal: S.active ? S.goal : '', step: S.step, active: S.active, site: here()?.name, siteId: here()?.id, ...extra } }).catch(() => {});
  panel.setState = (st) => { setState0(st); mirror.state = st; progress(); };
  panel.setInstruction = (i = {}) => { setInstruction0(i); mirror.ml = i.ml || ''; mirror.en = i.en || ''; progress(); };

  function persist(extra = {}) {
    const task = S.active ? { goal: S.goal, voice: S.voice, history: S.history.slice(-20), step: S.step, url: location.href, search: S.search || undefined, ...extra } : null;
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
    // After a URL change (SPA route or reload) let the new view render before reading it.
    if (location.href !== S.snapHref) {
      await K.ready.quiet(400, 2000);
      if (my !== S.token || !S.active) return;
    }
    S.snapHref = location.href;
    const snap = extractor.snapshot();
    panel.log(`snapshot ${snap.snapshot_id}: ${snap.candidates.length} candidates`);
    const t0 = performance.now();
    let resp = localPlan(snap);
    if (resp) { panel.log('local rule: ' + resp.rule); return planned(my, resp, 0, lastEvent); }
    // Normal steps take < 1 s; a longer wait is almost always the model's free-tier rate limit.
    const slow = setTimeout(() => { if (my === S.token) panel.setNotice('⏳ ഒരു നിമിഷം — AI സേവനം തിരക്കിലാണ്. · The AI service is busy; this can take up to 15 s.'); }, SLOW_NOTICE_MS);
    try {
      resp = await send({ type: 'koode:plan', payload: { goal: plannerGoal(), snapshot: snap, history: S.history.slice(-12), last_event: lastEvent || null } });
    } catch (e) {
      resp = { error: String(e && e.message || e) };
    } finally {
      clearTimeout(slow);
    }
    if (my !== S.token || !S.active) return;
    panel.setNotice('');
    return planned(my, resp, Math.round(performance.now() - t0), lastEvent);
  }

  function planned(my, resp, ms, lastEvent) {
    if (resp && resp.code === 'rate_limited') return rateLimited(my, lastEvent, resp.retry_after_ms, resp.scope);
    if (resp && resp.code === 'offline') return fail('Koode backend is not reachable. Is it running?', 'Koode സെർവറുമായി ബന്ധപ്പെടാനായില്ല.');
    if (!resp || resp.error) return fail('Planner unavailable: ' + (resp && resp.error || 'no response'));
    S.rateRetries = 0;
    if (resp.rate_limit_wait_ms) panel.log(`waited ${resp.rate_limit_wait_ms}ms for model rate limit`);
    if (resp.planner) panel.setPlanner(resp.planner.model || resp.planner.provider, resp.planner.mock, resp.planner.provider === 'rule');
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

  // WhatsApp Web: chats, contacts and messages are private areas that are never read, so the model has
  // nothing useful to plan on. A local rule (no AI, no network) points at the search control; after the
  // user types a name, Koode hands over: the user picks the contact and writes/sends messages themselves.
  const WA_RULE = { provider: 'rule', model: 'WhatsApp privacy rule (no AI)', mock: false };
  // The goal the step planner sees. After Koode opened YouTube results, it says so (and quotes the query).
  function plannerGoal() {
    if (!S.search || here()?.id !== 'youtube') return S.goal;
    return (S.goal + ` (YouTube search results for "${S.search.query}" are open: guide the user to open one relevant video.)`).slice(0, 300);
  }

  // YouTube searches opened by Koode: a video page means the user opened a video (done, no model call).
  const YT_RULE = { provider: 'rule', model: 'YouTube search rule (no AI)', mock: false };
  function youtubeRule() {
    if (!S.search || here()?.id !== 'youtube') return null;
    if (/^\/(watch|shorts\/)/.test(location.pathname)) {
      return { status: 'done', rule: 'yt_watch', planner: YT_RULE,
        instruction_ml: 'വീഡിയോ തുറന്നു. ഇനി കാണാം! മറ്റൊന്ന് വേണമെങ്കിൽ പറയൂ.',
        instruction_en: 'The video is open. Enjoy! Ask again if you want something else.' };
    }
    if (location.pathname === '/results' && countVideos() === 0) {
      return { status: 'cannot_find', rule: 'yt_no_results', planner: YT_RULE,
        instruction_ml: `“${S.search.query}” എന്നതിന് വീഡിയോകൾ കണ്ടില്ല. മറ്റൊരു രീതിയിൽ പറഞ്ഞുനോക്കൂ.`,
        instruction_en: `No videos were found for “${S.search.query}”. Try saying it another way.` };
    }
    return null;
  }

  function localPlan(snap) {
    const yt = youtubeRule();
    if (yt) return yt;
    if (here()?.id !== 'whatsapp') return null;
    if (S.history.some((h) => h.outcome === 'verified' && h.rule === 'wa_search')) {
      return { status: 'done', rule: 'wa_handoff', planner: WA_RULE,
        instruction_ml: 'ഇനി കോൺടാക്റ്റ് നിങ്ങൾ തന്നെ തിരഞ്ഞെടുത്ത് സന്ദേശം എഴുതി അയയ്ക്കൂ. Koode നിങ്ങളുടെ ചാറ്റുകൾ വായിക്കില്ല.',
        instruction_en: 'Now choose the contact and write and send your message yourself. Koode never reads your chats.' };
    }
    const box = snap.candidates.find((c) => /textbox|searchbox|combobox/.test(c.role) && !c.sensitive && /search|തിരയ/i.test(c.label));
    if (!box) {
      return { status: 'cannot_find', rule: 'wa_no_search', planner: WA_RULE,
        instruction_ml: 'WhatsApp-ൽ തിരയൽ ബോക്സ് കണ്ടില്ല. പേജ് പൂർണ്ണമായി തുറന്നോ എന്ന് നോക്കൂ.',
        instruction_en: 'I could not find the WhatsApp search box. Check that WhatsApp has finished loading.' };
    }
    return { status: 'guide', target_id: box.id, rule: 'wa_search', planner: WA_RULE,
      instruction_ml: `"${box.label}" എന്ന തിരയൽ ബോക്സിൽ ക്ലിക്ക് ചെയ്ത് ആളുടെ പേര് ടൈപ്പ് ചെയ്യൂ.`,
      instruction_en: `Click the "${box.label}" box and type the person's name.`,
      explanation_ml: 'Search എന്നാൽ തിരയുക. നിങ്ങൾ ടൈപ്പ് ചെയ്യുന്നത് Koode വായിക്കില്ല.' };
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
    }, { fillIdleMs: resp.rule === 'wa_search' ? 1500 : 0 });
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
    record({ target_label: r.info.label, role: r.info.role, action: kind, outcome: 'verified', evidence: ev.evidence, rule: S.lastPlan && S.lastPlan.rule });
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
    // The side panel (open for this tab) plays replies: it holds the user's gesture, so a freshly
    // loaded page's autoplay policy can't silence them. Otherwise the page plays them itself.
    send({ type: 'koode:say', text }).then((r) => {
      if (r && r.routed) { panel.setVoiceInfo({ ttsCount: ++ttsCount, ttsRouted: 'sidepanel' }); panel.log(`reply (${text.length} chars) spoken in the side panel`); return; }
      sayHere(text);
    }, () => sayHere(text));
  }
  function sayHere(text) {
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
    if (S.paused) {
      // Resume watching the step that was paused when the mic was pressed.
      S.paused = false;
      const v = extractor.resolve(S.target.id);
      if (!v.ok) plan({ type: 'target_lost', label: S.target.info.label });
      else show(S.lastPlan, v);
      return true;
    }
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
    send({ type: 'koode:hush' }).catch(() => {});
    S.voiceToken = (S.voiceToken || 0) + 1; // the current task continues until a new goal is confirmed
    // Pause step verification while the user speaks/confirms (e.g. focus moving to ✓ must not complete a field step).
    if (S.active && S.target && !S.paused) { monitor.stop(); S.paused = true; }
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
    route(goal, { voice: true });
  }

  // A request typed or spoken in the in-page panel: "open YouTube…" and "exit" use the same rule-based
  // routing as the side panel (no model quota); everything else is a goal for this page.
  function route(text0, opts = {}) {
    // Personal numbers are removed before routing, so they never reach a model, a URL or the task store.
    const red = G.redact(text0);
    const text = red.text;
    const privacy = G.redactionNotice(red.found);
    if (privacy) { panel.log('removed personal data from the request: ' + red.found.join(', ')); host().dataset.koodeRedacted = red.found.join(','); }
    const c = K.sites.classify(text, { siteId: here()?.id });
    panel.log('request routed: ' + c.type + (c.site ? ' ' + c.site.id : ''));
    host().dataset.koodeRoute = c.type;
    if (c.type !== 'exit' && G.safety(text) === 'self_harm') {
      host().dataset.koodeRoute = 'self_harm';
      stop(true, true);
      panel.setState('idle');
      panel.setInstruction({ ml: G.MSG.selfHarm.ml, en: G.MSG.selfHarm.en });
      say(G.MSG.selfHarm.ml, opts.voice);
      return;
    }
    if (c.type === 'youtube_search') return youtubeSearch(c.search, c.goal, opts, privacy);
    if (c.type === 'intent') return askIntent(text, opts, privacy);
    if (privacy) { panel.setNotice(privacy.ml + ' · ' + privacy.en); say(privacy.ml, opts.voice); }
    if (c.type === 'exit') return exit({ voice: opts.voice });
    if (c.type === 'navigate') {
      stop(true, true);
      panel.setState('loading');
      panel.setInstruction({ ml: `${c.site.ml || c.site.name} തുറക്കുന്നു…`, en: `Opening ${c.site.name}…` });
      say(`${c.site.ml || c.site.name} തുറക്കുന്നു`, opts.voice);
      send({ type: 'koode:navigate', siteId: c.site.id, goal: c.goal, voice: !!opts.voice }).then((r) => {
        if (r && r.error) fail('Could not open ' + c.site.name + ': ' + r.error, 'തുറക്കാനായില്ല.');
      }, () => {});
      return;
    }
    if (c.type === 'already_here') {
      panel.setState('idle');
      panel.setInstruction({ ml: `${c.site.ml || c.site.name} ഇതിനകം തുറന്നിട്ടുണ്ട്. എന്താണ് ചെയ്യേണ്ടത്?`, en: `${c.site.name} is already open. What would you like to do here?` });
      say(`${c.site.ml || c.site.name} ഇതിനകം തുറന്നിട്ടുണ്ട്. എന്താണ് ചെയ്യേണ്ടത്?`, opts.voice);
      return;
    }
    if (c.type === 'need_link') {
      panel.setState('idle');
      panel.setInstruction({ ml: 'നിങ്ങളുടെ Google Form ലിങ്ക് (WhatsApp/ഇമെയിൽ) തുറക്കൂ; അവിടെ ഞാൻ സഹായിക്കാം. പരിശീലനത്തിന് "അപേക്ഷാ ഫോം തുറക്കൂ" എന്ന് പറയൂ.', en: 'Open your Google Form link (from WhatsApp or email) and I will help there. To practise, say "open the application form".' });
      return;
    }
    start(c.goal || text, opts);
  }

  const host = () => document.getElementById('koode-panel-root') || document.documentElement;

  // Opens YouTube results for a validated query (the service worker builds the URL). A page with typed
  // input keeps its tab: the results open in a new one.
  async function youtubeSearch(search, goal, opts = {}, privacy = null) {
    // Stop first (monitor off, no persist) so this page can't overwrite the new task while it unloads.
    stop(true, true);
    const m = G.searchText(search.query);
    panel.setState('loading');
    panel.setInstruction({ ml: (privacy ? privacy.ml + ' ' : '') + m.ml, en: (privacy ? privacy.en + ' ' : '') + m.en });
    say((privacy ? privacy.ml + ' ' : '') + m.ml, opts.voice);
    host().dataset.koodeSearch = search.query;
    const r = await send({ type: 'koode:youtubeSearch', search, goal, voice: !!opts.voice }).catch((e) => ({ error: String(e && e.message || e) }));
    if (!r || r.error) return fail('Could not search YouTube: ' + (r && r.error || 'no response'), 'യൂട്യൂബിൽ തിരയാനായില്ല.');
    if (r.newTab) {
      panel.setState('idle');
      panel.setInstruction({ ml: 'നിങ്ങൾ ടൈപ്പ് ചെയ്തത് നഷ്ടപ്പെടാതിരിക്കാൻ യൂട്യൂബ് പുതിയ ടാബിൽ തുറന്നു.', en: 'YouTube opened in a new tab so what you typed on this page is kept.' });
      panel.log('search opened in a new tab (this page has typed input)');
      host().dataset.koodeNewTab = 'true';
    }
  }

  // Open-ended request: the intent planner nominates a query or explains what Koode can't do yet.
  async function askIntent(text, opts = {}, privacy = null) {
    panel.setState('finding');
    panel.setInstruction({ ml: 'നിങ്ങൾക്ക് എന്താണ് വേണ്ടതെന്ന് മനസ്സിലാക്കുന്നു…', en: 'Working out what you need…' });
    const resp = await send({ type: 'koode:intent', payload: { goal: text, site_id: here()?.id || null } }).catch((e) => ({ error: String(e && e.message || e) }));
    if (resp && resp.planner) panel.setPlanner(resp.planner.model || resp.planner.provider, resp.planner.mock, false);
    panel.log('intent: ' + ((resp && (resp.type || resp.code || resp.error)) || 'no response'));
    host().dataset.koodeIntent = (resp && (resp.type || resp.code)) || 'error';
    const a = G.intentToAction(resp, { guidable: true });
    if (a.kind === 'youtube_search') return youtubeSearch(a.search, text, opts, privacy);
    if (a.kind === 'guide') return start(text, opts);
    panel.setState('idle');
    const lead = privacy ? privacy.ml + ' ' : '';
    panel.setInstruction({ ml: lead + a.ml, en: (privacy ? privacy.en + ' ' : '') + a.en });
    say(lead + a.ml, opts.voice);
    if (a.offer) panel.setNotice(a.offerLabel.ml + ' · ' + a.offerLabel.en, { label: '▶ ' + a.offerLabel.ml, id: 'koode-offer', run: () => youtubeSearch(a.offer, text, opts) });
  }

  // Counts distinct video links on a YouTube results page (presence only; nothing is read or sent).
  function countVideos() {
    const hrefs = new Set();
    for (const a of document.querySelectorAll('a[href*="/watch?v="], a[href^="/shorts/"]')) {
      if (a.closest('#koode-panel-root,#koode-overlay-root') || !extractor.isRendered(a)) continue;
      hrefs.add((a.getAttribute('href') || '').split('&')[0]);
    }
    return hrefs.size;
  }
  async function waitForVideos(maxMs = 5000) {
    const t0 = performance.now();
    let n = countVideos();
    while (n < THIN_RESULTS && performance.now() - t0 < maxMs) { await new Promise((r) => setTimeout(r, 250)); n = countVideos(); }
    return n;
  }

  // Thin results for the first query: search again with the fallback (English words + the content
  // language, e.g. "coconut tree climbing malayalam"). Returns true if a new search was started.
  async function maybeFallback(my) {
    const sr = S.search;
    if (!sr || sr.attempt !== 1 || location.pathname !== '/results') return false;
    const n = await waitForVideos();
    if (my !== S.token) return true;
    host().dataset.koodeResults = String(n);
    panel.log(`results page: ${n} videos for the first query`);
    if (n >= THIN_RESULTS) return false;
    let fallback = sr.fallback;
    if (!fallback && sr.lazyFallback) {
      // The user's own Malayalam words found little: one intent call for English words (only now).
      const resp = await send({ type: 'koode:intent', payload: { goal: sr.query + ' വീഡിയോ', site_id: 'youtube' } }).catch(() => null);
      if (my !== S.token) return true;
      const plan = resp && !resp.error && (resp.type === 'youtube_search' || resp.type === 'service') ? G.planSearch({ ...resp, query_ml: sr.query, content_lang: sr.lang }) : null;
      fallback = plan && plan.fallback;
      panel.log('fallback query from intent: ' + (fallback ? fallback.length + ' chars' : 'none'));
    }
    if (!fallback || fallback === sr.query) return false;
    const m = G.searchText(fallback);
    panel.setInstruction({ ml: 'കുറച്ച് വീഡിയോകൾ മാത്രം കിട്ടി. ' + m.ml, en: 'Only a few videos came up. ' + m.en });
    host().dataset.koodeFallback = fallback;
    const { goal, voice: v } = S;
    stop(true, true);
    say('കുറച്ച് വീഡിയോകൾ മാത്രം കിട്ടി. ' + m.ml, v);
    const r = await send({ type: 'koode:youtubeSearch', search: { query: fallback, lang: sr.lang, attempt: 2 }, goal, voice: v }).catch(() => null);
    if (!r || r.error) fail('Could not search YouTube again: ' + (r && r.error || 'no response'), 'യൂട്യൂബിൽ വീണ്ടും തിരയാനായില്ല.');
    return true;
  }

  // True if the user has typed or chosen something on this page that a navigation would lose.
  // Search boxes don't count. Only a yes/no leaves this function; values are never read out.
  function hasUnsavedInput() {
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (el.closest('#koode-panel-root,#koode-overlay-root,[role=search],form[action*="search"],form[action="/results"]')) continue;
      const type = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'search', 'file'].includes(type) || /search|query|^q$/i.test(el.name || el.id || '')) continue;
      if (el.tagName === 'SELECT') { if (Array.from(el.options).some((o) => o.selected !== o.defaultSelected)) return true; continue; }
      if (type === 'checkbox' || type === 'radio') { if (el.checked !== el.defaultChecked) return true; continue; }
      if (el.value !== el.defaultValue) return true;
    }
    return false;
  }

  // Clean exit: stop guiding, forget the task, say goodbye, close the panel. The launcher stays.
  function exit(opts = {}) {
    stop(true, true);
    // Exit requested in the side panel: it already cleared the session and says goodbye itself.
    if (!opts.fromPanel) {
      send({ type: 'koode:clearTask' }).catch(() => {});
      send({ type: 'koode:exit', voice: !!opts.voice }).catch(() => {});
    }
    S.goal = '';
    panel.setState('ended');
    panel.setStep(0, '');
    panel.setInstruction({ ml: 'ശരി, Koode അവസാനിപ്പിച്ചു. നന്ദി!', en: 'Okay — Koode session ended. Thank you!' });
    if (opts.voice) say('ശരി, Koode അവസാനിപ്പിച്ചു. നന്ദി!', true);
    panel.log('session ended (exit)');
    if (!opts.keepOpen) setTimeout(() => { if (!S.active) panel.close(); }, opts.voice ? 2500 : 1200);
  }

  function retryVoice() {
    voice.hush();
    if (guiding()) return;
    panel.setState('idle');
    panel.setInstruction({ ml: '🎤 അമർത്തിപ്പിടിച്ച് ഒന്നുകൂടി പറയൂ.', en: 'Hold 🎤 and say it again.' });
  }

  function start(goal0, opts = {}) {
    stop(true);
    const goal = G.redact(goal0).text;
    Object.assign(S, { goal, voice: !!opts.voice, history: [], step: 0, active: true, invalidRetries: 0, rateRetries: 0, search: null });
    ttsWarned = false;
    panel.setNotice('');
    panel.setGoal(goal);
    panel.log(`goal set (${goal.length} chars)`);
    persist();
    plan({ type: 'goal_set' });
  }

  // A page opened on request: wait until it is ready (and the user has logged in, on WhatsApp), then
  // continue the carried-over goal, or just report that the site is open.
  async function resume(task) {
    Object.assign(S, { goal: task.goal, voice: !!task.voice, history: task.history || [], step: task.step || 0, active: true, invalidRetries: 0, rateRetries: 0, search: task.search || null });
    const my = ++S.token;
    let sidePanel = false;
    try { sidePanel = !!(await send({ type: 'koode:panelOpen' })).open; } catch (_) {}
    // With the side panel open, the in-page card stays minimised (the arrow carries the instruction).
    // Without a follow-up goal the next request is typed here, so the input takes focus.
    if (!sidePanel) panel.open({ noFocus: !!task.goal });
    panel.setGoal(task.goal);
    panel.log('resumed after page load');
    if (task.fresh) { task.fresh = false; persist(); panel.log('request carried over from the companion panel'); }
    panel.setState('loading');
    panel.setInstruction({ ml: 'പേജ് തുറക്കുന്നു, ഒരു നിമിഷം…', en: 'Waiting for the page to finish loading…' });
    const r = await K.ready.wait({
      cancelled: () => my !== S.token,
      onLogin: () => {
        // The QR code must stay fully visible: with the side panel open the instruction is shown there;
        // otherwise the in-page card moves away from the QR code.
        if (!sidePanel) {
          panel.open({ noFocus: true });
          const qr = Array.from(document.querySelectorAll('canvas, [data-ref], [data-testid*=qrcode]')).find((el) => extractor.isRendered(el));
          const box = qr && (qr.closest('[data-ref]') || qr).getBoundingClientRect();
          if (box) panel.avoid({ left: box.left - 40, top: box.top - 40, right: box.right + 40, bottom: box.bottom + 40, width: box.width + 80, height: box.height + 80 });
        }
        panel.setState('login');
        const ml = 'ആദ്യം WhatsApp-ൽ ലോഗിൻ ചെയ്യൂ: ഫോണിൽ WhatsApp തുറന്ന് "Linked devices" വഴി ഈ QR കോഡ് സ്കാൻ ചെയ്യൂ. ഞാൻ കാത്തിരിക്കാം.';
        panel.setInstruction({ ml, en: 'Log in to WhatsApp first: on your phone open WhatsApp → Linked devices and scan this QR code. I will wait.' });
        say(ml);
        progress({ login: true });
      }
    });
    if (my !== S.token) return;
    panel.log(`page ready check: ${r.reason} after ${r.waitedMs}ms`);
    if (!r.ok) return fail('WhatsApp login was not completed. Ask again when you are logged in.', 'WhatsApp ലോഗിൻ പൂർത്തിയായില്ല. ലോഗിൻ ചെയ്ത ശേഷം വീണ്ടും പറയൂ.');
    if (r.reason === 'timeout') {
      // The site's own interface never appeared (e.g. an unsupported-browser or error page): don't claim it is ready.
      S.active = false;
      persist();
      const site = here();
      panel.open({ noFocus: true });
      panel.setState('error');
      const ml = `${site?.ml || site?.name || 'പേജ്'} ശരിയായി തുറന്നില്ല. പേജിൽ എന്താണ് കാണിക്കുന്നതെന്ന് നോക്കൂ, അല്ലെങ്കിൽ റീലോഡ് ചെയ്യൂ.`;
      panel.setInstruction({ ml, en: `${site?.name || 'The page'} did not finish loading (it may be showing a message). Check the page or reload it.` });
      say(ml);
      progress({ notReady: true });
      return;
    }
    if (!task.goal) {
      // Opened without a follow-up goal: the site is ready; wait for the user's next request.
      S.active = false;
      persist();
      const site = here();
      panel.setState('idle');
      const ml = `${site?.ml || site?.name || 'പേജ്'} തുറന്നു. ഇനി എന്താണ് ചെയ്യേണ്ടത്?`;
      panel.setInstruction({ ml, en: `${site?.name || 'The page'} is open. What would you like to do next?` });
      say(ml);
      progress({ arrived: true });
      return;
    }
    // Koode opened YouTube results: if they are thin, search once more with the fallback query.
    if (S.search && (await maybeFallback(my))) return;
    if (my !== S.token) return;
    const p = task.pending;
    if (p && p.type === 'navigation') {
      if (location.href !== p.from) {
        if (p.on_target) record({ target_label: p.target_label, outcome: 'verified', action: 'click', evidence: 'navigation' });
        else record({ target_label: p.target_label, outcome: 'wrong_action', clicked_label: '(navigated elsewhere)', page_changed: true });
      }
    }
    plan({ type: 'page_loaded', after_navigation: !!p });
  }

  function stop(silent, noPersist) {
    S.token += 1;
    S.paused = false;
    S.voiceToken = (S.voiceToken || 0) + 1;
    voice.hush();
    S.active = false;
    S.snapHref = null;
    S.target = null;
    monitor.stop();
    overlay.clear();
    panel.setNotice('');
    if (!noPersist) persist();
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
    if (S.paused) { S.voiceToken = (S.voiceToken || 0) + 1; voice.hush(); guiding(); return; } // abandons a pending voice request and resumes the step
    const v = extractor.resolve(S.target.id);
    if (!v.ok) return plan({ type: 'target_lost', label: S.target.info.label });
    const r = S.target;
    overlay.point(v.anchor, { text: S.lastPlan.instruction_ml || S.lastPlan.instruction_en, step: S.step, lost: () => onLost(r), rect: (rect) => panel.avoid(rect) });
    panel.setInstruction({ ml: S.lastPlan.instruction_ml, en: S.lastPlan.instruction_en, explain: S.lastPlan.explanation_ml });
    panel.setNotice('');
    say(S.lastPlan.instruction_ml);
  }

  K.controller = { start, route, exit, stop, resume, repeat, micDown, micUp, confirmVoice, retryVoice, hasUnsavedInput, state: S };
})();
