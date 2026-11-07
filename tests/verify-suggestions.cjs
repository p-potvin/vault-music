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

    // 1. Test Scan Library button (#btn-desktop-scan)
    await page.click('#btn-desktop-scan');
    await page.waitForFunction(() => {
        const text = document.querySelector('#btn-desktop-scan span')?.textContent || '';
        return text.includes('✓') && text.includes('Songs');
    }, { timeout: 15000 });
    console.log('2. Scan Library button result:', (await page.textContent('#btn-desktop-scan span')).trim());

    // 2. Test Downloaded tab (#tab-offline) shows torrent-downloaded files
    await page.click('.nav-btn[data-tab="offline"]');
    await page.waitForSelector('#tab-offline', { state: 'visible' });
    await page.waitForFunction(() => {
        const rows = document.querySelectorAll('#torrent-downloads-container .track-row');
        return rows.length > 0;
    }, { timeout: 15000 });
    const dlSummary = (await page.textContent('#torrent-downloads-summary')).trim();
    const dlCount = await page.$$eval('#torrent-downloads-container .track-row', els => els.length);
    console.log('3. Downloaded tab torrent tracks:', dlCount, '| summary:', dlSummary);

    // 3. Test Songs tab shows full library (> 1200 songs, no 300-song cap)
    await page.click('.nav-btn[data-tab="tracks"]');
    await page.waitForSelector('#tab-tracks', { state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('#tracks-container .track-row').length > 1000, { timeout: 15000 });
    const songsCount = await page.$$eval('#tracks-container .track-row', els => els.length);
    console.log('4. Songs tab rendered rows:', songsCount);

    // 4. Test Search & Download tab: simplified Missing Album flow auto-runs on playlist selection
    await page.click('.nav-btn[data-tab="downloads"]');
    await page.waitForSelector('#tab-downloads', { state: 'visible' });
    const modeAGone = (await page.$('#reconstructor-results-container')) === null;
    console.log('5. Mode A table removed:', modeAGone);

    await page.waitForFunction(() => document.querySelectorAll('#select-apple-playlist option').length > 1, { timeout: 30000 });
    const values = await page.$$eval('#select-apple-playlist option', els => els.map(e => ({ v: e.value, t: e.textContent })));
    const target = values.find(o => /Daft Punk/.test(o.t)) || values.find(o => /NOFX/.test(o.t)) || values[1];
    console.log('6. Selecting playlist (auto-matching):', target.t.trim());
    await page.selectOption('#select-apple-playlist', target.v);

    // Wait for auto-detection + auto-matching to complete
    await page.waitForSelector('#suggestions-panel', { state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => {
        const meta = document.querySelector('#suggestions-meta')?.textContent || '';
        return meta.includes('Auto-matched') || meta.includes('already in your library');
    }, { timeout: 60000 });

    const cards = await page.$$eval('#suggestions-list .suggestion-card', els => els.length);
    const summary = (await page.textContent('#suggestions-summary')).trim();
    const meta = (await page.textContent('#suggestions-meta')).trim();
    console.log('7. Auto-matched suggestion cards:', cards, '| summary:', summary);
    console.log('8. Auto-match meta:', meta);

    if (cards > 0) {
        const firstRelease = await page.$eval('#suggestions-list .suggestion-card .suggestion-release', el => el.textContent.trim().slice(0, 100));
        console.log('9. First card release info:', firstRelease);
    }

    console.log('\nconsole errors:', errors.length ? errors : 'none');
    console.log('failed requests:', failed.length ? failed : 'none');

    await browser.close();
})().catch(err => { console.error('VERIFY FAILED:', err.message); process.exit(1); });
