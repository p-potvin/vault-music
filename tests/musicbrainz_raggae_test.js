/**
 * MusicBrainz through vault-raggae (src/musicbrainz/local-db.js) and the tag reader's formats
 * (ID3v2.2, ID3v2.4 UTF-16 / multi-value, MP4 ilst, Ogg Vorbis). Offline: the gateway is faked.
 * With RAGGAE_LIVE=1 it also asks the real gateway (vault-raggae on 127.0.0.1:8750).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalMusicBrainzDb, cleanTitle } = require('../src/musicbrainz/local-db');
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
const REC = ['recordingMbid', 'title', 'length', 'artist'];

async function testLookup() {
    const g = fakeGateway((url, body) => {
        if (url.includes('/v1/sql/musicbrainz')) {
            if (body.sql.includes('FROM artist_credits ac JOIN recordings')) {
                assert.deepStrictEqual(body.params, ['Radiohead', 'Paranoid Android']);
                return rows(REC, [['9f9c', 'Paranoid Android', 384000, 'Radiohead']]);
            }
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
    console.log('✓ [PASS] Exact artist + title, then the release from the catalog.');
}

async function testFallbacksAndBackoff() {
    // No exact hit: falls through to the "feat." and prefix queries, never asks the catalog without an album.
    let n = 0;
    const g = fakeGateway((url, body) => {
        n++;
        if (body.sql.includes("r.name LIKE ? ESCAPE '!'")) {
            assert.deepStrictEqual(body.params, ['100!% Pure%', '%Some!_One%']);
            return rows(REC, [['abc', '100% Pure Love', 1000, 'Some_One']]);
        }
        return rows(REC, []);
    });
    const db = new LocalMusicBrainzDb('http://gw', { fetchImpl: g.fetchImpl });
    const r = await db.searchRecording({ title: '100% Pure', artist: 'Some_One' });
    assert.strictEqual(r.recordingMbid, 'abc');
    assert.strictEqual(r.releaseMbid, null);
    assert.strictEqual(n, 3);

    // Gateway down: one failed request, then no more until the back-off ends.
    let tries = 0;
    const down = new LocalMusicBrainzDb('http://gw', { fetchImpl: async () => { tries++; throw new Error('ECONNREFUSED'); } });
    assert.strictEqual(await down.searchRecording({ title: 'A', artist: 'B' }), null);
    assert.strictEqual(await down.searchRecording({ title: 'C', artist: 'D' }), null);
    assert.strictEqual(tries, 1);
    assert.strictEqual(down.isAvailable, false);

    // A SQL error (400) is not an outage.
    const bad = new LocalMusicBrainzDb('http://gw', { fetchImpl: fakeGateway(() => ({ status: 400, body: { error: { type: 'OperationalError', message: 'x' } } })).fetchImpl });
    await bad.query('SELECT 1');
    assert.strictEqual(bad.isAvailable, true);
    // An artist is known but nothing matched: no title-only guess (that was someone else's song).
    const noGuess = new LocalMusicBrainzDb('http://gw', { fetchImpl: fakeGateway((u, b) => {
        assert.ok(!/WHERE r.name = ? COLLATE NOCASE LIMIT 1/.test(b.sql.replace(/s+/g, ' ')), 'title-only query with an artist');
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
    console.log(`✓ [PASS] Live gateway: ${r.artist} - ${r.title} / ${r.album} (${r.releaseYear}) in ${Date.now() - t0} ms`);
}

(async () => {
    console.log('=== MusicBrainz via vault-raggae & tag formats ===');
    await testLookup();
    await testFallbacksAndBackoff();
    testTagReader();
    await testLive();
    console.log(' ALL MUSICBRAINZ / TAG TESTS PASSED!');
})().catch(err => {
    console.error('MusicBrainz / tag test failed:', err);
    process.exit(1);
});
