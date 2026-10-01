const http = require('http');
const assert = require('assert');

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: 'localhost',
            port: 8733,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (_) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

(async () => {
    console.log('--- TESTING LIVE API ENDPOINTS & LOSSLESS GATING ---');

    // 1. Tag resolution
    console.log('1. Checking music-indexers...');
    const indexersRes = await request('GET', '/api/v1/downloads/apple-music-local/music-indexers');
    assert.strictEqual(indexersRes.status, 200);
    assert.strictEqual(indexersRes.body.tag, 'music');
    assert.ok(Array.isArray(indexersRes.body.indexers));
    console.log(`   ✓ Resolves to ${indexersRes.body.indexers.length} indexers`);

    // 2. Cancel validation: invalid hash rejects with 400
    console.log('2. Checking /cancel rejection on invalid hash selector ("all")...');
    const cancelInvalid = await request('POST', '/api/v1/downloads/cancel', { hash: 'all', deleteFiles: true });
    assert.strictEqual(cancelInvalid.status, 400, 'Must reject wildcard "all" hash');
    assert.ok(cancelInvalid.body.error.includes('Invalid torrent hash format'));
    console.log('   ✓ Wildcard bulk cancellation rejected with 400 Bad Request');

    // 3. Cancel validation: valid format passes router check
    console.log('3. Checking /cancel with valid 40-character hex hash...');
    const validHexHash = '0123456789abcdef0123456789abcdef01234567';
    const cancelValid = await request('POST', '/api/v1/downloads/cancel', { hash: validHexHash, deleteFiles: false });
    assert.strictEqual(cancelValid.status, 200, 'Router should accept valid hash format');
    console.log('   ✓ Valid hash format accepted by router and handled by reconstructor');

    // 4. match-albums input sanitization
    console.log('4. Checking match-albums input sanitization and length bounds...');
    const matchEmpty = await request('POST', '/api/v1/downloads/apple-music-local/match-albums', { albums: [] });
    assert.strictEqual(matchEmpty.status, 400);

    const matchInvalidItems = await request('POST', '/api/v1/downloads/apple-music-local/match-albums', {
        albums: [null, {}, { artist: '', album: '' }]
    });
    assert.strictEqual(matchInvalidItems.status, 400);
    console.log('   ✓ Empty and corrupt album payloads correctly rejected with 400');

    // 5. match-albums with real album: ensures no lossless release is returned
    console.log('5. Checking match-albums on real album (NOFX)...');
    const matchReal = await request('POST', '/api/v1/downloads/apple-music-local/match-albums', {
        albums: [{ artist: 'NOFX', album: 'Wolves In Wolves Clothing' }],
        maxAlbums: 1
    });
    assert.strictEqual(matchReal.status, 200);
    assert.strictEqual(matchReal.body.success, true);
    assert.ok(Array.isArray(matchReal.body.results));
    if (matchReal.body.results.length > 0 && matchReal.body.results[0].bestRelease) {
        assert.strictEqual(matchReal.body.results[0].bestRelease.isLossless, false, 'Matched release MUST NOT be lossless');
        console.log(`   ✓ Matched release: "${matchReal.body.results[0].bestRelease.title}" (lossless=${matchReal.body.results[0].bestRelease.isLossless})`);
    } else {
        console.log('   ✓ Query completed cleanly');
    }

    // 6. queue-download: rejecting lossless downloads
    console.log('6. Checking queue-download lossless gating...');
    const fakeLossless = {
        title: 'Test Album FLAC 24bit',
        quality: 'FLAC 24bit',
        isLossless: true,
        magnetUrl: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
    };
    const queueRes = await request('POST', '/api/v1/downloads/apple-music-local/queue-download', {
        releases: [fakeLossless],
        allowLossless: false
    });
    assert.strictEqual(queueRes.status, 200);
    assert.strictEqual(queueRes.body.results[0].success, false);
    assert.strictEqual(queueRes.body.results[0].confirmationRequired, true);
    assert.strictEqual(queueRes.body.blockedCount, 1);
    console.log('   ✓ Lossless release blocked from download queue');

    console.log('\nALL LIVE API & LOSSLESS GATING CHECKS PASSED SUCCESSFULLY!');
})().catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
});
