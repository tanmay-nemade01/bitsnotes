const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const requestBodies = [];
  await page.route('**/chat/completions*', async (route) => {
    const body = route.request().postDataJSON();
    requestBodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test',
        object: 'chat.completion',
        created: Date.now(),
        model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'REPLY ' + requestBodies.length }, finish_reason: 'stop' }],
      }),
    });
  });

  await page.goto('https://bitsnotes.com/view/machine-learning/introduction-to-machine-learning-session-1', { waitUntil: 'networkidle' });
  const cookieBtn = page.locator('#cookie-btn-accept');
  if (await cookieBtn.count()) { await cookieBtn.click({ force: true }); }
  await page.waitForTimeout(500);
  await page.waitForSelector('#bn-chatbot-fab', { timeout: 15000 });
  await page.locator('#bn-chatbot-fab').click();
  await page.waitForTimeout(800);

  await page.fill('#bn-api-key-input', 'test-key');
  await page.fill('#bn-model-name-input', 'test-model');
  await page.click('#bn-chatbot-config-form button[type="submit"]');
  await page.waitForTimeout(800);

  const input = page.locator('#bn-chatbot-input');
  await input.fill('What is a hash table?');
  await page.locator('#bn-chatbot-send').click();
  await page.waitForTimeout(1500);

  await input.fill('Give an example.');
  await page.locator('#bn-chatbot-send').click();
  await page.waitForTimeout(1500);

  console.log('=== REQUESTS CAPTURED: ' + requestBodies.length + ' ===');
  requestBodies.forEach((b, i) => {
    console.log('--- Request ' + (i + 1) + ' (messages: ' + b.messages.length + ') ---');
    b.messages.forEach((m) => {
      console.log('  [' + m.role + '] ' + String(m.content).substring(0, 80));
    });
  });

  const msgsBefore = await page.locator('#bn-chatbot-messages .bn-msg').count();
  console.log('messages before nav: ' + msgsBefore);

  const navLink = page.locator('#lecture-sidebar a, .lecture-nav-link a, nav a[href*="/view/"]').last();
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/view/"]'));
    const current = window.location.pathname;
    const other = links.find((a) => a.getAttribute('href') !== current);
    if (other) other.click();
  });
  await page.waitForTimeout(2500);

  const urlAfter = page.url();
  const panelOpen2 = await page.locator('#bn-chatbot-panel.open').count();
  console.log('url after nav: ' + urlAfter);
  console.log('panel open after nav: ' + (panelOpen2 > 0));

  await page.locator('#bn-chatbot-fab').click({ force: true });
  await page.waitForTimeout(800);
  const msgsAfter = await page.locator('#bn-chatbot-messages .bn-msg').count();
  console.log('messages after nav+reopen: ' + msgsAfter);

  await browser.close();
})();
