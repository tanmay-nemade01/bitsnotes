# BitsNotes

Free, open-source AI/ML study notes — **120+ lectures** across 9 subjects with interactive quizzes, exam revision cards, study guides, threaded comments, bookmarks, and reading progress tracking. Built with **Astro + Tailwind**, deployed on **Cloudflare Workers**.

**Site:** [bitsnotes.com](https://bitsnotes.com)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Astro](https://astro.build) ^7.0 (static + SSR hybrid) |
| Styling | [Tailwind CSS](https://tailwindcss.com) ^4.3 + custom design tokens |
| Deployment | [Cloudflare Workers](https://workers.cloudflare.com) via `@astrojs/cloudflare` |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite-compatible) |
| Object Storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) (notes content) |
| Cache | [Cloudflare KV](https://developers.cloudflare.com/kv/) (newsletter tokens) |
| Email | [Cloudflare Email Service](https://developers.cloudflare.com/email-routing/) + ZeptoMail |
| Auth | OAuth 2.0 (Google, GitHub) + email magic links, JWT sessions |
| Testing | [Vitest](https://vitest.dev) (unit) + [Playwright](https://playwright.dev) (E2E) |
| Languages | TypeScript ^6.0, HTML, CSS |

---

## Features

### Content
- **Four-tab lecture viewer** — Notes, Study Guide (summary/objectives), Exam Revision (cards), Quiz (interactive MCQs)
- **9 subjects** — ACI, DMML, DNN, DRL, ISM, ML, MFML, NLP, SEML
- **Cross-lecture resources** — Race cards, one-sheets, concept maps, solved papers, question banks, worksheets
- **Universal search** — Ctrl+K search across all subjects, lectures, and concepts
- **Blog** — Posts with tags, RSS feed, likes, and author following

### User Features
- **Authentication** — Google OAuth, GitHub OAuth, or email + verification
- **Bookmarks & Collections** — Save lectures to named collections (e.g., "To Review")
- **Reading Progress** — Automatic scroll-based progress per lecture and per topic
- **Threaded comments** — Reddit-style with up/down voting, reporting, admin moderation
- **Usefulness feedback** — "Was this useful?" voting on every page
- **Dashboard** — Recently saved bookmarks and progress bars (when signed in)
- **Newsletter** — Subscribe with your account (Zoho Campaigns + ZeptoMail); unsubscribe via email link
- **Pomodoro timer** — Built-in study timer

### Site
- **Dark/Light mode** — Theme toggle with system preference detection, no FOUC
- **SEO** — JSON-LD structured data (`LearningResource`, `Quiz`, `CollectionPage`, `WebSite`), dynamic sitemap, `robots.txt`
- **Edge caching** — Public page shells cached at Cloudflare edge with Cookie-based Vary
- **Security headers** — CSP (enforcing for auth routes, report-only for public), HSTS, X-Frame-Options
- **Analytics** — GA4 + Cloudflare beacon (deferred to first interaction)
- **Responsive** — Mobile-first layout with accessible components (ARIA, keyboard nav, screen reader support)

---

## Pages & Routes

| Route | Type | Description |
|-------|------|-------------|
| `/` | Static | Homepage — subject grid, browse-all accordions, blog preview, dashboard |
| `/subject/[subject]` | Static | Subject detail — lecture list, progress, resource cards |
| `/view/[...path]` | SSR | Lecture viewer (Notes / Study Guide / Exam Revision / Quiz tabs) |
| `/view/[id]` | SSR | Legacy URL redirect |
| `/about`, `/contact`, `/privacy`, `/terms`, `/disclaimer` | Static | Info pages |
| `/support` | Static | Buy Me a Coffee / support page |
| `/bookmarks` | Static | Saved lectures (requires auth) |
| `/blog` | Static | Blog index |
| `/blog/[slug]` | Static | Blog post |
| `/blog/rss.xml` | Static | RSS feed |
| `/blog/tag/[tag]` | Static | Posts by tag |
| `/auth/signin`, `/auth/signup`, `/auth/verify-email` | SSR | Auth pages |
| `/admin/comments` | SSR | Comment moderation dashboard |
| `/subscribed`, `/unsubscribed` | Static | Newsletter success pages |
| `/search-index.json` | Static | Full-text search index |
| `/sitemap.xml` | Static | XML sitemap |
| `/404`, `/500` | Static | Error pages |

---

## Architecture

### Content Pipeline

Notes are authored as **HTML + JSON pairs** committed to git under `src/content/notes/`:

```
src/content/notes/<Subject>/<Lecture>/
├── notes.html          # Lecture content (body + optional <style>)
└── notes.json          # Metadata: summary, quiz, keyConcepts, examRevisionNotes, etc.
```

At build time, `notesLoader.ts` uses Vite glob imports (`import.meta.glob`) to discover all notes. In production, notes are uploaded to **Cloudflare R2** and fetched on demand. A `notes-manifest.json` is generated for efficient catalog queries.

The Astro Cloudflare adapter generates a Worker that serves static pages (pre-rendered) alongside server-rendered endpoints (contact API, auth callbacks, comments API).

### Data Flow

```
User Request → Cloudflare Edge → Astro Worker → Static Page (from ASSETS binding)
                                                → API Route (D1 queries)
                                                → Content (R2 GET)
```

- **Static pages** are pre-rendered and served from the `ASSETS` binding
- **SSR pages** (lecture viewer, auth, API) run on the Worker
- **User data** (auth, bookmarks, comments, progress) lives in **D1**
- **Notes content** is served from **R2** (production) or Vite glob imports (dev)

---

## Database (Cloudflare D1)

**Binding name:** `DB` | **Database name:** `bitsnotes_auth`

```sql
users            -- User accounts (id, email, display_name, status)
identities       -- OAuth provider links (Google, GitHub)
entitlements     -- Tier/plan management
verification_tokens -- Email verification (SHA-256 hashed)
refresh_tokens   -- JWT session refresh tokens
auth_events      -- Security audit log
admin_users      -- Admin allowlist
collections      -- Named bookmark collections
bookmarks        -- Saved lectures (collection_id, subject, lecture)
reading_progress -- Per-lecture scroll progress
topic_progress   -- Per-topic scroll progress
comments         -- Threaded comments (parent_id, depth, score, status)
comment_votes    -- Up/down votes per comment
comment_reports  -- Reported comments
page_feedback    -- Usefulness feedback votes
blog_likes       -- Blog post likes
blog_follows     -- Author follows
page_views       -- Global view counts
```

Schema: `src/db/schema.sql` | Migrations: `src/db/migrations/`

---

## Authentication

- **Sign-in options:** Google OAuth, GitHub OAuth, email + magic link
- **Sessions:** JWT access token (short-lived) + refresh token (long-lived, revocable)
- **Security:** CSRF via Origin/Referer validation, Cloudflare Turnstile, rate limiting
- **Audit log:** All auth events logged to `auth_events` table
- **Email verification:** Sent via Cloudflare Email Service binding

Auth modules: `src/lib/auth/` — index, audit, crypto, csrf, db, email, oauth, session, turnstile

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/contact` | POST | Contact form → email |
| `/api/subscribe` | POST | Newsletter subscribe (auth required) |
| `/api/unsubscribe` | GET/POST | Newsletter unsubscribe |
| `/api/auth/signin` | POST | Sign-in (email or OAuth redirect) |
| `/api/auth/signout` | POST | Revoke tokens |
| `/api/auth/me` | GET | Current user |
| `/api/auth/verify-email` | GET | Email verification |
| `/api/auth/callback/[provider]` | GET | OAuth callback |
| `/api/bookmarks/*` | CRUD | Save/move/remove bookmarks |
| `/api/collections/*` | CRUD | Create/rename/delete collections |
| `/api/comments/*` | CRUD | List, create, vote, report, delete comments |
| `/api/feedback` | GET/POST | Usefulness feedback |
| `/api/progress/*` | GET/POST | Reading progress |
| `/api/views` | POST | Page view counter |
| `/api/admin/comments/*` | CRUD | Admin comment moderation |
| `/api/blog/like` / `/api/blog/follow` | POST | Blog interactions |
| `/api/v1/*` | GET | Mobile app API (subjects, lectures, content) |

---

## Project Structure

```
src/
├── components/     # Astro components (Navbar, Footer, SearchModal, Comments, etc.)
├── content/
│   ├── notes/      # Lecture notes by subject (HTML + JSON)
│   └── blog/       # Blog posts
├── data/           # Site config (subjects catalog, support channels)
├── db/             # D1 schema + migrations
├── layouts/        # BaseLayout, BlogPostLayout
├── lib/            # Server logic (auth, comments, bookmarks, moderation, etc.)
├── pages/          # Astro routes (pages + API endpoints)
├── styles/         # global.css, tokens.css, lecture-notes.css, prose.css
├── utils/          # notesLoader, blogLoader, htmlParser, metadata, etc.
├── middleware.ts   # Session, security headers, CSP, caching
└── env.d.ts        # Type declarations

scripts/            # Build utilities (audit, deploy guard, blog scaffolding)
test/               # Vitest unit tests (20 files)
e2e/                # Playwright E2E tests (3 spec files)
public/             # Static assets (fonts, favicons, lecture-notes.css)
```

---

## Commands

| Command | Action |
|---------|--------|
| `npm install` | Install dependencies |
| `npm run dev` | Start dev server at `localhost:4321` |
| `npm run build` | Type-check + build production site to `./dist/` |
| `npm run preview` | Preview production build locally |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run deploy` | Build + deploy to Cloudflare Workers |
| `npm run upload-notes` | Upload notes HTML/JSON to R2 |
| `npm run audit:theme` | Audit CSS colors against design token allowlist |
| `npm run blog:new` | Scaffold a new blog post |
| `npm run generate-types` | Generate Workers types from `wrangler.jsonc` |
| `npm run db:migrate:local` | Run D1 migrations locally |
| `npm run db:migrate:remote` | Run D1 migrations on production DB |

---

## Content Authoring

### Lectures

```
src/content/notes/<Subject>/<LectureFolder>/
├── notes.html          # required: lecture content
└── notes.json          # optional: metadata (summary, quiz, etc.)
```

- `notes.html` should contain a `<body>` with the lecture content and can include `<style>` blocks (scoped to `.lecture-notes-wrapper` at parse time).
- `notes.json` can include `summary`, `keyConcepts`, `sections`, `quiz`, `examRevisionNotes`, etc. See existing notes for examples.
- If no `notes.json` is provided, a fallback study guide is generated from the folder name.

### Cross-lecture Resources

Named resources that span a whole subject (rather than a single lecture) reuse the same pipeline — no second publishing system. Place each resource in its own subfolder:

```
src/content/notes/<Subject>/<ResourceFolder>/
├── resource.html       # required: the resource content
└── resource.json       # required: metadata
```

`resource.json` fields:

| Field | Value |
|-------|-------|
| `resourceKind` | `race-card` \| `one-sheet` \| `concept-map` \| `worksheet` \| `question-bank` \| `solved-paper` |
| `scope` | `"subject"` |
| `topicTitle` | Human title, e.g. `"MDP → DP → MC → TD"` |
| `sortOrder` | `1000` (sorts after lectures) |
| `availableModes` | e.g. `["notes", "exam-revision"]` |
| `shortDescription` | Card / list blurb |

HTML conventions: race cards reuse `.algorithm-trace` / `.trace-step` classes, concept maps use `.concept-map` / `.cm-*` classes, one-sheets use `.one-sheet-flow` / `.os-*` classes. All colors must be design tokens — run `npm run audit:theme` after editing content CSS.

---

## Design System

Centralized in `src/styles/tokens.css` — warm paper/ink color palette with a "study green-teal" accent. Consumed by:
- **Tailwind** via `src/styles/global.css`
- **Lecture content** via `src/styles/lecture-notes.css`

All content CSS colors must use design tokens (CSS custom properties). Run `npm run audit:theme` to verify.

---

## Deployment

Deploys to **bitsnotes.com** / **www.bitsnotes.com** via Cloudflare Workers.

1. Set required secrets: `SESSION_SIGNING_KEY`, OAuth client IDs, Turnstile keys, Zoho/ZeptoMail credentials
2. `npm run deploy` — runs guard checks, builds, and deploys
3. `npm run upload-notes` — syncs note content to R2
4. `npm run db:migrate:remote` — applies D1 schema to production

The `@astrojs/cloudflare` adapter serves static assets from the Workers `ASSETS` binding, with server-rendered endpoints for auth, comments, contact form, and legacy redirects.

---

## Testing

- **Unit tests** (Vitest): `src/test/` — 20 test files covering auth, comments, feedback, progress, crypto, moderation, HTML parsing, middleware, and more.
- **E2E tests** (Playwright): `e2e/` — 3 spec files covering browse + support flow, comments + feedback, and theme + navigation. Runs 3 browser projects (Chrome desktop, Chrome mobile, Firefox).
- **Visual checklist:** `src/test/visual-matrix.md` — manual regression checklist for visual verification.

---

## Security

- Do **not** commit real credentials to tracked files. Use Cloudflare Worker secrets or `.env` (git-ignored).
- Contact form sanitizes header fields and uses a honeypot for bot detection.
- Security headers (CSP, HSTS, X-Frame-Options, etc.) applied via middleware.
- Auth endpoints protected with CSRF validation, Turnstile, and rate limiting.
- Comment content filtered through profanity detection, spam scoring, and blocked-term lists.
- Session tokens use HMAC signing; verification tokens are SHA-256 hashed at rest.

---

## Environment & Configuration

**Cloudflare bindings** (configured in `wrangler.jsonc`): `DB` (D1), `NOTES_BUCKET` (R2), `NEWSLETTER_KV` (KV), `SEND_EMAIL` (Email Service), `COMMENT_RATE_LIMITER`, `FEEDBACK_RATE_LIMITER`, `ASSETS`.

**Secrets** (set via `wrangler secret put`): session signing key, Google/GitHub OAuth credentials, Turnstile keys, Zoho/ZeptoMail credentials, API secret key.

**Local dev:** Copy secrets to `.dev.vars` (git-ignored). Dev server uses Vite glob imports for content (no R2 needed).
