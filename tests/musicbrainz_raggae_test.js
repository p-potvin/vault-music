/**
 * MusicBrainz through vault-raggae (src/musicbrainz/local-db.js) and the tag reader's formats
 * (ID3v2.2, ID3v2.4 UTF-16 / multi-value, MP4 ilst, Ogg Vorbis). Offline: the gateway is faked.
 * With RAGGAE_LIVE=1 it also asks the real gateway (vault-raggae on 127.0.0.1:8750).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalMusicBrainzDb, cleanTitle, rankTrack } = require('../src/musicbrainz/local-db');
const { extractAudioFileMetadata } = require('../src/musicbrainz/tag-reader');

function fakeGateway(handler) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
        const out = await handler(url, init.body ? JSON.parse(init.body) : null);
        if (out instanceof Error) throw out;
        const status = out.status || 200;
        return { ok: status < 400, status, json: async () => out.body };
    };
    return { calls, fetchImpl };
}

const rows = (columns, values) => ({ body: { columns, rows: values } });
const REC = ['recordingId', 'recordingMbid', 'title', 'length', 'artist'];
const TRK = ['recordingId', 'number', 'position', 'disc', 'trackCount', 'releaseMbid', 'releaseName', 'y', 'm', 'd',
    'country', 'status', 'releaseArtist', 'rgMbid', 'rgName', 'rgType', 'fy', 'fm', 'fd'];

async function testTrackLookup() {
    // Exact credit finds a one-off EP recording; the "feat." credit finds the album one. The album track wins.
    const g = fakeGateway((url, body) => {
        if (url.includes('/v1/sql/musicbrainz')) {
            const sql = body.sql.replace(/\s+/g, ' ');
            if (sql.includes('FROM releases rl')) return rows(['x'], []); // no release named like the tag
            if (sql.includes('FROM artist_credits ac JOIN recordings')) {
                return rows(REC, [[11, 'ep-rec', 'Havana', 217000, 'Camila Cabello']]);
            }
            if (sql.includes("WHERE r.name = ? COLLATE NOCASE AND ac.name LIKE ?")) {
                assert.deepStrictEqual(body.params, ['Havana', '%Camila Cabello%']);
                return rows(REC, [[11, 'ep-rec', 'Havana', 217000, 'Camila Cabello'],
                    [22, 'main-rec', 'Havana', 217000, 'Camila Cabello feat. Young Thug']]);
            }
            if (sql.includes('FROM tracks t')) {
                assert.deepStrictEqual(body.params, [11, 22]);
                return rows(TRK, [
                    [11, '2', 2, 1, 7, 'rel-ep', 'New Music Daily Presents', 2019, 1, 1, 'AE', 'Official', 'Camila Cabello', 'rg-ep', 'New Music Daily Presents', 'EP', 2019, null, null],
                    [22, '1', 1, 1, 2, 'rel-single', 'Havana', 2017, 8, 3, 'XW', 'Official', 'Camila Cabello feat. Young Thug', 'rg-single', 'Havana', 'Single', 2017, 8, 3],
                    [22, '10', 10, 1, 40, 'rel-comp', 'Bravo Hits 99', 2017, 11, 1, 'DE', 'Official', 'Various Artists', 'rg-comp', 'Bravo Hits 99', 'Album', 2017, 11, 1],
                    [22, '4', 4, 1, 11, 'rel-reissue', 'Camila', 2023, null, null, 'US', 'Official', 'Camila Cabello', 'rg-camila', 'Camila', 'Album', 2018, 1, 12],
                    [22, 'A4', 4, 2, 11, 'rel-lp', 'Camila', 2018, 1, 12, 'US', 'Official', 'Camila Cabello', 'rg-camila', 'Camila', 'Album', 2018, 1, 12]
                ]);
            }
            if (sql.includes('FROM recordings r JOIN artist_credit_names')) {
                assert.deepStrictEqual(body.params, [22]);
                return rows(['gid'], [['artist-camila']]);
            }
            throw new Error('unexpected SQL ' + sql);
        }
        if (url.includes('/v1/catalog/search')) {
            return { body: { results: [{ catalog_id: 'mb:rel:x', title: 'Camila', subtitle_or_artist: 'Camila Cabello',
                genres: ['Album', 'pop'], external_ids: { mbid: 'x' } }] } };
        }
        throw new Error('unexpected URL ' + url);
    });
    const db = new LocalMusicBrainzDb('http://gw', { fetchImpl: g.fetchImpl });
    const r = await db.searchRecording({ title: 'Havana', artist: 'Camila Cabello', album: 'Camila' });
    assert.strictEqual(r.recordingMbid, 'main-rec');
    assert.strictEqual(r.album, 'Camila');
    // Both "Camila" tracks share the group's first date; the 2018 pressing beats the 2023 reissue. Its vinyl side
    // number "A4" falls back to the position.
    assert.strictEqual(r.releaseGroupMbid, 'rg-camila');
    assert.strictEqual(r.releaseMbid, 'rel-lp');
    assert.strictEqual(r.releaseDate, '2018-01-12');
    assert.strictEqual(r.originalYear, '2018');
    assert.strictEqual(r.trackNumber, 4);
    assert.strictEqual(r.discNumber, 2);
    assert.strictEqual(r.artistMbid, 'artist-camila');
    assert.deepStrictEqual(r.genres, ['pop']); // from the catalog; its release fields are not taken
    assert.strictEqual(r.releaseType, 'Album');

    // The album the file is tagged with beats everything else, even a compilation.
    const keyComp = rankTrack({ releaseName: 'Bravo Hits 99', releaseArtist: 'Various Artists', status: 'Official', rgType: 'Album', fy: 2017 },
        { album: 'Bravo Hits 99', artist: 'Camila Cabello' });
    const keyOwn = rankTrack({ releaseName: 'Camila', releaseArtist: 'Camila Cabello', status: 'Official', rgType: 'Album', fy: 2018 },
        { album: 'Bravo Hits 99', artist: 'Camila Cabello' });
    assert.ok(keyComp[0] < keyOwn[0]);
    // Undated releases sort after dated ones of the same rank; "Official" beats a bootleg.
    const k = (o) => rankTrack({ releaseArtist: 'Queen', status: 'Official', rgType: 'Album', ...o }, { artist: 'Queen' });
    assert.ok(k({ fy: 1975 })[4] < k({})[4]);
    assert.ok(k({ fy: 1975 })[2] < k({ fy: 1975, status: 'Bootleg' })[2]);
    console.log('✓ [PASS] Candidates from exact + "feat." credits; best track: own album, official, earliest; genres from the catalog.');
}

async function testAlbumFirst() {
    // The file's album settles the recording: typographic punctuation in MusicBrainz, a near title at the tagged
    // track number, another artist's release of the same name left out.
    const A = ['recordingId', 'number', 'position', 'trackName', 'disc', 'trackCount', 'releaseMbid', 'releaseName', 'y', 'm', 'd',
        'country', 'status', 'releaseArtist', 'rgMbid', 'rgName', 'rgType', 'fy', 'fm', 'fd', 'recordingMbid', 'title', 'length', 'artist'];
    const album = (n, trackName, rel, y, relArtist, recMbid) =>
        [n, String(n), n, trackName, 1, 12, rel, "The Freewheelin' Bob Dylan", y, 5, 27, 'US', 'Official', relArtist, 'rg-fw', "The Freewheelin' Bob Dylan", 'Album', 1963, 5, 27, recMbid, trackName, 400000, relArtist];
    const g = fakeGateway((url, body) => {
        if (url.includes('/v1/catalog/search')) return { body: { results: [] } };
        if (body.sql.includes('FROM releases rl')) {
            assert.deepStrictEqual(body.params, ["The Freewheelin' Bob Dylan", 'The Freewheelin’ Bob Dylan']);
            return rows(A, [
                album(6, 'A Hard Rain’s A‐Gonna Fall', 'rel-reissue', 1990, 'Bob Dylan', 'rec-hr'),
                album(6, 'A Hard Rain’s A‐Gonna Fall', 'rel-1963', 1963, 'Bob Dylan', 'rec-hr'),
                album(6, 'A Hard Rain’s A‐Gonna Fall', 'rel-cover', 1960, 'Someone Else', 'rec-cover'),
                album(5, 'Whispers (I Hear Your)', 'rel-1963', 1963, 'Bob Dylan', 'rec-wh')
            ]);
        }
        if (body.sql.includes('artist_credit_names')) return rows(['gid'], [['artist-dylan']]);
        return rows(REC, []); // the exact-title queries, reached only when the album gives nothing
    });
    const db = new LocalMusicBrainzDb('http://gw', { fetchImpl: g.fetchImpl });
    const r = await db.searchRecording({ title: "A Hard Rain's A-Gonna Fall", artist: 'Bob Dylan', album: "The Freewheelin' Bob Dylan", track: '6/13' });
    assert.strictEqual(r.recordingMbid, 'rec-hr');
    assert.strictEqual(r.releaseMbid, 'rel-1963');
    assert.strictEqual(r.trackNumber, 6);
    assert.strictEqual(r.artistMbid, 'artist-dylan');
    const w = await db.searchRecording({ title: 'Whispers (I Hear You)', artist: 'Bob Dylan', album: "The Freewheelin' Bob Dylan", track: '5' });
    assert.strictEqual(w.recordingMbid, 'rec-wh');
    // Same near title at another track number: not taken from the album (falls through to the exact queries).
    assert.strictEqual(await db.searchRecording({ title: 'Whispers (I Hear You)', artist: 'Bob Dylan', album: "The Freewheelin' Bob Dylan", track: '9' }), null);
    assert.strictEqual(db.isAvailable, true);
    console.log('✓ [PASS] Album first: punctuation-blind title, tagged track number for a near title, other artists left out.');
}

async function testLookup() {
    // A recording on no track: the release comes from the catalog, as before the reference was rebuilt.
    const g = fakeGateway((url, body) => {
        if (url.includes('/v1/sql/musicbrainz')) {
            if (body.sql.includes('FROM releases rl')) {
                assert.deepStrictEqual(body.params, ['OK Computer']);
                return rows(['x'], []);
            }
            if (body.sql.includes('FROM tracks t') || body.sql.includes('artist_credit_names')) return rows(['x'], []);
            if (body.sql.includes('FROM artist_credits ac JOIN recordings')) {
                assert.deepStrictEqual(body.params, ['Radiohead', 'Paranoid Android']);
                return rows(REC, [[5, '9f9c', 'Paranoid Android', 384000, 'Radiohead']]);
            }
            if (body.sql.includes('ac.name LIKE')) return rows(REC, []);
            if (body.sql.includes('FROM releases r')) {
                assert.deepStrictEqual(body.params, [1792]);
                return rows(['rgMbid', 'y', 'm', 'd', 'country'], [['b1392450', 1997, 5, 21, 'GB']]);
            }
            throw new Error('unexpected SQL ' + body.sql);
        }
        if (url.includes('/v1/catalog/search')) {
            assert.ok(url.includes('category=music'));
            return { body: { results: [
                { catalog_id: 'mb:rel:other', title: 'OK Computer OKNOTOK', subtitle_or_artist: 'Radiohead', external_ids: {} },
                { catalog_id: 'mb:rel:fba5', title: 'OK Computer', subtitle_or_artist: 'Radiohead',
                  genres: ['Album', 'art rock'], external_ids: { mbid: 'fba5', rel_id: 1792 } }
            ] } };
        }
        throw new Error('unexpected URL ' + url);
    });
    const db = new LocalMusicBrainzDb('http://gw', { fetchImpl: g.fetchImpl });
    const r = await db.searchRecording({ title: 'Paranoid Android', artist: 'Radiohead', album: 'OK Computer' });
    assert.strictEqual(r.recordingMbid, '9f9c');
    assert.strictEqual(r.length, 384);
    assert.strictEqual(r.releaseMbid, 'fba5');
    assert.strictEqual(r.releaseGroupMbid, 'b1392450');
    assert.strictEqual(r.releaseYear, '1997');
    assert.strictEqual(r.releaseDate, '1997-05-21');
    assert.deepStrictEqual(r.genres, ['art rock']);
    assert.strictEqual(g.calls[0].body.op, 'read');
    console.log('✓ [PASS] No track: exact artist + title, then the release from the catalog.');
}

async function testFallbacksAndBackoff() {
    // No exact hit: falls through to the "feat." and prefix queries, never asks the catalog without an album.
    let n = 0;
    const g = fakeGateway((url, body) => {
        n++;
        assert.ok(url.includes('/v1/sql/musicbrainz'), 'catalog asked without an album');
        if (body.sql.includes("r.name LIKE ? ESCAPE '!'")) {
            assert.deepStrictEqual(body.params, ['100!% Pure%', '%Some!_One%']);
            return rows(REC, [[7, 'abc', '100% Pure Love', 1000, 'Some_One']]);
        }
        return rows(REC, []);
    });
    const db = new LocalMusicBrainzDb('http://gw', { fetchImpl: g.fetchImpl });
    const r = await db.searchRecording({ title: '100% Pure', artist: 'Some_One' });
    assert.strictEqual(r.recordingMbid, 'abc');
    assert.strictEqual(r.releaseMbid, null);
    assert.strictEqual(n, 5); // exact credit, "feat.", prefix, tracks, artist MBID

    // Gateway down: the request and its one retry fail, then no more until the back-off ends.
    let tries = 0;
    const down = new LocalMusicBrainzDb('http://gw', { retryDelayMs: 0, fetchImpl: async () => { tries++; throw new Error('ECONNREFUSED'); } });
    assert.strictEqual(await down.searchRecording({ title: 'A', artist: 'B' }), null);
    assert.strictEqual(await down.searchRecording({ title: 'C', artist: 'D' }), null);
    assert.strictEqual(tries, 2);
    assert.strictEqual(down.isAvailable, false);

    // A blip (one refused connection) is retried and the lookup still answers; no back-off.
    let blips = 0;
    const flaky = new LocalMusicBrainzDb('http://gw', { retryDelayMs: 0, fetchImpl: async (url, init) => {
        if (blips++ === 0) throw new Error('ECONNRESET');
        return { ok: true, status: 200, json: async () => ({ columns: REC, rows: [[1, 'x1', 'A', 1000, 'B']] }) };
    } });
    assert.strictEqual((await flaky.searchRecording({ title: 'A', artist: 'B' })).recordingMbid, 'x1');
    assert.strictEqual(flaky.isAvailable, true);

    // A SQL error (400) is not an outage.
    const bad = new LocalMusicBrainzDb('http://gw', { fetchImpl: fakeGateway(() => ({ status: 400, body: { error: { type: 'OperationalError', message: 'x' } } })).fetchImpl });
    await bad.query('SELECT 1');
    assert.strictEqual(bad.isAvailable, true);
    // An artist is known but nothing matched: no title-only guess (that was someone else's song).
    const noGuess = new LocalMusicBrainzDb('http://gw', { fetchImpl: fakeGateway((u, b) => {
        assert.ok(!/WHERE r\.name = \? COLLATE NOCASE LIMIT/.test(b.sql.replace(/\s+/g, ' ')), 'title-only query with an artist');
        return rows(REC, []);
    }).fetchImpl });
    assert.strictEqual(await noGuess.searchRecording({ title: 'Cold Turkey', artist: '$uicideboy$' }), null);
    assert.strictEqual(cleanTitle('Havana (Audio) ft. Young Thug'), 'Havana');
    assert.strictEqual(cleanTitle('Cinderella (feat. Ty Dolla $ign)'), 'Cinderella');
    assert.strictEqual(cleanTitle('What I Got (Reprise)'), 'What I Got (Reprise)');
    console.log('✓ [PASS] Fallback order, LIKE escaping, back-off on outage only, no title-only guess with an artist.');
}

// --- tag reader on synthetic files ---
const synchsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const be32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const atom = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([be32(body.length + 8), Buffer.from(type, 'latin1'), body]); };

function id3v22(frames) {
    const body = Buffer.concat(frames.map(([id, text]) => {
        const data = Buffer.concat([Buffer.from([0]), Buffer.from(text, 'latin1')]);
        return Buffer.concat([Buffer.from(id, 'latin1'), Buffer.from([0, 0, data.length]), data]);
    }));
    return Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([2, 0, 0]), synchsafe(body.length), body, Buffer.alloc(64)]);
}

function id3v24(frames) {
    const body = Buffer.concat(frames.map(([id, enc, payload]) => {
        const data = Buffer.concat([Buffer.from([enc]), payload]);
        return Buffer.concat([Buffer.from(id, 'latin1'), synchsafe(data.length), Buffer.from([0, 0]), data]);
    }));
    return Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([4, 0, 0]), synchsafe(body.length + 16), body, Buffer.alloc(16), Buffer.alloc(64)]);
}

function utf16be(s) { const b = Buffer.from(s, 'utf16le'); b.swap16(); return b; }

function m4a(items) {
    const ilst = atom('ilst', ...items.map(([type, value]) => atom(type, atom('data', be32(1), be32(0), value))));
    const meta = atom('meta', be32(0), atom('hdlr', Buffer.alloc(25)), ilst);
    const moov = atom('moov', atom('mvhd', Buffer.alloc(100)), atom('udta', meta));
    // moov after mdat, as many encoders write it
    return Buffer.concat([atom('ftyp', Buffer.from('M4A \0\0\0\0', 'latin1')), atom('mdat', Buffer.alloc(4096)), moov]);
}

function testTagReader() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-tags-'));
    try {
        const write = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return extractAudioFileMetadata(p); };

        let m = write('a.mp3', id3v22([['TT2', 'Down The Highway'], ['TP1', 'Bob Dylan'], ['TAL', 'Freewheelin'], ['TYE', '1963'], ['TRK', '4/13']]));
        assert.deepStrictEqual([m.embeddedTitle, m.embeddedArtist, m.embeddedAlbum, m.embeddedYear, m.embeddedTrack],
            ['Down The Highway', 'Bob Dylan', 'Freewheelin', '1963', '4/13']);

        m = write('b.mp3', id3v24([
            ['TIT2', 1, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('Café', 'utf16le')])],
            ['TPE1', 3, Buffer.from('Artist A\0Artist B', 'utf8')],
            ['TPE2', 2, utf16be('Band')],
            ['TDRC', 3, Buffer.from('2001-05-02', 'utf8')]
        ]));
        assert.deepStrictEqual([m.embeddedTitle, m.embeddedArtist, m.embeddedAlbumArtist, m.embeddedYear], ['Café', 'Artist A', 'Band', '2001']);

        const trkn = Buffer.from([0, 0, 0, 7, 0, 12, 0, 0]);
        m = write('c.m4a', m4a([['©nam', Buffer.from('PARIS')], ['©ART', Buffer.from('$UICIDEBOY$')],
            ['©alb', Buffer.from('Kill Your$elf')], ['©day', Buffer.from('2015-06-01T07:00:00Z')], ['trkn', trkn],
            ['aART', Buffer.from('$uicideboy$')], ['©gen', Buffer.from('Hip-Hop/Rap')]]));
        assert.deepStrictEqual([m.embeddedTitle, m.embeddedArtist, m.embeddedAlbum, m.embeddedYear, m.embeddedTrack, m.embeddedAlbumArtist, m.embeddedGenre],
            ['PARIS', '$UICIDEBOY$', 'Kill Your$elf', '2015', '7/12', '$uicideboy$', 'Hip-Hop/Rap']);

        const comments = ['TITLE=Ogg Song', 'ARTIST=Ogg Band', 'ALBUM=Ogg Album', 'DATE=1999-01-01', 'TRACKNUMBER=2'];
        const vc = Buffer.concat([be32(0).reverse(), be32(comments.length).reverse(),
            ...comments.map(c => { const b = Buffer.from(c, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); })]);
        m = write('d.ogg', Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(60), Buffer.from('\x03vorbis', 'latin1'), vc]));
        assert.deepStrictEqual([m.embeddedTitle, m.embeddedArtist, m.embeddedAlbum, m.embeddedYear, m.embeddedTrack],
            ['Ogg Song', 'Ogg Band', 'Ogg Album', '1999', '2']);

        m = write('Artist - Album (2004)/01 - Untagged.m4a'.replace('/', '__'), Buffer.from('not an mp4 at all'));
        assert.strictEqual(m.embeddedTitle, '');
        assert.strictEqual(m.effectiveTitle, 'Artist - Album (2004)__01 - Untagged');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log('✓ [PASS] Tag reader: ID3v2.2, ID3v2.4 UTF-16 / multi-value, MP4 ilst (moov after mdat), Ogg Vorbis.');
}

async function testLive() {
    if (process.env.RAGGAE_LIVE !== '1') return;
    const db = new LocalMusicBrainzDb();
    const t0 = Date.now();
    const r = await db.searchRecording({ title: 'Paranoid Android', artist: 'Radiohead', album: 'OK Computer' });
    assert.ok(r && r.recordingMbid, 'live recording');
    assert.ok(r.releaseMbid, 'live release');
    assert.ok(r.trackNumber > 0, 'live track number');
    console.log(`✓ [PASS] Live gateway: ${r.artist} - ${r.title} / ${r.album} (${r.releaseYear}) #${r.trackNumber} in ${Date.now() - t0} ms`);
    for (const q of [{ title: 'Havana', artist: 'Camila Cabello' }, { title: 'Bohemian Rhapsody', artist: 'Queen' }]) {
        const t1 = Date.now();
        const x = await db.searchRecording(q);
        assert.ok(x && x.trackNumber > 0 && x.releaseGroupMbid, `live ${q.title}`);
        console.log(`  ${q.artist} - ${q.title}: ${x.album} [${x.releaseType}, ${x.releaseDate || x.originalYear}] #${x.trackNumber} in ${Date.now() - t1} ms`);
    }
}

(async () => {
    console.log('=== MusicBrainz via vault-raggae & tag formats ===');
    await testTrackLookup();
    await testAlbumFirst();
    await testLookup();
    await testFallbacksAndBackoff();
    testTagReader();
    await testLive();
    console.log(' ALL MUSICBRAINZ / TAG TESTS PASSED!');
})().catch(err => {
    console.error('MusicBrainz / tag test failed:', err);
    process.exit(1);
});
