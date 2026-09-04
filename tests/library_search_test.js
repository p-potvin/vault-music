/**
 * Vault Music — Library, Albums, Artists & Search Test Suite
 */

const http = require('http');
const { app, libraryService } = require('../src/server');

async function runLibrarySearchTests() {
    console.log('======================================================================');
    console.log(' VAULT MUSIC: LIBRARY, ARTISTS, ALBUMS & SEARCH TEST SUITE            ');
    console.log('======================================================================\n');

    const scanStats = libraryService.scanLibrary();
    console.log(`Scanned Library: ${scanStats.totalTracks} tracks, ${scanStats.totalAlbums} albums, ${scanStats.totalArtists} artists.`);

    // Test 1: Track Search
    console.log('\n[Test 1] Testing track query filtering...');
    const searchRes = libraryService.listTracks({ query: 'One More Time' });
    if (!searchRes.tracks || searchRes.tracks.length === 0) {
        throw new Error("Expected at least 1 track matching 'One More Time'");
    }
    console.log(`Found ${searchRes.tracks.length} matching track(s). Sample: "${searchRes.tracks[0].title}" by ${searchRes.tracks[0].artist}`);
    console.log('✓ [PASS] Track search verified.');

    // Test 2: Albums Listing & Details
    console.log('\n[Test 2] Testing albums listing and album details retrieval...');
    const albumsRes = libraryService.listAlbums();
    if (!albumsRes.albums || albumsRes.albums.length === 0) {
        throw new Error('Expected albums list to have items');
    }
    console.log(`Total Albums: ${albumsRes.total}. Sample: "${albumsRes.albums[0].title}" by ${albumsRes.albums[0].artist} (${albumsRes.albums[0].trackCount} tracks)`);

    const discoveryAlbum = albumsRes.albums.find(a => a.title === 'Discovery');
    if (discoveryAlbum) {
        const albumDetail = libraryService.getAlbum(discoveryAlbum.id);
        if (!albumDetail || !Array.isArray(albumDetail.tracks) || albumDetail.tracks.length < 14) {
            throw new Error(`Expected Discovery album to have at least 14 tracks, got ${albumDetail?.tracks?.length}`);
        }
        console.log(`Discovery album verified with ${albumDetail.tracks.length} tracks.`);
    }
    console.log('✓ [PASS] Albums listing and details verified.');

    // Test 3: Artists Listing & Details
    console.log('\n[Test 3] Testing artists listing and artist details retrieval...');
    const artistsRes = libraryService.listArtists();
    if (!artistsRes.artists || artistsRes.artists.length === 0) {
        throw new Error('Expected artists list to have items');
    }
    console.log(`Total Artists: ${artistsRes.total}. Sample: "${artistsRes.artists[0].name}" (${artistsRes.artists[0].trackCount} tracks)`);

    const daftPunk = libraryService.getArtist('Daft Punk') || libraryService.getArtist('Daft Punk, Romanthony');
    if (daftPunk) {
        console.log(`Found artist "${daftPunk.name}": ${daftPunk.trackCount} track(s), ${daftPunk.albumCount} album(s)`);
    }
    console.log('✓ [PASS] Artists listing and details verified.');

    // Test 4: Express API Endpoints
    console.log('\n[Test 4] Testing Express Library endpoints (/api/v1/tracks, /api/v1/albums, /api/v1/artists)...');
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
        const tracksApiRes = await fetch(`http://127.0.0.1:${port}/api/v1/tracks?query=Time`);
        const tracksData = await tracksApiRes.json();
        if (!tracksData.tracks || tracksData.tracks.length === 0) {
            throw new Error('Expected tracks search endpoint to return results');
        }

        const albumsApiRes = await fetch(`http://127.0.0.1:${port}/api/v1/albums`);
        const albumsData = await albumsApiRes.json();
        if (!albumsData.albums || albumsData.albums.length === 0) {
            throw new Error('Expected albums endpoint to return results');
        }

        const artistsApiRes = await fetch(`http://127.0.0.1:${port}/api/v1/artists`);
        const artistsData = await artistsApiRes.json();
        if (!artistsData.artists || artistsData.artists.length === 0) {
            throw new Error('Expected artists endpoint to return results');
        }

        console.log('✓ [PASS] All library API endpoints verified.');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }

    console.log('\n======================================================================');
    console.log(' ALL LIBRARY & SEARCH TESTS PASSED!                                   ');
    console.log('======================================================================\n');
}

if (require.main === module) {
    runLibrarySearchTests().catch(err => {
        console.error('❌ [FAIL] Library search test failed:', err);
        process.exit(1);
    });
}

module.exports = { runLibrarySearchTests };
