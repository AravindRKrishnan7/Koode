# Koode: hackathon notes

Material for judges and reviewers: run modes, a 3-minute demo script, test suites and verification status.
For the product overview see the [README](../README.md); for the full judging-day checklist see [DEMO.md](DEMO.md).

## Real AI vs. mock testing

| Mode | Command | Planner / intent | Voice | Uses API credits | Shown in the panel |
|---|---|---|---|---|---|
| **Judging (real)** | `scripts/start-judging.sh` | Groq `openai/gpt-oss-20b` | Sarvam (real) | Yes | `model: openai/gpt-oss-20b` |
| Rehearsal | `scripts/start-rehearsal.sh` | **Mock** (scripted, not AI) | Sarvam if its key is stored | Sarvam only | red **MOCK planner (not AI)** |
| Tests | `KOODE_PROVIDER=mock KOODE_SPEECH=mock` | **Mock** | **Mock** (queued transcripts, chime replies) | None | **MOCK planner · MOCK speech** |

Mocks are always labelled in the UI and in `/health`. Judging mode refuses to start without both keys and refuses
mock speech. The E2E runners refuse to run against real Groq or Sarvam unless explicitly allowed.

## Demo script (about 3 minutes)

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
npm run unit                                                   # 71 unit tests: routing, redaction, query safety,
                                                               # intent validation, catalogue, sanitiser
npx @puppeteer/browsers install chrome@stable --path ~/.cache/koode-cft   # Chrome for Testing (loads unpacked extensions)
(cd ../backend && PORT=8797 KOODE_PROVIDER=mock KOODE_SPEECH=mock npm start) &
KOODE_BACKEND=http://localhost:8797 node e2e/journey.mjs                  # full journey + goals + grant (43 checks)
KOODE_BACKEND=http://localhost:8797 node e2e/journey.mjs --only services  # Sarathi flow on a stand-in (21 checks)
KOODE_BACKEND=http://localhost:8797 node e2e/run.mjs --repeat 2           # form / settings / voice regression
```

E2E drives real Chrome with real (trusted) mouse and keyboard input. WhatsApp, YouTube and Sarathi are served as
local stand-ins at their real hostnames. `--only real` and `--only real-services` open the live sites while logged
out, with the mock planner and no typing on government pages.

## Verification status

| What | How it was verified |
|---|---|
| Core loop: voice → confirm → arrow → verified click → next step | **Real Groq + real Sarvam** in Chrome (tags `koode-groq-verified`: 51/51 steps, voice 3/3; `koode-judging-final`) |
| YouTube goals, Sarathi services, privacy, permissions, new UI | Mock planner and mock speech in real Chrome (unit 71/71, journey 43/43, services 21/21, regression ×2). Live **logged-out** youtube.com and sarathi.parivahan.gov.in with the mock planner, as far as the mobile-number field. |
| Real Groq/Sarvam on the goal-driven and Sarathi flows | Pending the final live run before submission |

**Known limits:** one verified government service so far (Sarathi; Kerala route); the first Chrome site-access
prompt needs a button click; logged-in WhatsApp is tested only on a stand-in; YouTube's ranking and Groq free-tier
rate limits vary.
