const fs = require('fs');
const path = require('path');
const { LocalDownloadReconstructor } = require('../src/services/local-download-reconstructor');

async function scan() {
    console.log('Testing active Jackett indexers for music search responsiveness...');
    const reconstructor = new LocalDownloadReconstructor();
    const dir = 'C:\\ProgramData\\Jackett\\Indexers';
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.bak'));

    const working = [];

    for (const file of files) {
        const id = file.replace('.json', '');
        // Skip obvious porn / adult / anime-only indexers
        if (id.includes('porn') || id.includes('xxx') || id.includes('sextorrent') || id.includes('sosulki') || id.includes('nyaasi') || id.includes('subsplease') || id.includes('acgrip') || id.includes('bangumi')) {
            continue;
        }

        try {
            const start = Date.now();
            const res = await reconstructor._searchIndexer(id, 'Daft Punk', { timeout: 4000 });
            const elapsed = Date.now() - start;
            if (res.length > 0) {
                console.log(`✓ [WORKING] ${id}: ${res.length} results (${elapsed}ms)`);
                working.push({ id, count: res.length, elapsed });
            } else {
                console.log(`- [EMPTY/SLOW] ${id} (${elapsed}ms)`);
            }
        } catch (err) {
            console.log(`x [FAILED] ${id}: ${err.message}`);
        }
    }

    console.log('\n--- SUMMARY OF WORKING INDEXERS ---');
    working.forEach(w => console.log(`  * ${w.id}: ${w.count} results, ${w.elapsed}ms`));
}

scan().catch(console.error);
