import { test, expect } from '@playwright/test';

test.describe('TOC sidebar diagnosis', () => {
  test('diagnose topic sidebar interactivity', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('bitsnotes-cookie-consent', JSON.stringify({ ads: true, analytics: true, functional: true }));
    });
    await page.goto('/view/Deep%20Neural%20Networks/DNN_Lecture_01_notes');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#topic-sidebar')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#topic-list-nav .topic-nav-link').first()).toBeVisible();

    const diag = await page.evaluate(() => {
      const out: Record<string, unknown> = {};
      const sidebar = document.getElementById('topic-sidebar') as HTMLElement;
      const cs = getComputedStyle(sidebar);
      out.sidebar = {
        rect: { top: sidebar.getBoundingClientRect().top, bottom: sidebar.getBoundingClientRect().bottom, left: sidebar.getBoundingClientRect().left, right: sidebar.getBoundingClientRect().right },
        position: cs.position,
        width: cs.width,
        height: cs.height,
        overflowY: cs.overflowY,
        pointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex,
        visibility: cs.visibility,
        opacity: cs.opacity,
        scrollTop: sidebar.scrollTop,
        scrollHeight: sidebar.scrollHeight,
        clientHeight: sidebar.clientHeight,
        classList: Array.from(sidebar.classList),
      };

      // What is on top of the sidebar at several probe points?
      const probes: Record<string, unknown> = {};
      const r = sidebar.getBoundingClientRect();
      const points = {
        headerCenter: { x: r.left + r.width / 2, y: r.top + 30 },
        midTop: { x: r.left + r.width / 2, y: r.top + r.height * 0.25 },
        mid: { x: r.left + r.width / 2, y: r.top + r.height * 0.5 },
        midBottom: { x: r.left + r.width / 2, y: r.top + r.height * 0.75 },
        bottom: { x: r.left + r.width / 2, y: r.bottom - 10 },
      };
      for (const [name, p] of Object.entries(points)) {
        const el = document.elementFromPoint(p.x, p.y);
        probes[name] = el
          ? { tag: el.tagName, id: el.id, cls: el.className, isSidebarOrChild: !!el.closest('#topic-sidebar') }
          : null;
      }
      out.probes = probes;

      // Does the sidebar get wheel events directly?
      const wheelTarget = document.elementFromPoint(points.mid.x, points.mid.y);
      out.wheelTarget = wheelTarget ? { tag: wheelTarget.tagName, id: wheelTarget.id, cls: wheelTarget.className, isSidebarOrChild: !!wheelTarget.closest('#topic-sidebar') } : null;

      // Any fixed/absolute full-size overlays?
      const overlays: unknown[] = [];
      document.querySelectorAll('body *').forEach((el) => {
        const e = el as HTMLElement;
        const s = getComputedStyle(e);
        if ((s.position === 'fixed' || s.position === 'absolute') && s.visibility !== 'hidden' && s.opacity !== '0' && s.pointerEvents !== 'none') {
          const er = e.getBoundingClientRect();
          if (er.width > 50 && er.height > 50) {
            const rr = sidebar.getBoundingClientRect();
            const overlaps = !(er.right < rr.left || er.left > rr.right || er.bottom < rr.top || er.top > rr.bottom);
            if (overlaps) {
              overlays.push({ tag: e.tagName, id: e.id, cls: e.className, z: s.zIndex, rect: { left: er.left, top: er.top, right: er.right, bottom: er.bottom }, overlapsSidebar: true });
            }
          }
        }
      });
      out.overlays = overlays;
      out.bodyClass = document.body.className;
      out.topicSidebarToggle = (() => {
        const t = document.getElementById('topic-sidebar-toggle');
        if (!t) return null;
        const ts = getComputedStyle(t);
        return { display: ts.display, pointerEvents: ts.pointerEvents, rect: { left: t.getBoundingClientRect().left, top: t.getBoundingClientRect().top, right: t.getBoundingClientRect().right, bottom: t.getBoundingClientRect().bottom } };
      })();
      return out;
    });

    console.log('=== TOC DIAGNOSTIC ===');
    console.log(JSON.stringify(diag, null, 2));

    // --- Interaction 1: wheel over the sidebar (must scroll its content) ---
    const sideRect = await page.locator('#topic-sidebar').boundingBox();
    await page.mouse.move(sideRect!.x + sideRect!.width / 2, sideRect!.y + sideRect!.height * 0.5);
    const beforeScrollTop = await page.evaluate(() => (document.getElementById('topic-sidebar') as HTMLElement).scrollTop);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(400);
    const wheelRes = await page.evaluate(() => {
      const sidebar = document.getElementById('topic-sidebar') as HTMLElement;
      return { after: sidebar.scrollTop, maxScroll: sidebar.scrollHeight - sidebar.clientHeight };
    });
    console.log('=== WHEEL ===');
    console.log(JSON.stringify({ before: beforeScrollTop, ...wheelRes }, null, 2));
    expect(wheelRes.after).toBeGreaterThan(beforeScrollTop);

    // --- Interaction 2: click a topic link ---
    const beforeHash = await page.evaluate(() => location.hash);
    const beforeScroll = await page.evaluate(() => window.scrollY);
    await page.locator('#topic-list-nav .topic-nav-link').first().click();
    await page.waitForTimeout(900);
    const clickResult = await page.evaluate(() => ({ hash: location.hash, scrollY: window.scrollY }));
    console.log('=== CLICK TOPIC LINK ===');
    console.log(JSON.stringify({ beforeHash, beforeScroll, after: clickResult }, null, 2));
    expect(clickResult.hash).not.toBe(beforeHash);

    // --- Interaction 3: collapse via header click, then expand via collapse button ---
    await page.locator('#topic-sidebar-header').click({ force: false });
    await page.waitForTimeout(300);
    const collapsedNow = await page.evaluate(() => ({
      hasCollapsed: document.getElementById('topic-sidebar')!.classList.contains('collapsed'),
    }));
    console.log('=== HEADER CLICK ===');
    console.log(JSON.stringify(collapsedNow, null, 2));
    expect(collapsedNow.hasCollapsed).toBe(true);

    await page.locator('#topic-sidebar-collapse-btn').click({ force: false });
    await page.waitForTimeout(300);
    const expandedNow = await page.evaluate(() => ({
      hasCollapsed: document.getElementById('topic-sidebar')!.classList.contains('collapsed'),
    }));
    console.log('=== COLLAPSE BTN CLICK ===');
    console.log(JSON.stringify(expandedNow, null, 2));
    expect(expandedNow.hasCollapsed).toBe(false);

    // --- Interaction 4: chat panel opens and is interactive (regression for the scoped CSS) ---
    await page.locator('#bn-chatbot-fab').click();
    await page.waitForTimeout(600);
    const panelState = await page.evaluate(() => {
      const panel = document.getElementById('bn-chatbot-panel') as HTMLElement;
      const activeView = panel.querySelector('.bn-chat-view.active') as HTMLElement;
      const cs = getComputedStyle(activeView);
      return {
        panelOpen: panel.classList.contains('open'),
        panelDocked: panel.classList.contains('docked-mode'),
        activeViewId: activeView.id,
        viewVisibility: cs.visibility,
        viewPointerEvents: cs.pointerEvents,
        bodyHasOpen: document.body.classList.contains('bn-chatbot-open'),
      };
    });
    console.log('=== PANEL OPEN ===');
    console.log(JSON.stringify(panelState, null, 2));
    expect(panelState.panelOpen).toBe(true);
    expect(panelState.activeViewId).toBeTruthy();
    expect(panelState.viewVisibility).toBe('visible');
    expect(panelState.viewPointerEvents).toBe('auto');

    await page.locator('#bn-chat-close-btn').click();
    await page.waitForTimeout(500);
    const closedState = await page.evaluate(() => {
      const panel = document.getElementById('bn-chatbot-panel') as HTMLElement;
      const view = document.getElementById('bn-chat-view-main') as HTMLElement;
      const cs = getComputedStyle(view);
      return {
        panelOpen: panel.classList.contains('open'),
        bodyHasOpen: document.body.classList.contains('bn-chatbot-open'),
        viewVisibility: cs.visibility,
        viewPointerEvents: cs.pointerEvents,
      };
    });
    console.log('=== PANEL CLOSED ===');
    console.log(JSON.stringify(closedState, null, 2));
    expect(closedState.panelOpen).toBe(false);
    expect(closedState.bodyHasOpen).toBe(false);
    expect(closedState.viewVisibility).toBe('hidden');
    expect(closedState.viewPointerEvents).toBe('none');
  });
});
