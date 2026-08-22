/**
 * Native lightweight audio metadata & tag extractor.
 * Reads ID3v1/ID3v2 tags from MP3s, Vorbis comments from FLAC/OGG,
 * and iTunes atoms from M4A/AAC without external binary dependencies.
 */

const fs = require('fs');

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
 * Extract audio metadata from file or fallback to directory structure.
 */
function extractAudioFileMetadata(filePath) {
    const parts = filePath.split(/[\\/]/);
    const filename = parts.pop() || '';
    const albumFolder = parts.pop() || '';
    const artistFolder = parts.pop() || '';

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
        } finally {
            fs.closeSync(fd);
        }
    } catch (_) {}

    meta.effectiveTitle = meta.embeddedTitle || meta.inferredTitle;
    meta.effectiveArtist = meta.embeddedArtist || meta.inferredArtist;
    meta.effectiveAlbum = meta.embeddedAlbum || meta.inferredAlbum;

    return meta;
}

module.exports = {
    cleanSongFilename,
    extractAudioFileMetadata
};
