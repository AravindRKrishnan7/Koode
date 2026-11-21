// Grounded step planner: sanitise → prompt model → parse → validate ID.
// Unknown IDs get one corrective retry; never returns an unvalidated target.
import { SYSTEM_PROMPT, buildUserMessage, extractJson } from './prompt.js';
import { sanitizePlanRequest, validatePlan } from './safety.js';
import { complete } from './providers/llm.js';
import { mockPlan } from './providers/mock.js';

export async function planStep(body, cfg, { llm = complete } = {}) {
  const req = sanitizePlanRequest(body);
  const planner = { provider: cfg.provider, model: cfg.model, mock: cfg.provider === 'mock' };
  const started = Date.now();

  if (planner.mock) {
    const v = validatePlan(mockPlan(req), req);
    return { req, result: { ...(v.ok ? v.plan : { status: 'cannot_find' }), planner, latency_ms: Date.now() - started, attempts: 1 } };
  }

  let user = buildUserMessage(req);
  let lastReason = '';
  let giveUp = null; // first valid ask/cannot_find, kept in case the reconsidered answer is invalid
  const meta = { rateLimitWaitMs: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await llm(cfg, SYSTEM_PROMPT, user, meta);
    const parsed = extractJson(raw);
    const v = validatePlan(parsed, req);
    // A premature give-up is the commonest real-model miss (e.g. settings hidden behind a gear/menu): reconsider once.
    // "ask" is the same miss phrased as a question ("where is the dark mode option?").
    if (v.ok && (v.plan.status === 'cannot_find' || v.plan.status === 'ask') && attempt === 1 && req.snapshot.candidates.length) {
      giveUp = v.plan;
      user = buildUserMessage(req) + `\n\nYou answered ${v.plan.status}. Re-check CANDIDATES: if any menu/settings/account/tab/icon control could plausibly lead toward the goal, guide to it; otherwise answer ${v.plan.status} again.`;
      continue;
    }
    if (v.ok) return { req, raw, result: { ...v.plan, planner, latency_ms: Date.now() - started, rate_limit_wait_ms: meta.rateLimitWaitMs, tokens: meta.tokens, attempts: attempt } };
    if (giveUp) return { req, raw, result: { ...giveUp, planner, latency_ms: Date.now() - started, rate_limit_wait_ms: meta.rateLimitWaitMs, tokens: meta.tokens, attempts: attempt, rejected: v.reason } };
    lastReason = v.reason;
    user = buildUserMessage(req) + `\n\nYour previous answer was rejected (${v.reason}). Return valid JSON and copy target_id exactly from CANDIDATES.`;
  }
  return { req, result: { status: 'cannot_find', target_id: null, instruction_en: 'Planner returned an invalid target (' + lastReason + ').', instruction_ml: 'ശരിയായ ഘടകം കണ്ടെത്താനായില്ല.', planner, latency_ms: Date.now() - started, rate_limit_wait_ms: meta.rateLimitWaitMs, tokens: meta.tokens, attempts: 2, rejected: lastReason } };
}
