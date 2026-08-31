const express = require('express');

function createDownloadsRouter(downloadService, options = {}) {
    const router = express.Router();
    const appleMusicLocalService = options.appleMusicLocalService;
    const localReconstructor = options.localReconstructor;
    const postDownloadProcessor = options.postDownloadProcessor;

    /**
     * Get list of available indexers (Jackett + Lidarr).
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
     * Search releases / indexers via Jackett and Lidarr.
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
     * Get active download queue from local qBittorrent & OVH Lidarr.
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

    /**
     * Lidarr System Status.
     */
    router.get('/lidarr/status', async (req, res) => {
        try {
            const status = await downloadService.lidarrService.getStatus();
            res.json(status);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Lidarr Music (Artist / Album) Search.
     */
    router.get('/lidarr/search', async (req, res) => {
        const { q } = req.query;
        if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });
        try {
            const results = await downloadService.lidarrService.searchMusic(q);
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Grab Release via Lidarr API.
     */
    router.post('/lidarr/grab', async (req, res) => {
        const { guid, indexerId, downloadUrl, title } = req.body;
        if (!guid && !downloadUrl) {
            return res.status(400).json({ error: 'guid or downloadUrl is required' });
        }

        try {
            const result = await downloadService.lidarrService.grabRelease({
                guid,
                indexerId,
                downloadUrl,
                title
            });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================================
    // Apple Music Local Safe Reconstructor & 35 GB Storage Guardrail Routes
    // =========================================================================

    /**
     * Get current 35GB storage quota status for G:\Music
     */
    router.get('/storage-status', (req, res) => {
        if (!localReconstructor) {
            return res.status(500).json({ error: 'Local download reconstructor not configured' });
        }
        res.json(localReconstructor.getLibraryStorageUsage());
    });

    /**
     * Safely snapshot Apple Music library to G:\Music\AppleMusic_Backup and scan playlists.
     */
    router.post('/apple-music-local/backup-and-scan', async (req, res) => {
        if (!appleMusicLocalService) {
            return res.status(500).json({ error: 'Apple Music Local Service not configured' });
        }
        try {
            const snapshotResult = await appleMusicLocalService.createSafeSnapshot();
            const scanResult = await appleMusicLocalService.scanSnapshotPlaylists();
            res.json({
                snapshot: snapshotResult,
                playlists: scanResult.playlists || [],
                totalPlaylists: scanResult.totalPlaylists || 0
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Match a single Apple Music playlist against Jackett with low-quality priority.
     */
    router.post('/apple-music-local/match-playlist', async (req, res) => {
        const { playlist } = req.body;
        if (!playlist) {
            return res.status(400).json({ error: 'Playlist object is required' });
        }
        if (!localReconstructor) {
            return res.status(500).json({ error: 'Local reconstructor not configured' });
        }

        try {
            const matchResult = await localReconstructor.matchPlaylistTracks(playlist);
            res.json(matchResult);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Queue matched releases to local qBittorrent with 35 GB cap and lossless confirmation checks.
     */
    router.post('/apple-music-local/queue-download', async (req, res) => {
        const { releases, allowLossless } = req.body;
        if (!Array.isArray(releases) || releases.length === 0) {
            return res.status(400).json({ error: 'Releases array is required' });
        }
        if (!localReconstructor) {
            return res.status(500).json({ error: 'Local reconstructor not configured' });
        }

        try {
            const results = [];
            for (const rel of releases) {
                const qRes = await localReconstructor.queueDownload(rel, allowLossless === true);
                results.push({
                    title: rel.title || rel.name,
                    quality: rel.quality,
                    ...qRes
                });
            }

            const successCount = results.filter(r => r.success).length;
            const blockedCount = results.filter(r => r.guardrailBlocked || r.confirmationRequired).length;

            res.json({
                total: releases.length,
                successCount,
                blockedCount,
                results
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Post-download MusicBrainz processor: tags newly downloaded tracks and adds them to library.
     */
    router.post('/post-process', async (req, res) => {
        if (!postDownloadProcessor) {
            return res.status(500).json({ error: 'Post-download processor not configured' });
        }
        try {
            const result = await postDownloadProcessor.processCompletedDownloads();
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

module.exports = { createDownloadsRouter };
