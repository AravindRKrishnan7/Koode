# Koode architecture (core guidance loop)

```
user goal ─▶ extractor.snapshot() ─▶ background SW ─▶ backend /api/plan ─▶ LLM (or labelled mock)
                 (visible candidates,                    sanitise ▶ prompt ▶ parse ▶ validate id
                  temp IDs, no values)                                     │
   ┌─────────────────────────────────────────────────────────────────────────┘
   ▼
extractor.resolve(id)  ── stale/unknown/hidden/disabled ─▶ re-snapshot + replan (max 2)
   │ ok
   ▼
overlay.point(anchor)   ring + arrow re-measured every animation frame (scroll/resize/layout)
monitor.watch(target)   trusted user events only
   ├─ click on target  ─▶ wait for DOM/URL signature change ─▶ verified | "nothing changed"
   ├─ fill target      ─▶ filled && validity.valid on change/blur ─▶ verified | "format"
   ├─ check / select   ─▶ checked / selection state changed ─▶ verified
   └─ click elsewhere  ─▶ wrong_action (page unchanged: re-point; changed: replan)
verified ─▶ history += step ─▶ next snapshot + plan … until planner says "done"
```

## Module ownership (one owner per directory — avoid editing the same files in parallel)

| Path | Responsibility | Suggested owner |
|---|---|---|
| `extension/src/content/extractor.js` | DOM candidates, labels, privacy filter, ID registry, `resolve()` | Devin |
| `extension/src/content/overlay.js` | Arrow/highlight anchored to live rect | Devin |
| `extension/src/content/monitor.js` | User action detection + evidence-based verification | Devin / Codex review |
| `extension/src/content/controller.js` | State machine, recovery, persistence across navigation | Devin |
| `extension/src/content/panel.js` | Floating UI (closed shadow DOM) | Devin |
| `extension/src/background/service-worker.js` | Backend proxy, tab-scoped task storage, toolbar opt-in injection | Devin |
| `backend/src/planner.js`, `prompt.js`, `providers/` | Planner API, prompts, model adapters, future Sarvam STT/TTS adapters | Claude Code |
| `backend/src/safety.js` | Server-side allowlist sanitiser + output validation | Codex review |
| `tests/` | Unit + real-Chrome E2E | Codex |
| `demo-site/` | Safe practice pages | Devin |

Content scripts share the isolated-world global `Koode` (no bundler). Each module exposes one object: `Koode.extractor`, `Koode.overlay`, `Koode.monitor`, `Koode.panel`, `Koode.controller`.

See `docs/CONTRACTS.md` for the data contracts.
