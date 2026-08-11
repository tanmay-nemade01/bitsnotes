# BitsNotes

Free, open-source AI/ML study notes — lectures across multiple subjects with interactive quizzes, exam revision cards, study guides, comments, bookmarks, and reading progress. Built with **Astro + Tailwind**, deployed on **Cloudflare Workers**.

**Live site:** [bitsnotes.com](https://bitsnotes.com)

---

## Stack

| Layer | Technology |
|-------|------------|
| Framework | [Astro](https://astro.build) (static + SSR hybrid) |
| Styling | [Tailwind CSS](https://tailwindcss.com) + design tokens in `src/styles/tokens.css` |
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com) via `@astrojs/cloudflare` |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) |
| Content storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) (production); Vite glob imports in local dev |
| Cache / email | KV (newsletter tokens), Cloudflare Email Service + ZeptoMail |
| Auth | Google / GitHub OAuth, email verification, JWT sessions |
| Tests | Vitest (unit) + Playwright (E2E) |

---

## Features

- **Lecture viewer** — Notes, Study Guide, Exam Revision, and Quiz tabs
- **Subjects** — ACI, DMML, DNN, DRL, ISM, ML, MFML, NLP, SEML, plus additional lecture sets (e.g. Big Data, Data Warehousing)
- **Cross-lecture resources** — Race cards, one-sheets, concept maps, question banks, worksheets, solved papers
- **Search** — Ctrl+K across subjects, lectures, and concepts
- **Accounts** — OAuth or email sign-in; bookmarks/collections, reading progress, threaded comments
- **Study tools** — Pomodoro timer; client-side “Ask AI Doubts” chatbot (bring-your-own API key)
- **Blog** — Posts, tags, RSS, likes, author follows
- **Site polish** — Dark/light theme, SEO (JSON-LD, sitemap), edge caching, security headers

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:4321
```

Optional local setup:

1. Copy secrets into `.dev.vars` (git-ignored) — see [Environment](#environment)
2. Apply the D1 schema locally: `npm run db:migrate:local`

| Command | Purpose |
|---------|---------|
| `npm run build` | Type-check, build to `./dist/`, theme-color audit |
| `npm run preview` | Preview the production build |
| `npm test` | Unit tests |
| `npm run test:e2e` | Playwright E2E |
| `npm run deploy` | Guard checks + build + Workers deploy |
| `npm run upload-notes` | Sync note HTML/JSON to R2 |
| `npm run db:migrate:remote` | Apply D1 schema in production |
| `npm run blog:new` | Scaffold a blog post |
| `npm run audit:theme` | Ensure content CSS uses design tokens |

---

## Project layout

```
src/
├── components/     # UI (nav, search, comments, chatbot, pomodoro, …)
├── content/
│   ├── notes/      # Lectures & resources (HTML + JSON per folder)
│   └── blog/       # Blog posts
├── data/           # Subject catalog, site config
├── db/             # D1 schema + migrations
├── layouts/
├── lib/            # Auth, comments, bookmarks, moderation, …
├── pages/          # Routes + API endpoints
├── styles/         # tokens, global, lecture, prose, chatbot
├── utils/          # notesLoader, blogLoader, parsers, …
└── middleware.ts   # Sessions, CSP, caching

scripts/            # Deploy guard, R2 upload, theme audit, blog scaffold
test/               # Vitest
e2e/                # Playwright
make-transcript-notes-kit-3agent/   # Optional transcript → notes pipeline
```

---

## Content

### Lectures

```
src/content/notes/<Subject>/<LectureFolder>/
├── notes.html    # required — body content (+ optional <style>)
└── notes.json    # optional — summary, quiz, keyConcepts, examRevisionNotes, …
```

Styles in lecture HTML are scoped to `.lecture-notes-wrapper` at parse time. Without `notes.json`, a basic study guide is derived from the folder name. Add subject metadata in `src/data/subjects.ts` when introducing a new subject folder.

### Cross-lecture resources

Same pipeline as lectures — use a dedicated folder with:

```
src/content/notes/<Subject>/<ResourceFolder>/
├── resource.html
└── resource.json   # resourceKind, scope, topicTitle, sortOrder, availableModes, …
```

`resourceKind` values: `race-card` | `one-sheet` | `concept-map` | `worksheet` | `question-bank` | `solved-paper`. After editing content CSS, run `npm run audit:theme`.

### Blog

Posts live under `src/content/blog/<slug>/` as `index.html` + `index.json`. Use `npm run blog:new` to scaffold.

### Transcript → notes kit

For turning lecture transcripts into HTML notes, see [`make-transcript-notes-kit-3agent/`](make-transcript-notes-kit-3agent/).

---

## Architecture

```
Request → Cloudflare Edge → Astro Worker
                              ├─ Static pages (ASSETS)
                              ├─ SSR / API (D1)
                              └─ Lecture content (R2 in prod)
```

Notes are authored in git under `src/content/notes/`. At build time, `notesLoader.ts` discovers them via Vite glob imports. In production, HTML/JSON are also uploaded to R2 and fetched on demand; a manifest supports catalog queries.

User data (auth, bookmarks, comments, progress) lives in D1. Schema: [`src/db/schema.sql`](src/db/schema.sql). Auth code: `src/lib/auth/`. API routes: `src/pages/api/`.

---

## Environment

Bindings are declared in [`wrangler.jsonc`](wrangler.jsonc): `DB`, `NOTES_BUCKET`, `NEWSLETTER_KV`, `SEND_EMAIL`, rate limiters, `ASSETS`.

Set secrets with `wrangler secret put` (and mirror them in `.dev.vars` for local work), including:

- `SESSION_SIGNING_KEY`
- Google / GitHub OAuth client secrets
- Turnstile secret
- ZeptoMail / Zoho Campaigns credentials (including list key)
- Any API keys required by your deploy

Never commit credentials. Prefer Worker secrets over tracked config.

---

## Deploy

1. Ensure secrets and bindings are configured
2. `npm run deploy`
3. `npm run upload-notes` when content changed
4. `npm run db:migrate:remote` when the schema changed

Target domains: `bitsnotes.com` / `www.bitsnotes.com`.

---

## Security notes

- Contact and auth endpoints use CSRF checks, rate limits, and (where configured) Turnstile
- Middleware sets CSP, HSTS, and related headers
- Comment input goes through profanity / spam checks
- Session and verification tokens are hashed or HMAC-signed as appropriate

---

## License / contributing

Open source — contributions via pull request are welcome. Keep lecture CSS on design tokens (`npm run audit:theme`), and avoid committing secrets or generated caches (`.dev.vars`, `.notes-upload-cache.json`, etc.).
