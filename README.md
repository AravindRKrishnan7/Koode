# Koode — കൂടെ

**A Malayalam-first voice companion for the web.** You say what you want to do in Malayalam. Koode finds the right
place to do it, points a live arrow at the real control, explains it in Malayalam, waits for **you** to act, checks
that the page actually changed, and then shows the next step.

*Koode guides; it never clicks, types, logs in, pays or submits for you.*

Built for people in Kerala who know *what* they need online (a video to learn from, a licence detail, a form) but
get lost in English-heavy websites.

---

## What Koode can do

| | Capability | Example (say it in the side panel) |
|---|---|---|
| 🎤 | **Malayalam voice in and out.** Push-to-talk speech-to-text (Sarvam Saaras v4) and spoken Malayalam replies (Sarvam Bulbul v3). Every transcript is shown for confirmation or correction before anything happens. | *hold the mic, speak, release, press ✓* |
| 🎯 | **Live, DOM-grounded guidance.** Koode reads the visible page structure, an LLM (Groq `openai/gpt-oss-20b`) picks one real control from that list, and the extension re-validates it against the live page. The arrow follows the element on scroll and resize. Each step advances only on evidence from the user's own action; wrong clicks are noticed and corrected. | `ഈ ഫോം പൂരിപ്പിക്കാൻ സഹായിക്കൂ` ("help me fill this form") |
| ▶️ | **Goal-driven YouTube learning.** Arbitrary learning requests become safe, Malayalam-first YouTube searches. Koode opens the results directly, falls back to an English query (keeping Malayalam content) when results are thin, and points at a relevant video. | `സോളാർ പാനൽ ഇൻസ്റ്റലേഷൻ വീഡിയോകൾ` ("solar panel installation videos") · `എനിക്ക് തെങ്ങ് കയറാൻ പഠിക്കണം` ("I want to learn coconut-tree climbing") |
| 🏛️ | **Verified government services.** Koode recognises a service, offers the official site or a Malayalam tutorial, confirms before opening it, and then guides step by step on the real site. Starts with **Sarathi Parivahan** (driving licence services), whose address was verified against parivahan.gov.in. | `എനിക്ക് ഡ്രൈവിംഗ് ലൈസൻസ് വിവരങ്ങൾ അറിയണം` ("I want my driving licence details") → 1) official website 2) tutorial |
| 🧭 | **Everyday sites.** Opens WhatsApp Web (it waits while you scan the QR code and never reads chats) and YouTube, guides Google Forms respondent pages you open from a link (never the form editor), and ends the session by voice. | `വാട്സ്ആപ്പ് തുറക്കൂ` ("open WhatsApp") · `നിർത്താം` ("let's stop") |

A request for a government service that has **no verified entry** (e.g. ration card) gets a clear "official
website not verified" answer. Koode never guesses a site and never redirects there automatically; a tutorial is
only offered as a button.

## Privacy and safety (enforced in code)

- **Personal numbers are removed before anything leaves the browser.** Aadhaar, phone, licence, PAN, vehicle and
  card numbers, email and OTP become `[PHONE]`, `[DL_NUMBER]` and so on, and Koode says what it removed. The backend
  redacts again.
- **Input values are never read.** Snapshots carry only "filled / valid" flags. Password, OTP, captcha, licence and
  application-number fields are marked sensitive: the user types them. Chats on WhatsApp are never extracted.
- **The model never supplies a URL or coordinates.** It can pick a control ID from Koode's own list, a plain-text
  search query (URLs, domains, operators and unsafe topics are stripped), or a verified catalogue ID. Code builds
  every URL and re-checks every target on the live page.
- **Official sites need confirmation and per-site permission.** Before opening one, Koode shows a card with the
  operator, the exact host and the verification date. Chrome then asks for access to *that one host* (optional
  host permission). If the tab leaves the official host mid-task, guidance pauses: *"ഇത് ഔദ്യോഗിക സൈറ്റ് അല്ല"*
  ("this is not the official site").
- **Hand-off before sensitive steps.** Koode pauses with "check your details" before submit, pay or OTP steps.
  After "Generate OTP" it stops reading the page, so personal results are never sent to a model.
- **API keys stay in the local backend.** The extension only talks to `localhost`, and the backend refuses API
  calls from web pages. Self-harm requests get a helpline answer (Tele-MANAS 14416, 112) with no search and no
  model call.

