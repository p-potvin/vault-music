const assert = require('assert').strict;
const http = require('http');
const path = require('path');
const fs = require('fs');
const { app, libraryService } = require('../src/server');

console.log('======================================================================');
console.log(' VAULT MUSIC: AUDIO STREAMING & RANGE REQUEST TEST SUITE              ');
console.log('======================================================================\n');

async function testStreaming() {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // Create a temporary mock audio file
        const testDir = path.join(__dirname, 'temp_music', 'ArtistX', 'AlbumY');
        fs.mkdirSync(testDir, { recursive: true });
        const mockAudioPath = path.join(testDir, '01 - Test Song.mp3');
        const mockData = Buffer.alloc(10000, 0xAA); // 10KB mock audio
        fs.writeFileSync(mockAudioPath, mockData);

        // Scan mock library
        libraryService.musicDir = path.join(__dirname, 'temp_music');
        libraryService.scanLibrary();

        const tracks = libraryService.listTracks().tracks;
        assert.ok(tracks.length > 0, 'Library must index test track');
        const testTrack = tracks[0];

        // 1. Test Full Stream (HTTP 200)
        console.log('[Test 1] Testing full audio stream (HTTP 200)...');
        const fullRes = await new Promise((resolve) => {
            http.get(`${baseUrl}/api/v1/stream/${testTrack.id}`, (res) => {
                let chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, size: Buffer.concat(chunks).length }));
            });
        });

        console.log('Full stream result:', fullRes.status, fullRes.headers['content-type'], `${fullRes.size} bytes`);
        assert.equal(fullRes.status, 200);
        assert.equal(fullRes.headers['accept-ranges'], 'bytes');
        assert.equal(fullRes.headers['content-type'], 'audio/mpeg');
        assert.equal(fullRes.size, 10000);
        console.log('✓ [PASS] Full stream verified.\n');

        // 2. Test Range Request (HTTP 206 Partial Content)
        console.log('[Test 2] Testing HTTP Range request (bytes=0-999) for seek playback...');
        const rangeRes = await new Promise((resolve) => {
            const req = http.get(`${baseUrl}/api/v1/stream/${testTrack.id}`, {
                headers: { 'Range': 'bytes=0-999' }
            }, (res) => {
                let chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    size: Buffer.concat(chunks).length
                }));
            });
        });

        console.log('Range stream result:', rangeRes.status, rangeRes.headers['content-range'], `${rangeRes.size} bytes`);
        assert.equal(rangeRes.status, 206);
        assert.equal(rangeRes.headers['content-range'], 'bytes 0-999/10000');
        assert.equal(rangeRes.headers['content-length'], '1000');
        assert.equal(rangeRes.size, 1000);
        console.log('✓ [PASS] HTTP 206 Partial Content seeking verified.\n');

        // Clean up mock audio
        try { fs.rmSync(path.join(__dirname, 'temp_music'), { recursive: true, force: true }); } catch (_) {}

        console.log('======================================================================');
        console.log(' ALL STREAMING TESTS PASSED!                                          ');
        console.log('======================================================================');
    } finally {
        server.close();
    }
}

testStreaming().catch(err => {
    console.error('Streaming test failed:', err);
    process.exit(1);
});
