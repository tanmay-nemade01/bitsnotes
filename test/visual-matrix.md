# Dark-Mode Visual Regression Matrix (Phase 9)

This checklist complements the automated suites. It is the manual sign-off
grid for the light / dark / system × viewport matrix required by the
implementation plan. Run it after every theme-touching change.

## Viewports
- **320px** — small mobile
- **768px** — tablet
- **Desktop** — ≥1280px

## Themes
- **Light**
- **Dark**
- **System** (toggle OS preference; verify it follows)

## Pages / components to cover (at minimum)

| Area | Light | Dark | System | Notes |
|---|---|---|---|---|
| Home (cards, browse-all, chips, stats) | ☐ | ☐ | ☐ | No white cards in dark |
| Subject list | ☐ | ☐ | ☐ | |
| Viewer — Notes tab | ☐ | ☐ | ☐ | MathJax `mjx-container` uses `var(--text)` |
| Viewer — Study Guide | ☐ | ☐ | ☐ | |
| Viewer — Exam Revision | ☐ | ☐ | ☐ | |
| Viewer — Quiz (states) | ☐ | ☐ | ☐ | selected/incorrect/correct |
| Pomodoro (incl. break overlay) | ☐ | ☐ | ☐ | break overlay stays dark by design |
| Comments | ☐ | ☐ | ☐ | textarea, list, report/delete |
| Usefulness feedback | ☐ | ☐ | ☐ | |
| Search modal (Ctrl+K) | ☐ | ☐ | ☐ | backdrop + shadow |
| Navbar / mobile menu | ☐ | ☐ | ☐ | no `text-black`/`bg-white` leakage |
| Cookie consent | ☐ | ☐ | ☐ | |
| Newsletter / Turnstile | ☐ | ☐ | ☐ | re-render on theme change |
| Auth (signin/signup/verify) | ☐ | ☐ | ☐ | `--color-text-muted` defined |
| Bookmarks | ☐ | ☐ | ☐ | |
| Contact | ☐ | ☐ | ☐ | |
| Support | ☐ | ☐ | ☐ | copy button, QR |
| Legal (privacy/terms/404/500) | ☐ | ☐ | ☐ | |

## Automated guardrails (already enforced)
- `npm run audit:theme` fails the build on new unapproved hard-coded colors.
- `test/htmlParser.test.ts` guarantees lecture `<style>` blocks are scoped to
  `.lecture-notes-wrapper` (theme isolation) and that `@media`/`@keyframes`
  preludes are preserved.

## How to run the automated browser suite
```bash
npm run build
npx playwright test            # all projects (desktop/mobile/firefox)
npx playwright test --project=chromium-mobile   # just mobile
```
Screenshots on failure land in `playwright-report/`. For a manual pass, use
the device emulation + theme toggle in the browser and tick the grid above.
