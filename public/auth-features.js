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

  BN.json = function (url, opts) {
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) return null;
      return r.json();
    }).catch(function () { return null; });
  };

  BN.post = function (url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  };

  BN.del = function (url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  };

  // ─── Bookmarks ───────────────────────────────────────────────────────────

  BN.collections = null;

  BN.loadCollections = function () {
    if (BN.collections) return Promise.resolve(BN.collections);
    return BN.json('/api/bookmarks/list').then(function (data) {
      if (data && data.collections) BN.collections = data.collections;
      return BN.collections;
    });
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
  };

  // ─── Reading Progress ────────────────────────────────────────────────────

  BN.progressSent = false;

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

  window.BitsNotes = BN;
})();
