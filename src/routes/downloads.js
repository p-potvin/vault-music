const express = require('express');

function createDownloadsRouter(downloadService) {
    const router = express.Router();

    /**
     * Search torrent indexers (Jackett / Comet) for audio releases.
     */
    router.get('/search', async (req, res) => {
        const { q, category } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        try {
            const results = await downloadService.searchTorrents(q, {
                category: category ? parseInt(category, 10) : 3000
            });
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Send magnet URL or torrent link to qBittorrent.
     */
    router.post('/add', async (req, res) => {
        const { magnetUrl, torrentUrl, savePath, category } = req.body;
        if (!magnetUrl && !torrentUrl) {
            return res.status(400).json({ error: 'magnetUrl or torrentUrl is required' });
        }

        try {
            const result = await downloadService.addDownload({
                magnetUrl,
                torrentUrl,
                savePath,
                category
            });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Get active download queue from qBittorrent.
     */
    router.get('/queue', async (req, res) => {
        const { category = 'music' } = req.query;
        try {
            const result = await downloadService.getDownloadQueue({ category });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

module.exports = { createDownloadsRouter };
