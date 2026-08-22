const fs = require('fs');
const path = require('path');

const MIME_MAP = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.aac': 'audio/aac',
    '.wma': 'audio/x-ms-wma',
    '.aiff': 'audio/aiff'
};

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * Stream an audio file to an HTTP response supporting standard HTTP Range requests.
 */
function streamAudioFile(filePath, req, res) {
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Audio file not found' });
    }

    let stats;
    try {
        stats = fs.statSync(filePath);
    } catch (err) {
        return res.status(500).json({ error: 'Failed to access audio file' });
    }

    const fileSize = stats.size;
    const contentType = getMimeType(filePath);
    const range = req.headers.range;

    if (range) {
        // Parse "bytes=start-end"
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (isNaN(start) || isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
            res.status(416).set({
                'Content-Range': `bytes */${fileSize}`
            });
            return res.end();
        }

        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
            'Cache-Control': 'no-cache'
        });

        fileStream.pipe(res);
        fileStream.on('error', (err) => {
            if (!res.headersSent) res.status(500).end();
        });
    } else {
        // Send entire file
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Accept-Ranges': 'bytes',
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600'
        });

        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        fileStream.on('error', (err) => {
            if (!res.headersSent) res.status(500).end();
        });
    }
}

module.exports = {
    streamAudioFile,
    getMimeType
};
