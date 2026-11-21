# Koode browser companion (side panel)

Feature branch work (PR #2 browser companion + PR #3 `claude-koode-next`). Not part of the judging build
(`koode-judging-final`); the judging tags are unchanged. Everything below was verified with the labelled
**mock planner** and **mock speech** only — no real-Groq or real-Sarvam run has been done on this code.

## Target journey
Chrome New Tab → WhatsApp Web → YouTube → practice application form → Exit, spoken in Malayalam from the
side panel. The user performs every click and keystroke; Koode points, explains, waits and verifies.

| Say (side panel mic) | Koode does |
|---|---|
| `വാട്സ്ആപ്പ് തുറന്ന് ഒരാളെ തിരയണം` | Opens WhatsApp Web in this tab. If WhatsApp shows its QR login: asks the user to scan it on their phone and waits (no planner calls). Then points at the search box; after the user types a name, hands over: the user picks the contact and writes/sends the message. |
| `യൂട്യൂബ് തുറന്ന് google forms tutorial തിരയൂ` | Opens YouTube, waits for the page, points at Search → user types and presses Enter → points at a matching video → user clicks → done. |
| `അപേക്ഷാ ഫോം തുറക്കൂ` | Opens the practice application form (`localhost:8787/demo/form.html`) and says it is open. |
| `ഈ ഫോം പൂരിപ്പിക്കാൻ സഹായിക്കൂ` | Guides field by field; the user submits. |
| `നിർത്താം` / `മതി` / `exit` | Ends the session: goodbye (spoken if the user spoke), arrow and in-page card closed, tab state cleared, side panel closes. |

Every transcript is shown for confirmation (✓ / edit / say again) before anything happens.

## Goal-driven requests (M1)
| Say | Koode does |
|---|---|
| `സോളാർ പാനൽ ഇൻസ്റ്റലേഷൻ വീഡിയോകൾ` (any page, New Tab included) | Rule fast path (no model): opens YouTube results for `സോളാർ പാനൽ ഇൻസ്റ്റലേഷൻ` directly, points at a relevant video, the user opens it, `/watch` = done (rule, no model). |
| `എനിക്ക് തെങ്ങ് കയറാൻ പഠിക്കണം` | One intent call (`/api/intent`) → Malayalam query; if fewer than 3 videos come up, one fallback search `coconut tree climbing malayalam`. |
| `യൂട്യൂബ് തുറന്ന് google forms tutorial തിരയൂ` / on YouTube `… തിരയൂ` | Results opened directly instead of guiding the user through the search box. |
| `ഡ്രൈവിംഗ് ലൈസൻസ് KL07 2019 0001234 വിവരങ്ങൾ അറിയണം` | Licence number removed before anything leaves the browser (Koode says so). Government sites are not opened in M1; Koode offers a how-to video search instead. |
| any request on a page with typed input (e.g. a half-filled form) | The search opens in a new tab; the form tab and its values are kept. |

Topic safety (`goals.js safety()`): self-harm requests get a Tele-MANAS 14416 / 112 helpline answer with no search
or model call; explicit, bomb-making and drug-buying searches are refused; sensitive words are allowed with an
educational context ("sex education", "suicide prevention", "ലഹരി വിമുക്തി ബോധവൽക്കരണം"). Labels have literal
markup/entities removed (YouTube snippets); elements are still resolved by snapshot ID.

Routing order: personal-data redaction → rule router (exit / open site / video or search request → YouTube search
/ guide here) → intent planner only for open-ended requests. The model can only nominate a plain-text query;
`goals.js` validates it and the service worker builds the YouTube URL itself. Koode still never clicks or types.
See `docs/CONTRACTS.md` → `/api/intent`.

## How it works
- **Side panel voice:** hold the big mic (mouse, or Space/Enter when focused). Audio goes to the backend
  (`/api/stt`, Sarvam Saaras v4; keys stay in the backend). If Chrome can't show the microphone prompt inside
  the side panel, Koode offers **Allow microphone**, which opens a one-time extension page (`mic.html`) to grant it.
- **Intent routing (no model quota), `src/shared/sites.js` → `classify()`:** exit / open a site / guide here.
  Malayalam verb forms and case endings are handled (`തുറന്ന്`, `തുറക്കൂ`, `യൂട്യൂബിൽ`, `വാട്സ്ആപ്പിലേക്ക് പോകൂ`).
  On a page Koode can guide, only an explicit "open X" / "on X" switches sites ("search for a WhatsApp tutorial"
  on YouTube stays a YouTube goal). Exit only matches short whole-utterance phrases ("stop the video" is a goal).
  The in-page panel (typed or spoken) uses the same routing.
- **Spoken replies** play in the side panel when it is open for the tab (it holds the user's gesture, so a freshly
  navigated page's autoplay policy can't silence them); otherwise the page plays them.
- **Page readiness (`src/content/ready.js`):** after a navigation Koode waits for the document, the site's own
  interface (WhatsApp chat shell, YouTube search box) and a quiet DOM before the first snapshot; after SPA route
  changes it waits for the DOM to settle. WhatsApp QR login is detected and waited out (up to 5 min) without
  planner calls, and the QR code is never covered. If the site's interface never appears (error or
  unsupported-browser page), Koode says so instead of claiming the site is ready.
