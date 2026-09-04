const assert = require('assert').strict;
const http = require('http');
const path = require('path');
const fs = require('fs');
const { app, profileService, libraryService } = require('../src/server');

console.log('======================================================================');
console.log(' VAULT MUSIC: PROFILES & VIEW DUPLICATION TEST SUITE                  ');
console.log('======================================================================\n');

async function testProfiles() {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    function requestJson(url, options = {}) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const req = http.request({
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                }
            }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    try {
                        resolve({ status: res.statusCode, data: JSON.parse(data) });
                    } catch (_) {
                        resolve({ status: res.statusCode, raw: data });
                    }
                });
            });
            req.on('error', reject);
            if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
            req.end();
        });
    }

    try {
        const deviceA = 'ts-iphone-philippe';
        const deviceB = 'ts-desktop-clopeux';

        // 1. Test Device Profile Identification (/api/v1/profiles/me)
        console.log('[Test 1] Testing Device Profile Auto-Identification for Device A...');
        const resA = await requestJson(`${baseUrl}/api/v1/profiles/me`, {
            headers: { 'x-device-id': deviceA }
        });
        assert.equal(resA.status, 200);
        assert.equal(resA.data.deviceId, deviceA);
        console.log(`✓ [PASS] Device A profile created/resolved: ${resA.data.deviceId}\n`);

        // 2. Test Device Customization & Pinned Playlists on Device A
        console.log('[Test 2] Testing Shared Playlist Creation and Device A Home Customization...');
        const createPlRes = await requestJson(`${baseUrl}/api/v1/profiles/playlists`, {
            method: 'POST',
            headers: { 'x-device-id': deviceA },
            body: { name: 'Late Night Synthwave', trackIds: ['track-1', 'track-2'] }
        });
        assert.equal(createPlRes.status, 201);
        const playlistId = createPlRes.data.id;
        assert.equal(createPlRes.data.name, 'Late Night Synthwave');
        console.log(`✓ [PASS] Shared playlist created: "${createPlRes.data.name}" (${playlistId})`);

        // Pin playlist on Device A
        const updateA = await requestJson(`${baseUrl}/api/v1/profiles/me`, {
            method: 'POST',
            headers: { 'x-device-id': deviceA },
            body: {
                name: "Philippe's iPhone 16",
                homeView: {
                    pinnedPlaylistIds: [playlistId],
                    favoriteTrackIds: ['track-99']
                }
            }
        });
        assert.equal(updateA.status, 200);
        assert.equal(updateA.data.name, "Philippe's iPhone 16");
        assert.deepEqual(updateA.data.homeView.pinnedPlaylistIds, [playlistId]);
        console.log('✓ [PASS] Device A home view customized.\n');

        // 3. Test Device B Connecting and Viewing Shared Playlists
        console.log('[Test 3] Testing Device B Accessing Shared Playlists...');
        const listPlRes = await requestJson(`${baseUrl}/api/v1/profiles/playlists/all`, {
            headers: { 'x-device-id': deviceB }
        });
        assert.equal(listPlRes.status, 200);
        const found = listPlRes.data.find(p => p.id === playlistId);
        assert.ok(found, 'Device B must see shared playlists created by Device A');
        console.log(`✓ [PASS] Device B confirmed shared playlist visibility (${listPlRes.data.length} total).\n`);

        // 4. Test View Duplication (Clone Device A View into Device B)
        console.log('[Test 4] Testing View Duplication (Clone View: Device A -> Device B)...');
        const cloneRes = await requestJson(`${baseUrl}/api/v1/profiles/clone-view`, {
            method: 'POST',
            headers: { 'x-device-id': deviceB },
            body: { sourceDeviceId: deviceA }
        });
        assert.equal(cloneRes.status, 200);
        assert.ok(cloneRes.data.success);
        assert.deepEqual(cloneRes.data.profile.homeView.pinnedPlaylistIds, [playlistId]);
        assert.deepEqual(cloneRes.data.profile.homeView.favoriteTrackIds, ['track-99']);
        // Clean up test playlist
        profileService.deletePlaylist(playlistId);

        console.log('======================================================================');
        console.log(' ALL PROFILES & VIEW DUPLICATION TESTS PASSED!                        ');
        console.log('======================================================================');
    } finally {
        server.close();
    }
}

testProfiles().catch(err => {
    console.error('Profiles test failed:', err);
    process.exit(1);
});
