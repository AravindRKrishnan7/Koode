# Koode demo guide

Two procedures: a **real-microphone manual test** (do this once on the demo laptop before judging) and the **90-second judging script**.

## Start Koode on your Mac

### One-time setup (~5 min)

```bash
brew install node@20 git                 # Node 20+ (check: node -v)
git clone https://github.com/AravindRKrishnan7/Koode.git ~/Koode
cd ~/Koode && git checkout koode-judging-final
```

Store the keys in the macOS Keychain (typed at a hidden prompt; never in a file, shell history, or the repo):

```bash
security add-generic-password -a "$USER" -s koode-groq   -w     # paste GROQ_API_KEY, Enter
security add-generic-password -a "$USER" -s koode-sarvam -w     # paste SARVAM_API_KEY, Enter
# replace a key later: add -U to the same command
```

Load the extension in Chrome:

1. Open `chrome://extensions`, switch on **Developer mode** (top right).
2. **Load unpacked** → choose `~/Koode/extension`. "Koode — കൂടെ" appears; pin it from the puzzle-piece menu.
3. After any `git checkout`, press the ↻ reload icon on the Koode card.

### Two modes (only one at a time, both on port 8787)

| | Rehearsal (simulation) | Judging (real AI) |
|---|---|---|
| Command | `~/Koode/scripts/start-rehearsal.sh` | `~/Koode/scripts/start-judging.sh` |
| Planner | Mock, scripted targets, **not AI** | Groq `openai/gpt-oss-20b` |
| Voice | Real Sarvam (if the key is stored), otherwise typing only | Real Sarvam (required) |
| Groq quota used | None | ≈ 850 tokens per step |
| Panel badge | Red **MOCK test harness (not AI)** | **model: openai/gpt-oss-20b** |
| Safety check | Prints a SIMULATION banner | Refuses to start without both keys; stops unless `/health` is `groq`, `mock:false`, `voice:true` |

Switch modes: press **Ctrl-C** in the terminal running Koode, start the other script, then reload the demo tab. A second mode can't start while one is running (port check).

Open `http://localhost:8787/demo/settings.html?layout=b` and click the orange **കൂ** bubble. First press of the mic: Chrome asks for microphone access for `localhost:8787` → **Allow**.

Keys never leave the backend process: the extension only talks to `localhost:8787`, and the backend refuses API calls from web pages.

## Groq quota budget (free tier)

| Limit | Value | Koode usage |
|---|---|---|
| Tokens per minute | 8,000 | One step ≈ 850 tokens, so ≈ 9 steps/min |
| Tokens per day (per Groq organization, shared by all its keys) | ≈ 200,000 (Groq’s published free-tier cap) | One voice demo (3 steps + done) ≈ 3,500 tokens; the full E2E suite ×3 ≈ 70,000 |
| Requests per day | 1,000 | ≈ 4 per demo |

On judging day: no E2E runs, no repeated rehearsals on Groq. Rehearse in mock mode, then switch back to Groq (`KOODE_REQUIRE_LLM=1`) and do at most one real run before judging.

## Known-good versions

- `koode-judging-final`: the judging build (features frozen). Real-Groq voice run on this code: speech → confirm → correct arrow → verified click → correct next arrow.
- `koode-groq-verified`: earlier commit with the full real-Groq suite passed (voice 3/3, 51/51 steps); fallback if the judging build misbehaves.

Switch: `git checkout <tag>`, reload the Koode card in `chrome://extensions`, restart the script.

## Real-microphone manual test (~5 min, rehearsal mode)

Run this with `start-rehearsal.sh`; it uses no Groq quota. Steps 1–3 and 7–11 test the real voice path; arrow targets come from the mock.

Reload the page (`F5`) before each case; it resets the demo state.

