// Sweep viewport widths; log geometry of nav elements to find the broken layout.
const { chromium } = require('playwright-core');
const EXE = 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
const URL = 'http://localhost:8733';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  for (const w of [320, 375, 430, 500, 640, 768, 900, 1013]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('NAV', e.message));
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const g = s => {
        const el = document.querySelector(s);
        if (!el) return null;
        const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
        return `${cs.display}/${cs.position} x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.width)} h=${Math.round(b.height)}`;
      };
      const tabs = [...document.querySelectorAll('.apple-tab')].map(t => {
        const b = t.getBoundingClientRect(); return `${t.textContent.trim()}:${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}x${Math.round(b.height)}`;
      });
      const navs = [...document.querySelectorAll('.nav-btn')].map(t => {
        const b = t.getBoundingClientRect(); return `${t.textContent.trim().slice(0,12)}:${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}x${Math.round(b.height)}`;
      });
      return {
        m768: matchMedia('(max-width:768px)').matches,
        sidebar: g('.desktop-sidebar'), bottombar: g('.apple-bottom-bar'),
        tabs, navs,
      };
    });
    console.log(`\n=== width ${w} (m768=${r.m768}) ===`);
    console.log(' sidebar:', r.sidebar);
    console.log(' bottombar:', r.bottombar);
    console.log(' tabs:', r.tabs.join(' | '));
    console.log(' navs:', r.navs.join(' | '));
    await ctx.close();
  }
  await browser.close();
})();
