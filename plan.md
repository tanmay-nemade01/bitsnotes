# BitsNotes — Code Analysis & Improvement Plan
 
> **Audience:** the site owner (non-developer).
> **Goal:** explain what the codebase does well, what can be improved, and what is
> outright risky — then give a concrete, prioritized plan to fix it **without
> changing the core of the website**.
>
> **What "the core" means here (must NOT change):**
> - It stays an **Astro + Tailwind** site deployed on **Cloudflare Workers**.
> - Notes stay as **HTML files committed to git** under `src/content/notes/`,
>   loaded at build time, and shown in the **viewer with tabs** (Lecture Notes /
>   Study Guide / Exam Revision / Practice Quiz).
> - The **SEO + AdSense "rich study guide" model** stays.
> - The visual look & feel (indigo theme, dark mode, cards) stays.
>
> Everything below is an *improvement* on top of that core, not a rewrite.
 
---
 
## 0. What the website is (quick mental model)
 
A study-notes website for postgraduate AI/ML subjects. Each lecture is an HTML
file in `src/content/notes/<Subject>/<LectureFolder>/`. At build time the code
reads those files (`src/utils/notesLoader.ts`), and renders pages:
 
- `/` — list of subjects (`src/pages/index.astro`)
- `/subject/<Subject>` — list of lectures (`src/pages/subject/[subject].astro`)
- `/view/<Subject>/<Lecture>` — the lecture viewer (`src/pages/view/[...path].astro`)
- Static pages: `about`, `contact`, `privacy`, `terms`, `404`, `500`
- A contact form backed by a Cloudflare email API (`src/pages/api/contact.ts`)
- SEO plumbing: `sitemap.xml`, `robots.txt`, JSON-LD structured data, Open Graph.
 
Overall this is a **solid, thoughtfully-built project**. The issues below are
mostly polish, safety, and consistency — not fundamental flaws.
 
---
 
## 1. Best Practices (for this type of site)
 
### 1.1 What it does well
- **Static-first architecture.** Pages are pre-rendered, which is exactly right
  for a notes site: fast, cheap, and great for SEO.
- **Build-time content loading** via `import.meta.glob` is a clean, modern Astro
  pattern. No database needed.
- **Good SEO foundation:** canonical URLs, Open Graph, Twitter cards, JSON-LD
  (`LearningResource`, `Quiz`, `CollectionPage`, `WebSite`), a dynamic sitemap,
  and a sensible `robots.txt`.
- **Performance-minded:** self-hosted fonts, deferred analytics (only loads on
  first interaction), inlined stylesheets, preconnects.
- **Accessibility basics present:** icon-only buttons have `aria-label`s, tabs
  use `role="tab"`/`aria-selected`.
 
### 1.2 What can be done better
- **Documentation is out of date / misleading (high impact, easy fix).**
  - `README.md` is still the **default Astro "minimal starter"** text. It tells
    a reader nothing about BitsNotes.
  - `setup_guide.md` describes a **completely different architecture** than what
    the code actually does: it talks about a **Python `uploader.py`**, a
    **`local_uploader/` folder**, **Cloudflare R2 image storage**, and
    **"secure non-downloadable images."** None of that exists in this repo
    (verified: there is no `local_uploader/` folder, no uploader script). The
    real system stores **HTML notes in git**. A future you (or a helper) will be
    badly confused.
- **Two sources of truth for lecture metadata.** `src/utils/metadata.ts`
  hard-codes full study-guide metadata for **5 specific DRL lectures**, while
  every other lecture uses either a companion `.json`, an embedded
  `<script id="lecture-metadata">`, or a generated fallback. This duplication is
  brittle and will drift. Prefer **one** mechanism (per-note JSON / embedded
  script) and keep `metadata.ts` only as a *generic* fallback generator.
- **Fragile HTML parsing with regular expressions.** `[...path].astro` pulls the
  `<body>`, extracts `<style>` blocks, and strips rules using regex
  (e.g. `body\s*\{[^}]*\}`). This works for the current notes but breaks easily
  (nested braces, comments, `<section>` inside `<section>`). It's the kind of
  code that silently mangles a note someday.
