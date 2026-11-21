# Koode landing page

A static, dependency-free page (`index.html`, `styles.css`, `main.js`, `assets/`). No build step.

- **Preview locally:** `cd website && python3 -m http.server 8899`, then open http://127.0.0.1:8899
- **Vercel:** import the repository and set *Root Directory* to `website` (framework preset: Other).
- **GitHub Pages:** publish the contents of `website/` (for example from a `gh-pages` branch, or with a Pages
  workflow that uploads `website/` as the artifact).

Screenshots in `assets/` are genuine captures from Koode's automated test runs (labelled test planner); the Sarathi
image is the live public portal, logged out. Fonts load from Google Fonts; nothing else is fetched or tracked.
