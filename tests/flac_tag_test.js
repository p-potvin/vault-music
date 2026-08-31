/**
 * Vault Music — FLAC & Vorbis Tag Extraction Test Suite
 */

const fs = require('fs');
const path = require('path');
const { extractAudioFileMetadata, readFLAC } = require('../src/musicbrainz/tag-reader');

async function runFlacTagTests() {
    console.log('======================================================================');
    console.log(' VAULT MUSIC: FLAC VORBIS TAG EXTRACTION TEST SUITE                   ');
    console.log('======================================================================\n');

    const sampleFlac = 'G:\\Music\\01. One More Time.flac';

    console.log('[Test 1] Testing native FLAC tag extraction on live library file...');
    if (!fs.existsSync(sampleFlac)) {
        console.log(`Sample file ${sampleFlac} not found; skipping live file assertion.`);
        return;
    }

    const meta = extractAudioFileMetadata(sampleFlac);
    console.log('Extracted metadata:', meta);

    if (meta.effectiveTitle !== 'One More Time') {
        throw new Error(`Expected title 'One More Time', got '${meta.effectiveTitle}'`);
    }
    if (!meta.effectiveArtist.includes('Daft Punk')) {
        throw new Error(`Expected artist containing 'Daft Punk', got '${meta.effectiveArtist}'`);
    }
    if (meta.effectiveAlbum !== 'Discovery') {
        throw new Error(`Expected album 'Discovery', got '${meta.effectiveAlbum}'`);
    }
    if (meta.embeddedTrack !== '1') {
        throw new Error(`Expected track number '1', got '${meta.embeddedTrack}'`);
    }
    if (meta.embeddedYear !== '2014') {
        throw new Error(`Expected year '2014', got '${meta.embeddedYear}'`);
    }

    console.log('✓ [PASS] Native FLAC Vorbis comment extraction verified.');

    console.log('\n======================================================================');
    console.log(' ALL FLAC TAG TESTS PASSED!                                           ');
    console.log('======================================================================\n');
}

if (require.main === module) {
    runFlacTagTests().catch(err => {
        console.error('❌ [FAIL] FLAC tag test failed:', err);
        process.exit(1);
    });
}

module.exports = { runFlacTagTests };