- **No quality gates.** There's no `astro check` (TypeScript) step in the build,
  no linter/formatter config, and no tests. For a solo project that's
  acceptable, but adding `astro check` to the build catches real bugs for free.
- **Default project identity.** `package.json` name is the auto-generated
  `"dreary-doppler"`. Rename to `bitsnotes`.
- **Dead / mis-configured assets.** `public/fonts/` ships **Outfit**, **Plus
  Jakarta Sans**, and **Fira Code** font files, but every `@font-face` for those
  families actually points at the **Inter** files (see `BaseLayout.astro`). So
  those files are downloaded into the repo but never used, and the intended
  typography (the notes CSS asks for `Outfit`) silently falls back to Inter.
- **Duplicated client JS.** Quiz handling exists twice (`checkQuizAnswer` and
  `checkAnswer`); tab logic and scroll logic are repeated inline across pages.
  Minor, but worth consolidating.
 
---
 
## 2. Security
 
> This is the most important section. One item here is **critical**.
 
### 2.1 🔴 CRITICAL — Real credentials are committed to the repo
`setup_guide.md` (which **is tracked in git**) contains what look like **live
secrets**:
- an R2 **Access Key ID** and **Secret Access Key**,
- a Cloudflare **API token** (`cfat_...`),
- an `UPLOAD_SECRET`.
 
Anyone with access to this repository (or its history, even if you delete the
lines later) can use these to access your Cloudflare account/storage.
 
**Action (do this first, today):**
1. **Revoke/rotate** all of those keys in the Cloudflare dashboard immediately.
   Assume they are already compromised.
2. Remove the secrets from `setup_guide.md` (replace with placeholders like
   `<YOUR_KEY_HERE>`).
3. Because git keeps history, **scrub them from history** (e.g. `git filter-repo`
   or BFG) and force-push, **or** if the repo has never been shared, the
   simplest safe option is to rotate the keys and move on.
4. Never store real secrets in tracked files. Use Cloudflare Worker secrets /
   `.env` (already git-ignored) instead.
 
### 2.2 🟠 Email header injection in the contact API
In `src/pages/api/contact.ts`, user input is placed **directly into email
headers**:
```
`Reply-To: ${name} <${email}>`,
`Subject: [Contact Form] ${subject}`,
```
If a visitor puts a newline (CRLF) in `name`, `email`, or `subject`, they can
**inject extra email headers** (e.g. add `Bcc:` recipients) and abuse your
contact form as a spam relay. The body is also unbounded in length.
 
**Fix:** strip `\r` and `\n` from all header fields, enforce max lengths
(e.g. name ≤ 100, subject ≤ 150, message ≤ 5000), and keep only the message in
the body. Add a simple honeypot field and/or basic rate limiting.
 
### 2.3 🟠 No HTTP security headers
There's no Content-Security-Policy (CSP), `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, or `X-Frame-Options`. For a site that
serves ads and third-party scripts, a baseline header set meaningfully reduces
risk (clickjacking, MIME sniffing, etc.).
 
**Fix:** add a `public/_headers` file (Cloudflare supports it) with conservative
headers. CSP needs care because of AdSense/Analytics/MathJax — start in
report-only mode.
 
### 2.4 🟡 Raw HTML injection (`set:html`) — lower risk but note it
The viewer injects note HTML with `<Fragment set:html={bodyContent} />`. Today
that content is **authored by you and committed to git**, so the risk is low.
But it means: (a) a mistake in a note can break the whole page, and (b) if you
ever accept notes from anyone else, it becomes a stored-XSS hole. Keep notes
first-party, and if that ever changes, sanitize the HTML.
 