- **Token budget:** on heavy pages the snapshot keeps on-screen controls first, at most 20 off-screen ones, drops
  unlabelled links and the 3rd+ copy of identical controls, labels ≤ 64 chars, ≤ 12 context lines, and omits
  positions for off-screen controls. Pages with ≤ 40 controls are unchanged.

## Privacy rules
- **WhatsApp Web:** `#main`, `#pane-side`, the chat list and `[role=application]` are never extracted. On WhatsApp
  no model is used at all: a local rule ("WhatsApp privacy rule (no AI)") points at the search control and then
  hands over. Clicks inside the private chat list are not reported or treated as wrong actions.
- **Google Forms:** the content script runs only on respondent pages (`…/viewform`, `…/formResponse`), never on
  the form editor (`…/edit`) or the forms list. No form URL is hardcoded.
- Koode never logs in, sends messages or submits forms. Input values are never read (only filled/valid flags).

## Permissions
`sidePanel`, `tabs`, `storage`. Host access: `localhost`, `127.0.0.1`, Google Forms respondent pages,
`web.whatsapp.com`, `www.youtube.com`. (`scripting` and `activeTab` were removed: the toolbar opens the side panel.)

## Verified (Chrome for Testing 158, macOS, mock planner + mock speech + mock intent)
| Suite | Result |
|---|---|
| Unit (`npm run unit`) | 53/53 (M1: + redaction, query safety incl. educational sensitive topics and self-harm, injection, language, intent endpoint with a fake model) |
| Journey (`node e2e/journey.mjs`), WhatsApp/YouTube as local fixtures at their real hostnames | 41/41 checks incl. 17 M1 goal checks (`--only goals`): markup-free labels with the arrow on the same link, self-harm helpline answer |
| Regression (`node e2e/run.mjs`, ×2) | form 8/8, settings A 3/3, settings B 3/3, Google-Forms structure 3/3, voice 3/3 steps correct; wrong clicks recovered; no typed values in planner payloads; arrow anchor error ≤ 0.5 px |
| Real sites (`--only real`, logged out, headless, mock planner) | M1: youtube.com results opened directly for an English and a Malayalam query (30 videos), arrow on a video, opened → done by rule. 0.3.0: arrow on the real search box after readiness. web.whatsapp.com: real "Scan to log in" page detected, no planner calls; on runs where WhatsApp served its unsupported-browser page to headless Chrome, Koode said the page did not finish loading |

Planner payload, first request (estimated prompt tokens = 443 + 0.382 × user-message chars, fitted on 8 logged
real-Groq requests):

| Page | Before (PR #2) | After |
|---|---|---|
| YouTube home (fixture, 96 videos) | 150 candidates, ≈ 4,360 tokens | 60 candidates, ≈ 2,030 tokens |
| YouTube home (real, logged out) | — | 60 candidates, ≈ 2,030 tokens |
| Practice form / Google-Forms structure / settings | unchanged (≈ 1,220 / 960 / 650) | unchanged |

## Not verified
- **Real Groq** planning on YouTube and the practice form from this branch (quota preserved), and the real-Groq
  **intent planner** (`/api/intent`): query quality, Malayalam/English split, service detection, injection resistance.
- **Real Sarvam** STT/TTS through the side panel, and a real human voice (mock speech returns queued transcripts).
- **Chrome's microphone prompt inside a real side panel**: tests open the panel page as a window with
  auto-granted fake media. The `mic.html` fallback has not been exercised in a real side panel.
- **Logged-in WhatsApp Web**: the search-box selector/label (`Search input textbox`) and private-area selectors
  are tested only on the fixture.
- `chrome.sidePanel.close()` on exit (Chrome 141+; falls back to `window.close()`).
