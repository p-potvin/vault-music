const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

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
    console.log('=== REAL-CONDITION UI PROOF: TIERED BADGES & RELEASE SELECTION ===');

    const browser = await chromium.launch({
        executablePath: findChromium(),
        args: ['--no-sandbox']
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));

    // 1. Navigate to downloads page
    await page.goto('http://localhost:8733#downloads', { waitUntil: 'networkidle' });
    console.log('1. Page loaded successfully:', await page.title());

    // 2. Playlists are auto-discovered from snapshot on tab load
    await page.waitForFunction(() => document.querySelectorAll('#select-apple-playlist option').length > 1, { timeout: 30000 });
    const options = await page.$$eval('#select-apple-playlist option', els => els.map(e => ({ v: e.value, t: e.textContent })));
    console.log(`2. Playlists auto-populated on page load: ${options.length - 1} playlists found`);

    // 3. Select playlist with tracks (e.g. The Stooges or NOFX)
    const target = options.find(o => /The Stooges/i.test(o.t)) || options[1];
    await page.selectOption('#select-apple-playlist', target.v);
    await page.dispatchEvent('#select-apple-playlist', 'change');
    console.log('3. Selected playlist:', target.t.trim());

    // 4. Test playlist track matching with tiered size algorithm
    console.log('4. Clicking Match Releases for playlist...');
    await page.click('#btn-match-playlist');

    // Wait for the results table container to become visible
    await page.waitForSelector('#reconstructor-results-container', { state: 'visible', timeout: 60000 });
    await page.waitForFunction(() => {
        const rows = document.querySelectorAll('#reconstructor-matches-tbody tr');
        return rows.length > 0;
    }, { timeout: 60000 });

    const rowsCount = await page.$$eval('#reconstructor-matches-tbody tr', els => els.length);
    const tableHtml = await page.$eval('#reconstructor-matches-tbody', el => el.innerHTML);
    const tableText = await page.$eval('#reconstructor-matches-tbody', el => el.innerText.trim());
    console.log(`5. Reconstructor matches table rendered ${rowsCount} row(s):\n${tableText}`);
    assert.ok(rowsCount > 0, 'Reconstructor matches table must render at least 1 row');

    // 5. Capture single targeted screenshot of the reconstructed matches as visual proof
    const screenshotPath = 'tests/proof-tiered-selection-ui.png';
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`6. Targeted visual proof captured at: ${screenshotPath}`);

    console.log('Errors:', errors.length ? errors : 'None');
    assert.strictEqual(errors.length, 0, 'Must have 0 console errors');

    await browser.close();
    console.log('\n=== REAL-CONDITION UI PROOF VERIFIED SUCCESSFULLY ===');
})().catch(err => {
    console.error('PROOF VERIFICATION FAILED:', err);
    process.exit(1);
});
