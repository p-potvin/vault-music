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
    console.log('=== REAL-CONDITION UI PROOF: RECONSTRUCTOR MODE A & MODE B WORKFLOWS ===');

    const browser = await chromium.launch({
        executablePath: findChromium(),
        args: ['--no-sandbox']
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));

    // 1. Navigate to downloads page
    await page.goto('http://localhost:8733#downloads', { waitUntil: 'networkidle' });
    console.log('1. Page loaded successfully:', await page.title());

    // 2. Playlists auto-discovered from snapshot
    await page.waitForFunction(() => document.querySelectorAll('#select-apple-playlist option').length > 1, { timeout: 30000 });
    const options = await page.$$eval('#select-apple-playlist option', els => els.map(e => ({ v: e.value, t: e.textContent })));
    console.log(`2. Playlists available: ${options.length - 1}`);

    // 3. Select The Stooges playlist
    const target = options.find(o => /The Stooges/i.test(o.t)) || options[1];
    await page.selectOption('#select-apple-playlist', target.v);
    await page.dispatchEvent('#select-apple-playlist', 'change');
    console.log('3. Selected playlist:', target.t.trim());

    // 4. Test Mode B (Missing Album Gap Filler) - Recommended workflow for The Stooges!
    console.log('4. Clicking Mode B: Step 1: Find Missing Albums...');
    await page.click('#btn-find-missing');

    await page.waitForSelector('#suggestions-panel', { state: 'visible', timeout: 30000 });
    const suggestionsCount = await page.$$eval('.suggestion-card', els => els.length);
    console.log(`5. Mode B detected ${suggestionsCount} missing album card(s)`);
    assert.ok(suggestionsCount > 0, 'Must detect at least 1 missing album card');

    // Verify Step 3 Queue button is initially disabled until Step 2 is run
    const queueBtnDisabled = await page.$eval('#btn-queue-suggestions', el => el.disabled);
    console.log('6. Step 3 Queue button initial state (disabled before search):', queueBtnDisabled);
    assert.strictEqual(queueBtnDisabled, true, 'Queue button must be disabled before Step 2 releases are found');

    // 5. Run Step 2: Search Jackett for Albums
    console.log('7. Clicking Step 2: Search Jackett for Albums...');
    await page.click('#btn-find-releases');

    // Wait for the release slot to populate with matched release info
    await page.waitForFunction(() => {
        const slot = document.querySelector('.suggestion-release');
        return slot && slot.innerText.trim().length > 0;
    }, { timeout: 60000 });

    const releaseSlotText = await page.$eval('.suggestion-release', el => el.innerText.trim());
    console.log('8. Step 2 Jackett Album Search Result:\n', releaseSlotText);

    // Verify Step 3 Queue button is now updated with album count and enabled!
    await page.waitForFunction(() => {
        const btn = document.querySelector('#btn-queue-suggestions');
        return btn && !btn.disabled;
    }, { timeout: 15000 });

    const queueBtnText = await page.$eval('#btn-queue-suggestions', el => el.innerText.trim());
    console.log('9. Step 3 Queue button state after search:', queueBtnText);
    assert.ok(queueBtnText.includes('Queue') && queueBtnText.includes('Matched Album'), 'Queue button must update with matched album count');

    // 6. Test Mode A (Track-by-track matcher) to verify the informative guidance tip
    console.log('10. Clicking Mode A: Match Playlist Tracks...');
    await page.click('#btn-match-playlist');

    await page.waitForSelector('#reconstructor-results-container', { state: 'visible', timeout: 60000 });
    const trackGuidanceText = await page.$eval('#reconstructor-matches-tbody', el => el.innerText.trim());
    console.log('11. Mode A single track results & guidance tip:\n', trackGuidanceText);
    assert.ok(trackGuidanceText.includes('Mode B: Missing Album Filler'), 'Must provide guidance to use Mode B when single track torrent is absent');

    // 7. Capture visual proof screenshot
    const screenshotPath = 'tests/proof-reconstructor-modes.png';
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`12. Targeted visual proof screenshot captured at: ${screenshotPath}`);

    console.log('Errors:', errors.length ? errors : 'None');
    assert.strictEqual(errors.length, 0, 'Must have 0 console errors');

    await browser.close();
    console.log('\n=== RECONSTRUCTOR MODES VERIFICATION PASSED PERFECTLY ===');
})().catch(err => {
    console.error('VERIFICATION FAILED:', err);
    process.exit(1);
});
