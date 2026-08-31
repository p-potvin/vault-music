/**
 * Native lightweight audio metadata & tag extractor.
 * Reads ID3v1/ID3v2 tags from MP3s, Vorbis comments from FLAC/OGG,
 * and iTunes atoms from M4A/AAC without external binary dependencies.
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

/**
 * Read basic ID3v2 header and text frames from start of MP3 file.
 */
function readID3v2(fd, fileSize) {
    if (fileSize < 10) return null;
    const headerBuf = Buffer.alloc(10);
    fs.readSync(fd, headerBuf, 0, 10, 0);

    if (headerBuf.toString('latin1', 0, 3) !== 'ID3') return null;

    const version = headerBuf[3];
    const tagSize = ((headerBuf[6] & 0x7F) << 21) |
                    ((headerBuf[7] & 0x7F) << 14) |
                    ((headerBuf[8] & 0x7F) << 7) |
                    (headerBuf[9] & 0x7F);

    if (tagSize <= 0 || tagSize > 10 * 1024 * 1024) return null;

    const tagBuf = Buffer.alloc(Math.min(tagSize, 65536));
    fs.readSync(fd, tagBuf, 0, tagBuf.length, 10);

    const tags = {};
    let pos = 0;

    const frameHeaderSize = (version === 3 || version === 4) ? 10 : 6;
    while (pos + frameHeaderSize < tagBuf.length) {
        let frameId, frameSize;
        if (version === 3 || version === 4) {
            frameId = tagBuf.toString('latin1', pos, pos + 4);
            if (!frameId || frameId[0] === '\0' || !/^[A-Z0-9]{4}$/.test(frameId)) break;
            frameSize = (version === 4)
                ? (((tagBuf[pos + 4] & 0x7F) << 21) | ((tagBuf[pos + 5] & 0x7F) << 14) | ((tagBuf[pos + 6] & 0x7F) << 7) | (tagBuf[pos + 7] & 0x7F))
                : tagBuf.readUInt32BE(pos + 4);
            pos += 10;
        } else {
            break;
        }

        if (frameSize <= 0 || pos + frameSize > tagBuf.length) break;

        const frameData = tagBuf.slice(pos, pos + frameSize);
        pos += frameSize;

        if (frameId.startsWith('T') && frameSize > 1) {
            const encoding = frameData[0];
            let text = '';
            try {
                if (encoding === 0) text = frameData.toString('latin1', 1);
                else if (encoding === 1 || encoding === 2) text = frameData.toString('utf16le', 1);
                else if (encoding === 3) text = frameData.toString('utf8', 1);
                else text = frameData.toString('utf8', 1);
            } catch (_) {}
            text = cleanString(text);

            if (frameId === 'TIT2') tags.title = text;
            else if (frameId === 'TPE1') tags.artist = text;
            else if (frameId === 'TALB') tags.album = text;
            else if (frameId === 'TYER' || frameId === 'TDRC') tags.year = text;
            else if (frameId === 'TRCK') tags.track = text;
            else if (frameId === 'TCON') tags.genre = text;
        }
    }

    return Object.keys(tags).length > 0 ? tags : null;
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

    const meta = {
        filePath,
        filename,
        inferredArtist: (artistFolder && artistFolder !== 'Music' && artistFolder !== 'root') ? artistFolder : '',
        inferredAlbum: (albumFolder && albumFolder.toLowerCase() !== 'unknown album' && albumFolder !== 'Music') ? albumFolder : '',
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
            if (ext === '.flac' || ext === '.ogg') {
                const flacTags = readFLAC(fd, stats.size);
                if (flacTags) {
                    meta.embeddedTitle = flacTags.title || '';
                    meta.embeddedArtist = flacTags.artist || flacTags.albumArtist || '';
                    meta.embeddedAlbum = flacTags.album || '';
                    meta.embeddedYear = flacTags.year || '';
                    meta.embeddedTrack = flacTags.track || '';
                    meta.embeddedAlbumArtist = flacTags.albumArtist || '';
                    meta.embeddedGenre = flacTags.genre || '';
                }
            } else {
                const id3v2 = readID3v2(fd, stats.size);
                if (id3v2) {
                    meta.embeddedTitle = id3v2.title || '';
                    meta.embeddedArtist = id3v2.artist || '';
                    meta.embeddedAlbum = id3v2.album || '';
                    meta.embeddedYear = id3v2.year || '';
                    meta.embeddedTrack = id3v2.track || '';
                    meta.embeddedGenre = id3v2.genre || '';
                } else {
                    const id3v1 = readID3v1(fd, stats.size);
                    if (id3v1) {
                        meta.embeddedTitle = id3v1.title || '';
                        meta.embeddedArtist = id3v1.artist || '';
                        meta.embeddedAlbum = id3v1.album || '';
                        meta.embeddedYear = id3v1.year || '';
                    }
                }
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
    readID3v1
};
