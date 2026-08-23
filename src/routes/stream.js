const express = require('express');
const fs = require('fs');
const path = require('path');
const { streamAudioFile } = require('../services/streaming-service');

function createStreamRouter(libraryService) {
    const router = express.Router();

    /**
     * Stream track audio by ID with HTTP Range support.
     */
    router.get('/stream/:trackId', (req, res) => {
        const track = libraryService.getTrack(req.params.trackId);
        if (!track) {
            return res.status(404).json({ error: 'Track not found in library' });
        }
        streamAudioFile(track.filePath, req, res);
    });

    /**
     * Serve album cover image by album ID.
     */
    router.get('/art/:albumId', (req, res) => {
        const album = libraryService.getAlbum(req.params.albumId);
        if (!album || !album.coverPath || !fs.existsSync(album.coverPath)) {
            return res.status(404).json({ error: 'Artwork not found' });
        }
        const ext = path.extname(album.coverPath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(album.coverPath).pipe(res);
    });

    /**
     * Download track audio file directly (e.g. into iOS Files app / iCloud).
     */
    router.get('/download/:trackId', (req, res) => {
        const track = libraryService.getTrack(req.params.trackId);
        if (!track || !fs.existsSync(track.filePath)) {
            return res.status(404).json({ error: 'Track not found in library' });
        }
        const ext = path.extname(track.filePath);
        const downloadName = `${track.artist} - ${track.title}${ext}`.replace(/[<>:"/\\|?*]/g, '_');
        res.download(track.filePath, downloadName);
    });

    return router;
}

module.exports = { createStreamRouter };
