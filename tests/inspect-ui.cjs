// Throwaway UI inspector: loads the app in headless chromium (ms-playwright binary),
// reports computed styles/geometry for layout elements, console errors, and screenshots.
const { chromium } = require('playwright-core');

const EXE = 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
const URL = process.argv[2] || 'http://localhost:8733';
const OUT = process.argv[3] || 'C:\\Users\\Administrator\\Desktop\\Github Repos\\vault-music\\vm-shot1.png';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => errors.push('NAV: ' + e.message));
  await page.waitForTimeout(2500);

  const report = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, exists: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        sel, exists: true,
        display: cs.display, position: cs.position,
        width: cs.width, height: cs.height,
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        flexDirection: cs.flexDirection,
        visibility: cs.visibility,
      };
    };
    return {
      url: location.href,
      viewport: { w: innerWidth, h: innerHeight },
      pointerCoarse: matchMedia('(pointer: coarse)').matches,
      maxWidth768: matchMedia('(max-width: 768px)').matches,
      bodyClass: document.body.className,
      els: [
        pick('.app-container'),
        pick('.desktop-sidebar'),
        pick('.main-viewport'),
        pick('.desktop-header'),
        pick('.mobile-top-bar'),
        pick('.content-scroll-area'),
        pick('.floating-mini-player'),
        pick('.apple-bottom-bar'),
        pick('.apple-tab'),
        pick('.nav-btn'),
      ],
      cssRuleCount: [...document.styleSheets].map(s => {
        try { return { href: s.href, rules: s.cssRules.length }; }
        catch (e) { return { href: s.href, rules: 'ERR ' + e.message }; }
      }),
    };
  });

  console.log(JSON.stringify(report, null, 2));
  console.log('CONSOLE ERRORS:', JSON.stringify(errors, null, 2));
  await page.screenshot({ path: OUT });
  await browser.close();
})();
