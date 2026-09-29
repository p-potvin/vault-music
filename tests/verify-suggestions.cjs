const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

function findChromium() {
    const base = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
    for (const dir of fs.readdirSync(base)) {
        if (!dir.startsWith('chromium-')) continue;
        for (const sub of ['chrome-win64', 'chrome-win']) {
            const candidate = path.join(base, dir, sub, 'chrome.exe');
            if (fs.existsSync(candidate)) return candidate;
        }
    }
    throw new Error('chromium not found');
}

(async () => {
    const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const errors = [];
    const failed = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('requestfailed', r => failed.push(r.url() + ' :: ' + (r.failure() || {}).errorText));

    await page.goto('http://localhost:8733', { waitUntil: 'networkidle' });
    console.log('1. loaded:', await page.title());

    await page.click('.nav-btn[data-tab="downloads"]');
    await page.waitForSelector('#tab-downloads', { state: 'visible' });
    console.log('2. downloads tab visible');

    const panelBefore = await page.isVisible('#suggestions-panel');
    console.log('3. suggestions panel hidden initially:', panelBefore === false);

    console.log('4. scan button:', (await page.textContent('#btn-scan-apple-text')).trim());
    await page.click('#btn-scan-apple-music');
    await page.waitForFunction(() => document.querySelectorAll('#select-apple-playlist option').length > 1, { timeout: 60000 });
    const options = await page.$$eval('#select-apple-playlist option', els => els.length);
    console.log('5. playlists loaded:', options - 1);

    const findMissingDisabled = await page.getAttribute('#btn-find-missing', 'disabled');
    console.log('6. find-missing enabled after scan:', findMissingDisabled === null);

    // pick a playlist with gaps
    const values = await page.$$eval('#select-apple-playlist option', els => els.map(e => ({ v: e.value, t: e.textContent })));
    const target = values.find(o => /NOFX/.test(o.t)) || values[1];
    await page.selectOption('#select-apple-playlist', target.v);
    console.log('7. selected playlist:', target.t.trim());

    await page.click('#btn-find-missing');
    await page.waitForSelector('#suggestions-panel', { state: 'visible', timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('#suggestions-list .suggestion-card').length > 0, { timeout: 60000 });

    const cards = await page.$$eval('#suggestions-list .suggestion-card', els => els.length);
    const summary = (await page.textContent('#suggestions-summary')).trim();
    const meta = (await page.textContent('#suggestions-meta')).trim();
    console.log('8. suggestion cards:', cards, '| summary:', summary);
    console.log('9. meta:', meta.slice(0, 120));

    const firstCard = await page.$eval('#suggestions-list .suggestion-card', el => ({
        title: el.querySelector('.suggestion-label span').textContent,
        count: el.querySelector('.suggestion-count').textContent,
        trackBoxes: el.querySelectorAll('.suggestion-track-check').length,
        checkedBoxes: [...el.querySelectorAll('.suggestion-track-check')].filter(b => b.checked).length,
        albumChecked: el.querySelector('.suggestion-album-check').checked,
        selected: el.classList.contains('selected'),
    }));
    console.log('10. first card:', JSON.stringify(firstCard));

    // untick the album and confirm track boxes follow
    await page.click('#suggestions-list .suggestion-card .suggestion-album-check');
    const afterUntick = await page.$eval('#suggestions-list .suggestion-card', el => ({
        checkedBoxes: [...el.querySelectorAll('.suggestion-track-check')].filter(b => b.checked).length,
        selected: el.classList.contains('selected'),
    }));
    console.log('11. after unticking album:', JSON.stringify(afterUntick));

    // re-tick
    await page.click('#suggestions-list .suggestion-card .suggestion-album-check');
    const afterRetick = await page.$eval('#suggestions-list .suggestion-card', el => ({
        checkedBoxes: [...el.querySelectorAll('.suggestion-track-check')].filter(b => b.checked).length,
        selected: el.classList.contains('selected'),
    }));
    console.log('12. after re-ticking album:', JSON.stringify(afterRetick));

    const queueDisabled = await page.getAttribute('#btn-queue-suggestions', 'disabled');
    console.log('13. queue disabled before releases found:', queueDisabled !== null);

    await page.screenshot({ path: 'suggestions-panel.png', fullPage: false });
    console.log('14. screenshot written');

    // mobile check
    await page.setViewportSize({ width: 430, height: 900 });
    await page.waitForTimeout(400);
    const mobileCard = await page.$eval('#suggestions-list .suggestion-card', el => {
        const r = el.getBoundingClientRect();
        return { width: Math.round(r.width), left: Math.round(r.left) };
    });
    console.log('15. mobile card box:', JSON.stringify(mobileCard));
    await page.screenshot({ path: 'suggestions-mobile.png', fullPage: false });

    console.log('\nconsole errors:', errors.length ? errors : 'none');
    console.log('failed requests:', failed.length ? failed : 'none');

    await browser.close();
})().catch(err => { console.error('VERIFY FAILED:', err.message); process.exit(1); });
