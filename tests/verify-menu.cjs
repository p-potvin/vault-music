// Post-fix GUI verification: tabs, console errors, hover, phone-mode.
const { chromium } = require('playwright-core');
const EXE = 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
const URL = 'http://localhost:8733';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => errors.push(e.message));
  await page.waitForTimeout(2000);

  const g = (sel) => page.evaluate(s => {
    const el = document.querySelector(s); if (!el) return null;
    const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
    return `${cs.display}/${cs.position} ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`;
  }, sel);

  console.log('desktop sidebar:', await g('.desktop-sidebar'));
  console.log('desktop header:', await g('.desktop-header'));
  console.log('bottombar:', await g('.apple-bottom-bar'));
  console.log('mobile-top:', await g('.mobile-top-bar'));

  // click through tabs (2+ deep navigation)
  for (const tab of ['tracks', 'albums', 'artists', 'downloads', 'home']) {
    await page.evaluate(t => document.querySelector(`.nav-btn[data-tab="${t}"]`)?.click(), tab);
    await page.waitForTimeout(700);
    const h1 = await page.evaluate(() => {
      const t = document.querySelector('.content-scroll-area h1, .content-scroll-area h2, .ios-section-title');
      return t ? t.textContent.trim() : '(no title)';
    });
    console.log(`tab=${tab}: section="${h1}"`);
  }

  // hover a nav button
  await page.hover('.nav-btn[data-tab="tracks"]');
  await page.waitForTimeout(300);

  // back to desktop
  console.log('CONSOLE ERRORS:', JSON.stringify(errors.slice(0, 15)));

  // phone-mode emulation check
  const ctx2 = await browser.newContext({ viewport: { width: 430, height: 800 }, hasTouch: true, isMobile: true });
  const p2 = await ctx2.newPage();
  await p2.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await p2.waitForTimeout(1500);
  const bb = await p2.evaluate(() => {
    const el = document.querySelector('.apple-bottom-bar'); const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
    return `${cs.display}/${cs.position} ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`;
  });
  const mt = await p2.evaluate(() => {
    const el = document.querySelector('.mobile-top-bar'); const cs = getComputedStyle(el); return cs.display;
  });
  console.log('phone-mode bottombar:', bb, '| mobile-top display:', mt);
  await p2.screenshot({ path: 'vm-phone.png' });
  await ctx2.close();

  await page.screenshot({ path: 'vm-fixed.png' });
  await browser.close();
})();
