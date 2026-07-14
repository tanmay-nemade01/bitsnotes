import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`BROWSER CONSOLE [${msg.type()}]:`, msg.text());
  });

  page.on('pageerror', err => {
    console.error('BROWSER PAGE ERROR:', err);
  });

  const url = 'http://localhost:4321/view/Deep%20Reinforcement%20Learning/DRL_Lecture_5_notes?topic=5.1';
  console.log('Navigating to:', url);
  await page.goto(url);

  await page.waitForTimeout(2000);

  const textContent = await page.evaluate(() => {
    const el = document.getElementById('lecture-topics-data');
    return el ? el.textContent : null;
  });

  console.log('Script element text content length in browser:', textContent ? textContent.length : 'NULL');

  if (textContent) {
    try {
      JSON.parse(textContent);
      console.log('Browser textContent parsed successfully in Node!');
    } catch (e) {
      console.error('Browser textContent failed to parse in Node:', e.message);
    }
  }

  await browser.close();
})();
