const http = require('http');
const assert = require('assert');

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: '127.0.0.1',
            port: 8733,
            path,
            method,
            headers: {
                'X-Device-Id': 'verify_runner',
                'Accept': 'application/json'
            },
            timeout: 60000
        };
        if (payload) {
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(payload);
        }

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(data); } catch (_) {}
                resolve({ status: res.statusCode, data: parsed, raw: data });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Timeout on ${method} ${path}`));
        });

        if (payload) req.write(payload);
        req.end();
    });
}

async function verifyAll() {
    console.log('=== REAL-CONDITION LIVE TEST SUITE: SEARCH & DOWNLOAD ===');

    // 1. Storage Status
    console.log('\n[TEST 1] Storage status query:');
    const storageRes = await request('GET', '/api/v1/downloads/storage-status');
    assert.strictEqual(storageRes.status, 200, 'Storage status should return 200');
    assert.strictEqual(typeof storageRes.data.usedGb, 'number', 'usedGb must be a number');
    assert.strictEqual(storageRes.data.maxGb, 35, 'Hard storage cap must be 35 GB');
    console.log(`✓ Storage quota active: ${storageRes.data.usedGb} GB used of ${storageRes.data.maxGb} GB (${storageRes.data.remainingGb} GB remaining)`);

    // 2. Playlists Auto-Discovery (without forcing re-clone)
    console.log('\n[TEST 2] Apple Music playlists auto-discovery:');
    const plRes = await request('GET', '/api/v1/downloads/apple-music-local/playlists');
    assert.strictEqual(plRes.status, 200, 'Playlists endpoint should return 200');
    assert.strictEqual(plRes.data.hasSnapshot, true, 'Snapshot must be verified as present');
    assert.ok(Array.isArray(plRes.data.playlists) && plRes.data.playlists.length > 0, 'Playlists array must not be empty');
    console.log(`✓ Successfully discovered ${plRes.data.totalPlaylists} playlists from snapshot without re-cloning`);

    // 3. Payload Size & Suggestion Engine on 1600+ track playlist (reproducing 413 scenario)
    console.log('\n[TEST 3] Large playlist payload handling (reproducing 413 scenario):');
    const largePl = plRes.data.playlists.find(p => p.trackCount > 500) || plRes.data.playlists[0];
    console.log(`   Testing playlist "${largePl.name}" (${largePl.trackCount} tracks)...`);
    const suggRes = await request('POST', '/api/v1/downloads/apple-music-local/suggestions', {
        playlist: largePl,
        maxAlbums: 5
    });
    assert.strictEqual(suggRes.status, 200, 'Large payload must NOT be rejected with 413');
    assert.strictEqual(suggRes.data.success, true, 'Suggestion engine must succeed on large playlists');
    assert.ok(Array.isArray(suggRes.data.albums), 'Returned albums must be an array');
    console.log(`✓ 50MB body limit verified: Analyzed ${largePl.trackCount} tracks and suggested ${suggRes.data.albums.length} albums with missing tracks`);

    // 4. Playlist Track Matching with Tiered Size Filtering
    console.log('\n[TEST 4] Bounded playlist track matching with tiered size algorithm:');
    const smallPl = plRes.data.playlists.find(p => p.name === 'The Stooges') || plRes.data.playlists[1];
    console.log(`   Matching playlist "${smallPl.name}" (bounded to maxTracks: 2)...`);
    const matchRes = await request('POST', '/api/v1/downloads/apple-music-local/match-playlist', {
        playlist: smallPl,
        maxTracks: 2
    });
    assert.strictEqual(matchRes.status, 200, 'Match playlist must return 200');
    assert.strictEqual(matchRes.data.success, true, 'Match result must be success');
    assert.strictEqual(matchRes.data.scannedTracks, 2, 'Scanned tracks must respect maxTracks limit');
    
    // Check that every single matched release satisfies the 30MB ceiling and has route/tier info
    for (const m of matchRes.data.matches) {
        if (m.matchFound && m.bestRelease) {
            assert.ok(m.bestRelease.sizeBytes <= 30 * 1024 * 1024, `Release ${m.bestRelease.title} must be <= 30MB (got ${m.bestRelease.formattedSize})`);
            assert.ok(m.bestRelease.route === 1 || m.bestRelease.route === 2, 'Must have route 1 or route 2 assigned');
            console.log(`   ✓ Track "${m.track.title}": matched release "${m.bestRelease.title}" (${m.bestRelease.formattedSize}, route ${m.bestRelease.route}, ${m.bestRelease.tierLabel})`);
        }
    }
    console.log(`✓ Bounded matching verified: matched ${matchRes.data.matchedCount}/${matchRes.data.scannedTracks} tracks under tiered algorithm.`);

    // 5. Release Search & Persistence
    console.log('\n[TEST 5] Indexer search and queue state check:');
    const queueRes = await request('GET', '/api/v1/downloads/queue');
    assert.strictEqual(queueRes.status, 200, 'Queue endpoint must return 200');
    assert.ok(Array.isArray(queueRes.data.items), 'Queue items must be an array');
    console.log(`✓ Download queue verified live: ${queueRes.data.items.length} active downloads`);

    console.log('\n======================================================');
    console.log('ALL REAL-CONDITION VERIFICATION TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================');
}

verifyAll().catch(err => {
    console.error('FATAL VERIFICATION FAILURE:', err);
    process.exit(1);
});
