// Check apple-bottom-bar geometry under coarse pointer (touchscreen laptop scenario)
// and phone-mode toggle.
const { chromium } = require('playwright-core');
const EXE = 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
const URL = 'http://localhost:8733';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });

  // Scenario A: coarse pointer, desktop width (touchscreen laptop)
  let ctx = await browser.newContext({ viewport: { width: 1013, height: 800 }, hasTouch: true });
  let page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  let r = await page.evaluate(() => {
    const nav = document.querySelector('.apple-bottom-bar');
    const b = nav.getBoundingClientRect(); const cs = getComputedStyle(nav);
    const tabs = [...document.querySelectorAll('.apple-tab')].map(t => {
      const r2 = t.getBoundingClientRect(); return `${t.textContent.trim()}:${Math.round(r2.x)},${Math.round(r2.y)},${Math.round(r2.width)}x${Math.round(r2.height)}`;
    });
    const mini = document.querySelector('.floating-mini-player').getBoundingClientRect();
    return { bar: `${cs.display}/${cs.position} x=${b.x} y=${b.y} w=${b.width} h=${b.height} fd=${cs.flexDirection}`, tabs, miniX: mini.x };
  });
  console.log('COARSE+wide:', JSON.stringify(r, null, 1));
  await page.screenshot({ path: 'vm-shot-coarse.png' });
  await ctx.close();

  // Scenario B: fine pointer + phone-mode toggle on
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('btn-switch-mode')?.click());
  await page.waitForTimeout(500);
  r = await page.evaluate(() => {
    const nav = document.querySelector('.apple-bottom-bar');
    const b = nav.getBoundingClientRect(); const cs = getComputedStyle(nav);
    const tabs = [...document.querySelectorAll('.apple-tab')].map(t => {
      const r2 = t.getBoundingClientRect(); return `${t.textContent.trim()}:${Math.round(r2.x)},${Math.round(r2.y)},${Math.round(r2.width)}x${Math.round(r2.height)}`;
    });
    return { bodyClass: document.body.className, bar: `${cs.display}/${cs.position} x=${b.x} y=${b.y} w=${b.width} h=${b.height} fd=${cs.flexDirection}`, tabs };
  });
  console.log('PHONE-MODE:', JSON.stringify(r, null, 1));
  await ctx.close();
  await browser.close();
})();
