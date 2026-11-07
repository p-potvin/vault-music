const http = require('http');
const config = require('../src/config');
const { LocalDownloadReconstructor } = require('../src/services/local-download-reconstructor');

async function test() {
    console.log('--- JACKETT CONFIGURATION CHECK ---');
    console.log('Jackett URL:', config.JACKETT_URL);
    console.log('Jackett API Key:', config.JACKETT_API_KEY ? config.JACKETT_API_KEY.slice(0, 6) + '...' : 'NONE');

    const reconstructor = new LocalDownloadReconstructor();
    const tagged = reconstructor.resolveTaggedIndexers('music');
    console.log('Tagged indexers (music):', tagged);

    // Let's test individual indexers first
    for (const id of tagged) {
        console.log(`\nQuerying indexer: ${id}...`);
        const start = Date.now();
        const results = await reconstructor._searchIndexer(id, 'The Stooges', { timeout: 10000 });
        console.log(`Indexer [${id}] returned ${results.length} results in ${Date.now() - start}ms`);
        results.slice(0, 3).forEach(r => {
            console.log(`  - [${r.tracker}] ${r.title} | ${r.formattedSize} | Seeders: ${r.seeders} | isLossless: ${r.isLossless}`);
        });
    }

    // Now test a track query
    console.log('\n--- TESTING TRACK QUERY ---');
    const trackQuery = 'The Stooges Down On The Street';
    console.log(`Querying: "${trackQuery}"...`);
    const trackReleases = await reconstructor.searchJackett(trackQuery, { tag: 'music', timeout: 10000 });
    console.log(`Total releases found: ${trackReleases.length}`);
    trackReleases.slice(0, 5).forEach(r => {
        console.log(`  - [${r.tracker}] ${r.title} | ${r.formattedSize} | Seeders: ${r.seeders}`);
    });

    // Now test album query
    console.log('\n--- TESTING ALBUM QUERY ---');
    const albumQuery = 'The Stooges Fun House';
    console.log(`Querying: "${albumQuery}"...`);
    const albumReleases = await reconstructor.searchJackett(albumQuery, { tag: 'music', timeout: 10000 });
    console.log(`Total releases found: ${albumReleases.length}`);
    albumReleases.slice(0, 5).forEach(r => {
        console.log(`  - [${r.tracker}] ${r.title} | ${r.formattedSize} | Seeders: ${r.seeders}`);
    });
}

test().catch(console.error);
