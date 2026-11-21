# Koode demo guide

Two procedures: a **real-microphone manual test** (do this once on the demo laptop before judging) and the **90-second judging script**.

## Setup (once, ~3 min)

```bash
cd backend
GROQ_API_KEY=... SARVAM_API_KEY=... KOODE_REQUIRE_LLM=1 npm start
curl -s localhost:8787/health   # expect "provider":"groq","mock":false,"voice":true
```

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `extension/`. (Reload the card after any code change.)
2. Use a wired/USB or laptop mic; close Zoom/Meet/other apps that hold the mic.
3. Open `http://localhost:8787/demo/settings.html?layout=b`. Click the orange **കൂ** bubble.
4. First press of 🎤: Chrome asks for microphone permission for `localhost:8787` → **Allow**.
5. Keys stay in the backend shell only. Never paste them into the extension, the page, or a commit.

## Real-microphone manual test (~5 min)

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

Pre-flight (before the judges arrive): backend running, `/health` shows `groq`, `mock:false`, `voice:true`; mic permission already allowed; tab on `settings.html?layout=b`, reloaded; **wait 60 s since the last run** so the Groq per-minute budget is full. Keep a second tab on `form.html` as a backup.

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
