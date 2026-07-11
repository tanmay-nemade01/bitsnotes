# Sign Up / Sign In — Implementation Plan

## Architecture summary

| Concern | Decision |
|---|---|
| Auth method | OAuth social login (Google + GitHub) |
| Storage | Cloudflare D1 (SQLite) |
| Account purpose | Public now, **entitlements/billing-ready** for future paid tiers |
| Email verification | Required before account is active |
| MFA | Not in v1 (designed to slot in later) |
| Sessions | Stateless signed JWT in `HttpOnly; Secure; SameSite=Strict` cookie |
| Abuse protection | Cloudflare Turnstile on forms + edge rate-limit rules |

---

## 1. New Cloudflare bindings & config

**`wrangler.jsonc`** — add:
- `d1_databases`: `DB` → `bitsnotes_auth` (new database, create via `wrangler d1 create`)
- `vars`: `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, `APP_BASE_URL` (secrets via `wrangler secret put`)
- `secrets`: `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`, `SESSION_SIGNING_KEY` (Ed25519 or HMAC-SHA256 key, 32+ bytes)
- `send_email`: already present — reuse for verification emails

**OAuth app setup (manual, outside code):**
- Google Cloud Console → OAuth client (Web), authorized redirect: `https://bitsnotes.com/api/auth/callback/google`
- GitHub Developer Settings → OAuth App, callback: `https://bitsnotes.com/api/auth/callback/github`
- Cloudflare Turnstile → create widget, get site key (public) + secret key

---

## 2. D1 schema (`src/db/schema.sql`)

```sql
-- Users: one row per identity. `email` is unique and verified.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- UUID v7
  email         TEXT NOT NULL UNIQUE,
  email_verified_at INTEGER,               -- NULL until verified
  display_name  TEXT,
  avatar_url    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'  -- pending|active|suspended|deleted
);

-- OAuth identities linked to a user (supports multiple providers per user)
CREATE TABLE identities (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,             -- 'google' | 'github'
  provider_uid  TEXT NOT NULL,             -- provider's stable user id
  created_at    INTEGER NOT NULL,
  UNIQUE(provider, provider_uid)
);

-- Entitlements: future-paid hook. v1 has one row per active user with tier='free'.
CREATE TABLE entitlements (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier          TEXT NOT NULL DEFAULT 'free',  -- free|pro|... (extensible)
  expires_at    INTEGER,                     -- NULL = never expires
  source        TEXT NOT NULL DEFAULT 'manual', -- manual|stripe|...
  updated_at    INTEGER NOT NULL
);

-- Email verification tokens (single-use, short TTL)
CREATE TABLE verification_tokens (
  token_hash    TEXT PRIMARY KEY,           -- SHA-256 of token
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose       TEXT NOT NULL,              -- 'signup' | 'email_change'
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER
);

-- Audit log: security-sensitive events
CREATE TABLE auth_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT,
  event         TEXT NOT NULL,              -- signup|login|logout|verify|failed_login|...
  provider      TEXT,
  ip            TEXT,
  ua            TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_identities_provider_uid ON identities(provider, provider_uid);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_auth_events_user ON auth_events(user_id, created_at);
```

Migration runner: `src/db/migrate.ts` — runs on first request if `DB` schema version is stale (stored in a `_meta` table). Idempotent.

---

## 3. New files

```
src/
  lib/
    auth/
      crypto.ts        # HMAC signing, token generation, hashing
      session.ts       # JWT issue/verify, cookie helpers
      oauth.ts         # Google/GitHub authorize URLs + token exchange + profile fetch
      turnstile.ts     # server-side Turnstile verification
      db.ts            # D1 prepared-statement wrappers
      audit.ts         # auth_events writer
  db/
    schema.sql
    migrate.ts
  middleware.ts        # extend existing: attach `locals.user` from cookie
  pages/
    auth/
      signup.astro
      signin.astro
      signout.astro        # POST only, CSRF-protected
      verify-email.astro   # landing after clicking email link
      auth.astro           # "choose provider" hub (used by both signup & signin)
    api/
      auth/
        signup.ts          # POST: validate Turnstile, create pending user, send verification email
        signin.ts          # POST: validate Turnstile, redirect to OAuth provider
        callback/
          [provider].ts    # OAuth callback: exchange code, upsert user+identity, set session cookie, redirect
        verify-email.ts    # GET ?token=...: consume token, mark email_verified_at, set active
        signout.ts         # POST: clear cookie (stateless = just expire), audit log
```

