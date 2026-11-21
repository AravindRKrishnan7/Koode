// Guidance state machine:
// observe → plan (backend) → validate ID → point → wait for user → verify → next.
(() => {
  const K = (globalThis.Koode = globalThis.Koode || {});
  if (K.started) return; // already injected on this page
  const C = K.constants;
  const { extractor, overlay, monitor, panel } = K;

  const S = { goal: '', history: [], step: 0, target: null, lastPlan: null, token: 0, invalidRetries: 0, active: false };

  const send = (msg) => chrome.runtime.sendMessage(msg);

  function persist(extra = {}) {
    const task = S.active ? { goal: S.goal, history: S.history.slice(-20), step: S.step, url: location.href, ...extra } : null;
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
    if (S.step >= C.MAX_STEPS) return fail('Too many steps; stopping to avoid a loop.');
    const snap = extractor.snapshot();
    panel.log(`snapshot ${snap.snapshot_id}: ${snap.candidates.length} candidates`);
    const t0 = performance.now();
    let resp;
    try {
      resp = await send({ type: 'koode:plan', payload: { goal: S.goal, snapshot: snap, history: S.history.slice(-12), last_event: lastEvent || null } });
    } catch (e) {
      resp = { error: String(e && e.message || e) };
    }
    if (my !== S.token || !S.active) return;
    const ms = Math.round(performance.now() - t0);
    if (!resp || resp.error) return fail('Planner unavailable: ' + (resp && resp.error || 'no response'));
    if (resp.planner) panel.setPlanner(resp.planner.model || resp.planner.provider, resp.planner.mock);
    panel.log(`plan ${resp.status} ${resp.target_id || ''} in ${ms}ms (${resp.planner ? resp.planner.provider : '?'})`);
    S.lastPlan = resp;

    if (resp.status === 'done') {
      panel.setState('done');
      panel.setInstruction({ ml: resp.instruction_ml || 'എല്ലാം കഴിഞ്ഞു!', en: resp.instruction_en || 'All done.', explain: resp.explanation_ml });
      panel.setStep(S.step, '');
      S.active = false;
      persist();
      return;
    }
    if (resp.status !== 'guide') {
      panel.setState('idle');
      panel.setInstruction({ ml: resp.instruction_ml, en: resp.instruction_en || 'I could not find a matching control on this page.', explain: resp.explanation_ml });
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

  function show(resp, r) {
    S.target = r;
    const sensitiveNote = r.info.sensitive ? ' 🔒 ഇത് സ്വകാര്യമാണ് — Koode ഇത് വായിക്കില്ല. നിങ്ങൾ തന്നെ ടൈപ്പ് ചെയ്യൂ.' : '';
    panel.setState('waiting');
    panel.setStep(S.step, r.info.label);
    panel.setInstruction({ ml: (resp.instruction_ml || '') + sensitiveNote, en: resp.instruction_en, explain: resp.explanation_ml });
    overlay.point(r.anchor, {
      text: resp.instruction_ml || resp.instruction_en,
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
    overlay.point(r.anchor, { text: `"${r.info.label}"`, lost: () => onLost(r), rect: (rect) => panel.avoid(rect) });
  }

  function fail(msg) {
    monitor.stop();
    overlay.clear();
    panel.setState('error');
    panel.setInstruction({ ml: 'ക്ഷമിക്കണം, ഒരു പ്രശ്നം ഉണ്ടായി.', en: msg });
    panel.log('ERROR ' + msg);
  }

  function start(goal) {
    stop(true);
    Object.assign(S, { goal, history: [], step: 0, active: true, invalidRetries: 0 });
    panel.setGoal(goal);
    panel.log(`goal set (${goal.length} chars)`);
    persist();
    plan({ type: 'goal_set' });
  }

  function resume(task) {
    Object.assign(S, { goal: task.goal, history: task.history || [], step: task.step || 0, active: true, invalidRetries: 0 });
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
    S.active = false;
    S.target = null;
    monitor.stop();
    overlay.clear();
    persist();
    if (!silent) {
      panel.setState('stopped');
      panel.setInstruction({ ml: 'നിർത്തി. വീണ്ടും വേണമെങ്കിൽ ലക്ഷ്യം എഴുതൂ.', en: 'Stopped. Type a goal to start again.' });
      panel.log('stopped by user');
    }
  }

  function repeat() {
    if (!S.target || !S.lastPlan) return;
    const v = extractor.resolve(S.target.id);
    if (!v.ok) return plan({ type: 'target_lost', label: S.target.info.label });
    const r = S.target;
    overlay.point(v.anchor, { text: S.lastPlan.instruction_ml || S.lastPlan.instruction_en, lost: () => onLost(r), rect: (rect) => panel.avoid(rect) });
    panel.setInstruction({ ml: S.lastPlan.instruction_ml, en: S.lastPlan.instruction_en, explain: S.lastPlan.explanation_ml });
  }

  K.controller = { start, stop, resume, repeat, state: S };
})();
