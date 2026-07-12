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
- **Self-hosted Inter font**, scroll progress, back-to-top

## Adding a new lecture

```text
src/content/notes/<Subject>/<LectureFolder>/
├── notes.html          # required: the lecture content
└── notes.json          # optional: metadata (summary, quiz, etc.)
```

- `notes.html` should contain a `<body>` with the lecture content and can include `<style>` blocks.
- `notes.json` can include `summary`, `keyConcepts`, `sections`, `quiz`, `examRevisionNotes`, etc. See existing notes for examples.
- If no `notes.json` is provided, a fallback study guide is generated from the folder name.

## Cross-lecture resource authoring

Named resources that span a whole subject (rather than a single lecture) reuse the
same pipeline as lectures — there is **no second publishing system**. Place each
resource in its own subfolder with a `resource.html` + `resource.json`:

```text
src/content/notes/<Subject>/<ResourceFolder>/
├── resource.html       # required: the resource content
└── resource.json       # required: metadata describing the resource
```

`resource.json` must set the catalog fields that distinguish it from a lecture:

| Field | Value |
|---|---|
| `resourceKind` | `race-card` \| `one-sheet` \| `concept-map` \| `worksheet` \| `question-bank` \| `solved-paper` |
| `scope` | `"subject"` |
| `topicTitle` | Human title, e.g. `"MDP → DP → MC → TD"` (no lecture number) |
| `sortOrder` | `1000` (sorts after lectures) |
| `availableModes` | e.g. `["notes", "exam-revision"]` |
| `shortDescription` | Card / list blurb |

The viewer derives its tab label and sidebar grouping from `resourceKind`/`scope`
(no fabricated lecture number), and the catalog (home, subject, browse-all, search,
bookmarks, JSON-LD) shows the real `topicTitle`.

### HTML conventions

- `resource.html` is a normal lecture-style document: a `<body>` with content and
  optional `<style>` blocks (scoped to `.lecture-notes-wrapper` at parse time).
- **Race cards** should reuse the existing `.algorithm-trace` / `.trace-step`
  classes already in `lecture-notes.css`.
- **Concept maps** use `.concept-map` / `.cm-branch` / `.cm-node` / `.cm-leaf` /
  `.cm-link` (a root node plus one branch per family, each linking to its lecture).
- **One sheets** use `.one-sheet-flow` / `.os-stage` / `.os-num` / `.os-arrow` for
  the pipeline, plus standard `.callout` and `table` elements.
- All colors must be design tokens (or within the existing lecture-content
  allowlist). Run `npm run audit:theme` after editing content CSS.
- Each resource should include: concept placement, I/O, assumptions, comparisons,
  common mistakes, one worked example, links to numbered lectures, and a
  mobile-accessible layout.

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
