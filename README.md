# BitsNotes

AI/ML study notes site built with **Astro + Tailwind**, deployed on **Cloudflare Workers**.

## Architecture

Notes are HTML files committed to git under `src/content/notes/<Subject>/<Lecture>/notes.html`. At build time, `notesLoader.ts` uses Vite glob imports to discover and load all notes. The site is pre-rendered (static) except for the contact API and a legacy URL redirect.

### Pages

| Route | Description |
|---|---|
| `/` | Subject listing |
| `/subject/<Subject>` | Lectures for a subject |
| `/view/<Subject>/<Lecture>` | Lecture viewer with tabs (Notes / Study Guide / Exam Revision / Quiz) |
| `/about`, `/contact`, `/privacy`, `/terms` | Static pages |
| `/api/contact` | Server-rendered contact form API |

### Key features

- **Four-tab viewer** — lecture notes, study guide with summary/objectives, exam revision cards, practice quiz
- **Build-time content loading** via `import.meta.glob`
- **SEO structured data** — JSON-LD schemas (`LearningResource`, `Quiz`, `CollectionPage`, `WebSite`)
- **Dynamic sitemap** and `robots.txt`
- **Deferred analytics** (GA4 + Cloudflare beacon load on first interaction)
- **Self-hosted Inter font**, dark mode, scroll progress, back-to-top

## Adding a new lecture

```text
src/content/notes/<Subject>/<LectureFolder>/
├── notes.html          # required: the lecture content
└── notes.json          # optional: metadata (summary, quiz, etc.)
```

- `notes.html` should contain a `<body>` with the lecture content and can include `<style>` blocks.
- `notes.json` can include `summary`, `keyConcepts`, `sections`, `quiz`, `examRevisionNotes`, etc. See existing notes for examples.
- If no `notes.json` is provided, a fallback study guide is generated from the folder name.

## Commands

| Command | Action |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start local dev server at `localhost:4321` |
| `npm run build` | Type-check + build production site to `./dist/` |
| `npm run deploy` | Build + deploy to Cloudflare Workers |
| `npm run preview` | Preview production build locally |

## Deployment

Deploys to `bitsnotes.com` / `www.bitsnotes.com` via Cloudflare Workers (`wrangler deploy`). The `@astrojs/cloudflare` adapter serves static assets from the Workers `ASSETS` binding, with a few server-rendered endpoints for the contact form and legacy redirects.

## Security

- Do **not** commit real credentials to tracked files. Use Cloudflare Worker secrets or `.env` (git-ignored).
- Contact form sanitizes header fields and uses a honeypot for bot detection.
- Security headers (CSP report-only, X-Frame-Options, etc.) are applied via middleware.