### 2.5 🟡 "Content protection" is security theater (and hurts UX)
`BaseLayout.astro` disables right-click drag, blocks `Ctrl+P`/`Ctrl+S`, and even
hides the whole page when printing (`@media print { body { display:none } }`).
This does **not** protect anything (the text is fully in the page source and in
the AdSense-crawled HTML), but it **does** frustrate legitimate users and hurts
accessibility. Also note: the viewer never actually sets `isSecure`, so most of
this code doesn't even run — it's dead weight. Recommend removing the
print-hiding rule and the keyboard blocking. (This is a UX/clarity change, not a
core change.)
 
### 2.6 🟢 Public IDs are fine
The GA ID, Cloudflare beacon token, and AdSense publisher ID are public by
design — no action needed.
 
---
 
## 3. UI / UX
 
### 3.1 What's good
- Clean, modern, consistent design system (indigo accent, rounded cards, soft
  shadows), good dark mode, tasteful entrance animations, mobile sidebar drawer,
  scroll progress bar, back-to-top, copy-code buttons. This is genuinely nice.
 
### 3.2 What can be improved
- **Missing Open Graph image.** Every page advertises
  `https://bitsnotes.com/og-default.png` for social sharing, but **that file
  doesn't exist** in `public/`. Links shared on WhatsApp/Twitter/LinkedIn will
  show a broken/blank preview. Add a 1200×630 `og-default.png`.
- **Mislabeled sort order.** The subject page header says *"Sorted
  alphabetically"* but lectures are actually sorted **numerically by lecture
  number** (correctly!). Just fix the label to "Sorted by lecture".
- **Inconsistent link behavior.** Subject cards open in the **same tab**;
  lecture cards force **new tab** (`target="_blank"`). Pick one behavior (or at
  least make it intentional/consistent) so users aren't surprised.
- **No "reduced motion" support.** Animations always run. Add a
  `@media (prefers-reduced-motion: reduce)` block to disable them for users who
  ask for it (accessibility + comfort).
- **Tabs aren't fully keyboard-accessible.** They're clickable and labeled, but
  arrow-key navigation between tabs (the ARIA tab pattern) isn't implemented.
  Low priority, but a nice accessibility win.
- **Typography intent lost.** Because Outfit/Jakarta are aliased to Inter (see
  §1.2), headings that were designed in a different font all render as Inter.
  Either ship/alias the real fonts or remove the unused files and references so
  the design is honest.
- **Search is title-only.** Home/subject search filters by name only. Fine for
  now; a future enhancement could index summaries for real search.
 
---
 
## 4. Overall Logic / Correctness
 
### 4.1 What's sound
- Subject/lecture discovery, URL encoding of names with spaces, and the
  build-time path generation all hang together correctly.
- Prev/next navigation, including wrapping into adjacent subjects, is clever and
  works.
- Metadata resolution order (companion JSON → embedded script → generated
  fallback) is a reasonable design.
 
### 4.2 Things to tighten
- **`output: 'static'` vs server routes.** `astro.config.mjs` sets
  `output: 'static'`, yet `api/contact.ts`, `sitemap.xml.ts`, and `view/[id].ts`
  use `prerender = false` (server-rendered). This works with the Cloudflare
  adapter, but it's worth a comment/clarity so it's obvious the site is a
  static-with-a-few-dynamic-endpoints hybrid.
- **Two `/view` routes coexist** (`[id].astro` and `[...path].astro`). `[id]`
  only exists to redirect old single-segment URLs. It's fine, but document *why*
  it exists so nobody deletes it (it preserves old links / SEO) or, conversely,
  removes it intentionally once old URLs no longer matter.
- **Metadata duplication** (the DRL block in `metadata.ts`) is a logic smell as
  much as a best-practice one — the same lecture can have different text in two
  places. Consolidate.
- **Prev/next can loop forever across subjects.** Last lecture of the last
  subject links to the first lecture of the first subject. If that's intended
  (endless browsing) keep it; if not, stop at the ends.
- **Contact form has no success/abuse safeguards** beyond field-presence and an
  email regex (no rate limiting, no spam protection) — see §2.2.
 
---
 