---

## 4. Security controls (per requirement: security is top priority)

### Auth flow
- OAuth state + PKCE per attempt; state stored in a short-lived `__oauth_state` HttpOnly cookie (10 min TTL), validated on callback.
- `redirect_uri` fixed server-side; never taken from query params (prevent open redirect).
- On callback: verify `state`, exchange code server-side, fetch profile from provider's userinfo endpoint (don't trust claims in the ID token alone for GitHub).
- Email from provider is **not** trusted as verified unless provider explicitly says so (Google `email_verified=true`; GitHub only if primary verified). Otherwise we still send our own verification email.

### Sessions
- JWT signed with `SESSION_SIGNING_KEY` (HMAC-SHA256, 32-byte secret in Wrangler secrets).
- Claims: `sub` (user id), `email`, `tier`, `iat`, `exp` (15 min access), `rt` (refresh token id).
- Refresh token: opaque random token, SHA-256 stored in a `refresh_tokens` table, rotated on each use, 30-day TTL, revocable.
- Cookie: `__session`; `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`.
- Refresh cookie: `__rt`; `HttpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh; Max-Age=2592000`.
- No `localStorage`/`sessionStorage` tokens ever.

### CSRF
- All state-changing POST endpoints (`signup`, `signin`, `signout`, `verify-email` resends) require either:
  - SameSite=Strict cookie (default protection), **and**
  - `Origin`/`Referer` header check against `APP_BASE_URL`.
- OAuth `state` param doubles as CSRF token for the OAuth leg.

### Turnstile
- Client widget on `/auth/signup` and `/auth/signin`.
- Server verifies token at `https://challenges.cloudflare.com/turnstile/v0/siteverify` with secret + remote IP. Idempotency key per attempt.

### Rate limiting (Cloudflare dashboard rules)
- `/api/auth/signup`: 5 req / 10 min / per IP.
- `/api/auth/signin`: 10 req / 10 min / per IP.
- `/api/auth/callback/*`: 20 req / 10 min / per IP.
- `/api/auth/verify-email`: 30 req / hour / per IP.
- Email-send endpoints: 3 / hour / per IP (prevents verification-email abuse).

### Email verification
- Token: 32 random bytes, base64url. Store only `SHA-256(token)` in `verification_tokens`.
- TTL: 24 h. Single-use (`consumed_at` set on success).
- Link: `https://bitsnotes.com/api/auth/verify-email?token=...` → on success, redirect to `/auth/verify-email?ok=1`.
- Pending users cannot sign in (session issue blocked while `status='pending'`).
- Resend endpoint with the same rate limit.

### Input validation
- All API inputs validated with typed guards; reject on any unexpected field.
- Email normalized (lowercase, trim) before uniqueness check.
- Display name: max 80 chars, stripped of control chars.

### Audit log
- Every event in `auth_events`: signup, login (per provider), logout, verify, failed login, OAuth state mismatch, Turnstile fail, rate-limit hit (best-effort).
- Retained 90 days (cron cleanup via Cloudflare Cron Trigger, optional v1.1).

### Headers (extend existing middleware)
- Add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (currently missing).
- Add `Cross-Origin-Opener-Policy: same-origin`.
- Move CSP from `Report-Only` to enforcing **only on `/auth/*` and `/api/auth/*`** (lock down those routes hard; leave the rest report-only until AdSense/GA verified).
- `Cache-Control: no-store` on all auth pages and API responses.

### Secrets hygiene
- All secrets via `wrangler secret put`, never in `wrangler.jsonc` or env files.
- `SESSION_SIGNING_KEY` rotation procedure documented: rotate refresh tokens on next refresh.
- OAuth client secrets never logged; redact in error responses.

### D1 access
- All queries via parameterized prepared statements (`db.prepare('...').bind(...)`). No string concatenation.
- Row-level checks always scoped by `user_id` from session, never from request body.

