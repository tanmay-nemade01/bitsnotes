# BitsNotes — Agent Architecture Guide & Context Map

Welcome to **BitsNotes**. This file serves as an architectural index and set of ground rules for AI agents. Always read this file before performing wide directory scans or deep multi-file searches.

---

## 1. Tech Stack & Environment

| Layer | Technology & Details |
|---|---|
| **Framework** | [Astro](https://astro.build) (Static + SSR hybrid via `@astrojs/cloudflare`) |
| **Runtime** | Cloudflare Workers (`cloudflare()` adapter) |
| **Styling** | Tailwind CSS v4 (`@tailwindcss/vite`) + Design tokens in `src/styles/tokens.css` |
| **Database** | Cloudflare D1 (SQLite at the edge) via `src/db/` |
| **Storage** | Cloudflare R2 (production) / Vite glob imports (local development) |
| **Auth** | OAuth (Google/GitHub) + Email verification + JWT sessions in `src/middleware.ts` & `src/lib/auth/` |
| **Tests** | Vitest (`npm test`) & Playwright (`npm run test:e2e`) |

---

## 2. Codebase Map: Where Everything Lives

Directly navigate to the files listed below instead of executing repository-wide searches.

### A. Backend Services & Business Logic (`src/lib/`)
*All database queries and business logic live here, not in route files.*
- `src/lib/comments.ts` & `commentsValidation.ts` — D1 queries for comments, thread trees, voting.
- `src/lib/bookmarks.ts` — Bookmarks and collection management.
- `src/lib/progress.ts` — User lecture reading progress & streak tracking.
- `src/lib/users.ts` — User accounts, profiles, and auth record operations.
- `src/lib/auth/` — Session handling, OAuth providers, token generation.
- `src/lib/chatbotRetrieval.ts` — AI doubt-solver context retrieval.
- `src/lib/apiHelpers.ts` — Standard JSON response formatters & error wrappers.
- `src/lib/getEnv.ts` — Environment variables & Cloudflare bindings accessor.

### B. API Routes (`src/pages/api/`)
*All dynamic API endpoints live here. Every dynamic route file MUST include `export const prerender = false;`.*
- `src/pages/api/comments/` — Comment CRUD, replies, like/upvote endpoints.
- `src/pages/api/bookmarks/` & `collections/` — User bookmark management.
- `src/pages/api/auth/` — Login, callback, logout, verification routes.
- `src/pages/api/progress/` — Progress tracking endpoints.
- `src/pages/api/feedback/` — User usefulness feedback endpoints.
- `src/pages/api/chatbot/` — Chatbot streaming / query endpoints.
- `src/pages/api/bits/` & `blog/` — Interactions for bits and blog posts.

### C. UI Components (`src/components/`)
- **Navigation & Layout:** `Navbar.astro`, `Footer.astro`, `ThemeToggle.astro`.
- **Search:** `SearchModal.astro` (Ctrl+K global search).
- **Comments & Feedback:** `CommentsSection.astro`, `UsefulnessFeedback.astro`.
- **Engagement:** `BookmarkButton.astro`, `CollectionPicker.astro`, `RecentlySaved.astro`.
- **Study Tools:** `PomodoroTimer.astro`, `ChatbotPanel.astro`.
- **Banners & Modals:** `BannerCarousel.astro`, `CookieConsent.astro`.
- **Subdirectories:**
  - `src/components/bits/` — Bit feed cards and interactive elements.
  - `src/components/blog/` — Blog article cards, tag filters, author info.
  - `src/components/admin/` — Admin dashboard widgets.

### D. Content & Loaders (`src/content/` & `src/utils/`)
- `src/content/notes/` — Core study notes (HTML + metadata JSON).
- `src/content/blog/` & `bits/` — Markdown/MDX content.
- `src/utils/notesLoader.ts` — Loads note content from R2 or local filesystem.
- `src/utils/searchEngine.ts` — Client/server search indexing logic.
- `src/utils/mathRender.ts` — KaTeX math expression rendering.

### E. Database Schema & Migrations (`src/db/`)
- `src/db/schema.sql` — Single source of truth for D1 database tables and indexes.
- `src/db/migrations/` — Versioned migration files.

### F. Styling System (`src/styles/`)
- `src/styles/tokens.css` — **Primary design tokens** (colors, typography, theme variables).
- `src/styles/global.css` — Tailwind imports and global base layer.
- `src/styles/lecture-notes.css` — Dedicated lecture note formatting rules.

---

## 3. Critical Rules for AI Agents

1. **Never Search or Read Giant Generated Files:**
   - `worker-configuration.d.ts` (566 KB) — Cloudflare auto-generated types.
   - `.*-upload-cache.json` — Synchronization cache files.
   - `dist/`, `.astro/`, `.wrangler/` — Build artifacts.

2. **Design Tokens Over Hardcoded CSS:**
   - Always reference CSS variables defined in `src/styles/tokens.css` or Tailwind theme utility classes. Do not hardcode random hex values in markup.

3. **Database Interaction Standards:**
   - Use Cloudflare D1 prepared statements:
     ```ts
     const db = getD1Database(locals);
     const result = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
     ```
   - Keep SQL queries inside `src/lib/` service files, not inline inside Astro page templates.

4. **Component Modularity (Avoid Bloat):**
   - When adding features to large files (like `CommentsSection.astro` or `support.astro`), extract complex client scripts or child UI chunks into `src/lib/` or subcomponents instead of inlining hundreds of new lines.

---

## 4. Key Verification Commands

```bash
# Verify TypeScript & Astro types
npx astro check

# Run unit tests
npm test

# Run build verification (includes theme color audit)
npm run build

# Run local D1 database migration (if schema was altered)
npm run db:migrate:local
```
