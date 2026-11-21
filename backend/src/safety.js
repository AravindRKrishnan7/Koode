// Server-side allowlist sanitiser. Rebuilds the request from known-safe fields
// only, so anything unexpected (e.g. a `value` field) never reaches the model.
import { redact } from './goals.js';
const MAX_CANDIDATES = 150;
const MAX_HISTORY = 12;

const str = (v, max = 80) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const num = (v) => (Number.isFinite(v) ? Math.round(v) : undefined);

const STATE_BOOL_KEYS = ['disabled', 'required', 'checked', 'filled', 'valid', 'has_selection'];
const STATE_MIXED_KEYS = ['expanded', 'selected', 'pressed', 'current'];

function prune(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function sanitizeState(s) {
  const out = {};
  if (!s || typeof s !== 'object') return out;
  for (const k of STATE_BOOL_KEYS) out[k] = bool(s[k]);
  for (const k of STATE_MIXED_KEYS) out[k] = typeof s[k] === 'boolean' ? s[k] : str(s[k], 20);
  return prune(out);
}

function sanitizeCandidate(c) {
  if (!c || typeof c.id !== 'string') return null;
  const sensitive = c.sensitive === true;
  const out = prune({
    id: str(c.id, 24),
    role: str(c.role, 24),
    tag: str(c.tag, 16),
    type: str(c.type, 16),
    // Personal numbers that a page shows in a label (a licence or application number) never reach the model.
    label: c.label === undefined ? undefined : redact(str(c.label) || '').text,
    section: str(c.section, 60),
    state: sanitizeState(c.state),
    sensitive: sensitive || undefined,
    in_viewport: bool(c.in_viewport),
    bbox: c.bbox ? prune({ x: num(c.bbox.x), y: num(c.bbox.y), w: num(c.bbox.w), h: num(c.bbox.h) }) : undefined,
    options: Array.isArray(c.options) && !sensitive ? c.options.slice(0, 40).map((o) => str(o, 40)).filter(Boolean) : undefined
  });
  if (sensitive) out.state = prune({ filled: out.state.filled, required: out.state.required, disabled: out.state.disabled });
  return out;
}

export function sanitizePlanRequest(body) {
  if (!body || typeof body !== 'object') throw new Error('invalid body');
  // Personal numbers in the goal (phone, Aadhaar, licence…) are replaced before the model sees it;
  // the extension redacts too, this is the second line of defence.
  const goal = str(body.goal, 300) && redact(str(body.goal, 300)).text;
  if (!goal) throw new Error('goal required');
  const snap = body.snapshot || {};
  const candidates = (Array.isArray(snap.candidates) ? snap.candidates : []).slice(0, MAX_CANDIDATES).map(sanitizeCandidate).filter(Boolean);
  const context = (Array.isArray(snap.context) ? snap.context : []).slice(0, 20)
    .map((c) => prune({ kind: str(c && c.kind, 12), text: str(c && c.text, 120) && redact(str(c && c.text, 120)).text })).filter((c) => c.text);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_HISTORY).map((h) => prune({
    step: num(h.step), target_label: str(h.target_label), role: str(h.role, 24), action: str(h.action, 12),
    outcome: str(h.outcome, 24), evidence: str(h.evidence, 24), clicked_label: str(h.clicked_label), page_changed: bool(h.page_changed)
  }));
  const ev = body.last_event && typeof body.last_event === 'object' ? body.last_event : null;
  const last_event = ev ? prune({ type: str(ev.type, 24), label: str(ev.label), clicked_label: str(ev.clicked_label), reason: str(ev.reason, 40), target_id: str(ev.target_id, 24), evidence: str(ev.evidence, 24), page_changed: bool(ev.page_changed), alert: bool(ev.alert) }) : null;
  // TASK_HINT: the route for a verified service, from Koode's catalogue (not from the page).
  const task_hint = str(body.task_hint, 400) && redact(str(body.task_hint, 400)).text;
  return {
    goal,
    task_hint: task_hint || undefined,
    snapshot: {
      snapshot_id: str(snap.snapshot_id, 16),
      origin: str(snap.origin, 120),
      path: str(snap.path, 200),
      title: str(snap.title, 100),
      viewport: snap.viewport ? prune({ w: num(snap.viewport.w), h: num(snap.viewport.h) }) : undefined,
      candidates,
      context,
      popup: snap.popup === true || undefined
    },
    history,
    last_event
  };
}

const STATUSES = new Set(['guide', 'done', 'ask', 'cannot_find']);

// Validates model output against the candidate list it was given.
export function validatePlan(plan, req) {
  if (!plan || typeof plan !== 'object') return { ok: false, reason: 'not_an_object' };
  if (!STATUSES.has(plan.status)) return { ok: false, reason: 'bad_status' };
  const out = {
    status: plan.status,
    target_id: plan.status === 'guide' ? str(plan.target_id, 24) : null,
    instruction_ml: str(plan.instruction_ml, 300) || '',
    instruction_en: str(plan.instruction_en, 300) || '',
    explanation_ml: str(plan.explanation_ml, 300) || '',
    expected_observation: str(plan.expected_observation, 200) || '',
    confidence: typeof plan.confidence === 'number' ? Math.max(0, Math.min(1, plan.confidence)) : null
  };
  if (out.status === 'guide') {
    const ids = new Set(req.snapshot.candidates.map((c) => c.id));
    if (!out.target_id || !ids.has(out.target_id)) return { ok: false, reason: 'unknown_target_id', plan: out };
    const c = req.snapshot.candidates.find((x) => x.id === out.target_id);
    if (c.state && c.state.disabled) return { ok: false, reason: 'disabled_target', plan: out };
  }
  return { ok: true, plan: out };
}
