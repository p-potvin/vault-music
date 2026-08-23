const assert = require('assert').strict;
const http = require('http');
const path = require('path');
const fs = require('fs');
const { app, libraryService } = require('../src/server');

console.log('======================================================================');
console.log(' VAULT MUSIC: PWA & DIRECT DOWNLOAD TEST SUITE                        ');
console.log('======================================================================\n');

async function testPwaAndDownload() {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // 1. Test /manifest.json
        console.log('[Test 1] Testing PWA manifest.json...');
        const manifestRes = await new Promise((resolve) => {
            http.get(`${baseUrl}/manifest.json`, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
            });
        });

        assert.equal(manifestRes.status, 200);
        assert.equal(manifestRes.data.short_name, 'VaultMusic');
        assert.equal(manifestRes.data.display, 'standalone');
        console.log('✓ [PASS] PWA manifest validated.\n');

        // 2. Test /sw.js
        console.log('[Test 2] Testing Service Worker script at /sw.js...');
        const swRes = await new Promise((resolve) => {
            http.get(`${baseUrl}/sw.js`, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve({ status: res.statusCode, code: data }));
            });
        });

        assert.equal(swRes.status, 200);
        assert.ok(swRes.code.includes('CACHE_NAME'), 'SW must contain cache logic');
        console.log('✓ [PASS] Service Worker script verified.\n');

        // 3. Test Direct Download Endpoint (/api/v1/download/:trackId)
        console.log('[Test 3] Testing direct iOS file download endpoint...');
        // Create mock file
        const testDir = path.join(__dirname, 'temp_pwa_music', 'ArtistZ', 'AlbumZ');
        fs.mkdirSync(testDir, { recursive: true });
        const mockAudioPath = path.join(testDir, '01 - TestTrack.mp3');
        fs.writeFileSync(mockAudioPath, Buffer.alloc(5000, 0xBB));

        libraryService.musicDir = path.join(__dirname, 'temp_pwa_music');
        libraryService.scanLibrary();
        const tracks = libraryService.listTracks().tracks;
        assert.ok(tracks.length > 0);
        const testTrack = tracks[0];

        const dlRes = await new Promise((resolve) => {
            http.get(`${baseUrl}/api/v1/download/${testTrack.id}`, (res) => {
                let chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    size: Buffer.concat(chunks).length
                }));
            });
        });

        console.log('Download result:', dlRes.status, dlRes.headers['content-disposition'], `${dlRes.size} bytes`);
        assert.equal(dlRes.status, 200);
        assert.ok(dlRes.headers['content-disposition'].includes('attachment; filename="'), 'Must have attachment header for iOS Files');
        assert.equal(dlRes.size, 5000);
        console.log('✓ [PASS] Direct download endpoint for iOS Files verified.\n');

        // Clean up
        try { fs.rmSync(path.join(__dirname, 'temp_pwa_music'), { recursive: true, force: true }); } catch (_) {}

        console.log('======================================================================');
        console.log(' ALL PWA & DOWNLOAD TESTS PASSED!                                     ');
        console.log('======================================================================');
    } finally {
        server.close();
    }
}

testPwaAndDownload().catch(err => {
    console.error('PWA test failed:', err);
    process.exit(1);
});