## 5. Prioritized Action Plan
 
Tackle in order. Each item lists the files involved and is scoped to **not**
change the core behavior of the site.
 
### Phase 0 — Critical security (do immediately)
- [ ] **Rotate** the Cloudflare R2 keys + API token + upload secret in the
      Cloudflare dashboard.
- [ ] Replace the real secrets in `setup_guide.md` with placeholders.
- [ ] Scrub secrets from git history (or rotate-and-accept if repo was private).
- [ ] Add a note in `.gitignore`/docs: never commit real keys.
 
### Phase 1 — Safety & correctness (high value, low risk)
- [ ] **Harden the contact API** (`src/pages/api/contact.ts`): strip CRLF from
      header fields, enforce max lengths, add a honeypot field, optional basic
      rate limiting.
- [ ] **Add security headers** via `public/_headers` (start CSP in
      report-only). Test that AdSense, GA, Cloudflare beacon, and MathJax still
      load.
- [ ] **Add the missing `og-default.png`** (1200×630) to `public/`.
- [ ] **Add `astro check`** to the `build` script in `package.json` so type
      errors fail the build.
 
### Phase 2 — Documentation & project hygiene
- [ ] **Rewrite `README.md`** to describe the *actual* BitsNotes architecture
      (git-based HTML notes, build-time loader, viewer, deploy on Cloudflare).
- [ ] **Rewrite `setup_guide.md`** to match reality: how to add a new note
      (create `src/content/notes/<Subject>/<Lecture>/notes.html`, optional
      `notes.json`), how to build, how to deploy. Remove the Python/R2/images
      story unless you actually intend to build it.
- [ ] **Rename** `package.json` `"name"` to `"bitsnotes"`.
 
### Phase 3 — UX & accessibility polish
- [ ] Remove the **print-hiding** rule and `Ctrl+P/Ctrl+S` blocking from
      `BaseLayout.astro` (security theater); keep the layout otherwise identical.
- [ ] Fix the **"Sorted alphabetically"** label on the subject page.
- [ ] Make **card link behavior consistent** (decide same-tab vs new-tab).
- [ ] Add a **`prefers-reduced-motion`** block to `global.css`.
- [ ] Resolve the **fonts**: either alias the real Outfit/Jakarta files in
      `@font-face`, or delete the unused font files + references.
 
### Phase 4 — Maintainability (optional, no behavior change)
- [ ] **Consolidate lecture metadata** to a single mechanism; reduce
      `metadata.ts` to a generic fallback only.
- [ ] Consider replacing the **regex HTML extraction** in `[...path].astro` with
      a small, well-tested helper (or a parser) — refactor carefully so output
      is byte-for-byte equivalent for existing notes.
- [ ] De-duplicate the **quiz/tab/scroll** inline scripts into shared files.
- [ ] Add an **`@astrojs/sitemap`**-style comment or keep the hand-rolled one;
      either is fine.
 
---
 
## 6. Guardrails — what NOT to touch
 
To honor "the core should not change," these stay as-is unless you explicitly
decide otherwise:
 
- The **content model**: HTML notes in `src/content/notes/`, loaded at build
  time. No CMS, no database.
- The **viewer experience**: tabs (Notes / Study Guide / Exam Revision / Quiz),
  the interactive quiz, prev/next navigation, the sidebar.
- The **hosting**: Astro + Cloudflare Workers, custom domain on `bitsnotes.com`.
- The **SEO/AdSense study-guide strategy** and the structured-data schemas.
- The **visual design language** (indigo theme, dark mode, cards, animations) —
  only the small fixes in Phase 3 touch UI, and none change the overall look.
 
---
 
## 7. One-line summary
 
A well-built, SEO-savvy Astro notes site with a great viewer — held back mainly
by **leaked credentials in a tracked file**, an **injectable contact form**,
**docs that describe a different app than the one that exists**, and a few
**dead/mislabeled assets**. Fix Phase 0 today; the rest is steady polish that
keeps the core intact.