## How it works

```
 Chrome side panel / in-page card                       Local backend (Node 20, zero dependencies)
 ───────────────────────────────                        ──────────────────────────────────────────
 🎤 voice ─▶ /api/stt ─────────────────────────────────▶ Sarvam Saaras v4 (speech → text)
 confirm transcript ✓
   │
   ├─ redact personal numbers (goals.js)
   ├─ rule router (sites.js, catalogue.js) — no model
   │     exit · open site · video search · verified service · guide this page
   └─ open-ended request ─▶ /api/intent ───────────────▶ Groq LLM → strict JSON, validated
                                                         (query or catalogue id only, never a URL)
 service worker builds the URL (YouTube results / catalogue entry), asks Chrome for per-host access
   │
 page: snapshot of visible controls (no values) ─▶ /api/plan ─▶ Groq LLM picks ONE candidate id
   ◀── validated id ◀──────────────────────────────── sanitised request, id checked server-side
 arrow on the live element ─▶ user acts ─▶ evidence (DOM / URL change, field valid) ─▶ next step
 spoken Malayalam replies ◀── /api/tts ◀────────────── Sarvam Bulbul v3
```

| Path | Role |
|---|---|
| `extension/src/sidepanel/` | Side panel: voice dock, transcript confirmation, choice and confirmation cards, progress, Continue / Retry / Stop |
| `extension/src/content/` | Extractor (visible controls, privacy filter, popup detection), overlay (arrow), monitor (verification), controller (state machine), in-page card |
| `extension/src/shared/` | `goals.js` (redaction, query safety, intent schema), `sites.js` (routing), `catalogue.js` (verified services) |
| `extension/src/background/service-worker.js` | Backend proxy, navigation broker, per-host permissions, origin guard |
| `backend/src/` | `/api/plan`, `/api/intent`, `/api/stt`, `/api/tts`; sanitiser and validators; Groq / Sarvam adapters; labelled mocks |
| `demo-site/` | Safe practice pages (application form, settings layouts) served at `/demo/` |

