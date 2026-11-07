const assert = require('assert');
const { LocalDownloadReconstructor } = require('../src/services/local-download-reconstructor');

async function testAlgorithm() {
    console.log('======================================================================');
    console.log(' VAULT MUSIC: TIERED RELEASE SELECTION & TOKEN MATCHING TEST SUITE    ');
    console.log('======================================================================\n');

    const reconstructor = new LocalDownloadReconstructor();

    // -------------------------------------------------------------------------
    // TEST 1: Lexical Token Matching (_isExactReleaseMatch)
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Testing lexical token matching (_isExactReleaseMatch)...');

    // 1a. Song exact match with scene info
    assert.strictEqual(
        reconstructor._isExactReleaseMatch('The Stooges - I Wanna Be Your Dog [Single] [MP3-192]', 'The Stooges', 'I Wanna Be Your Dog'),
        true,
        'Should match track with artist and scene brackets'
    );

    // 1b. Song match with different track title
    assert.strictEqual(
        reconstructor._isExactReleaseMatch('The Stooges - No Fun [MP3 320kbps]', 'The Stooges', 'I Wanna Be Your Dog'),
        false,
        'Should NOT match different track from same artist'
    );

    // 1c. Album match with scene tags and year
    assert.strictEqual(
        reconstructor._isExactReleaseMatch('NOFX - Punk In Drublic (1994) [FLAC] [CD]', 'NOFX', 'Punk In Drublic'),
        true,
        'Should match album with year and FLAC tag'
    );

    // 1d. Partial overlap must NOT match
    assert.strictEqual(
        reconstructor._isExactReleaseMatch('Nofx - A to H (2025 Punk-New wave) [Flac 24-48]', 'NOFX', 'Punk In Drublic'),
        false,
        'Partial token overlap must not be accepted'
    );

    // 1e. Artist mismatch
    assert.strictEqual(
        reconstructor._isExactReleaseMatch('Green Day - Dookie [MP3 320]', 'NOFX', 'Dookie'),
        false,
        'Mismatched artist should not pass'
    );

    // 1f. Short artist tokens (e.g. U2, AC/DC)
    assert.strictEqual(
        reconstructor._isExactReleaseMatch('AC/DC - Back In Black (1980) MP3', 'AC/DC', 'Back In Black'),
        true,
        'Should match short artist tokens like AC/DC'
    );

    console.log('✓ [PASS] Lexical token matching verified across singles, albums, scene tags, and edge cases.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Route #1 (Plenty of Results: > 2 exact matches)
    // -------------------------------------------------------------------------
    console.log('[TEST 2] Testing Route #1 (> 2 exact matches) tiered sizing...');

    // Scenario 2A: Tier 1 candidate available (<= 5MB/track)
    // Even if Tier 2 or Tier 3 has higher seeders, Tier 1 is preferred!
    const mockReleasesRoute1 = [
        {
            title: 'Artist - Song [FLAC Lossless]',
            size: 25 * 1024 * 1024, // 25MB (Tier 3)
            seeders: 100,
            magnetUrl: 'magnet:?xt=urn:btih:tier3'
        },
        {
            title: 'Artist - Song [MP3 320kbps]',
            size: 8 * 1024 * 1024, // 8MB (Tier 2)
            seeders: 50,
            magnetUrl: 'magnet:?xt=urn:btih:tier2'
        },
        {
            title: 'Artist - Song [MP3 128kbps]',
            size: 4 * 1024 * 1024, // 4MB (Tier 1)
            seeders: 10,
            magnetUrl: 'magnet:?xt=urn:btih:tier1_a'
        },
        {
            title: 'Artist - Song [MP3 160kbps]',
            size: 4.5 * 1024 * 1024, // 4.5MB (Tier 1)
            seeders: 15,
            magnetUrl: 'magnet:?xt=urn:btih:tier1_b'
        }
    ];

    const sel1 = reconstructor._selectBestRelease(mockReleasesRoute1, {
        artist: 'Artist',
        targetTitle: 'Song',
        trackCount: 1
    });

    assert.strictEqual(sel1.route, 1, 'Must take Route 1 (> 2 matches)');
    assert.strictEqual(sel1.tier, 1, 'Must pick Tier 1');
    assert.strictEqual(sel1.bestRelease.seeders, 15, 'Must pick highest seeders within Tier 1 (15 vs 10)');
    assert.strictEqual(sel1.bestRelease.magnetUrl, 'magnet:?xt=urn:btih:tier1_b');
    console.log(`✓ [PASS] Route 1 Tier 1 selected: ${sel1.tierLabel} with ${sel1.bestRelease.seeders} seeders (favored over larger tiers with higher seeders).`);

    // Scenario 2B: No Tier 1, relaxes to Tier 2 (<= 10MB/track)
    const mockReleasesTier2 = [
        {
            title: 'Artist - Song [FLAC]',
            size: 20 * 1024 * 1024, // 20MB (Tier 3)
            seeders: 80,
            magnetUrl: 'magnet:?xt=urn:btih:tier3'
        },
        {
            title: 'Artist - Song [MP3 320]',
            size: 9 * 1024 * 1024, // 9MB (Tier 2)
            seeders: 25,
            magnetUrl: 'magnet:?xt=urn:btih:tier2_a'
        },
        {
            title: 'Artist - Song [VBR V0]',
            size: 7 * 1024 * 1024, // 7MB (Tier 2)
            seeders: 40,
            magnetUrl: 'magnet:?xt=urn:btih:tier2_b'
        }
    ];

    const sel2 = reconstructor._selectBestRelease(mockReleasesTier2, {
        artist: 'Artist',
        targetTitle: 'Song',
        trackCount: 1
    });

    assert.strictEqual(sel2.route, 1);
    assert.strictEqual(sel2.tier, 2, 'Must relax to Tier 2');
    assert.strictEqual(sel2.bestRelease.seeders, 40, 'Must pick highest seeders within Tier 2');
    console.log(`✓ [PASS] Route 1 Tier 2 relaxation verified: selected ${sel2.tierLabel} with ${sel2.bestRelease.seeders} seeders.`);

    // Scenario 2C: No Tier 1 or Tier 2, relaxes to Tier 3 (<= 30MB/track, modest FLAC)
    const mockReleasesTier3 = [
        {
            title: 'Artist - Song [FLAC CD]',
            size: 22 * 1024 * 1024, // 22MB (Tier 3)
            seeders: 12,
            magnetUrl: 'magnet:?xt=urn:btih:tier3_a'
        },
        {
            title: 'Artist - Song [FLAC 16bit]',
            size: 18 * 1024 * 1024, // 18MB (Tier 3)
            seeders: 30,
            magnetUrl: 'magnet:?xt=urn:btih:tier3_b'
        },
        {
            title: 'Artist - Song [Vinyl 24bit Rip]',
            size: 90 * 1024 * 1024, // 90MB (> 30MB ceiling)
            seeders: 100,
            magnetUrl: 'magnet:?xt=urn:btih:oversized'
        }
    ];

    const sel3 = reconstructor._selectBestRelease(mockReleasesTier3, {
        artist: 'Artist',
        targetTitle: 'Song',
        trackCount: 1
    });

    assert.strictEqual(sel3.route, 1);
    assert.strictEqual(sel3.tier, 3, 'Must relax to Tier 3 (modest FLAC allowed when no lossy exists)');
    assert.strictEqual(sel3.bestRelease.seeders, 30, 'Must pick highest seeders within Tier 3');
    console.log(`✓ [PASS] Route 1 Tier 3 relaxation verified: modest FLAC allowed under 30MB/track ceiling.`);

    // Scenario 2D: All releases exceed 30MB/track ceiling
    const mockReleasesExceeded = [
        {
            title: 'Artist - Song [Dolby Atmos 5.1]',
            size: 45 * 1024 * 1024,
            seeders: 50,
            magnetUrl: 'magnet:?xt=urn:btih:atmos'
        },
        {
            title: 'Artist - Song [24-192 FLAC Stems]',
            size: 120 * 1024 * 1024,
            seeders: 80,
            magnetUrl: 'magnet:?xt=urn:btih:stems'
        },
        {
            title: 'Artist - Song [Video + Audio ISO]',
            size: 500 * 1024 * 1024,
            seeders: 30,
            magnetUrl: 'magnet:?xt=urn:btih:iso'
        }
    ];

    const sel4 = reconstructor._selectBestRelease(mockReleasesExceeded, {
        artist: 'Artist',
        targetTitle: 'Song',
        trackCount: 1
    });

    assert.strictEqual(sel4.bestRelease, null, 'Must reject releases that all exceed 30MB/track ceiling');
    console.log('✓ [PASS] Route 1 ceiling enforcement verified: oversized releases correctly rejected.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Route #2 (Few Results: <= 2 exact matches)
    // -------------------------------------------------------------------------
    console.log('[TEST 3] Testing Route #2 (<= 2 exact matches) availability prioritization...');

    // Scenario 3A: 1 or 2 matches, prioritizes availability / seeders under 30MB
    const mockReleasesRoute2 = [
        {
            title: 'Rare Artist - Rare Track [FLAC]',
            size: 14 * 1024 * 1024, // 14MB FLAC
            seeders: 3,
            magnetUrl: 'magnet:?xt=urn:btih:rare_flac'
        },
        {
            title: 'Rare Artist - Rare Track [MP3 96k]',
            size: 2 * 1024 * 1024, // 2MB
            seeders: 1,
            magnetUrl: 'magnet:?xt=urn:btih:rare_mp3'
        }
    ];

    const selRoute2 = reconstructor._selectBestRelease(mockReleasesRoute2, {
        artist: 'Rare Artist',
        targetTitle: 'Rare Track',
        trackCount: 1
    });

    assert.strictEqual(selRoute2.route, 2, 'Must take Route 2 (<= 2 matches)');
    assert.strictEqual(selRoute2.bestRelease.seeders, 3, 'Must pick top seeder under 30MB ceiling for rare track');
    assert.strictEqual(selRoute2.bestRelease.magnetUrl, 'magnet:?xt=urn:btih:rare_flac');
    console.log(`✓ [PASS] Route 2 availability prioritization verified: picked top seeder (${selRoute2.bestRelease.seeders} seeders, 14MB FLAC) for rare track.`);

    // Scenario 3B: Route 2 candidate exceeds 30MB ceiling
    const mockReleasesRoute2Over = [
        {
            title: 'Rare Artist - Rare Track [Vinyl 24-96]',
            size: 60 * 1024 * 1024, // 60MB (> 30MB)
            seeders: 5,
            magnetUrl: 'magnet:?xt=urn:btih:rare_giant'
        }
    ];

    const selRoute2Over = reconstructor._selectBestRelease(mockReleasesRoute2Over, {
        artist: 'Rare Artist',
        targetTitle: 'Rare Track',
        trackCount: 1
    });

    assert.strictEqual(selRoute2Over.bestRelease, null, 'Must reject Route 2 candidate if it exceeds 30MB ceiling');
    console.log('✓ [PASS] Route 2 ceiling enforcement verified: oversized candidate rejected.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Album Sizing Scaling (trackCount * 30MB)
    // -------------------------------------------------------------------------
    console.log('[TEST 4] Testing album sizing scaling (trackCount * tier sizes)...');

    // 12-track album:
    // Tier 1: <= 60MB (12 * 5MB)
    // Tier 2: <= 120MB (12 * 10MB)
    // Tier 3: <= 360MB (12 * 30MB)
    const mockAlbumReleases = [
        {
            title: 'Band - Full Album (2020) [FLAC]',
            size: 280 * 1024 * 1024, // 280MB (Tier 3)
            seeders: 50,
            magnetUrl: 'magnet:?xt=urn:btih:album_flac'
        },
        {
            title: 'Band - Full Album (2020) [MP3 320]',
            size: 110 * 1024 * 1024, // 110MB (Tier 2)
            seeders: 20,
            magnetUrl: 'magnet:?xt=urn:btih:album_320'
        },
        {
            title: 'Band - Full Album (2020) [MP3 V2]',
            size: 55 * 1024 * 1024, // 55MB (Tier 1)
            seeders: 15,
            magnetUrl: 'magnet:?xt=urn:btih:album_v2'
        },
        {
            title: 'Band - Full Album (2020) [Lossless Boxset 24-192]',
            size: 900 * 1024 * 1024, // 900MB (> 360MB)
            seeders: 100,
            magnetUrl: 'magnet:?xt=urn:btih:album_giant'
        }
    ];

    const albumSel = reconstructor._selectBestRelease(mockAlbumReleases, {
        artist: 'Band',
        targetTitle: 'Full Album',
        trackCount: 12
    });

    assert.strictEqual(albumSel.route, 1);
    assert.strictEqual(albumSel.tier, 1, 'Must pick Tier 1 (<= 60MB for 12 tracks)');
    assert.strictEqual(albumSel.bestRelease.size, 55 * 1024 * 1024);
    console.log(`✓ [PASS] 12-track album scaling verified: 55MB picked in Tier 1 (limit 60MB).`);

    // Now test if only Tier 3 exists for the album
    const albumSelTier3 = reconstructor._selectBestRelease([mockAlbumReleases[0], mockAlbumReleases[3], {
        title: 'Band - Full Album (2020) [FLAC 16bit]',
        size: 300 * 1024 * 1024, // 300MB (Tier 3)
        seeders: 80,
        magnetUrl: 'magnet:?xt=urn:btih:album_flac_2'
    }], {
        artist: 'Band',
        targetTitle: 'Full Album',
        trackCount: 12
    });

    assert.strictEqual(albumSelTier3.route, 1);
    assert.strictEqual(albumSelTier3.tier, 3, 'Must pick Tier 3 (<= 360MB for 12 tracks)');
    assert.strictEqual(albumSelTier3.bestRelease.seeders, 80);
    console.log(`✓ [PASS] 12-track album Tier 3 relaxation verified: picked 300MB FLAC with 80 seeders under 360MB cap.\n`);

    console.log('======================================================================');
    console.log(' ALL TIERED SELECTION & TOKEN MATCHING TESTS PASSED SUCCESSFULLY!     ');
    console.log('======================================================================');
}

testAlgorithm().catch(err => {
    console.error('FATAL TEST FAILURE:', err);
    process.exit(1);
});