| # | Do | Expect (pass) |
|---|---|---|
| 1 | Hold 🎤 (or focus it and hold Space). Say **"ഈ വെബ്സൈറ്റ് ഡാർക്ക് മോഡിലേക്ക് മാറ്റണം"**. Release. | Pill shows **Listening…** and the level bar moves while you speak; then **Understanding…** for about 1–2 s. |
| 2 | Look at the panel. | **Is this right?** box shows what Koode heard; Koode reads it back aloud (🔊 in the header). Nothing on the page is highlighted yet. |
| 3 | If a word is wrong, fix it in the text box. Press **✓ ശരി, തുടങ്ങാം** (or Enter). | Within ~1 s an orange ring + arrow with step badge **1** points at **Menu**; Malayalam instruction is spoken. |
| 4 | Click **Menu**. | Green ✓ flash on Menu, then the arrow moves to **Display** (step 2). |
| 5 | Click **Alerts** instead (a wrong click). | **Let's fix that**: Koode names what you clicked and re-points at **Display**; the step number does not advance. |
| 6 | Click **Display**, then **Night mode**. | Page turns dark; panel turns green with a large ✓ and **Done ✓**; completion is spoken. |
| 7 | Press 🎤 and say something, then press **🎤 വീണ്ടും പറയാം**. | The heard text is discarded; you can speak again. |
| 8 | Press **Stop** while it shows **Understanding…**. | Nothing starts afterwards. |
| 9 | Type the goal instead of speaking and press **Guide**. | Same guidance, text only (no spoken replies). |
| 10 | Click 🔒 in the address bar → Microphone → **Block**, reload, press 🎤. | Malayalam + English message explaining how to re-allow the mic; the text box is focused for typing. Re-allow afterwards. |
| 11 | Stop the backend (Ctrl-C), press 🎤 and speak. | “Koode backend is not reachable” message; restart the backend and continue. |

Record what Koode heard for 3–5 different phrasings (e.g. *"ഡാർക്ക് മോഡ് ഓൺ ആക്കണം"*, *"രാത്രി മോഡ് വേണം"*) and in a noisy room. If a transcript is wrong, the confirm box is where you correct it. Automated tests used a synthetic voice only, so this test is the first real-voice check.

### Troubleshooting

| Symptom | Fix |
|---|---|
| Level bar never moves | Wrong input device: Chrome `chrome://settings/content/microphone` → pick the right mic. |
| “AI service is busy … retrying in N s” | Groq free tier (8,000 tokens/min ≈ 5–9 steps/min). Wait for the countdown; Koode retries automatically. Avoid back-to-back runs right before judging. |
| “Press Repeat to hear the instruction” | Chrome blocked audio on a freshly loaded page; press **Repeat** once. |
| Mic button dimmed | Voice not configured (`"voice":false` in `/health`) or the page isn't https/localhost; typing still works. |

## 90-second judging script

Pre-flight checklist (before the judges arrive):

1. `git describe --tags` shows `koode-judging-final`; Koode card reloaded in `chrome://extensions`.
2. No Groq use in the last hour (no tests, no Groq rehearsals); the daily quota refills slowly.
3. `scripts/start-judging.sh` prints `JUDGING MODE OK … "provider":"groq" … "mock":false … "voice":true`.
4. Tab on `http://localhost:8787/demo/settings.html?layout=b`, freshly reloaded; panel badge reads `model: openai/gpt-oss-20b` (not red MOCK).
5. Mic permission already allowed for `localhost:8787`; mic level bar moves when you speak (check by holding the mic, then press **🎤 വീണ്ടും പറയാം** to discard; that uses Sarvam only, no Groq).
6. Laptop volume up so the spoken Malayalam replies are audible; notifications off.
7. Backup: a second tab on `form.html`; if voice misbehaves, type the same sentence and press **Guide**.

| Time | Say (presenter) | Do |
|---|---|---|
| 0:00–0:12 | “Many people know *what* they want to do online but get lost in English menus. Koode sits beside them, in Malayalam, and points — the user always clicks.” | Show the page; open the **കൂ** bubble. |
| 0:12–0:25 | “I just say what I want, in Malayalam.” | Hold 🎤: **“ഈ വെബ്സൈറ്റ് ഡാർക്ക് മോഡിലേക്ക് മാറ്റണം.”** Release. |
| 0:25–0:35 | “Koode shows and says what it heard, and does nothing until I confirm. If it misheard, I just correct it.” | Point at the **Is this right?** box; press **✓**. |
| 0:35–0:50 | “It read the real page, picked the actual Menu button — not screen coordinates — and is waiting for *me*.” | Arrow on **Menu** (step 1). Click **Menu**. Green ✓; arrow moves to **Display**. |
| 0:50–1:05 | “If I click the wrong thing, it notices and gently corrects me.” | Click **Alerts** → recovery message, arrow stays on **Display**. Click **Display**. |
| 1:05–1:20 | “Each step only advances when the page actually changes.” | Click **Night mode** → page goes dark, **Done ✓**, spoken completion. |
| 1:20–1:30 | “Speech by Sarvam Saaras v4 and Bulbul, planning by a real LLM on Groq. Keys never leave our server, typed values never leave the page, and nothing is clicked for you.” | Expand **Trace** briefly to show model + verified steps. |

Fallbacks during the demo: if voice misbehaves, type the same sentence and press **Guide** (identical guidance). If a rate-limit countdown appears, narrate it (“free-tier AI quota — it retries itself”) and continue.