Details: [`docs/CONTRACTS.md`](docs/CONTRACTS.md) · [`docs/COMPANION.md`](docs/COMPANION.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DEMO.md`](docs/DEMO.md)

## Real AI vs. mock testing

| Mode | Command | Planner / intent | Voice | Uses API credits | Shown in the panel |
|---|---|---|---|---|---|
| **Judging (real)** | `scripts/start-judging.sh` | Groq `openai/gpt-oss-20b` | Sarvam (real) | Yes | `model: openai/gpt-oss-20b` |
| Rehearsal | `scripts/start-rehearsal.sh` | **Mock** (scripted, not AI) | Sarvam if its key is stored | Sarvam only | red **MOCK planner (not AI)** |
| Tests | `KOODE_PROVIDER=mock KOODE_SPEECH=mock` | **Mock** | **Mock** (queued transcripts, chime replies) | None | **MOCK planner · MOCK speech** |

Mocks are always labelled in the UI and in `/health`. Judging mode refuses to start without both keys and refuses
mock speech. The E2E runners refuse to run against real Groq or Sarvam unless explicitly allowed.

## Install and run (macOS, about 5 minutes)

**Requirements:** Node.js 20+, Google Chrome 116+, a Groq API key and a Sarvam API key for real mode.
**The Chrome extension needs the local backend running:** without it the panel shows *"Koode backend is not running"*.

```bash
git clone https://github.com/AravindRKrishnan7/Koode.git ~/Koode
cd ~/Koode            # main = final submission

# Store keys in the macOS Keychain. You paste each key at a hidden prompt; it is never written to a file,
# shell history or the repo.
security add-generic-password -a "$USER" -s koode-groq   -w
security add-generic-password -a "$USER" -s koode-sarvam -w

scripts/start-judging.sh     # real Groq + Sarvam on http://localhost:8787 (wait for "JUDGING MODE OK")
```

Then in Chrome:

1. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select `~/Koode/extension`
   (version 0.5.1). Pin **Koode — കൂടെ**.
2. Click the Koode toolbar icon to open the side panel (it works on any tab, including New Tab). On the first mic
   press, allow the microphone (if Chrome can't ask inside the side panel, use the **Allow microphone** button).

<details><summary>Other systems / manual start</summary>

The scripts read keys from the Keychain, an already-exported environment variable, or a hidden prompt. Manual start
without putting keys on the command line:

```bash
cd ~/Koode/backend
read -rs GROQ_API_KEY && export GROQ_API_KEY       # paste, Enter (hidden)
read -rs SARVAM_API_KEY && export SARVAM_API_KEY
KOODE_PROVIDER=groq KOODE_REQUIRE_LLM=1 npm start   # listens on 127.0.0.1:8787 only
```
</details>

## Demo for judges (about 3 minutes)

All of these happen in the side panel. Hold the mic, speak, release, and press **✓** to confirm what Koode heard.

1. **Learning:** `സോളാർ പാനൽ ഇൻസ്റ്റലേഷൻ വീഡിയോകൾ`. YouTube results open directly in Malayalam, an arrow
   points at a relevant video, you open it, and Koode confirms.
2. **Government service:** `എനിക്ക് ഡ്രൈവിംഗ് ലൈസൻസ് വിവരങ്ങൾ അറിയണം`. Two cards appear; say `ഒന്ന്` (one).
   The official-site card shows the operator, host and verification date. Press **✓** and allow Chrome access to
   `sarathi.parivahan.gov.in` (one time). Then follow the arrows: close the popup → state **Kerala** → **Skip** →
   **Others** → **DL Search**. You type the mobile number and captcha; Koode pauses with "check your details" and
   hands off at **Generate OTP**.
3. **Unverified service:** `റേഷൻ കാർഡ് അപേക്ഷിക്കണം` ("apply for a ration card"). Koode says no official site is
   verified and opens nothing.
4. **Form guidance:** `അപേക്ഷാ ഫോം തുറക്കൂ` ("open the application form"), then `ഈ ഫോം പൂരിപ്പിക്കാൻ സഹായിക്കൂ`
   ("help me fill this form"). Koode guides field by field; click a wrong field to see the correction.
5. **End:** `നിർത്താം` ("let's stop").

Typing a request instead of speaking works everywhere (text-only replies). Groq free tier is 8,000 tokens per minute
and a step uses about 1–3k tokens, so a short "AI busy, retrying in N s" countdown is normal.

## Tests

```bash
cd tests && npm install
npm run unit                                                   # 64 unit tests: routing, redaction, query safety,
                                                               # intent validation, catalogue, sanitiser
npx @puppeteer/browsers install chrome@stable --path ~/.cache/koode-cft   # Chrome for Testing (loads unpacked extensions)
(cd ../backend && PORT=8797 KOODE_PROVIDER=mock KOODE_SPEECH=mock npm start) &
KOODE_BACKEND=http://localhost:8797 node e2e/journey.mjs                  # full journey + goals + grant (43 checks)
KOODE_BACKEND=http://localhost:8797 node e2e/journey.mjs --only services  # Sarathi flow on a stand-in (19 checks)
KOODE_BACKEND=http://localhost:8797 node e2e/run.mjs --repeat 2           # form / settings / voice regression
```

E2E drives real Chrome with real (trusted) mouse and keyboard input. WhatsApp, YouTube and Sarathi are served as
local stand-ins at their real hostnames. `--only real` and `--only real-services` open the live sites while logged
out, with the mock planner and no typing on government pages.

## Verification status

| What | How it was verified |
|---|---|
| Core loop: voice → confirm → arrow → verified click → next step | **Real Groq + real Sarvam** in Chrome (tags `koode-groq-verified`: 51/51 steps, voice 3/3; `koode-judging-final`) |
| YouTube goals, Sarathi services, privacy, permissions, new UI | Mock planner and mock speech in real Chrome (unit 64/64, journey 43/43, services 19/19, regression ×2). Live **logged-out** youtube.com and sarathi.parivahan.gov.in with the mock planner, as far as the mobile-number field. |
| Real Groq/Sarvam on the goal-driven and Sarathi flows | Pending the final live run before submission |

**Known limits:** one verified government service so far (Sarathi; Kerala route); the first Chrome site-access
prompt needs a button click; logged-in WhatsApp is tested only on a stand-in; YouTube's ranking and Groq free-tier
rate limits vary.
