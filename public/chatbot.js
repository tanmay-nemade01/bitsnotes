/**
 * BitsNotes AI Chatbot — Client-Side Controller
 * Server-proxied AI study assistant with fast transformer-style word streaming,
 * wide reading drawer (>= 40% screen), interactive starter chips & copy actions.
 */
(function () {
  'use strict';

  var HISTORY_STORAGE_KEY = 'bn_chatbot_history';
  var conversationHistory = [];
  var isSending = false;
  var bitsnotesUsage = { used: 0, limit: 20, remaining: 20, unlimited: false };
  var bitsnotesUser = null; // { displayName, ... } from /api/auth/me

  // Active streaming state
  var activeStreamTimer = null;
  var activeStreamFinish = null;

  // Clean up legacy BYOK sessionStorage keys if present
  try {
    sessionStorage.removeItem('bn_chatbot_config');
    sessionStorage.removeItem('bn_chatbot_mode');
  } catch (e) { }

  // ─── Textbook companion toggle (on by default, persisted per session) ──
  var TEXTBOOK_STORAGE_KEY = 'bn_chatbot_textbook';

  function isTextbookEnabled() {
    try {
      var v = sessionStorage.getItem(TEXTBOOK_STORAGE_KEY);
      return v === null ? true : v === '1';
    } catch (e) {
      return true;
    }
  }

  function setTextbookEnabled(on) {
    try {
      sessionStorage.setItem(TEXTBOOK_STORAGE_KEY, on ? '1' : '0');
    } catch (e) { }
  }

  // ─── Conversation History ─────────────────────────────────────────────
  function loadConversationHistory() {
    try {
      var saved = sessionStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(function (m) {
            return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
          });
        }
      }
    } catch (e) {
      console.warn('[chatbot] Could not read conversation history', e);
    }
    return [];
  }

  function saveConversationHistory() {
    try {
      sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversationHistory));
    } catch (e) {
      console.warn('[chatbot] Failed to persist conversation history', e);
    }
  }

  conversationHistory = loadConversationHistory();

  // ─── Usage tracking for BitsNotes ─────────────────────────────────────
  async function fetchBitsNotesUsage() {
    async function fetchBitsNotesUsage() {
      try {
        var res = await fetch('/api/chatbot/usage');
        if (res.ok) {
          var data = await res.json();
          bitsnotesUsage = {
            used: data.used || 0,
            limit: data.limit != null ? data.limit : 20,
            remaining: data.remaining != null ? data.remaining : 20,
            unlimited: Boolean(data.unlimited),
          };
        }
      } catch (e) {
        console.warn('[chatbot] Could not fetch usage:', e);
      }
      updateUsageUI();
    }

    function updateUsageUI() {
      function updateUsageUI() {
        var remaining = bitsnotesUsage.remaining;
        var used = bitsnotesUsage.used;
        var limit = bitsnotesUsage.limit;
        var isUnlimited = Boolean(bitsnotesUsage.unlimited);
        var pct = (!isUnlimited && limit > 0) ? Math.min(100, Math.round((used / limit) * 100)) : 0;

        // Settings panel usage counter
        var bar = document.getElementById('bn-usage-bar');
        var remainingEl = document.getElementById('bn-usage-remaining');
        var detailEl = document.getElementById('bn-usage-detail');
        if (bar) bar.style.width = pct + '%';
        if (remainingEl) remainingEl.textContent = isUnlimited ? '∞' : remaining;
        if (detailEl) {
          detailEl.textContent = isUnlimited
            ? used + ' used (Unlimited Admin)'
            : used + ' / ' + limit + ' used';
        }

        // Chat header badge
        var usageBadge = document.getElementById('bn-chat-usage-badge');
        if (usageBadge) {
          if (bitsnotesUser) {
            if (isUnlimited) {
              usageBadge.textContent = 'Admin (∞)';
              usageBadge.title = 'Unlimited messages (Admin)';
              usageBadge.classList.remove('hidden', 'bn-usage-low');
            } else {
              usageBadge.textContent = remaining + '/' + limit;
              usageBadge.title = remaining + ' messages remaining this month';
              usageBadge.classList.remove('hidden');
              if (remaining <= 5) {
                usageBadge.classList.add('bn-usage-low');
              } else {
                usageBadge.classList.remove('bn-usage-low');
              }
            }
          } else {
            usageBadge.classList.add('hidden');
          }
        }
      }

      async function fetchBitsNotesUser() {
        try {
          var res = await fetch('/api/auth/me');
          if (res.ok) {
            var data = await res.json();
            if (data && data.user) {
              bitsnotesUser = data.user;
              return;
            }
          }
        } catch (e) { }
        bitsnotesUser = null;
      }

      // Escape HTML string
      function escapeHtml(str) {
        if (!str) return '';
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      // Ensure KaTeX is loaded and available (lazy — only fetched when a chat
      // message actually contains math). Self-hosted; far lighter than MathJax.
      // Ensure KaTeX is loaded and available
      function ensureKaTeX(cb) {
        var ready = function () {
          return window.katex && window.renderMathInElement;
        };
        if (ready()) {
          if (cb) cb();
          return;
        }

        var loadAutoRender = function () {
          if (document.getElementById('katex-autorender-script')) return;
          var ar = document.createElement('script');
          ar.id = 'katex-autorender-script';
          ar.async = true;
          ar.src = '/vendor/katex/contrib/auto-render.min.js';
          document.head.appendChild(ar);
        };

        if (window.katex) {
          loadAutoRender();
        } else if (!document.getElementById('katex-script')) {
          var s = document.createElement('script');
          s.id = 'katex-script';
          s.async = true;
          s.src = '/vendor/katex/katex.min.js';
          s.onload = loadAutoRender;
          document.head.appendChild(s);
        }
        var startedAt = Date.now();
        var poll = setInterval(function () {
          if (ready()) {
            clearInterval(poll);
            if (cb) cb();
          } else if (Date.now() - startedAt > 20000) {
            clearInterval(poll);
          }
        }, 100);
      }

      // Typeset KaTeX equations inside a target element
      function typesetElement(el) {
        if (!el) return;
        ensureKaTeX(function () {
          try {
            window.renderMathInElement(el, {
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '\\(', right: '\\)', display: false },
                { left: '$', right: '$', display: false }
              ],
              throwOnError: false
            });
          } catch (err) {
            console.warn('[chatbot] KaTeX render error:', err);
          }
        });
      }

      // Markdown & LaTeX parsing for assistant bubbles
      function renderMarkdown(text) {
        if (!text) return '';

        var stash = [];
        function saveToken(content) {
          var key = '___BN_STASH_' + stash.length + '___';
          stash.push(content);
          return key;
        }

        // 1. Stash fenced code blocks (extracting optional language identifier)
        // 1. Stash fenced code blocks with header and 1-click copy
        var processed = text.replace(/```([a-zA-Z0-9_\-\+]*)\n?([\s\S]*?)```/g, function (match, lang, code) {
          var cleanCode = code.replace(/^\n+|\n+$/g, '');
          var langLabel = lang ? '<div class="bn-code-lang">' + escapeHtml(lang.toLowerCase()) + '</div>' : '';
          var langLabel = lang ? lang.toLowerCase() : 'code';
          return saveToken(
            '<div class="bn-code-block">' +
            langLabel +
            '<div class="bn-code-header">' +
            '<span class="bn-code-lang">' + escapeHtml(langLabel) + '</span>' +
            '<button type="button" class="bn-code-copy-btn" title="Copy code">' +
            '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>' +
            '<span>Copy</span>' +
            '</button>' +
            '</div>' +
            '<pre><code>' + escapeHtml(cleanCode) + '</code></pre>' +
            '</div>'
          );
        });

        // 2. Stash inline code
        processed = processed.replace(/`([^`]+)`/g, function (match, code) {
          return saveToken('<code>' + escapeHtml(code) + '</code>');
        });

        // 3. Stash Display Math: $$...$$ or \[...\]
        processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, function (match, math) {
          var cleanMath = math.trim();
          return saveToken('<div class="bn-math-display">\\[' + cleanMath + '\\]</div>');
        });
        processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, function (match, math) {
          var cleanMath = math.trim();
          return saveToken('<div class="bn-math-display">\\[' + cleanMath + '\\]</div>');
        });

        // 4. Stash Inline Math: \(...\) or $...$
        processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, function (match, math) {
          return saveToken('\\(' + math.trim() + '\\)');
        });
        processed = processed.replace(/(^|[^\\])\$([^\$\n]+?)\$/g, function (match, prefix, math) {
          return prefix + saveToken('\\(' + math.trim() + '\\)');
        });

        // 5. Escape rest of HTML text safely
        processed = escapeHtml(processed);

        // 6. Markdown formatting on non-math/code text
        // Bold & Italics
        // 6. Markdown formatting
        processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        processed = processed.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        processed = processed.replace(/^### (.*$)/gim, '<h4 class="font-bold text-sm mt-3 mb-1">$1</h4>');
        processed = processed.replace(/^## (.*$)/gim, '<h3 class="font-bold text-base mt-4 mb-1.5">$1</h3>');

        // Headings
        processed = processed.replace(/^### (.*$)/gim, '<h4 class="font-bold text-sm mt-2 mb-1">$1</h4>');
        processed = processed.replace(/^## (.*$)/gim, '<h3 class="font-bold text-base mt-3 mb-1">$1</h3>');

        // Lists (Unordered - / * and Ordered 1. / 2.) & Tables
        // Lists & Tables
        var lines = processed.split('\n');
        var inUl = false;
        var inOl = false;
        var inTable = false;
        var tableRows = [];
        var outLines = [];

        function flushTable() {
          if (tableRows.length === 0) return;
          var html = '<div class="bn-table-wrapper"><table class="bn-markdown-table">';
          var startIdx = 0;
          // Header row
          if (tableRows.length >= 2 && /^[\s\|\:\-\+]+$/.test(tableRows[1].raw)) {
            html += '<thead><tr>';
            tableRows[0].cells.forEach(function (cell) {
              html += '<th>' + cell + '</th>';
            });
            html += '</tr></thead>';
            startIdx = 2;
          }
          html += '<tbody>';
          for (var r = startIdx; r < tableRows.length; r++) {
            if (/^[\s\|\:\-\+]+$/.test(tableRows[r].raw)) continue;
            html += '<tr>';
            tableRows[r].cells.forEach(function (cell) {
              html += '<td>' + cell + '</td>';
            });
            html += '</tr>';
          }
          html += '</tbody></table></div>';
          outLines.push(html);
          tableRows = [];
          inTable = false;
        }

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          var trimmed = line.trim();

          // Check for table row
          var isTableRow = trimmed.length > 2 && trimmed.indexOf('|') !== -1 && (trimmed.startsWith('|') || trimmed.endsWith('|'));

          if (isTableRow) {
            if (inUl) { outLines.push('</ul>'); inUl = false; }
            if (inOl) { outLines.push('</ol>'); inOl = false; }
            inTable = true;
            var cells = trimmed.split('|');
            if (trimmed.startsWith('|')) cells.shift();
            if (trimmed.endsWith('|')) cells.pop();
            tableRows.push({
              raw: trimmed,
              cells: cells.map(function (c) { return c.trim(); })
            });
            continue;
          } else if (inTable) {
            flushTable();
          }

          var ulMatch = line.match(/^\s*[\-\*]\s+(.*)$/);
          var olMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);

          if (ulMatch) {
            if (inOl) { outLines.push('</ol>'); inOl = false; }
            if (!inUl) { outLines.push('<ul>'); inUl = true; }
            outLines.push('<li>' + ulMatch[1] + '</li>');
          } else if (olMatch) {
            if (inUl) { outLines.push('</ul>'); inUl = false; }
            if (!inOl) { outLines.push('<ol>'); inOl = true; }
            outLines.push('<li>' + olMatch[2] + '</li>');
          } else {
            if (inUl) { outLines.push('</ul>'); inUl = false; }
            if (inOl) { outLines.push('</ol>'); inOl = false; }
            outLines.push(line);
          }
        }
        if (inUl) outLines.push('</ul>');
        if (inOl) outLines.push('</ol>');
        if (inTable) flushTable();

        processed = outLines.join('\n');

        // Paragraph breaks and line breaks
        processed = processed.replace(/\n\n+/g, '</p><p>');
        processed = processed.replace(/\n/g, '<br/>');

        // Clean up empty <p></p> or invalid tags around block containers
        processed = '<p>' + processed + '</p>';
        processed = processed.replace(/<p>\s*<\/p>/g, '');

        // 7. Restore stashed blocks in reverse order
        for (var k = stash.length - 1; k >= 0; k--) {
          var token = '___BN_STASH_' + k + '___';
          processed = processed.replace(token, stash[k]);
        }

        return processed;
      }

      function getSubjectName() {
        var contentEl = document.getElementById('lecture-content');
        if (contentEl && contentEl.dataset.subject) {
          return contentEl.dataset.subject;
        }
        var pathParts = window.location.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2 && pathParts[0] === 'view') {
          var rawSubject = decodeURIComponent(pathParts[1]);
          return rawSubject.replace(/-/g, ' ');
        }
        return 'Subject';
      }

      function getLectureFolderName() {
        var contentEl = document.getElementById('lecture-content');
        if (contentEl && contentEl.dataset.lecture) {
          return contentEl.dataset.lecture;
        }
        return '';
      }

      // Attach code copy & message copy actions to a message element
      function attachBubbleCopyActions(msgDiv, bubble, fullText) {
        if (!bubble) return;

        // 1. Code block copy buttons
        var codeButtons = bubble.querySelectorAll('.bn-code-copy-btn');
        codeButtons.forEach(function (btn) {
          if (btn.dataset.bnInited) return;
          btn.dataset.bnInited = 'true';
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var block = btn.closest('.bn-code-block');
            var pre = block ? block.querySelector('pre') : null;
            var code = pre ? pre.textContent : '';
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(code).then(function () {
                btn.classList.add('copied');
                btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg><span>Copied!</span>';
                setTimeout(function () {
                  btn.classList.remove('copied');
                  btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg><span>Copy</span>';
                }, 2000);
              });
            }
          });
        });

        // 2. Message answer copy button
        if (msgDiv && !msgDiv.querySelector('.bn-msg-actions')) {
          var actions = document.createElement('div');
          actions.className = 'bn-msg-actions';
          actions.innerHTML =
            '<button type="button" class="bn-msg-copy-btn" title="Copy answer to clipboard">' +
            '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>' +
            '</svg>' +
            '<span>Copy answer</span>' +
            '</button>';

          var copyBtn = actions.querySelector('.bn-msg-copy-btn');
          copyBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(fullText).then(function () {
                copyBtn.classList.add('copied');
                copyBtn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg><span>Copied!</span>';
                setTimeout(function () {
                  copyBtn.classList.remove('copied');
                  copyBtn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg><span>Copy answer</span>';
                }, 2000);
              });
            }
          });

          msgDiv.appendChild(actions);
        }
      }

      // Append a static message immediately (for historical or user messages)
      function appendMessage(role, content, isHtml) {
        var container = document.getElementById('bn-chatbot-messages');
        if (!container) return;

        var msgDiv = document.createElement('div');
        msgDiv.className = 'bn-msg ' + role;

        var bubble = document.createElement('div');
        bubble.className = 'bn-msg-bubble';

        if (isHtml) {
          bubble.innerHTML = content;
        } else {
          bubble.innerHTML = renderMarkdown(content);
        }

        msgDiv.appendChild(bubble);
        container.appendChild(msgDiv);

        typesetElement(bubble);

        if (role === 'assistant' && !isHtml) {
          attachBubbleCopyActions(msgDiv, bubble, content);
        }

        container.scrollTop = container.scrollHeight;
      }

      // ─── Transformer Fast Word-by-Word Streaming Animation ───────────────
      function stopActiveStream() {
        if (activeStreamTimer) {
          clearInterval(activeStreamTimer);
          activeStreamTimer = null;
        }
        if (activeStreamFinish) {
          var fn = activeStreamFinish;
          activeStreamFinish = null;
          fn();
        }
      }

      function streamAssistantMessage(fullText, sources, onFinished) {
        stopActiveStream();

        var container = document.getElementById('bn-chatbot-messages');
        if (!container) {
          if (onFinished) onFinished();
          return;
        }

        var msgDiv = document.createElement('div');
        msgDiv.className = 'bn-msg assistant bn-msg-streaming';

        var bubble = document.createElement('div');
        bubble.className = 'bn-msg-bubble';

        var contentDiv = document.createElement('div');
        contentDiv.className = 'bn-msg-content';

        var cursor = document.createElement('span');
        cursor.className = 'bn-streaming-cursor';
        cursor.setAttribute('aria-hidden', 'true');

        bubble.appendChild(contentDiv);
        bubble.appendChild(cursor);
        msgDiv.appendChild(bubble);
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;

        // Tokenize full reply into words & whitespace sequences
        var tokens = fullText.split(/(\s+)/);
        var tokenIndex = 0;
        var accumulated = '';

        // Fast transformer pacing:
        // Paced so any length answer streams smoothly in ~1.0 to 1.8 seconds max
        var totalTokens = tokens.length;
        var targetTicks = Math.min(80, Math.max(25, Math.round(totalTokens / 4)));
        var tokensPerTick = Math.max(2, Math.ceil(totalTokens / targetTicks));

        function finish() {
          if (activeStreamTimer) {
            clearInterval(activeStreamTimer);
            activeStreamTimer = null;
          }
          activeStreamFinish = null;

          msgDiv.classList.remove('bn-msg-streaming');
          if (cursor && cursor.parentNode) {
            cursor.remove();
          }

          // Final complete high-fidelity markdown render
          contentDiv.innerHTML = renderMarkdown(fullText);

          // Math typesetting
          typesetElement(contentDiv);

          // Attach copy code and copy response actions
          attachBubbleCopyActions(msgDiv, bubble, fullText);

          // Append sources footer if present
          if (sources && sources.length > 0) {
            appendSourcesFooter(sources, bubble);
          }

          container.scrollTop = container.scrollHeight;

          if (onFinished) onFinished();
        }

        activeStreamFinish = finish;

        // Click anywhere on the streaming bubble to instantly reveal
        msgDiv.addEventListener('click', function onClick() {
          if (activeStreamTimer) {
            finish();
            msgDiv.removeEventListener('click', onClick);
          }
        });

        activeStreamTimer = setInterval(function () {
          for (var i = 0; i < tokensPerTick && tokenIndex < tokens.length; i++) {
            accumulated += tokens[tokenIndex];
            tokenIndex++;
          }

          // During stream, safely close unclosed code blocks for display
          var textToRender = accumulated;
          var fenceCount = (textToRender.match(/```/g) || []).length;
          if (fenceCount % 2 === 1) {
            textToRender += '\n```';
          }

          contentDiv.innerHTML = renderMarkdown(textToRender);
          container.scrollTop = container.scrollHeight;

          if (tokenIndex >= tokens.length) {
            finish();
          }
        }, 14);
      }

      // ─── Welcome Card with 4 Interactive Starter Chips ─────────────────────
      function appendWelcomeMessage() {
        var container = document.getElementById('bn-chatbot-messages');
        if (!container) return;

        var subject = getSubjectName();
        appendMessage(
          'assistant',
          'Hello! 👋 I am your AI study assistant for **' +
          escapeHtml(subject) +
          '**.\n\nI have the full context of this lecture page. Ask me anything!'
        );
        var welcomeDiv = document.createElement('div');
        welcomeDiv.className = 'bn-welcome-card';
        welcomeDiv.innerHTML =
          '<div class="bn-welcome-header">' +
          '<div class="bn-welcome-icon">✨</div>' +
          '<div class="bn-welcome-text">' +
          '<h4>AI Study Assistant for <strong>' + escapeHtml(subject) + '</strong></h4>' +
          '<p>Ask questions about this lecture notes or select a 1-click prompt to get started:</p>' +
          '</div>' +
          '</div>' +
          '<div class="bn-starter-chips">' +
          '<button type="button" class="bn-starter-chip" data-prompt="Summarize this lecture notes in 3 concise bullet points with key takeaways.">' +
          '<span class="bn-chip-icon">💡</span>' +
          '<span class="bn-chip-text">Summarize key takeaways</span>' +
          '</button>' +
          '<button type="button" class="bn-starter-chip" data-prompt="Give me 3 practice quiz questions based on this lecture with answers.">' +
          '<span class="bn-chip-icon">❓</span>' +
          '<span class="bn-chip-text">3 practice questions</span>' +
          '</button>' +
          '<button type="button" class="bn-starter-chip" data-prompt="Explain the key formulas and core definitions from this lecture notes.">' +
          '<span class="bn-chip-icon">📐</span>' +
          '<span class="bn-chip-text">Key formulas & definitions</span>' +
          '</button>' +
          '<button type="button" class="bn-starter-chip" data-prompt="What does the textbook companion say about the main topics in this lecture?">' +
          '<span class="bn-chip-icon">📖</span>' +
          '<span class="bn-chip-text">Textbook companion insights</span>' +
          '</button>' +
          '</div>';

        container.appendChild(welcomeDiv);
        container.scrollTop = container.scrollHeight;
      }

      function clearChat() {
        stopActiveStream();
        var container = document.getElementById('bn-chatbot-messages');
        if (container) container.innerHTML = '';
        conversationHistory = [];
        saveConversationHistory();
        appendWelcomeMessage();
      }

      function showTypingIndicator() {
        var container = document.getElementById('bn-chatbot-messages');
        if (!container) return null;

        var msgDiv = document.createElement('div');
        msgDiv.className = 'bn-msg assistant';
        msgDiv.id = 'bn-typing-indicator';

        var bubble = document.createElement('div');
        bubble.className = 'bn-msg-bubble bn-typing-dots';
        bubble.innerHTML = '<div class="bn-typing-dot"></div><div class="bn-typing-dot"></div><div class="bn-typing-dot"></div>';

        msgDiv.appendChild(bubble);
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
        return msgDiv;
      }

      function hideTypingIndicator() {
        var el = document.getElementById('bn-typing-indicator');
        if (el) el.remove();
      }

      // ─── Settings / Account view management ───────────────────────────────
      function showSettingsView() {
        var mainView = document.getElementById('bn-chat-view-main');
        var settingsView = document.getElementById('bn-chat-view-settings');
        var backBtn = document.getElementById('bn-chat-back-btn');

        if (backBtn) {
          backBtn.style.display = bitsnotesUser ? 'flex' : 'none';
        }

        updateBitsNotesAccountPanel();

        if (mainView) mainView.classList.remove('active');
        if (settingsView) settingsView.classList.add('active');
      }

      function updateBitsNotesAccountPanel() {
        var loggedIn = document.getElementById('bn-bitsnotes-logged-in');
        var loggedOut = document.getElementById('bn-bitsnotes-logged-out');
        var footer = document.getElementById('bn-bitsnotes-footer');
        var usernameEl = document.getElementById('bn-bitsnotes-username');

        if (bitsnotesUser) {
          if (loggedIn) loggedIn.classList.remove('hidden');
          if (loggedOut) loggedOut.classList.add('hidden');
          if (footer) footer.classList.remove('hidden');
          if (usernameEl) usernameEl.textContent = bitsnotesUser.displayName || bitsnotesUser.email || 'User';
          fetchBitsNotesUsage();
        } else {
          if (loggedIn) loggedIn.classList.add('hidden');
          if (loggedOut) loggedOut.classList.remove('hidden');
          if (footer) footer.classList.add('hidden');
        }
      }

      function showChatView() {
        var mainView = document.getElementById('bn-chat-view-main');
        var settingsView = document.getElementById('bn-chat-view-settings');

        if (settingsView) settingsView.classList.remove('active');
        if (mainView) mainView.classList.add('active');
        updateUsageUI();

        setTimeout(function () {
          var inputEl = document.getElementById('bn-chatbot-input');
          if (inputEl) inputEl.focus();
        }, 200);
      }

      function openModal() {
        var panel = document.getElementById('bn-chatbot-panel');
        if (panel && !panel.classList.contains('open')) {
          openPanel();
        }
        showSettingsView();
      }

      function closeModal() {
        showChatView();
      }

      function openPanel() {
        var panel = document.getElementById('bn-chatbot-panel');
        if (!panel) return;

        // Pure overlay: never touch page layout or sidebars.
        panel.classList.remove('docked-mode');
        // Restore wide reading mode preference
        try {
          if (sessionStorage.getItem('bn_chat_wide') === '1') {
            panel.classList.add('wide-mode');
          }
        } catch (e) { }

        document.body.classList.add('bn-chatbot-open');
        panel.classList.add('open');

        if (!bitsnotesUser) {
          showSettingsView();
        } else {
          showChatView();
          var container = document.getElementById('bn-chatbot-messages');
          if (container && container.children.length === 0) {
            if (conversationHistory.length > 0) {
              // Restore the persisted conversation after page navigation
              conversationHistory.forEach(function (m) {
                appendMessage(m.role, m.content);
              });
            } else {
              appendWelcomeMessage();
            }
          }
        }
      }

      // Re-check auth state before opening, so a fast FAB click right after page
      // load (while /api/auth/me is still in flight) doesn't show the sign-in view
      // to a user who is actually logged in.
      function openPanelWithFreshUser() {
        function openPanelWithFreshUser() {
          if (!bitsnotesUser) {
            fetchBitsNotesUser().then(function () {
              if (bitsnotesUser) fetchBitsNotesUsage();
              openPanel();
            });
          } else {
            fetchBitsNotesUsage();
            openPanel();
          }
        }

        function closePanel() {
          stopActiveStream();
          var panel = document.getElementById('bn-chatbot-panel');
          if (panel) {
            panel.classList.remove('open', 'docked-mode');
            panel.classList.remove('open');
          }

          document.body.classList.remove('bn-chatbot-open');
        }

        // ─── Message submission ───────────────────────────────────────────────

        async function handleUserSubmit(e) {
          if (e) e.preventDefault();
          if (isSending) return;

          var inputEl = document.getElementById('bn-chatbot-input');
          if (!inputEl) return;

          var userQuery = inputEl.value.trim();
          if (!userQuery) return;

          if (!bitsnotesUser) {
            await fetchBitsNotesUser();
          }
          if (!bitsnotesUser) {
            openModal();
            return;
          }

          // Check local usage counter (admins are unlimited)
          // Check local monthly limit
          if (!bitsnotesUsage.unlimited && bitsnotesUsage.remaining <= 0) {
            appendMessage(
              'system',
              '⚠️ <strong>Monthly limit reached</strong><br/>You\'ve used all ' + bitsnotesUsage.limit + ' messages for this month. Your limit resets on the 1st of next month.',
              true
            );
            return;
          }

          // Remove welcome card if starting conversation
          var welcomeCard = document.querySelector('.bn-welcome-card');
          if (welcomeCard) {
            welcomeCard.remove();
          }

          inputEl.value = '';
          inputEl.style.height = 'auto';

          appendMessage('user', userQuery);
          conversationHistory.push({ role: 'user', content: userQuery });
          if (conversationHistory.length > 20) {
            conversationHistory = conversationHistory.slice(-20);
          }
          saveConversationHistory();

          isSending = true;
          var sendBtn = document.getElementById('bn-chatbot-send');
          if (sendBtn) sendBtn.disabled = true;
          var clearBtn = document.getElementById('bn-chat-clear-btn');
          if (clearBtn) clearBtn.disabled = true;

          showTypingIndicator();

          try {
            await handleBitsNotesSubmit(userQuery);
          } finally {
            isSending = false;
            if (sendBtn) sendBtn.disabled = false;
            if (clearBtn) clearBtn.disabled = false;
          }
        }

        // ─── BitsNotes submission (server proxy) ──────────────────────────────

        // Append a small "Sources" footer to the last assistant bubble (transparency
        // for cross-lecture retrieval). History keeps only the raw reply text.
        function appendSourcesFooter(sources) {
          // ─── Sources footer ───────────────────────────────────────────────────
          function appendSourcesFooter(sources, targetBubble) {
            try {
              if (!sources || sources.length === 0) return;
              var container = document.getElementById('bn-chatbot-messages');
              if (!container) return;
              var bubbles = container.querySelectorAll('.bn-msg.assistant .bn-msg-bubble');
              if (!bubbles || bubbles.length === 0) return;
              var last = bubbles[bubbles.length - 1];
              var bubble = targetBubble;
              if (!bubble) {
                var container = document.getElementById('bn-chatbot-messages');
                if (!container) return;
                var bubbles = container.querySelectorAll('.bn-msg.assistant .bn-msg-bubble');
                if (!bubbles || bubbles.length === 0) return;
                bubble = bubbles[bubbles.length - 1];
              }
              var footer = document.createElement('div');
              footer.className = 'bn-sources';
              var label = document.createElement('span');
              label.className = 'bn-sources-label';
              label.textContent = 'Sources: ';
              footer.appendChild(label);
              sources.forEach(function (s, idx) {
                if (idx > 0) footer.appendChild(document.createTextNode(' · '));
                var chip = document.createElement('span');
                var isTextbook = s && s.kind === 'textbook';
                chip.className = 'bn-source-chip' + (isTextbook ? ' bn-source-chip-textbook' : '');
                chip.textContent = (isTextbook ? '📖 ' : '') + (s.title || s.folderName || 'Related lecture');
                chip.title = (isTextbook ? 'Textbook: ' : '') + (s.title || '') + (s.folderName ? ' (' + s.folderName + ')' : '');
                footer.appendChild(chip);
              });
              last.appendChild(footer);
              container.scrollTop = container.scrollHeight;
              bubble.appendChild(footer);
            } catch (e) { }
          }

          // ─── Server Proxy Submission & Streaming Output ───────────────────────
          async function handleBitsNotesSubmit(userQuery) {
            // Rolling conversation history window (last 6 turns = 3 user, 3 assistant)
            var rollingMessages = conversationHistory.slice(-6).map(function (m) {
              return { role: m.role, content: m.content };
            });

            try {
              var res = await fetch('/api/chatbot/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  subject: getSubjectName(),
                  lectureFolder: getLectureFolderName(),
                  query: userQuery,
                  includeTextbook: isTextbookEnabled(),
                  messages: rollingMessages
                }),
              });

              hideTypingIndicator();

              if (!res.ok) {
                var errData = {};
                try { errData = await res.json(); } catch (e) { }

                // Roll back unanswered user turn
                if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
                  conversationHistory.pop();
                }
                saveConversationHistory();

                if (errData.limitReached) {
                  bitsnotesUsage.remaining = 0;
                  bitsnotesUsage.used = errData.used || bitsnotesUsage.limit;
                  bitsnotesUsage.limit = errData.limit || bitsnotesUsage.limit;
                  updateUsageUI();
                  appendMessage(
                    'system',
                    '⚠️ <strong>Monthly limit reached</strong><br/>You\'ve used all ' + (errData.limit || bitsnotesUsage.limit) + ' messages for this month. Your limit will reset on the 1st of next month.',
                    true
                  );
                } else if (res.status === 401) {
                  appendMessage(
                    'system',
                    '⚠️ <strong>' + escapeHtml(errData.error || 'Authentication required.') + '</strong><br/><a href="/auth/login" class="bn-chat-link" style="text-decoration:underline; font-weight:600;">Sign in to continue</a>',
                    '⚠️ <strong>' + escapeHtml(errData.error || 'Authentication required.') + '</strong><br/><a href="/auth/signin" class="bn-chat-link" style="text-decoration:underline; font-weight:600;">Sign in to continue</a>',
                    true
                  );
                } else {
                  var msg = errData.error ? escapeHtml(errData.error) : 'Chatbot is under heavy use, please try again later.';
                  appendMessage(
                    'system',
                    '⚠️ <strong>' + msg + '</strong>',
                    true
                  );
                  appendMessage('system', '⚠️ <strong>' + msg + '</strong>', true);
                }
                return;
              }

              var data = await res.json();
              var reply = '';
              if (data.choices && data.choices[0] && data.choices[0].message) {
                reply = data.choices[0].message.content;
              } else {
                reply = 'Received unexpected response format.';
              }

              appendMessage('assistant', reply);
              conversationHistory.push({ role: 'assistant', content: reply });
              if (conversationHistory.length > 20) {
                conversationHistory = conversationHistory.slice(-20);
              }
              saveConversationHistory();

              // Show cross-lecture sources when the server used related excerpts
              if (data._sources && data._sources.length > 0) {
                appendSourcesFooter(data._sources);
              }

              // Update usage from response
              if (data._usage) {
                bitsnotesUsage.used = data._usage.used;
                bitsnotesUsage.remaining = data._usage.remaining != null ? data._usage.remaining : bitsnotesUsage.remaining;
                bitsnotesUsage.limit = data._usage.limit != null ? data._usage.limit : bitsnotesUsage.limit;
                bitsnotesUsage.unlimited = Boolean(data._usage.unlimited);
                updateUsageUI();
              }

              // Stream assistant response with transformer typewriter animation
              await new Promise(function (resolve) {
                streamAssistantMessage(reply, data._sources, resolve);
              });

            } catch (err) {
              hideTypingIndicator();
              console.error('[chatbot] BitsNotes fetch error:', err);
              if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
                conversationHistory.pop();
              }
              saveConversationHistory();
              appendMessage(
                'system',
                '⚠️ <strong>Chatbot is under heavy use, please try again later.</strong>',
                true
              );
            }
          }

          // ─── Event initialization ─────────────────────────────────────────────

          function initEvents() {
            var chatForm = document.getElementById('bn-chatbot-form');
            var inputArea = document.getElementById('bn-chatbot-input');
            var bitsnotesStartBtn = document.getElementById('bn-bitsnotes-start-btn');

            if (bitsnotesStartBtn && !bitsnotesStartBtn.dataset.bnInited) {
              bitsnotesStartBtn.dataset.bnInited = 'true';
              bitsnotesStartBtn.addEventListener('click', function () {
                closeModal();
                openPanel();
              });
            }

            if (chatForm && !chatForm.dataset.bnInited) {
              chatForm.dataset.bnInited = 'true';
              chatForm.addEventListener('submit', handleUserSubmit);
            }

            if (inputArea && !inputArea.dataset.bnInited) {
              inputArea.dataset.bnInited = 'true';
              inputArea.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleUserSubmit();
                }
              });

              inputArea.addEventListener('input', function () {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 100) + 'px';
                this.style.height = Math.min(this.scrollHeight, 130) + 'px';
              });
            }

            // Wide reading view expand toggle
            var expandBtn = document.getElementById('bn-chat-expand-btn');
            if (expandBtn && !expandBtn.dataset.bnInited) {
              expandBtn.dataset.bnInited = 'true';
              expandBtn.addEventListener('click', function (e) {
                e.preventDefault();
                var panel = document.getElementById('bn-chatbot-panel');
                if (panel) {
                  var isWide = panel.classList.toggle('wide-mode');
                  try {
                    sessionStorage.setItem('bn_chat_wide', isWide ? '1' : '0');
                  } catch (err) { }
                }
              });
            }

            // Quick Actions Collapsible Toggle
            var quickActionsGroup = document.getElementById('bn-quick-actions-group');
            var quickActionsToggle = document.getElementById('bn-quick-actions-toggle');
            var quickTopBtn = document.getElementById('bn-quick-top-btn');
            var quickCommentsBtn = document.getElementById('bn-quick-comments-btn');

            if (quickActionsToggle && quickActionsGroup && !quickActionsToggle.dataset.bnInited) {
              quickActionsToggle.dataset.bnInited = 'true';
              quickActionsToggle.addEventListener('click', function (e) {
                e.stopPropagation();
                quickActionsGroup.classList.toggle('active');
              });
            }

            if (quickTopBtn && !quickTopBtn.dataset.bnInited) {
              quickTopBtn.dataset.bnInited = 'true';
              quickTopBtn.addEventListener('click', function () {
                window.scrollTo({ top: 0, behavior: 'smooth' });
                if (quickActionsGroup) quickActionsGroup.classList.remove('active');
              });
            }

            if (quickCommentsBtn && !quickCommentsBtn.dataset.bnInited) {
              quickCommentsBtn.dataset.bnInited = 'true';
              quickCommentsBtn.addEventListener('click', function () {
                var commentsEl = document.querySelector('.bn-comments');
                if (commentsEl) {
                  commentsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                if (quickActionsGroup) quickActionsGroup.classList.remove('active');
              });
            }

            var subjectLabel = document.getElementById('bn-chat-subject-label');
            if (subjectLabel) {
              subjectLabel.textContent = getSubjectName();
            }

            // Textbook companion toggle (Astro re-renders the panel on navigation)
            // Textbook companion toggle
            var textbookToggle = document.getElementById('bn-textbook-toggle');
            if (textbookToggle) {
              textbookToggle.checked = isTextbookEnabled();
              if (!textbookToggle.dataset.bnInited) {
                textbookToggle.dataset.bnInited = 'true';
                textbookToggle.addEventListener('change', function () {
                  setTextbookEnabled(textbookToggle.checked);
                });
              }
            }

            // Fetch BitsNotes user status and usage on init
            fetchBitsNotesUser().then(function () {
              if (bitsnotesUser) {
                fetchBitsNotesUsage();
              } else {
                updateUsageUI();
              }
            });
          }

          // Delegated click listener (resilient to Astro ViewTransitions)
          document.addEventListener('click', function (e) {
            // 1. Starter chip click
            var starterChip = e.target.closest('.bn-starter-chip');
            if (starterChip) {
              e.preventDefault();
              var promptText = starterChip.getAttribute('data-prompt');
              if (promptText) {
                var inputEl = document.getElementById('bn-chatbot-input');
                if (inputEl) {
                  inputEl.value = promptText;
                  handleUserSubmit();
                }
              }
              return;
            }

            // 2. Chatbot FAB
            var fab = e.target.closest('#bn-chatbot-fab');
            if (fab) {
              e.preventDefault();
              var panel = document.getElementById('bn-chatbot-panel');
              if (panel && panel.classList.contains('open')) {
                closePanel();
              } else {
                openPanelWithFreshUser();
              }
              return;
            }

            // 3. Settings button
            var configBtn = e.target.closest('#bn-chat-config-btn');
            if (configBtn) {
              e.preventDefault();
              showSettingsView();
              return;
            }

            // 4. Back button
            var backBtn = e.target.closest('#bn-chat-back-btn');
            if (backBtn) {
              e.preventDefault();
              showChatView();
              return;
            }

            // 5. Close button
            var closeBtn = e.target.closest('#bn-chat-close-btn') || e.target.closest('#bn-chat-close-btn-settings');
            if (closeBtn) {
              e.preventDefault();
              closePanel();
              return;
            }

            // 6. Clear chat button
            var clearChatBtn = e.target.closest('#bn-chat-clear-btn');
            if (clearChatBtn) {
              e.preventDefault();
              clearChat();
              return;
            }

            // 7. Mobile backdrop
            var backdrop = e.target.closest('#bn-chatbot-backdrop');
            if (backdrop) {
              e.preventDefault();
              closePanel();
              return;
            }

            var quickGroup = document.getElementById('bn-quick-actions-group');
            if (quickGroup && !quickGroup.contains(e.target)) {
              quickGroup.classList.remove('active');
            }
          });

          // Keyboard shortcut: Escape to close drawer
          document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
              var panel = document.getElementById('bn-chatbot-panel');
              if (panel && panel.classList.contains('open')) {
                closePanel();
              }
            }
          });

          // Reset chatbot UI state before Astro view-transition swaps.
          if (!window.__bnChatbotSwapCleanupBound) {
            window.__bnChatbotSwapCleanupBound = true;
            document.addEventListener('astro:before-swap', function () {
              stopActiveStream();
              document.body.classList.remove('bn-chatbot-open');
              var panel = document.getElementById('bn-chatbot-panel');
              if (panel) {
                panel.classList.remove('open', 'docked-mode');
                panel.classList.remove('open');
              }
            });
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initEvents);
          } else {
            initEvents();
          }
          document.addEventListener('astro:page-load', initEvents);
        }) ();
