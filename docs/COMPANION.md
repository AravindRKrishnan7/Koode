# Koode browser companion (side panel) — feature branch

Not part of the judging build (`koode-judging-final`). Rehearsal results below used the labelled
mock planner (`scripts/start-rehearsal.sh`); no real-Groq run has been done on this branch yet.

## What it adds
- **Side panel:** clicking the Koode toolbar icon opens a persistent panel on any tab, including
  Chrome's New Tab page (where content scripts cannot run).
- **Navigation only on request:** "Open YouTube", "വാട്സ്ആപ്പ് തുറക്കൂ", or the site buttons
  navigate the current tab with `chrome.tabs.update`. Site matching is rule-based (no model quota).
- **Goal carry-over:** "Open YouTube and search for a Google Forms tutorial" opens YouTube, then the
  in-page guide resumes with "search for google forms tutorial" using the same planner, ID
  validation, arrow, action verification and voice as before.
- **Progress mirror:** the side panel shows the current instruction and state from the page.
- **End session:** clears the stored goal for the tab and stops guidance.

## Permissions (narrow)
`sidePanel`, `tabs`, `storage`, `scripting`, `activeTab`; host access only for `localhost`,
`127.0.0.1`, `https://docs.google.com/forms/*`, `https://web.whatsapp.com/*`,
`https://www.youtube.com/*`. The old "click the icon to inject on any site" behaviour is replaced
by the side panel, so other sites are not supported.

## Privacy rules
- WhatsApp Web: the chat list (`#pane-side`) and conversation (`#main`) are never extracted, so
  contact names, message previews and messages are never sent to any model. Koode can only point
  at page chrome such as the search box; the user picks the contact and writes/sends messages.
- Koode never logs in, sends messages or submits forms. The user does every click and keystroke.

## Verified in real Chrome (Chrome for Testing 156, mock planner, real websites)
| Check | Result |
|---|---|
| Toolbar → side panel on New Tab | Opens; shows "Current tab: New Tab" |
| New Tab → "Open YouTube and search for a Google Forms tutorial" | Same tab navigates to youtube.com; goal carried over |
| YouTube guidance | Arrow on Search box → user types + Enter → arrow on a matching video → user clicks → Done on /watch |
| Practice form (Google Forms structure) from side panel | Arrow on "Morning" → caption click verified → "Bus" in the 2nd question → user clicks Submit → Done |
| New Tab → WhatsApp Web | Opens web.whatsapp.com; Koode loads. Stops at WhatsApp's QR login (user must log in on their phone) |
| WhatsApp Web → YouTube from the side panel | Navigates; goal carried over; arrow on the YouTube Search box |

## Not verified (assumptions)
- Contact search guidance on a logged-in WhatsApp Web (needs the user's phone to log in).
- Real-Groq planning on YouTube/WhatsApp (quota preserved; mock only).
- Typing Malayalam into the side panel in Chrome (matching is unit-checked; the VM keyboard tool could not type Malayalam).
- Voice from the side panel itself: voice stays in the in-page panel on supported sites.
