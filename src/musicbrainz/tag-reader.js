/**
 * Native lightweight audio metadata & tag extractor.
 * Reads ID3v1 / ID3v2.2-2.4 tags from MP3s, Vorbis comments from FLAC / Ogg / Opus,
 * and iTunes `ilst` atoms from M4A / MP4 without external binary dependencies.
 */

const fs = require('fs');
const path = require('path');

function cleanString(str) {
    if (!str) return '';
    return str.replace(/\0/g, '').trim();
}

/**
 * Clean a song filename to produce a search-ready title.
 */
function cleanSongFilename(filename) {
    if (!filename) return '';
    let title = filename.replace(/\.[^.]+$/, ''); // Remove ext
    title = title.replace(/^\s*\d{1,3}\s*[-._]\s*/i, '');
    title = title.replace(/^\s*\d{1,3}\s+/i, '');
    title = title.replace(/\[(?:hq|hd|audio|official|lyrics|320kbps|flac|\d+kbps)[^\]]*\]/gi, '');
    title = title.replace(/\((?:official video|official audio|lyrics|audio|visualizer|remastered|mono|stereo)\)/gi, '');
    return title.trim();
}

/**
 * Read ID3v1 tags from MP3 end of file (128 bytes).
 */
function readID3v1(fd, fileSize) {
    if (fileSize < 128) return null;
    const buffer = Buffer.alloc(128);
    fs.readSync(fd, buffer, 0, 128, fileSize - 128);
    if (buffer.toString('latin1', 0, 3) !== 'TAG') return null;

    return {
        title: cleanString(buffer.toString('latin1', 3, 33)),
        artist: cleanString(buffer.toString('latin1', 33, 63)),
        album: cleanString(buffer.toString('latin1', 63, 93)),
        year: cleanString(buffer.toString('latin1', 93, 97)),
        comment: cleanString(buffer.toString('latin1', 97, 127)),
    };
}

/** UTF-16 with a byte-order mark (little-endian when there is none), as ID3v2 encoding 1. */
function decodeUtf16(buf, bigEndianDefault = false) {
    let be = bigEndianDefault;
    let start = 0;
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) { be = true; start = 2; }
    else if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) { be = false; start = 2; }
    const body = Buffer.from(buf.subarray(start, start + ((buf.length - start) & ~1)));
    if (be) body.swap16();
    return body.toString('utf16le');
}

/**
 * The text of an ID3v2 text frame (encoding byte + text). ID3v2.4 separates several values with NUL: the first
 * one is kept (cleanString would otherwise glue "Artist A\0Artist B" into one name).
 */
function decodeId3Text(frameData) {
    const encoding = frameData[0];
    const body = frameData.subarray(1);
    let text;
    if (encoding === 1) text = decodeUtf16(body);
    else if (encoding === 2) text = decodeUtf16(body, true);
    else if (encoding === 3) text = body.toString('utf8');
    else text = body.toString('latin1');
    const first = text.replace(/^\uFEFF/, '').split('\0').map(s => s.trim()).find(Boolean) || '';
    return cleanString(first);
}

/** Frame ids we read, ID3v2.3/2.4 and their ID3v2.2 three-letter forms. */
const ID3_FIELDS = {
    TIT2: 'title', TT2: 'title',
    TPE1: 'artist', TP1: 'artist',
    TPE2: 'albumArtist', TP2: 'albumArtist',
    TALB: 'album', TAL: 'album',
    TYER: 'year', TDRC: 'year', TYE: 'year',
    TRCK: 'track', TRK: 'track',
    TCON: 'genre', TCO: 'genre',
};

/** ID3v2 frames read at most from this many bytes of the tag (text frames come before the large APIC ones). */
const ID3_READ_MAX = 1024 * 1024;

/**
 * Read ID3v2.2 / 2.3 / 2.4 text frames from the start of an MP3 file. ID3v2.2 has 3-letter frame ids and 6-byte
 * frame headers: 442 of G:\Music's 602 MP3s (Sat 07 Nov 2026) and the reader used to stop at their first frame.
 */
