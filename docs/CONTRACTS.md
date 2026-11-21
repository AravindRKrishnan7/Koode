# Data contracts

## POST /api/plan (extension → backend)

```jsonc
{
  "goal": "Change this website to dark mode",
  "snapshot": {
    "snapshot_id": "s4",                       // IDs below are only valid for this snapshot
    "origin": "http://localhost:8787", "path": "/demo/settings.html", "title": "ShopEasy — My account",
    "viewport": { "w": 1280, "h": 800 },
    "candidates": [
      { "id": "s4_7", "role": "radio", "tag": "input", "type": "radio", "label": "Dark", "section": "Theme",
        "state": { "checked": false }, "in_viewport": true, "bbox": { "x": 912, "y": 240, "w": 13, "h": 13 } },
      { "id": "s4_9", "role": "textbox", "label": "Create account password *", "sensitive": true,
        "state": { "filled": false, "required": true } }
    ],
    "context": [{ "kind": "status", "text": "Dark theme is on." }]   // headings/status, untrusted
  },
  "history": [{ "step": 1, "target_label": "Settings", "action": "click", "outcome": "verified", "evidence": "dom_change" },
              { "step": 2, "target_label": "Appearance", "outcome": "wrong_action", "clicked_label": "Deals", "page_changed": false }],
  "last_event": { "type": "step_verified" }    // goal_set | step_verified | wrong_action | invalid_target | target_lost | page_loaded
}
```

Never present: input/textarea values, contenteditable text, selected option of a select, hidden or `aria-hidden` nodes,
anything inside `[data-koode-private]`/`[data-private]`. Text fields are reduced to `filled` / `valid` booleans.
The backend rebuilds the request from an allowlist (`backend/src/safety.js`) so unexpected fields are dropped.

## Response (backend → extension)

```jsonc
{ "status": "guide",            // guide | done | ask | cannot_find
  "target_id": "s4_7",          // validated server-side ∈ candidates; re-validated client-side against live DOM
  "instruction_ml": "…", "instruction_en": "Click \"Dark\".", "explanation_ml": "…",
  "expected_observation": "Theme changes to dark", "confidence": 0.9,
  "planner": { "provider": "openai", "model": "gpt-4o-mini", "mock": false }, "latency_ms": 900, "attempts": 1 }
```

The verifiable action (click / fill / check / select) is derived from the element itself in `monitor.js`, not from the model.

## POST /api/stt and /api/tts (extension → backend → Sarvam)

Voice is optional (`/health` reports `"voice": true` and `"speech": "sarvam"` when `SARVAM_API_KEY` is set, or `"speech": "mock"` with `KOODE_SPEECH=mock`: a labelled offline stand-in for tests that returns transcripts queued via `POST /test/stt-queue` (local clients only) and a chime for replies). The key never leaves the backend.

```jsonc
// /api/stt  request: push-to-talk clip (≤ 25 s), base64     response:
{ "audio": "<base64>", "mime": "audio/webm" }               { "transcript": "…", "language_code": "ml-IN", "model": "saaras:v4", "latency_ms": 1200 }
// /api/tts  request: text ≤ 500 chars                       response: base64 WAV
{ "text": "…", "lang": "ml-IN" }                            { "audio": "<base64>", "mime": "audio/wav", "model": "bulbul:v3", "latency_ms": 900 }
```

The transcript is used as the goal for `/api/plan`, exactly like typed text. Spoken replies play only for voice-started tasks.
