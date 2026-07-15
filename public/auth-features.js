/**
 * Client-side auth features — bookmarks, reading progress.
 * Loaded as <script is:inline data-astro-rerun> in relevant pages.
 * All functions are on `window.BitsNotes` to avoid pollution.
 */
(function () {
  if (window.__bitsNotesFeaturesLoaded) return;
  window.__bitsNotesFeaturesLoaded = true;

  var BN = {};

  // ─── Helpers ─────────────────────────────────────────────────────────────

  BN.json = async function (url, opts) {
    try {
      var r = await fetch(url, opts);
      if (r.status === 401) return null;
      return await r.json();
    } catch (e) { return null; }
  };

  BN.post = async function (url, body) {
    try {
      var r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await r.json();
    } catch (e) { return null; }
  };

  BN.del = async function (url, body) {
    try {
      var r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await r.json();
    } catch (e) { return null; }
  };

  // ─── Bookmarks ───────────────────────────────────────────────────────────

  BN.collections = null;

  BN.loadCollections = async function () {
    if (BN.collections) return BN.collections;
    var data = await BN.json('/api/bookmarks/list');
    if (data && data.collections) BN.collections = data.collections;
    return BN.collections;
  };

  BN.toggleBookmark = function (btn) {
    var subject = btn.dataset.subject;
    var lecture = btn.dataset.lecture;
    var displayName = btn.dataset.displayName;
    var isBookmarked = btn.dataset.bookmarked === 'true';

    if (isBookmarked) {
      BN.del('/api/bookmarks/remove', { subject: subject, lecture: lecture }).then(function () {
        btn.dataset.bookmarked = 'false';
        BN.updateBookmarkUI(btn, false);
      });
    } else {
      // Show collection picker or use default
      BN.post('/api/bookmarks/add', {
        subject: subject,
        lecture: lecture,
        displayName: displayName,
      }).then(function () {
        btn.dataset.bookmarked = 'true';
        BN.updateBookmarkUI(btn, true);
      });
    }
  };

  BN.updateBookmarkUI = function (btn, bookmarked) {
    var outlines = btn.querySelectorAll('svg');
    if (outlines.length >= 2) {
      outlines[0].classList.toggle('hidden', bookmarked);
      outlines[1].classList.toggle('hidden', !bookmarked);
    }
    if (bookmarked) {
      btn.classList.add('border-[var(--accent)]', 'bg-[var(--accent-subtle)]', 'text-[var(--accent)]');
      btn.classList.remove('border-[var(--border)]', 'text-[var(--text-muted)]');
      var textSpan = btn.querySelector('span:last-child');
      if (textSpan) textSpan.textContent = 'Saved';
    } else {
      btn.classList.remove('border-[var(--accent)]', 'bg-[var(--accent-subtle)]', 'text-[var(--accent)]');
      btn.classList.add('border-[var(--border)]', 'text-[var(--text-muted)]');
      var textSpan = btn.querySelector('span:last-child');
      if (textSpan) textSpan.textContent = 'Save';
    }
  };

  // ─── Reading Progress ────────────────────────────────────────────────────

  BN.progressSent = false;
  BN.topicProgressSent = {};

  BN.setupProgress = function (subject, lecture) {
    var sent = false;
    var handler = function () {
      if (sent) return;
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (scrollHeight <= 0) return;
      var pct = Math.round((scrollTop / scrollHeight) * 100);
      if (pct >= 80) {
        sent = true;
        BN.post('/api/progress/mark-read', { subject: subject, lecture: lecture, readPct: pct });
      }
    };
    window.addEventListener('scroll', handler, { passive: true });
    // Clean up on SPA navigation so the listener doesn't leak across pages.
    document.addEventListener('astro:before-swap', function () {
      window.removeEventListener('scroll', handler);
    }, { once: true });
  };

  BN.setupTopicProgress = function (subject, lecture) {
    var handler = function () {
      var currentTopicId = window.BitsNotesCurrentTopicId;
      var totalTopics = window.BitsNotesTotalTopics;
      if (!currentTopicId || !totalTopics) return;

      if (BN.topicProgressSent[currentTopicId]) return;

      var contentEl = document.getElementById('topic-content');
      if (!contentEl) return;

      var rect = contentEl.getBoundingClientRect();
      var elementHeight = contentEl.offsetHeight;
      if (elementHeight <= 0) return;

      var viewportHeight = window.innerHeight;
      var scrolledAmount = viewportHeight - rect.top;
      var pct = Math.round((scrolledAmount / elementHeight) * 100);

      if (pct >= 80) {
        BN.topicProgressSent[currentTopicId] = true;

        var indicators = document.querySelectorAll('.topic-item-container[data-topic-id="' + currentTopicId + '"] .topic-check-indicator');
        indicators.forEach(function (ind) {
          ind.classList.remove('hidden');
        });

        BN.post('/api/progress/mark-read', {
          subject: subject,
          lecture: lecture,
          topicId: currentTopicId,
          readPct: Math.min(100, pct),
          totalTopics: totalTopics,
        });
      }
    };

    window.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler, { passive: true });

    document.addEventListener('astro:before-swap', function () {
      window.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    }, { once: true });
  };

  window.BitsNotes = BN;
})();