---

## 5. UX / pages

- `/auth/signup` — heading "Create your account", provider buttons (Google, GitHub), Turnstile widget, link to `/auth/signin`. No password fields.
- `/auth/signin` — heading "Sign in", same provider buttons, Turnstile, link to signup.
- `/auth/verify-email` — three states: `?ok=1` success, `?pending` waiting-for-click (shown right after signup), `?error=...` failure.
- `/auth/signout` — POST form with a "Sign out" button; on success redirect to `/`.
- Navbar: show "Sign in" link when logged out; show display name + avatar + dropdown (Sign out) when logged in. Reads from `Astro.locals.user`.

---

## 6. Middleware changes (`src/middleware.ts`)

- For every request, read `__session` cookie → verify JWT → load user + entitlement from D1 → set `Astro.locals.user` and `Astro.locals.tier`.
- Refresh flow: if access JWT expired but `__rt` present and valid, issue new pair, set cookies, continue.
- On auth pages: redirect to `/` if already signed in.
- Keep existing security headers; add the new ones listed above.

---

## 7. Build / deploy changes

- `package.json`: add `db:migrate` script (`wrangler d1 execute bitsnotes_auth --file=src/db/schema.sql --remote` and `--local` variants).
- `astro.config.mjs`: no change needed (already `output: 'static'` with Cloudflare adapter; auth pages use `export const prerender = false`).
- CI: add a step to run migrations before `wrangler deploy`.

---

## 8. Testing checklist (manual + scripted)

- OAuth happy path for Google and GitHub.
- State mismatch → 400 + audit log, no session.
- Email verification: token reuse → 410; expired → 410; valid → active.
- Pending user tries to sign in → blocked with "verify your email" message.
- CSRF: POST from foreign origin → 403.
- Turnstile failure → 400.
- Rate limit: 6th signup in 10 min → 429.
- Cookie flags verified via DevTools.
- Refresh token rotation: old `__rt` rejected after refresh.
- Entitlements: `tier` flows into JWT; future Stripe webhook can update `entitlements` table.

---

## 9. Out of scope for v1 (explicit non-goals)

