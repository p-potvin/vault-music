const express = require('express');

function createProfilesRouter(profileService, libraryService) {
    const router = express.Router();

    // Middleware to extract device ID
    function getDeviceContext(req) {
        let deviceId = req.headers['x-device-id'] || req.query.device_id;
        let suggestedName = 'My Device';
        let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

        if (!deviceId) {
            const resolved = profileService.resolveDeviceId(req);
            deviceId = resolved.deviceId;
            suggestedName = resolved.suggestedName;
            clientIp = resolved.clientIp;
        }

        const profile = profileService.getOrCreateProfile(deviceId, suggestedName, clientIp);
        return { deviceId, profile };
    }

    /**
     * Get current device profile and custom homeView.
     */
    router.get('/me', (req, res) => {
        const { profile } = getDeviceContext(req);
        res.json(profile);
    });

    /**
     * Update current device profile (name, homeView layout, pinned items).
     */
    router.post('/me', (req, res) => {
        const { deviceId } = getDeviceContext(req);
        const { name, homeView } = req.body;
        const updated = profileService.updateProfile(deviceId, { name, homeView });
        res.json(updated);
    });

    /**
     * List all connected Tailscale devices/profiles (for the Clone View picker).
     */
    router.get('/', (req, res) => {
        res.json(profileService.listProfiles());
    });

    /**
     * Duplicate home screen view & preferences from another device.
     */
    router.post('/clone-view', (req, res) => {
        const { deviceId } = getDeviceContext(req);
        const { sourceDeviceId } = req.body;

        if (!sourceDeviceId) {
            return res.status(400).json({ error: 'sourceDeviceId is required' });
        }

        try {
            const cloned = profileService.cloneDeviceView(deviceId, sourceDeviceId);
            res.json({ success: true, profile: cloned });
        } catch (err) {
            res.status(404).json({ error: err.message });
        }
    });

    /**
     * Toggle favorite track for this device.
     */
    router.post('/favorite', (req, res) => {
        const { deviceId } = getDeviceContext(req);
        const { trackId } = req.body;
        if (!trackId) return res.status(400).json({ error: 'trackId is required' });

        const result = profileService.toggleFavorite(deviceId, trackId);
        res.json(result);
    });

    // =========================================================================
    // Shared Playlists Endpoints
    // =========================================================================

    /**
     * List all shared playlists.
     */
    router.get('/playlists/all', (req, res) => {
        const playlists = profileService.listPlaylists();
        res.json(playlists);
    });

    /**
     * Create a new shared playlist.
     */
    router.post('/playlists', (req, res) => {
        const { deviceId, profile } = getDeviceContext(req);
        const { name, trackIds } = req.body;

        const playlist = profileService.createPlaylist({
            name,
            ownerDeviceId: deviceId,
            ownerName: profile.name,
            trackIds
        });
        res.status(201).json(playlist);
    });

    /**
     * Get playlist details and resolve all track objects.
     */
    router.get('/playlists/:id', (req, res) => {
        const playlist = profileService.getPlaylist(req.params.id);
        if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

        const resolvedTracks = playlist.trackIds
            .map(id => libraryService.getTrack(id))
            .filter(Boolean);

        res.json({
            ...playlist,
            trackCount: resolvedTracks.length,
            tracks: resolvedTracks
        });
    });

    /**
     * Update playlist.
     */
    router.put('/playlists/:id', (req, res) => {
        const { name, trackIds } = req.body;
        const updated = profileService.updatePlaylist(req.params.id, { name, trackIds });
        if (!updated) return res.status(404).json({ error: 'Playlist not found' });
        res.json(updated);
    });

    /**
     * Delete playlist.
     */
    router.delete('/playlists/:id', (req, res) => {
        const ok = profileService.deletePlaylist(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Playlist not found' });
        res.json({ success: true });
    });

    /**
     * Add track to playlist.
     */
    router.post('/playlists/:id/tracks', (req, res) => {
        const { trackId } = req.body;
        if (!trackId) return res.status(400).json({ error: 'trackId is required' });

        const updated = profileService.addTrackToPlaylist(req.params.id, trackId);
        if (!updated) return res.status(404).json({ error: 'Playlist not found' });
        res.json(updated);
    });

    /**
     * Remove track from playlist.
     */
    router.delete('/playlists/:id/tracks/:trackId', (req, res) => {
        const updated = profileService.removeTrackFromPlaylist(req.params.id, req.params.trackId);
        if (!updated) return res.status(404).json({ error: 'Playlist not found' });
        res.json(updated);
    });

    return router;
}

module.exports = { createProfilesRouter };
