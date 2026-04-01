// Use a known installed playwright version that has matching browser binaries
// The global @playwright/cli has version 1212, but we have 1217 installed.
// Use the playwright from a project that has matching binaries.
const playwrightPath = 'C:\\Users\\bjorn.vandegaer\\OneDrive - Miniemeninstituut\\Miniemeninstituut\\Cursus\\template-slides\\node_modules\\playwright';
const { chromium } = require(playwrightPath);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect console messages
  const consoleMessages = [];
  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  // Collect network responses
  const networkResponses = [];
  page.on('response', response => {
    networkResponses.push({
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
    });
  });

  // Collect page errors
  const pageErrors = [];
  page.on('pageerror', err => {
    pageErrors.push(err.message);
  });

  try {
    // Step 1: Log in
    console.log('--- Navigating to login page ---');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
    console.log('Login page title:', await page.title());

    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin');
    await page.click('button[type="submit"]');

    await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
    console.log('After login URL:', page.url());
    console.log('After login title:', await page.title());

    // Step 2: Navigate to /attestering/411
    console.log('\n--- Navigating to /attestering/411 ---');
    const attestResponse = await page.goto('http://localhost:3000/attestering/411', { waitUntil: 'networkidle' });
    console.log('Response status:', attestResponse ? attestResponse.status() : 'unknown');
    console.log('Final URL:', page.url());
    console.log('Page title:', await page.title());

    // Step 3: Screenshot
    await page.screenshot({ path: '/tmp/attestering-411.png', fullPage: true });
    console.log('\nScreenshot saved to /tmp/attestering-411.png');

    // Step 4: Console errors
    console.log('\n--- Console messages ---');
    if (consoleMessages.length === 0) {
      console.log('(none)');
    }
    for (const msg of consoleMessages) {
      console.log(`[${msg.type.toUpperCase()}] ${msg.text}`);
    }

    // Page errors
    console.log('\n--- Page errors ---');
    if (pageErrors.length === 0) {
      console.log('(none)');
    }
    for (const err of pageErrors) {
      console.log('ERROR:', err);
    }

    // Step 5: Network responses (filter for /attestering/411 and API calls)
    console.log('\n--- Relevant network responses ---');
    const relevant = networkResponses.filter(r =>
      r.url.includes('attestering') ||
      r.url.includes('/api/') ||
      r.status >= 400
    );
    if (relevant.length === 0) {
      console.log('(no relevant responses)');
    }
    for (const r of relevant) {
      console.log(`${r.status} ${r.statusText} — ${r.url}`);
    }

    // Also show the main page response
    console.log('\n--- All network responses (summary) ---');
    for (const r of networkResponses) {
      console.log(`${r.status} — ${r.url}`);
    }

    // Step 6: Page content snippet
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('\n--- Page body text (first 2000 chars) ---');
    console.log(bodyText.substring(0, 2000));

  } catch (err) {
    console.error('Test error:', err.message);
    await page.screenshot({ path: '/tmp/attestering-411-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
