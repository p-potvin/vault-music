const express = require('express');

function createMetadataRouter(metadataService, libraryService) {
    const router = express.Router();

    /**
     * Get current status of metadata processor and local DB.
     */
    router.get('/status', (req, res) => {
        res.json(metadataService.getStatus());
    });

    /**
     * Match a single track path or track ID.
     */
    router.post('/match-track', async (req, res) => {
        const { trackId, filePath } = req.body;
        let targetPath = filePath;

        if (trackId && !targetPath) {
            const track = libraryService.getTrack(trackId);
            if (!track) return res.status(404).json({ error: 'Track not found' });
            targetPath = track.filePath;
        }

        if (!targetPath) {
            return res.status(400).json({ error: 'trackId or filePath is required' });
        }

        try {
            const result = await metadataService.matchSingleTrack(targetPath);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Trigger batch population of library tracks with MusicBrainz metadata and artwork.
     */
    router.post('/populate', (req, res) => {
        const { downloadArt = true, writeNfo = true, writeJson = true, limit = 0 } = req.body;
        let tracks = libraryService.tracks;

        if (tracks.length === 0) {
            libraryService.scanLibrary();
            tracks = libraryService.tracks;
        }

        if (limit > 0 && limit < tracks.length) {
            tracks = tracks.slice(0, limit);
        }

        const run = metadataService.populateLibrary(tracks, { downloadArt, writeNfo, writeJson });
        res.json(run);
    });

    return router;
}

module.exports = { createMetadataRouter };
