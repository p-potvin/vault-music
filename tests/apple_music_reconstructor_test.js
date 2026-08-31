/**
 * Vault Music — Offline Apple Music Reconstructor & Jackett/qBittorrent Test Suite
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { AppleMusicLocalService } = require('../src/services/apple-music-local-service');
const { LocalDownloadReconstructor } = require('../src/services/local-download-reconstructor');
const { PostDownloadProcessor } = require('../src/services/post-download-processor');

async function runTests() {
    console.log('======================================================================');
    console.log(' VAULT MUSIC: APPLE MUSIC RECONSTRUCTOR & JACKETT TEST SUITE          ');
    console.log('======================================================================\n');

    const appleService = new AppleMusicLocalService({
        sourceDir: config.APPLE_MUSIC_SOURCE_DIR,
        backupDir: config.APPLE_MUSIC_BACKUP_DIR
    });

    const reconstructor = new LocalDownloadReconstructor({
        jackettUrl: config.JACKETT_URL,
        jackettApiKey: config.JACKETT_API_KEY,
        qbitUrl: config.QBITTORRENT_URL,
        maxLibrarySizeGb: 35.0
    });

    // Test 1: Safe Snapshot Cloner
    console.log('[Test 1] Testing Safe Cloner (C:\\Users\\... -> G:\\Music\\AppleMusic_Backup)...');
    const snapshotRes = await appleService.createSafeSnapshot();
    assert.strictEqual(snapshotRes.success, true, 'Snapshot should succeed');
    assert.ok(fs.existsSync(config.APPLE_MUSIC_BACKUP_DIR), 'Backup directory must exist');
    assert.ok(fs.existsSync(path.join(config.APPLE_MUSIC_BACKUP_DIR, 'snapshot_manifest.json')), 'Manifest must be generated');
    console.log(`✓ [PASS] Safe snapshot verified: ${snapshotRes.manifest.fileCount} files (${snapshotRes.manifest.formattedSize}) copied into backup.\n`);

    // Test 2: Playlist Scanner from Local Snapshot
    console.log('[Test 2] Testing Playlist Discovery from Snapshot...');
    const playlistsRes = await appleService.scanSnapshotPlaylists();
    assert.strictEqual(playlistsRes.success, true);
    assert.ok(Array.isArray(playlistsRes.playlists) && playlistsRes.playlists.length > 0, 'Should find at least 1 playlist');
    const samplePl = playlistsRes.playlists[0];
    console.log(`Found playlist: "${samplePl.name}" (${samplePl.trackCount} tracks)`);
    assert.ok(samplePl.tracks.length > 0, 'Playlist must contain tracks');
    console.log(`✓ [PASS] Snapshot playlist extraction verified.\n`);

    // Test 3: Storage Usage & 35 GB Hard Cap Guardrail
    console.log('[Test 3] Testing 35 GB Storage Guardrail Calculation...');
    const storage = reconstructor.getLibraryStorageUsage();
    console.log(`Storage Status: ${storage.usedGb} GB used / ${storage.maxGb} GB max (${storage.remainingGb} GB remaining, ${storage.percentUsed}% full)`);
    assert.strictEqual(storage.maxGb, 35.0, 'Max storage limit should be 35 GB');
    assert.strictEqual(typeof storage.usedGb, 'number');
    assert.strictEqual(typeof storage.isCapReached, 'boolean');
    console.log(`✓ [PASS] Storage guardrail evaluation verified.\n`);

    // Test 4: Quality Classifier (Low Quality 128k vs Lossless Gating)
    console.log('[Test 4] Testing Quality Priority & Lossless Confirmation Gate...');
    const q128 = reconstructor._classifyQuality('Daft Punk - Discovery [MP3 128kbps]');
    const q320 = reconstructor._classifyQuality('Daft Punk - Discovery [MP3 320kbps]');
    const qFlac = reconstructor._classifyQuality('Daft Punk - Discovery [FLAC 24bit Lossless]');

    assert.strictEqual(q128.category, 'low-lossy', 'MP3 128k should be low-lossy');
    assert.strictEqual(q128.needsConfirmation, false, '128k should not require confirmation');
    assert.ok(q128.score > q320.score, '128k must score higher than 320k according to user low-quality preference');

    assert.strictEqual(qFlac.category, 'lossless', 'FLAC must be classified as lossless');
    assert.strictEqual(qFlac.needsConfirmation, true, 'Lossless MUST require confirmation');
    assert.ok(qFlac.score < q128.score, 'Lossless must have lower priority than lossy');
    console.log(`✓ [PASS] Quality scoring verified: 128k (${q128.score}) > 320k (${q320.score}) > FLAC (${qFlac.score}, needsConfirmation=true)\n`);

    // Test 5: Guardrail Block on Simulated Overflow
    console.log('[Test 5] Testing Download Rejection on 35 GB Cap Overflow...');
    const fakeGiganticRelease = {
        title: 'Huge Discography',
        sizeBytes: 40 * 1024 * 1024 * 1024, // 40 GB
        magnetUrl: 'magnet:?xt=urn:btih:fake'
    };
    const blockRes = await reconstructor.queueDownload(fakeGiganticRelease, true);
    assert.strictEqual(blockRes.success, false, 'Should block release');
    assert.strictEqual(blockRes.guardrailBlocked, true, 'Must flag guardrailBlocked');
    console.log(`✓ [PASS] 35 GB hard guardrail correctly rejected oversized download (${blockRes.error}).\n`);

    // Test 6: Lossless Confirmation Gate Check
    console.log('[Test 6] Testing Lossless Confirmation Requirement...');
    const losslessRelease = {
        title: 'Album FLAC',
        isLossless: true,
        quality: 'FLAC 24bit',
        sizeBytes: 300 * 1024 * 1024,
        magnetUrl: 'magnet:?xt=urn:btih:fake'
    };
    const unconfirmedRes = await reconstructor.queueDownload(losslessRelease, false);
    assert.strictEqual(unconfirmedRes.success, false);
    assert.strictEqual(unconfirmedRes.confirmationRequired, true);
    console.log(`✓ [PASS] Unconfirmed lossless release was correctly rejected.\n`);

    // Test 7: Express API Endpoints
    console.log('[Test 7] Testing Express Storage & Reconstructor API Endpoints...');
    const { app } = require('../src/server');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const testPort = server.address().port;

    const getJson = (endpoint) => new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${testPort}${endpoint}`, (res) => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
        }).on('error', reject);
    });

    const storageApi = await getJson('/api/v1/downloads/storage-status');
    assert.strictEqual(storageApi.status, 200);
    assert.strictEqual(storageApi.data.maxGb, 35.0);
    console.log(`✓ [PASS] /api/v1/downloads/storage-status verified.\n`);

    await new Promise(r => server.close(r));

    console.log('======================================================================');
    console.log(' ALL APPLE MUSIC RECONSTRUCTOR & JACKETT TESTS PASSED!                ');
    console.log('======================================================================');
}

if (require.main === module) {
    runTests().catch(err => {
        console.error('Test Suite Failed:', err);
        process.exit(1);
    });
}

module.exports = { runTests };
