// Find elements forcing main-viewport wider than the window — per tab, and with coarse pointer.
const { chromium } = require('playwright-core');
const EXE = 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
const URL = 'http://localhost:8733';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  for (const coarse of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1013, height: 800 }, hasTouch: coarse });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log('NAV', e.message));
    await page.waitForTimeout(2000);
    for (const tab of ['home', 'tracks', 'artists', 'albums', 'playlists', 'downloads', 'metadata']) {
      await page.evaluate(t => {
        document.querySelectorAll(`.nav-btn[data-tab="${t}"], .apple-tab[data-tab="${t}"]`).forEach(b => b.click());
      }, tab);
      await page.waitForTimeout(600);
      const r = await page.evaluate(() => {
        const sb = document.querySelector('.desktop-sidebar');
        const mv = document.querySelector('.main-viewport');
        const wide = [];
        document.querySelectorAll('.main-viewport *').forEach(el => {
          const rc = el.getBoundingClientRect();
          if (rc.width > mv.getBoundingClientRect().width + 5 || el.scrollWidth > mv.clientWidth + 5) {
            wide.push({ tag: el.tagName, cls: String(el.className).slice(0, 50), id: el.id, w: Math.round(rc.width), sw: el.scrollWidth });
          }
        });
        return {
          coarse: matchMedia('(pointer: coarse)').matches,
          m768: matchMedia('(max-width:768px)').matches,
          sidebarDisplay: getComputedStyle(sb).display, sidebarW: Math.round(sb.getBoundingClientRect().width),
          mvW: Math.round(mv.getBoundingClientRect().width), mvScrollW: mv.scrollWidth,
          wide: wide.slice(0, 12),
        };
      });
      console.log(`coarse=${coarse} tab=${tab}:`, JSON.stringify(r));
    }
    await ctx.close();
  }
  await browser.close();
})();
