# Koode — കൂടെ

Malayalam-first browser companion for people who know *what* they want to do on a web page but struggle with English-heavy interfaces.
Koode reads the visible page structure, points a live arrow at the **real** control, explains it in Malayalam, lets the **user** act,
verifies what changed on the page, and only then moves to the next step. It guides; it never clicks or types for the user.

This branch contains the first vertical slice (core browser-guidance loop). Voice and desktop automation are intentionally out of scope until this loop is proven.

## Layout

```
extension/   Chrome MV3 extension (no build step)
  src/content/extractor.js   visible DOM candidates, labels, privacy filter, snapshot-scoped IDs, resolve()
  src/content/overlay.js     arrow + highlight re-anchored to the live element every frame
  src/content/monitor.js     trusted user-action detection + evidence-based verification
  src/content/controller.js  observe → plan → validate → point → wait → verify → next / recover
  src/content/panel.js       floating assistant (closed shadow DOM), hold-to-talk mic button
  src/content/voice.js       push-to-talk recording (MediaRecorder) + playback of spoken replies
  src/background/service-worker.js  backend proxy, tab-scoped task state, toolbar activation
backend/     Node 20, zero runtime dependencies: /api/plan planner, /api/stt + /api/tts (Sarvam), /demo static server
  src/planner.js, prompt.js, safety.js, providers/{llm,mock,sarvam-speech}.js
demo-site/   fictional practice pages: form, settings layout A, settings layout B
tests/       unit (node --test) + real-Chrome E2E (playwright-core driving Chrome with the unpacked extension)
docs/        ARCHITECTURE.md, CONTRACTS.md
```

## Run

**Mac / judging:** use `scripts/start-judging.sh` (real Groq, mock impossible) or `scripts/start-rehearsal.sh` (labelled simulation, no Groq quota). Full steps, key storage in the Keychain, and the judging checklist: [`docs/DEMO.md`](docs/DEMO.md).

Manual start:

```bash
cd backend
GROQ_API_KEY=...  npm start           # Groq openai/gpt-oss-20b (default real planner)
# or OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY / SARVAM_API_KEY
# KOODE_REQUIRE_LLM=1 refuses to start without a real provider (no mock fallback)
# no key → deterministic MOCK test harness, labelled "MOCK test harness (not AI)" in the panel
SARVAM_API_KEY=... also enables voice: Saaras v4 speech-to-text and Bulbul v3 Malayalam replies
```

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `extension/`.
2. Open `http://localhost:8787/demo/` and pick a page.
3. Click the Koode bubble (bottom-right), type a goal, e.g. `ഈ ഫോം പൂരിപ്പിക്കാൻ സഹായിക്കൂ` or `Change this website to dark mode`.
   Or hold 🎤 (mouse, or Space/Enter when focused) and speak (Malayalam by default). Koode shows and reads back what it heard and waits for ✓ (edit the text to correct it); then the transcript goes to the same planner and Koode reads each step aloud. Typed goals get text-only replies.

Demo and real-microphone test procedure: [`docs/DEMO.md`](docs/DEMO.md).

The content script auto-loads on `localhost`/`127.0.0.1`. On other sites, click the Koode toolbar button to opt in for that tab (`activeTab`).

Optional env: `KOODE_PROVIDER`, `KOODE_MODEL`, `KOODE_LLM_TIMEOUT_MS`, `OPENAI_BASE_URL`, `GROQ_BASE_URL`, `KOODE_REASONING_EFFORT` (gpt-oss: low|medium|high, default low), `KOODE_REQUIRE_LLM=1`, `HOST` (default 127.0.0.1), `PORT`, `KOODE_LOG=0` (disable the sanitised audit log in `backend/logs/`), `KOODE_FAULT=stale_first` (test: first answer uses a stale ID). Voice: `KOODE_STT_MODEL` (default `saaras:v4`), `KOODE_STT_LANGUAGE` (default `ml-IN`), `KOODE_TTS_MODEL` (default `bulbul:v3`), `KOODE_TTS_SPEAKER`, `KOODE_SPEECH_TIMEOUT_MS`.

## Test

```bash
cd tests && npm install
npm run unit                                  # planner/safety unit tests
CHROME_PATH=/path/to/chrome npm run e2e -- --repeat 3   # backend must be running
```

E2E writes `artifacts/e2e/report.json` and screenshots per step (anchor error, arrow-tip distance, wrong-click outcome, privacy audit of planner payloads).

## Safety rules enforced in code

- Snapshots never contain input values, hidden nodes, or anything inside `[data-koode-private]`. Password/OTP/card/Aadhaar-like fields are marked `sensitive` and reduced to `filled`/`required`.
- The backend rebuilds every request from an allowlist and validates `target_id` against that request's candidates; the extension re-validates against the live DOM (stale, detached, hidden, disabled → replan).
- The model never supplies coordinates; the overlay reads `getBoundingClientRect()` of the resolved element.
- A step advances only on evidence from a trusted user event: DOM/URL change after a click, valid filled field, changed checked/selected state. A click with no change is not success.
- Page text is passed to the model as untrusted data.
- `SARVAM_API_KEY` and all model keys stay in the backend; the extension only talks to the local backend. Transcripts and spoken text are not printed to the console (lengths only).
