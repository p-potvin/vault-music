/**
 * Apple Music Library.musicdb reader.
 *
 * The library database is an "hfma" container: an AES-128-ECB encrypted,
 * zlib-compressed stream of length-prefixed chunks. Records are flat — a
 * record chunk (iama/itma/iAma/lpma) is immediately followed by its "boma"
 * field chunks — so parsing is a single sequential pass.
 */

const crypto = require('crypto');
const zlib = require('zlib');

const AES_KEY = Buffer.from('BHUILuilfghuila3', 'utf8');

const FIELD = {
    TRACK_TITLE: 2,
    TRACK_ALBUM: 3,
    TRACK_ARTIST: 4,
    TRACK_GENRE: 5,
    TRACK_ALBUM_ARTIST: 0x1b,
    ALBUM_NAME: 300,
    ALBUM_ARTIST: 301,
    ALBUM_ARTIST_2: 302,
    ARTIST_NAME: 400,
    PLAYLIST_NAME: 200,
    PLAYLIST_ITEM: 206,
};

const SYSTEM_PLAYLISTS = new Set([
    'Music', 'Downloaded', 'Music Videos', 'TV & Movies', 'Genius',
    'Classical Music', 'Favourite Songs', 'Favorite Songs', '####!####',
]);

function decodeField(payload) {
    // subtype(4) + 20 bytes of header + string bytes
    if (payload.length < 24) return { subtype: null, value: '', payload };
    const subtype = payload.readUInt32LE(0);
    const encoding = payload.readUInt32LE(8);
    const length = payload.readUInt32LE(12);
    const end = Math.min(24 + length, payload.length);
    const value = payload.slice(24, end).toString(encoding === 1 ? 'utf16le' : 'utf8');
    return { subtype, value, payload };
}

function readChunks(buffer) {
    const chunks = [];
    let offset = 0;
    while (offset + 8 <= buffer.length) {
        const fourcc = buffer.slice(offset, offset + 4).toString('latin1');
        let length = buffer.readUInt32LE(offset + 4);
        let prefix = 8;
        if (fourcc === 'boma') {
            if (offset + 12 > buffer.length) break;
            length = buffer.readUInt32LE(offset + 8);
            prefix = 12;
        }
        const payloadLength = length - prefix;
        if (payloadLength < 0 || offset + prefix + payloadLength > buffer.length) break;
        chunks.push({
            fourcc,
            payload: buffer.slice(offset + prefix, offset + prefix + payloadLength),
        });
        offset += prefix + payloadLength;
    }
    return chunks;
}

function decodeMusicDb(filePath) {
    const fs = require('fs');
    const raw = fs.readFileSync(filePath);
    if (raw.length < 16 || raw.slice(0, 4).toString('latin1') !== 'hfma') {
        throw new Error('Not an Apple Music library database (missing hfma header)');
    }

    const headerSize = raw.readUInt32LE(4);
    const header = raw.slice(8, headerSize);
    const fileSize = header.readUInt32LE(0);
    let encryptedSize = header.readUInt32LE(76);
    const dataSize = fileSize - headerSize;
    if (encryptedSize > fileSize) encryptedSize = dataSize - (dataSize % 16);

    const body = raw.slice(headerSize);
    const decipher = crypto.createDecipheriv('aes-128-ecb', AES_KEY, null);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([
        decipher.update(body.slice(0, encryptedSize)),
        decipher.final(),
    ]);
    const inflated = zlib.inflateSync(Buffer.concat([decrypted, body.slice(encryptedSize)]));

    return readChunks(inflated);
}

function groupRecords(chunks) {
    const records = [];
    let current = null;
    for (const chunk of chunks) {
        if (chunk.fourcc === 'boma') {
            if (current) current.fields.push(decodeField(chunk.payload));
            continue;
        }
        current = { fourcc: chunk.fourcc, payload: chunk.payload, fields: [] };
        records.push(current);
    }
    return records;
}

function readRecordId(payload) {
    return payload.length >= 16 ? payload.readBigInt64LE(8).toString() : null;
}

function firstField(record, subtypes) {
    for (const field of record.fields) {
        if (subtypes.includes(field.subtype) && field.value) return field.value;
    }
    return '';
}

/**
 * Parse playlists with their resolved tracks.
 */
function readPlaylists(filePath) {
    const records = groupRecords(decodeMusicDb(filePath));

    const tracks = new Map();
    for (const record of records) {
        if (record.fourcc !== 'itma') continue;
        const id = readRecordId(record.payload);
        if (!id) continue;
        tracks.set(id, {
            id,
            title: firstField(record, [FIELD.TRACK_TITLE]),
            artist: firstField(record, [FIELD.TRACK_ARTIST, FIELD.TRACK_ALBUM_ARTIST]),
            album: firstField(record, [FIELD.TRACK_ALBUM]),
            genre: firstField(record, [FIELD.TRACK_GENRE]),
        });
    }

    const playlists = [];
    for (const record of records) {
        if (record.fourcc !== 'lpma') continue;
        const id = readRecordId(record.payload);
        const name = firstField(record, [FIELD.PLAYLIST_NAME]);
        if (!name) continue;

        const items = [];
        for (const field of record.fields) {
            if (field.subtype !== FIELD.PLAYLIST_ITEM) continue;
            const payload = field.payload;
            if (payload.length < 36) continue;
            const position = payload.readUInt32LE(16);
            const trackId = payload.readBigInt64LE(28).toString();
            const track = tracks.get(trackId);
            items.push({
                position,
                trackId,
                title: track ? track.title : '',
                artist: track ? track.artist : '',
                album: track ? track.album : '',
                genre: track ? track.genre : '',
            });
        }
        if (items.length === 0) continue;
        items.sort((a, b) => a.position - b.position);

        playlists.push({
            id: id || name,
            name,
            isSystem: SYSTEM_PLAYLISTS.has(name),
            trackCount: items.length,
            tracks: items.map(({ title, artist, album, genre }) => ({ title, artist, album, genre })),
        });
    }

    playlists.sort((a, b) => b.trackCount - a.trackCount);
    return playlists;
}

module.exports = { readPlaylists, decodeMusicDb, groupRecords, SYSTEM_PLAYLISTS };
