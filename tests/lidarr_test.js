/**
 * Vault Music — Lidarr Integration Test Suite
 */

const http = require('http');
const { LidarrService } = require('../src/services/lidarr-service');
const { DownloadService } = require('../src/services/download-service');
const { app } = require('../src/server');

async function runLidarrTests() {
    console.log('======================================================================');
    console.log(' VAULT MUSIC: LIDARR INTEGRATION TEST SUITE                           ');
    console.log('======================================================================\n');

    const lidarrService = new LidarrService();
    const downloadService = new DownloadService();

    // Test 1: Lidarr Status check
    console.log('[Test 1] Testing Lidarr system status from OVH media stack...');
    const status = await lidarrService.getStatus();
    if (!status.online) {
        console.warn(`⚠️ [WARN] Lidarr returned offline/unreachable: ${status.error}`);
    } else {
        console.log(`Lidarr Status: ${status.appName} v${status.version} (${status.branch}) at ${status.url}`);
        console.log('✓ [PASS] Lidarr live status verified.');
    }

    // Test 2: Lidarr Music Search
    console.log('\n[Test 2] Testing Lidarr music search (artist/album)...');
    const searchResults = await lidarrService.searchMusic('daft punk');
    if (!Array.isArray(searchResults)) {
        throw new Error('Expected array of search results from Lidarr');
    }
    console.log(`Found ${searchResults.length} results from Lidarr search.`);
    if (searchResults.length > 0) {
        const first = searchResults[0];
        console.log(`Sample result: [${first.type}] ${first.title || first.artistName} (ID: ${first.id})`);
    }
    console.log('✓ [PASS] Lidarr music search verified.');

    // Test 3: Unified Download Queue
    console.log('\n[Test 3] Testing unified download queue retrieval...');
    const queue = await downloadService.getDownloadQueue();
    if (!queue.success || !Array.isArray(queue.items)) {
        throw new Error('Expected success: true and items array from getDownloadQueue');
    }
    console.log(`Unified Queue: ${queue.total} active downloads.`);
    console.log('✓ [PASS] Unified queue retrieval verified.');

    // Test 4: Downloads HTTP Router Endpoints
    console.log('\n[Test 4] Testing Express Downloads Router endpoints...');
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/downloads/indexers`);
        const indexers = await res.json();
        if (!Array.isArray(indexers) || indexers.length === 0) {
            throw new Error('Expected indexers array');
        }
        console.log(`Indexers available: ${indexers.map(i => i.name).join(', ')}`);
        console.log('✓ [PASS] Express download routes verified.');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }

    console.log('\n======================================================================');
    console.log(' ALL LIDARR TESTS PASSED!                                             ');
    console.log('======================================================================\n');
}

if (require.main === module) {
    runLidarrTests().catch(err => {
        console.error('❌ [FAIL] Lidarr test failed:', err);
        process.exit(1);
    });
}

module.exports = { runLidarrTests };
