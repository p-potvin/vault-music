const express = require('express');

function createDownloadsRouter(downloadService) {
    const router = express.Router();

    /**
     * Get list of available Jackett indexers.
     */
    router.get('/indexers', async (req, res) => {
        try {
            const indexers = await downloadService.getIndexers();
            res.json(indexers);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Search torrent indexers via Jackett with indexer selection, category, and music filter.
     */
    router.get('/search', async (req, res) => {
        const { q, indexer, category, filterMusic, timeout } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        try {
            const results = await downloadService.searchTorrents(q, {
                indexer: indexer || 'all',
                category: category !== undefined ? category : 3000,
                filterMusic: filterMusic === 'true' || filterMusic === true,
                timeout: timeout ? parseInt(timeout, 10) : 15000
            });
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Send magnet URL or torrent link to local qBittorrent.
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
                category: category || 'music'
            });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Get active download queue from local qBittorrent.
     */
    router.get('/queue', async (req, res) => {
        const { category } = req.query;
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