function readID3v2(fd, fileSize) {
    if (fileSize < 10) return null;
    const headerBuf = Buffer.alloc(10);
    fs.readSync(fd, headerBuf, 0, 10, 0);

    if (headerBuf.toString('latin1', 0, 3) !== 'ID3') return null;

    const version = headerBuf[3];
    const flags = headerBuf[5];
    if (version < 2 || version > 4) return null;
    const tagSize = ((headerBuf[6] & 0x7F) << 21) |
                    ((headerBuf[7] & 0x7F) << 14) |
                    ((headerBuf[8] & 0x7F) << 7) |
                    (headerBuf[9] & 0x7F);

    if (tagSize <= 0 || tagSize > 64 * 1024 * 1024) return null;

    const tagBuf = Buffer.alloc(Math.min(tagSize, ID3_READ_MAX, Math.max(0, fileSize - 10)));
    fs.readSync(fd, tagBuf, 0, tagBuf.length, 10);

    const tags = {};
    let pos = 0;

    // Extended header (v2.3: size excludes its own 4 bytes; v2.4: synchsafe size including them).
    if (version >= 3 && (flags & 0x40) && tagBuf.length >= 4) {
        pos = version === 4
            ? (((tagBuf[0] & 0x7F) << 21) | ((tagBuf[1] & 0x7F) << 14) | ((tagBuf[2] & 0x7F) << 7) | (tagBuf[3] & 0x7F))
            : tagBuf.readUInt32BE(0) + 4;
    }

    const idLen = version === 2 ? 3 : 4;
    const frameHeaderSize = version === 2 ? 6 : 10;
    while (pos + frameHeaderSize < tagBuf.length) {
        const frameId = tagBuf.toString('latin1', pos, pos + idLen);
        if (!new RegExp(`^[A-Z0-9]{${idLen}}$`).test(frameId)) break; // padding or garbage
        let frameSize;
        if (version === 2) {
            frameSize = (tagBuf[pos + 3] << 16) | (tagBuf[pos + 4] << 8) | tagBuf[pos + 5];
        } else if (version === 4) {
            frameSize = ((tagBuf[pos + 4] & 0x7F) << 21) | ((tagBuf[pos + 5] & 0x7F) << 14) |
                        ((tagBuf[pos + 6] & 0x7F) << 7) | (tagBuf[pos + 7] & 0x7F);
        } else {
            frameSize = tagBuf.readUInt32BE(pos + 4);
        }
        pos += frameHeaderSize;

        if (frameSize <= 0 || pos + frameSize > tagBuf.length) break;

        const field = ID3_FIELDS[frameId];
        if (field && frameSize > 1 && !tags[field]) {
            try {
                const text = decodeId3Text(tagBuf.subarray(pos, pos + frameSize));
                if (text) tags[field] = text;
            } catch (_) {}
        }
        pos += frameSize;
    }

    if (tags.year) tags.year = tags.year.slice(0, 4);
    return Object.keys(tags).length > 0 ? tags : null;
}

/** Child atoms of an MP4 box: [{type, start, end}] where start is the payload's first byte. */
function mp4Children(buf, from, to) {
    const out = [];
    let pos = from;
    while (pos + 8 <= to) {
        let size = buf.readUInt32BE(pos);
        const type = buf.toString('latin1', pos + 4, pos + 8);
        let header = 8;
        if (size === 1) {
            if (pos + 16 > to) break;
            size = Number(buf.readBigUInt64BE(pos + 8));
            header = 16;
        } else if (size === 0) {
            size = to - pos;
        }
        if (size < header || pos + size > to) break;
        out.push({ type, start: pos + header, end: pos + size });
        pos += size;
    }
    return out;
}

/** iTunes item atoms (`moov/udta/meta/ilst`) we read. */
const MP4_FIELDS = {
    '\u00A9nam': 'title', '\u00A9ART': 'artist', 'aART': 'albumArtist', '\u00A9alb': 'album',
    '\u00A9day': 'year', '\u00A9gen': 'genre', 'trkn': 'track',
};

/**
 * Read iTunes metadata from an MP4 / M4A file (674 of G:\Music's files, the Apple Music snapshot: none had their
 * tags read before Sat 07 Nov 2026). Top-level atoms are walked by seeking, so a `moov` after `mdat` is found
 * without reading the audio; `moov` itself is read whole (capped at 32 MB).
 */
