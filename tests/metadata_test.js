const assert = require('assert').strict;
const path = require('path');
const { MetadataService } = require('../src/services/metadata-service');
const { cleanSongFilename } = require('../src/musicbrainz/tag-reader');
const { RateLimiter } = require('../src/musicbrainz/rate-limiter');

console.log('======================================================================');
console.log(' VAULT MUSIC: METADATA & MUSICBRAINZ TEST SUITE                       ');
console.log('======================================================================\n');

async function testMetadata() {
    // 1. Tag cleaner
    console.log('[Test 1] Testing filename cleaner...');
    assert.equal(cleanSongFilename('01 - Breezeblocks.mp3'), 'Breezeblocks');
    assert.equal(cleanSongFilename('03. Paris [320kbps].flac'), 'Paris');
    console.log('✓ [PASS] Filename cleaner verified.\n');

    // 2. Rate limiter
    console.log('[Test 2] Testing rate limiter...');
    const limiter = new RateLimiter(50);
    const results = await Promise.all([
        limiter.schedule(async () => 1),
        limiter.schedule(async () => 2)
    ]);
    assert.deepEqual(results, [1, 2]);
    console.log('✓ [PASS] Rate limiter verified.\n');

    // 3. Metadata Service Status
    console.log('[Test 3] Testing metadata service status...');
    const metaService = new MetadataService();
    const status = metaService.getStatus();
    assert.equal(typeof status.localDbAvailable, 'boolean');
    assert.equal(status.isRunning, false);
    console.log('✓ [PASS] Metadata service status verified.\n');

    console.log('======================================================================');
    console.log(' ALL METADATA TESTS PASSED!                                           ');
    console.log('======================================================================');
}

testMetadata().catch(err => {
    console.error('Metadata test failed:', err);
    process.exit(1);
});
