// DETERMINISTIC TEST HARNESS — NOT AI. Keyword/heuristic planner used only for
// offline tests or when no model key is configured. Responses are labelled
// `mock: true` and the extension shows "MOCK test harness (not AI)".

const SYNONYMS = {
  dark: ['dark', 'night', 'theme', 'appearance', 'display', 'settings', 'preferences', 'menu'],
  form: ['name', 'birth', 'mobile', 'phone', 'district', 'card', 'password', 'otp', 'agree', 'submit', 'apply']
};

function isDone(req) {
  return req.snapshot.context.some((c) => /success|submitted|is on|applied|enabled/i.test(c.text));
}

function textFieldPending(c) {
  return c.role === 'textbox' && c.state && c.state.required && (!c.state.filled || c.state.valid === false);
}

export function mockPlan(req) {
  const { candidates } = req.snapshot;
  const goal = req.goal.toLowerCase();
  if (isDone(req)) return { status: 'done', instruction_en: 'Done (mock).', instruction_ml: 'കഴിഞ്ഞു (mock).' };
  const wantsDark = /dark|night|theme|ഇരുണ്ട|ഡാർക്ക്/.test(goal);
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