function readMP4(fd, fileSize) {
    if (fileSize < 16) return null;
    const head = Buffer.alloc(16);
    let pos = 0;
    let moov = null;
    while (pos + 8 <= fileSize) {
        fs.readSync(fd, head, 0, 16, pos);
        let size = head.readUInt32BE(0);
        const type = head.toString('latin1', 4, 8);
        if (pos === 0 && type !== 'ftyp') return null;
        let header = 8;
        if (size === 1) { size = Number(head.readBigUInt64BE(8)); header = 16; }
        else if (size === 0) size = fileSize - pos;
        if (size < header) return null;
        if (type === 'moov') {
            const len = Math.min(size - header, 32 * 1024 * 1024, fileSize - pos - header);
            moov = Buffer.alloc(len);
            fs.readSync(fd, moov, 0, len, pos + header);
            break;
        }
        pos += size;
    }
    if (!moov) return null;

    const find = (buf, from, to, type) => mp4Children(buf, from, to).find(a => a.type === type);
    const udta = find(moov, 0, moov.length, 'udta');
    if (!udta) return null;
    const meta = find(moov, udta.start, udta.end, 'meta');
    if (!meta) return null;
    // `meta` is a full box (4 bytes version + flags) in ISO files; QuickTime files have none.
    const metaStart = moov.toString('latin1', meta.start + 4, meta.start + 8) === 'hdlr' ? meta.start : meta.start + 4;
    const ilst = find(moov, metaStart, meta.end, 'ilst');
    if (!ilst) return null;

    const tags = {};
    for (const item of mp4Children(moov, ilst.start, ilst.end)) {
        const field = MP4_FIELDS[item.type];
        if (!field || tags[field]) continue;
        const data = find(moov, item.start, item.end, 'data');
        if (!data || data.end - data.start < 8) continue;
        const value = moov.subarray(data.start + 8, data.end); // after type (4) and locale (4)
        if (field === 'track') {
            if (value.length >= 4) {
                const n = value.readUInt16BE(2);
                const total = value.length >= 6 ? value.readUInt16BE(4) : 0;
                if (n) tags.track = total ? `${n}/${total}` : String(n);
            }
        } else {
            const text = cleanString(value.toString('utf8'));
            if (text) tags[field] = field === 'year' ? text.slice(0, 4) : text;
        }
    }
    return Object.keys(tags).length > 0 ? tags : null;
}

/**
 * Vorbis comments of an Ogg Vorbis / Opus file: the comment packet follows `\x03vorbis` or `OpusTags` near the start.
 * Read from the first 256 KB; a comment packet split across Ogg pages (large embedded art) may be cut.
 */