- MFA / passkeys (designed to slot in: add `mfa_factors` table, gate on `users.mfa_enrolled`).
- Password login (no `password_hash` column — keeps breach surface zero).
- Stripe integration (only the `entitlements` table + webhook stub reserved).
- Account deletion / data export UI (DB schema supports it; build later for GDPR compliance).
- Session revocation UI (stateless JWT can't be revoked without a blocklist; refresh tokens can be revoked).

---

## 10. User Features — Bookmarks, Inline Notes & Reading Progress

All features below are **auth-gated**: anonymous users see nothing. Data lives server-side in D1 (no localStorage caching).

### 10.1 Bookmarks with Named Collections

**What the user sees:**
- A **bookmark icon** (outlined star → filled star) on every lecture row in subject pages (`/subject/[subject]`) and in the sidebar of the viewer (`/view/[...path]`).
- A dedicated **`/bookmarks`** page listing all saved lectures **grouped by collection**.
- A **"Recently saved"** widget on the **dashboard** (`/index.astro`) for logged-in users showing the 5 most recently bookmarked lectures.

**Collections:**
- Every user starts with a **default collection** called "Saved" (auto-created on first bookmark).
- Users can **create, rename, and delete** custom collections (e.g. "Exam Prep", "Review Later").
- A bookmark can belong to **one collection at a time** (drag-to-move in v2; dropdown picker in v1).
- When bookmarking a lecture the user picks a collection from a small dropdown popover (default: "Saved").

**D1 tables:**
```sql
-- Named collections
CREATE TABLE collections (
  id            TEXT PRIMARY KEY,          -- UUID v7
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  UNIQUE(user_id, name)
);

-- Individual bookmarks (each points to exactly one lecture)
CREATE TABLE bookmarks (
  id            TEXT PRIMARY KEY,          -- UUID v7
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  subject       TEXT NOT NULL,             -- e.g. "Artificial Computational Intelligence"
  lecture       TEXT NOT NULL,             -- folderName e.g. "ACI_Lecture_1_Notes"
  display_name  TEXT NOT NULL,             -- human-readable lecture name
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_bookmarks_user   ON bookmarks(user_id);
CREATE INDEX idx_bookmarks_coll   ON bookmarks(user_id, collection_id);
CREATE INDEX idx_collections_user ON collections(user_id);
```

**API endpoints:**
```
POST   /api/bookmarks/add        { subject, lecture, displayName, collectionId? }
DELETE /api/bookmarks/remove     { subject, lecture }
PUT    /api/bookmarks/move       { bookmarkId, collectionId }
POST   /api/collections/create   { name }
PUT    /api/collections/rename   { collectionId, name }
DELETE /api/collections/delete   { collectionId }
GET    /api/bookmarks/list       → JSON: collections[] + uncategorized bookmarks[]
```

Every endpoint: verify session, audit log `bookmark_add` / `bookmark_remove` / etc.

---

### 10.2 Inline Highlights + Notes

**What the user sees:**
- **Select any text** inside the lecture HTML → a small **floating toolbar** appears with two options:
  1. **Highlight** (yellow background, persisted).
  2. **Add note** (highlight + a popover text field for a personal annotation).
- **Sidebar panel** (toggle button in viewer) shows a chronological list of all highlights/notes for the current lecture, with a "jump to" anchor.
- Clicking a highlight re-opens the note popover (if any) and shows the annotation text.
- Highlights are **color-coded**: yellow = highlight only, blue = highlight + note.

**How it works technically:**
- The lecture HTML is wrapped in a `<div class="lecture-content" id="lecture-content" data-subject="..." data-lecture="...">` container.
- On `mouseup`, a `<script is:inline>` in the viewer page:
  1. Gets the current `Selection` range.
  2. Checks the selection is within `#lecture-content`.
  3. Shows a positioned floating toolbar at the selection anchor point.
- On "Highlight" click: the script serializes the selection as a **CSS selector path** (e.g. `#lecture-content > div:nth-child(3) > p:nth-child(2)` + start/end text offsets). This is sent to the server and stored; on re-render, a `<mark>` is injected.
- On "Add note" click: same highlight logic + a `textarea` popover for the note body.
- Each highlight gets a **unique ID** (`hl-{uuid}`) assigned client-side and stored server-side so re-visits can restore them.

**D1 tables:**
```sql
-- Individual highlights / annotations
CREATE TABLE highlights (
  id            TEXT PRIMARY KEY,          -- UUID v7
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject       TEXT NOT NULL,
  lecture       TEXT NOT NULL,
  -- CSS selector path locating the anchor node relative to #lecture-content
  selector_path TEXT NOT NULL,
  -- Character offsets within the anchor node's textContent for start/end
  start_offset  INTEGER NOT NULL,
  end_offset    INTEGER NOT NULL,
  -- Optional personal note body (NULL = highlight only, non-NULL = highlight + note)
  note_body     TEXT,
  color         TEXT NOT NULL DEFAULT 'yellow',  -- 'yellow' | 'blue'
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_highlights_user_lec ON highlights(user_id, subject, lecture);
```

**Viewer page changes (`/view/[...path].astro`):**
- Pass `Astro.locals.user` (from middleware) into the frontmatter so the highlight script can conditionally run.
- Add `<script is:inline>` block (only when `user` exists) that:
  - On page load: fetches `GET /api/highlights/list?subject=...&lecture=...` and injects `<mark>` elements into the DOM.
  - Listens for `mouseup` → shows floating toolbar.
  - Sends `POST /api/highlights/save` / `DELETE /api/highlights/remove` to persist.
- Add a **"My Notes" toggle button** in the viewer toolbar (between tabs and content) that opens/closes the highlights sidebar panel.

**API endpoints:**
```
POST   /api/highlights/save    { subject, lecture, selectorPath, startOffset, endOffset, noteBody?, color }
DELETE /api/highlights/remove  { highlightId }
PUT    /api/highlights/update  { highlightId, noteBody }
GET    /api/highlights/list    ?subject=...&lecture=...  → JSON: highlights[]
```

**Security:**
- All selectors validated server-side: must start with `#lecture-content`, no `javascript:` or event handlers.
- `noteBody` max 2000 chars, sanitized (strip tags).
- User can only access their own highlights (WHERE user_id = session user).

---

### 10.3 Reading Progress Tracking

**What the user sees:**
- **Subject pages** (`/subject/[subject]`): each lecture row gets a small **progress dot**:
  - ⬤ (filled accent) = fully read
  - ◔ (half) = partially read (>20% scrolled)
  - ○ (empty) = unread
- **Dashboard** (`/index.astro`): subject cards show a **completion percentage bar** and text like "5 / 8 lectures read".
- No explicit "mark as read" button — progress is **auto-tracked on scroll**.

**How it works:**
- In the viewer page, a scroll listener tracks the maximum scroll percentage reached.
- When the user scrolls past **80%** of the lecture content, a `POST /api/progress/mark-read` fires (debounced, at most once per lecture per session).
- The server records `last_read_at` and `read_pct` (max % scrolled).

**D1 tables:**
```sql
CREATE TABLE reading_progress (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject       TEXT NOT NULL,
  lecture       TEXT NOT NULL,
  read_pct      INTEGER NOT NULL DEFAULT 0,   -- 0-100, max scroll ever reached
  last_read_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, subject, lecture)
);
```

**API endpoints:**
```
POST /api/progress/mark-read   { subject, lecture, readPct }
GET  /api/progress/list        ?subject=...  → JSON: { lectures: [{ lecture, readPct, lastReadAt }], totalRead, totalCount }
```

**Viewer page additions:**
- `<script is:inline>` (only when logged in) that:
  - On scroll: calculates `scrollTop / (scrollHeight - clientHeight) * 100`.
  - When pct > current server pct and pct >= 80: debounced `POST /api/progress/mark-read`.
  - Fires once on page load if pct already >= 80 (to mark lectures the user has scrolled through).

---

### 10.4 New Pages

#### `/bookmarks` (dynamic, `prerender = false`)

Layout:
- **Left column (260px):** Collection list (vertical nav). "All" (uncategorized), "Saved" (default), user-created collections. Clicking one filters the main list. At bottom: "+ New collection" button.
- **Main area:** Lecture cards grouped by collection (or flat if a specific collection is selected). Each card shows: subject, lecture name, date added, and a "…" menu (Move to collection / Remove).
- **Empty state:** "No bookmarks yet. Star any lecture to save it here."

Route protection: redirect to `/auth/signin` if not logged in.

#### Dashboard additions (`/index.astro`)

When `Astro.locals.user` exists, prepend below the search:
- **"Recently saved"** horizontal row (max 5 cards) — small cards with subject + lecture name + star icon. Clicking navigates to the viewer.
- **"Your progress"** section: subject cards with a small progress bar underneath the lecture count.

---

### 10.5 D1 migration additions

Add to `src/db/schema.sql` after the auth tables (Section 2):
```sql
-- ─── Bookmarks & Collections ──────────────────────────────────────
-- (full CREATE TABLE statements from 10.1)

-- ─── Highlights & Notes ───────────────────────────────────────────
-- (full CREATE TABLE statements from 10.2)

-- ─── Reading Progress ─────────────────────────────────────────────
-- (full CREATE TABLE statements from 10.3)
```

---

### 10.6 New files to create

```
src/
  lib/
    auth/
      bookmarks.ts     # D1 queries: add/remove/list bookmarks, CRUD collections
      highlights.ts    # D1 queries: save/remove/list highlights, selector validation
      progress.ts      # D1 queries: mark-read, list progress
  pages/
    bookmarks.astro                # /bookmarks (prerender=false)
    api/
      bookmarks/
        add.ts                     # POST add bookmark
        remove.ts                  # DELETE remove bookmark
        move.ts                    # PUT move to collection
        list.ts                    # GET all bookmarks + collections
      collections/
        create.ts                  # POST create collection
        rename.ts                  # PUT rename collection
        delete.ts                  # DELETE collection
      highlights/
        save.ts                    # POST save highlight/note
        remove.ts                  # DELETE remove highlight
        update.ts                  # PUT update note body
        list.ts                    # GET list highlights for a lecture
      progress/
        mark-read.ts               # POST mark lecture as read
        list.ts                    # GET progress for a subject
  components/
    BookmarkButton.astro           # Reusable star icon component (props: subject, lecture, displayName, isBookmarked, collectionId)
    HighlightToolbar.astro         # Floating toolbar + sidebar panel (rendered via <script is:inline>)
    ProgressBar.astro              # Small horizontal bar used on subject pages and dashboard
    CollectionPicker.astro         # Dropdown popover for choosing a collection when bookmarking
    RecentlySaved.astro            # Dashboard widget for logged-in users
```

**Existing files to modify:**
- `src/pages/view/[...path].astro` — inject `HighlightToolbar` + progress script (when logged in).
- `src/pages/subject/[subject].astro` — add `ProgressBar` + `BookmarkButton` to each lecture row (when logged in).
- `src/pages/index.astro` — add `RecentlySaved` widget + progress bars on subject cards (when logged in).
- `src/components/Navbar.astro` — add Bookmarks link (when logged in).
- `src/components/Footer.astro` — add Bookmarks link in Browse section.

---

### 10.7 API security (all new endpoints)

| Control | Detail |
|---|---|
| Auth required | Every bookmarks/highlights/progress endpoint returns `401` if no valid session. |
| CSRF | `Origin`/`Referer` check + `SameSite=Strict` cookie (same as auth endpoints). |
| Input validation | Subject & lecture params validated against known values from `notesLoader.listSubjects()` / `listLectures()`. Reject unknown subjects/lectures. |
| Row ownership | All queries filtered by `user_id` from session, never from request body. |
| Rate limit | Bookmark CRUD: 30 req/min/IP. Highlight CRUD: 30 req/min/IP. Progress: 10 req/min/IP. |
| Audit | `bookmark_add`, `bookmark_remove`, `highlight_save`, `highlight_remove`, `progress_mark_read` events logged. |

---

### 10.8 Testing checklist (user features)

- Bookmark a lecture → appears in `/bookmarks` under "Saved".
- Create collection → move bookmark → verify new collection.
- Delete collection → bookmarks move to uncategorized.
- Inline highlight: select text → highlight appears as yellow `<mark>`.
- Add note → highlight turns blue, note visible in sidebar panel.
- Re-visit lecture → highlights/notes restored from D1.
- Remove highlight → `<mark>` removed, note deleted.
- Scroll past 80% → progress dot updates on subject page.
- Dashboard shows correct completion % per subject.
- Anonymous user sees no bookmark/progress/highlight UI elements.
- Cross-user isolation: User A cannot see User B's highlights.

---

## Open items — please write your answers below each question

### Q1. OAuth providers
**Google + GitHub as planned, or add Microsoft / LinkedIn too?**

> _Your answer:_Google + Github is sufficient for now. We can consider adding Microsoft or LinkedIn later if user demand indicates a need for it.

---

### Q2. Display name & avatar
**Pull from provider on first signup, or ask the user to fill them in a profile step?**

> _Your answer:_ Pull from provider on first signup. This will streamline the signup process and reduce friction for users. We can allow users to edit their display name and avatar later in their profile settings if they wish to customize them.

---

### Q3. Pending-user cleanup
**Delete unverified accounts after how many days? (Suggest 7)**

> _Your answer:_ 7 days

---

### Q4. Session lifetime
**15 min access / 30 day refresh OK, or do you want stricter (e.g. 8 h sliding)?**

> _Your answer:_ 15 min access / 30 day refresh is acceptable for now.

---

### Q5. Turnstile mode
**`managed` (invisible, recommended) or `interactive` checkbox?**

> _Your answer:_managed

---

### Q6. HSTS preload
**OK to submit bitsnotes.com to the HSTS preload list? (One-way; takes time to remove.)**

> _Your answer:_ Yes, it is okay to submit bitsnotes.com to the HSTS preload list. This will enhance security by ensuring that browsers always connect to the site over HTTPS.

---

### Q7. Audit log retention
**90 days OK, or do you have a compliance requirement that dictates otherwise?**

> _Your answer:_ 90 days is acceptable for now.
