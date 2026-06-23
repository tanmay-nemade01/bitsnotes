/**
 * Client-side auth features — bookmarks, highlights, reading progress.
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

  // ─── Highlights ──────────────────────────────────────────────────────────

  BN.highlights = [];
  BN.highlightToolbar = null;
  BN.currentSelection = null;

  BN.loadHighlights = function (subject, lecture) {
    return BN.json('/api/highlights/list?subject=' + encodeURIComponent(subject) + '&lecture=' + encodeURIComponent(lecture)).then(function (data) {
      if (data && data.highlights) {
        BN.highlights = data.highlights;
        BN.injectHighlights();
      }
    });
  };

  BN.injectHighlights = function () {
    // Remove existing marks
    document.querySelectorAll('.bn-highlight').forEach(function (el) {
      var parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });
    // Re-inject from data
    BN.highlights.forEach(function (hl) {
      try {
        var container = document.querySelector('#lecture-content');
        if (!container) return;
        var anchor = container.querySelector(hl.selector_path.replace(/^#lecture-content\s*>\s*/, ''));
        if (!anchor || !anchor.textContent) return;

        var text = anchor.textContent;
        var start = Math.min(hl.start_offset, text.length);
        var end = Math.min(hl.end_offset, text.length);
        if (start >= end) return;

        // Simple text wrap — works for plain text nodes
        // For complex HTML, we'd need a proper range-based approach
        var walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
        var charCount = 0;
        var startNode = null, startOffset = 0, endNode = null, endOffset = 0;
        var node;
        while ((node = walker.nextNode())) {
          var nodeLen = (node.textContent || '').length;
          if (!startNode && charCount + nodeLen > start) {
            startNode = node;
            startOffset = start - charCount;
          }
          if (charCount + nodeLen >= end) {
            endNode = node;
            endOffset = end - charCount;
            break;
          }
          charCount += nodeLen;
        }

        if (startNode && endNode) {
          var range = document.createRange();
          range.setStart(startNode, startOffset);
          range.setEnd(endNode, endOffset);
          var mark = document.createElement('mark');
          mark.className = 'bn-highlight';
          mark.dataset.highlightId = hl.id;
          mark.style.backgroundColor = hl.color === 'blue' ? '#bfdbfe' : '#fef08a';
          mark.style.borderRadius = '2px';
          mark.style.cursor = 'pointer';
          if (hl.note_body) {
            mark.title = hl.note_body;
            mark.style.borderBottom = '2px solid #3b82f6';
          }
          range.surroundContents(mark);
        }
      } catch (e) {
        // Selector mismatch or DOM changed — skip silently
      }
    });
  };

  BN.createHighlightToolbar = function () {
    if (BN.highlightToolbar) return;
    var toolbar = document.createElement('div');
    toolbar.id = 'bn-highlight-toolbar';
    toolbar.className = 'hidden fixed z-[70] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--r-md)] shadow-lg px-1 py-1 flex gap-1';
    toolbar.innerHTML =
      '<button data-action="highlight" class="px-2.5 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--bg-subtle)] rounded-[var(--r-sm)] transition-colors flex items-center gap-1.5" title="Highlight">' +
      '<svg class="w-3.5 h-3.5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' +
      'Highlight</button>' +
      '<button data-action="note" class="px-2.5 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--bg-subtle)] rounded-[var(--r-sm)] transition-colors flex items-center gap-1.5" title="Add note">' +
      '<svg class="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
      'Note</button>';
    document.body.appendChild(toolbar);
    BN.highlightToolbar = toolbar;

    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !BN.currentSelection) return;

      var range = sel.getRangeAt(0);
      var contentEl = document.getElementById('lecture-content');
      if (!contentEl || !contentEl.contains(range.commonAncestorContainer)) return;

      // Build selector path
      var selectorPath = BN.buildSelectorPath(range.startContainer, contentEl);
      var startOffset = BN.getTextOffset(range.startContainer, range.startOffset, contentEl);
      var endOffset = BN.getTextOffset(range.endContainer, range.endOffset, contentEl);

      if (action === 'highlight') {
        BN.post('/api/highlights/save', {
          subject: contentEl.dataset.subject,
          lecture: contentEl.dataset.lecture,
          selectorPath: selectorPath,
          startOffset: startOffset,
          endOffset: endOffset,
          color: 'yellow',
        }).then(function () {
          BN.loadHighlights(contentEl.dataset.subject, contentEl.dataset.lecture);
        });
      } else if (action === 'note') {
        var noteText = prompt('Add a note:');
        if (noteText !== null && noteText.trim()) {
          BN.post('/api/highlights/save', {
            subject: contentEl.dataset.subject,
            lecture: contentEl.dataset.lecture,
            selectorPath: selectorPath,
            startOffset: startOffset,
            endOffset: endOffset,
            noteBody: noteText.trim(),
            color: 'blue',
          }).then(function () {
            BN.loadHighlights(contentEl.dataset.subject, contentEl.dataset.lecture);
          });
        }
      }

      toolbar.classList.add('hidden');
      sel.removeAllRanges();
      BN.currentSelection = null;
    });
  };

  BN.buildSelectorPath = function (node, container) {
    var parts = [];
    var current = node;
    while (current && current !== container) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        var tag = current.tagName.toLowerCase();
        var parent = current.parentNode;
        if (parent) {
          var siblings = Array.from(parent.children).filter(function (c) { return c.tagName === current.tagName; });
          if (siblings.length > 1) {
            var idx = siblings.indexOf(current) + 1;
            parts.unshift(tag + ':nth-of-type(' + idx + ')');
          } else {
            parts.unshift(tag);
          }
        }
      }
      current = current.parentNode;
    }
    return parts.length > 0 ? '#lecture-content > ' + parts.join(' > ') : '#lecture-content';
  };

  BN.getTextOffset = function (node, offset, container) {
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    var totalOffset = 0;
    var n;
    while ((n = walker.nextNode())) {
      if (n === node) return totalOffset + offset;
      totalOffset += (n.textContent || '').length;
    }
    return totalOffset;
  };

  BN.setupMouseUp = function () {
    var contentEl = document.getElementById('lecture-content');
    if (!contentEl) return;

    document.addEventListener('mouseup', function (e) {
      var toolbar = BN.highlightToolbar;
      if (!toolbar) return;

      // Hide on clicks inside toolbar
      if (toolbar.contains(e.target)) return;

      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !contentEl.contains(sel.anchorNode)) {
        toolbar.classList.add('hidden');
        BN.currentSelection = null;
        return;
      }

      BN.currentSelection = sel;
      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();

      toolbar.style.top = (rect.top + window.scrollY - 40) + 'px';
      toolbar.style.left = (rect.left + rect.width / 2 - 60) + 'px';
      toolbar.classList.remove('hidden');
    });
  };

  // ─── Reading Progress ────────────────────────────────────────────────────

  BN.progressSent = false;

  BN.setupProgress = function (subject, lecture) {
    var sent = false;
    window.addEventListener('scroll', function () {
      if (sent) return;
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (scrollHeight <= 0) return;
      var pct = Math.round((scrollTop / scrollHeight) * 100);
      if (pct >= 80) {
        sent = true;
        BN.post('/api/progress/mark-read', { subject: subject, lecture: lecture, readPct: pct });
      }
    });
  };

  // ─── Highlight Sidebar ───────────────────────────────────────────────────

  BN.sidebarOpen = false;

  BN.toggleHighlightSidebar = function () {
    var panel = document.getElementById('bn-highlights-sidebar');
    if (!panel) return;
    BN.sidebarOpen = !BN.sidebarOpen;
    panel.classList.toggle('hidden', !BN.sidebarOpen);
    BN.renderHighlightSidebar();
  };

  BN.renderHighlightSidebar = function () {
    var list = document.getElementById('bn-highlights-list');
    if (!list) return;
    list.innerHTML = '';
    if (BN.highlights.length === 0) {
      list.innerHTML = '<p class="text-xs text-[var(--text-muted)] px-3 py-4">No highlights yet. Select text in the lecture to highlight it.</p>';
      return;
    }
    BN.highlights.forEach(function (hl) {
      var div = document.createElement('div');
      div.className = 'px-3 py-2 border-b border-[var(--border)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors';
      div.innerHTML =
        '<div class="flex items-center gap-2 mb-0.5">' +
        '<span class="w-2 h-2 rounded-full shrink-0" style="background:' + (hl.color === 'blue' ? '#3b82f6' : '#eab308') + '"></span>' +
        '<span class="text-xs font-medium text-[var(--text)] line-clamp-1">' + (hl.note_body || 'Highlight') + '</span>' +
        '</div>' +
        '<p class="text-[10px] text-[var(--text-muted)] line-clamp-2 pl-4">' + (hl.note_body || '') + '</p>';
      div.addEventListener('click', function () {
        var mark = document.querySelector('.bn-highlight[data-highlight-id="' + hl.id + '"]');
        if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      list.appendChild(div);
    });
  };

  window.BitsNotes = BN;
})();