function readOgg(fd, fileSize) {
    if (fileSize < 32) return null;
    const buf = Buffer.alloc(Math.min(fileSize, 256 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);
    if (buf.toString('latin1', 0, 4) !== 'OggS') return null;
    let i = buf.indexOf('\x03vorbis', 0, 'latin1');
    if (i >= 0) return parseVorbisCommentBuffer(buf, i + 7);
    i = buf.indexOf('OpusTags', 0, 'latin1');
    if (i >= 0) return parseVorbisCommentBuffer(buf, i + 8);
    return null;
}

/**
 * Parse Vorbis comments from a buffer slice.
 */
function parseVorbisCommentBuffer(buf, startOffset) {
    const tags = {};
    try {
        let pos = startOffset;
        if (pos + 4 > buf.length) return null;
        const vendorLen = buf.readUInt32LE(pos);
        pos += 4 + vendorLen;
        if (pos + 4 > buf.length) return null;

        const numComments = buf.readUInt32LE(pos);
        pos += 4;

        for (let i = 0; i < numComments && pos < buf.length; i++) {
            if (pos + 4 > buf.length) break;
            const cLen = buf.readUInt32LE(pos);
            pos += 4;
            if (pos + cLen > buf.length) break;

            const comment = buf.toString('utf8', pos, pos + cLen);
            pos += cLen;

            const eqIdx = comment.indexOf('=');
            if (eqIdx !== -1) {
                const key = comment.substring(0, eqIdx).toUpperCase().trim();
                const val = cleanString(comment.substring(eqIdx + 1));

                if (key === 'TITLE') tags.title = val;
                else if (key === 'ARTIST' && !tags.artist) tags.artist = val;
                else if (key === 'ALBUMARTIST' || key === 'ALBUM ARTIST') tags.albumArtist = val;
                else if (key === 'ALBUM') tags.album = val;
                else if (key === 'DATE' || key === 'YEAR') tags.year = val.split('-')[0];
                else if (key === 'TRACKNUMBER' || key === 'TRACK') tags.track = val;
                else if (key === 'GENRE') tags.genre = val;
            }
        }
    } catch (_) {}
    return Object.keys(tags).length > 0 ? tags : null;
}

/**
 * Read Vorbis comments from FLAC file.
 */
function readFLAC(fd, fileSize) {
    if (fileSize < 8) return null;
    const header = Buffer.alloc(Math.min(fileSize, 256 * 1024));
    fs.readSync(fd, header, 0, header.length, 0);

    if (header.toString('ascii', 0, 4) !== 'fLaC') return null;

    let pos = 4;
    while (pos + 4 < header.length) {
        const isLast = (header[pos] & 0x80) !== 0;
        const blockType = header[pos] & 0x7F;
        const blockLen = (header[pos + 1] << 16) | (header[pos + 2] << 8) | header[pos + 3];
        pos += 4;

        if (blockType === 4) { // VORBIS_COMMENT
            const commentBlock = (pos + blockLen <= header.length)
                ? header
                : (() => {
                    const blockBuf = Buffer.alloc(blockLen);
                    fs.readSync(fd, blockBuf, 0, blockLen, pos);
                    return blockBuf;
                })();
            const start = (pos + blockLen <= header.length) ? pos : 0;
            return parseVorbisCommentBuffer(commentBlock, start);
        }

        pos += blockLen;
        if (isLast) break;
    }
    return null;
}

/**
 * Extract audio metadata from file or fallback to directory structure.
 */
function extractAudioFileMetadata(filePath) {
    const parts = filePath.split(/[\\/]/);
    const filename = parts.pop() || '';
    const albumFolder = parts.pop() || '';
    const artistFolder = parts.pop() || '';
    const ext = path.extname(filePath).toLowerCase();

    const cleanTitle = cleanSongFilename(filename);

    const isIgnoredDir = (dir) => !dir || ['music', 'root', 'downloads', 'unknown album'].includes(dir.toLowerCase()) || /^[a-z]:$/i.test(dir);
    let inferredArtist = !isIgnoredDir(artistFolder) ? artistFolder : '';
    let inferredAlbum = !isIgnoredDir(albumFolder) ? albumFolder : '';

    // If inside Downloads/<Artist - Album>/track.mp3, split the release folder name
    if (!inferredArtist && inferredAlbum && inferredAlbum.includes(' - ')) {
        const splitParts = inferredAlbum.split(' - ');
        inferredArtist = splitParts[0].trim();
        inferredAlbum = splitParts.slice(1).join(' - ').replace(/\s*[\[(](?:19|20)\d{2}[\])].*$/i, '').replace(/\s*(?:320|192|128)[_\s]*kbps.*$/i, '').trim();
    }

    const meta = {
        filePath,
        filename,
        inferredArtist,
        inferredAlbum,
        inferredTitle: cleanTitle,
        embeddedTitle: '',
        embeddedArtist: '',
        embeddedAlbum: '',
        embeddedYear: '',
        embeddedTrack: '',
        embeddedGenre: ''
    };

    try {
        const stats = fs.statSync(filePath);
        const fd = fs.openSync(filePath, 'r');
        try {
            let tags = null;
            if (ext === '.flac') tags = readFLAC(fd, stats.size);
            else if (ext === '.ogg' || ext === '.opus' || ext === '.oga') tags = readOgg(fd, stats.size);
            else if (ext === '.m4a' || ext === '.mp4' || ext === '.m4b' || ext === '.alac') tags = readMP4(fd, stats.size);
            if (!tags) tags = readID3v2(fd, stats.size) || readID3v1(fd, stats.size);
            if (tags) {
                meta.embeddedTitle = tags.title || '';
                meta.embeddedArtist = tags.artist || tags.albumArtist || '';
                meta.embeddedAlbum = tags.album || '';
                meta.embeddedYear = tags.year || '';
                meta.embeddedTrack = tags.track || '';
                meta.embeddedAlbumArtist = tags.albumArtist || '';
                meta.embeddedGenre = tags.genre || '';
            }
        } finally {
            fs.closeSync(fd);
        }
    } catch (_) {}

    meta.effectiveTitle = meta.embeddedTitle || meta.inferredTitle;
    meta.effectiveArtist = meta.embeddedArtist || meta.inferredArtist;
    meta.effectiveAlbum = meta.embeddedAlbum || meta.inferredAlbum;
    meta.effectiveAlbumArtist = meta.embeddedAlbumArtist || (meta.effectiveArtist ? meta.effectiveArtist.split(/[,;&]|\s+feat\.\s+|\s+ft\.\s+/i)[0].trim() : '');

    return meta;
}

module.exports = {
    cleanSongFilename,
    extractAudioFileMetadata,
    readFLAC,
    readID3v2,
    readID3v1,
    readMP4,
    readOgg
};
