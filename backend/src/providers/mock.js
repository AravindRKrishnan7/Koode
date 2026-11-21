// DETERMINISTIC TEST HARNESS — NOT AI. Keyword/heuristic planner used only for
// offline tests or when no model key is configured. Responses are labelled
// `mock: true` and the extension shows "MOCK test harness (not AI)".

const SYNONYMS = {
  dark: ['dark', 'night', 'theme', 'appearance', 'display', 'settings', 'preferences', 'menu'],
  form: ['name', 'birth', 'mobile', 'phone', 'district', 'card', 'password', 'otp', 'agree', 'submit', 'apply']
};

function isDone(req) {
  return req.snapshot.context.some((c) => /success|submitted|recorded|is on|applied|enabled/i.test(c.text));
}

function textFieldPending(c) {
  return c.role === 'textbox' && c.state && c.state.required && (!c.state.filled || c.state.valid === false);
}

export function mockPlan(req) {
  const { candidates } = req.snapshot;
  const goal = req.goal.toLowerCase();
  if (isDone(req)) return { status: 'done', instruction_en: 'Done (mock).', instruction_ml: 'കഴിഞ്ഞു (mock).' };
  // Verified service: follow the catalogue route (quoted labels in TASK_HINT), first step not yet done.
  if (req.task_hint) {
    const route = [...req.task_hint.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const doneLabels = req.history.filter((h) => h.outcome === 'verified').map((h) => (h.target_label || '').trim().toLowerCase());
    // Route progress: steps after the last route step the user completed.
    let from = 0;
    route.forEach((want, i) => { const w = want.toLowerCase(); if (doneLabels.some((l) => l === w || l.startsWith(w))) from = i + 1; });
    const usable = (x) => !x.state.disabled && !(/textbox|searchbox/.test(x.role) && x.state.filled) && !doneLabels.includes((x.label || '').trim().toLowerCase());
    for (const want of route.slice(from).concat(route.slice(0, from))) {
      const w = want.toLowerCase();
      const lab = (x) => (x.label || '').trim().toLowerCase();
      const c = candidates.find((x) => x.role === 'combobox' && (x.options || []).some((o) => o.toLowerCase() === w) && !x.state.has_selection) ||
        candidates.find((x) => usable(x) && lab(x) === w) || candidates.find((x) => usable(x) && lab(x).startsWith(w)) || candidates.find((x) => usable(x) && lab(x).includes(w));
      if (c) return { status: 'guide', target_id: c.id, instruction_en: `[mock] Use "${c.label}" (${want}).`, instruction_ml: `[mock] "${c.label}" ഉപയോഗിക്കൂ.`, expected_observation: 'route step', confidence: 0.5 };
    }
    const close = req.snapshot.popup && candidates.find((x) => /^(×|x|close|skip|ok|cancel|continue)$/i.test((x.label || '').trim()));
    if (close) return { status: 'guide', target_id: close.id, instruction_en: `[mock] Close the popup with "${close.label}".`, instruction_ml: `[mock] "${close.label}" അമർത്തി പോപ്പ്-അപ്പ് അടയ്ക്കൂ.`, expected_observation: 'popup closes', confidence: 0.5 };
    return { status: 'cannot_find', instruction_en: 'Mock harness found no route step on this page.', instruction_ml: 'വഴി കണ്ടില്ല (mock).' };
  }
  // YouTube results opened by Koode's search: the goal quotes the query; point at the result whose
  // title shares the most words with it (Malayalam or English).
  if (/^\/results/.test(req.snapshot.path || '')) {
    const q = (req.goal.match(/"([^"]+)"/) || [])[1] || req.goal;
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const best = candidates.filter((c) => c.role === 'link' && c.label)
      .map((c) => [words.filter((w) => c.label.toLowerCase().includes(w)).length, c]).filter(([n]) => n > 0)
      .sort((a, b) => b[0] - a[0])[0];
    if (best) return { status: 'guide', target_id: best[1].id, instruction_en: `[mock] Open the video "${best[1].label}".`, instruction_ml: `[mock] "${best[1].label}" എന്ന വീഡിയോ തുറക്കൂ.`, expected_observation: 'video page', confidence: 0.5 };
    return { status: 'cannot_find', instruction_en: 'Mock harness found no matching video.', instruction_ml: 'പൊരുത്തമുള്ള വീഡിയോ കണ്ടില്ല (mock).' };
  }
  const wantsDark = /dark|night|theme|ഇരുണ്ട|ഡാർക്ക്/.test(goal);
  const search = goal.match(/(?:search|find|look)(?: for)?\s+(?:an? |the )?(.+)|(.+?)\s*(?:തിരയ|കണ്ടെത്ത)/);
  if (search && !wantsDark) {
    if (/^\/watch/.test(req.snapshot.path || '')) return { status: 'done', instruction_en: 'Video opened (mock).', instruction_ml: 'വീഡിയോ തുറന്നു (mock).' };
    const words = (search[1] || search[2] || '').replace(/\b(video|tutorial|on|about|how to)\b/g, ' ').split(/\s+/).filter((w) => w.length > 2);
    const box = candidates.find((c) => /searchbox|combobox|textbox/.test(c.role) && /search|തിരയ/i.test(c.label + ' ' + (c.placeholder || '')));
    const result = candidates.find((c) => c.role === 'link' && words.length && words.every((w) => (c.label || '').toLowerCase().includes(w)));
    const btn = candidates.find((c) => c.role === 'button' && /^search$|^തിരയ/i.test(c.label || ''));
    const pickS = result || (box && !box.state.filled ? box : btn || box);
    if (pickS) return { status: 'guide', target_id: pickS.id, instruction_en: `[mock] Use "${pickS.label}".`, instruction_ml: `[mock] "${pickS.label}" ഉപയോഗിക്കൂ.`, expected_observation: 'state change', confidence: 0.5 };
  }
  let pick = null;
  if (wantsDark) {
    const words = SYNONYMS.dark;
    const score = (c) => {
      const l = (c.label || '').toLowerCase();
      if (/^(dark|night mode)/.test(l) && !c.state.checked) return 100;
      return words.reduce((s, w, i) => s + (l.includes(w) ? 50 - i * 4 : 0), 0) - (c.state.selected || c.state.expanded || c.state.checked ? 40 : 0);
    };
    pick = candidates.map((c) => [score(c), c]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0])[0]?.[1];
  } else {
    pick =
      candidates.find(textFieldPending) ||
      candidates.find((c) => c.role === 'combobox' && c.state.required && !c.state.has_selection) ||
      candidates.find((c) => c.role === 'radio' && c.state.required && !candidates.some((o) => o.role === 'radio' && o.section === c.section && o.state.checked)) ||
      candidates.find((c) => c.role === 'checkbox' && c.state.required && !c.state.checked) ||
      candidates.find((c) => c.role === 'button' && /submit|apply/i.test(c.label));
  }
  if (!pick) return { status: 'cannot_find', instruction_en: 'Mock harness found nothing.', instruction_ml: 'ഒന്നും കണ്ടില്ല (mock).' };
  return {
    status: 'guide',
    target_id: pick.id,
    instruction_en: `[mock] Use "${pick.label}".`,
    instruction_ml: `[mock] "${pick.label}" ഉപയോഗിക്കൂ.`,
    expected_observation: 'state change',
    confidence: 0.5
  };
}
