const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ProfileService {
    constructor(dataPath = path.join(__dirname, '..', '..', 'data', 'vault_music_data.json')) {
        this.dataPath = path.resolve(dataPath);
        this.data = {
            profiles: {}, // deviceId -> Profile
            playlists: {} // playlistId -> Playlist
        };
        this._loadData();
    }

    _loadData() {
        try {
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            if (fs.existsSync(this.dataPath)) {
                const raw = fs.readFileSync(this.dataPath, 'utf8');
                this.data = JSON.parse(raw);
                if (!this.data.profiles) this.data.profiles = {};
                if (!this.data.playlists) this.data.playlists = {};
            } else {
                this._saveData();
            }
        } catch (err) {
            console.warn('Failed to load profile data, using in-memory store:', err.message);
        }
    }

    _saveData() {
        try {
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (err) {
            console.error('Failed to save profile data:', err.message);
        }
    }

    generateId(prefix = 'id') {
        return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Resolve device ID from Tailscale headers, client IP, or explicit client device token.
     */
    resolveDeviceId(req) {
        if (req.headers['x-device-id']) return req.headers['x-device-id'];
        if (req.query && req.query.device_id) return req.query.device_id;
        
        const tailscaleLogin = req.headers['tailscale-user-login'];
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const ua = req.headers['user-agent'] || 'unknown';

        let deviceName = 'Device';
        if (/iPhone/i.test(ua)) deviceName = 'iPhone';
        else if (/iPad/i.test(ua)) deviceName = 'iPad';
        else if (/Android/i.test(ua)) deviceName = 'Android Phone';
        else if (/Macintosh/i.test(ua)) deviceName = 'Mac';
        else if (/Windows/i.test(ua)) deviceName = 'Windows PC';

        const hash = crypto.createHash('md5').update(`${ip}-${ua}`).digest('hex').slice(0, 8);
        return {
            deviceId: `ts-${hash}`,
            suggestedName: tailscaleLogin ? `${tailscaleLogin} (${deviceName})` : `${deviceName} (${ip})`,
            clientIp: ip
        };
    }

    getOrCreateProfile(deviceId, suggestedName = 'My Device', clientIp = '') {
        if (!this.data.profiles[deviceId]) {
            this.data.profiles[deviceId] = {
                deviceId,
                name: suggestedName,
                clientIp,
                createdAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                homeView: {
                    pinnedPlaylistIds: [],
                    favoriteTrackIds: [],
                    recentTrackIds: [],
                    preferredTab: 'tracks'
                }
            };
            this._saveData();
        } else {
            this.data.profiles[deviceId].lastSeen = new Date().toISOString();
            if (clientIp) this.data.profiles[deviceId].clientIp = clientIp;
        }
        return this.data.profiles[deviceId];
    }

    listProfiles() {
        return Object.values(this.data.profiles);
    }

    updateProfile(deviceId, { name, homeView } = {}) {
        const profile = this.getOrCreateProfile(deviceId);
        if (name) profile.name = name.trim();
        if (homeView) {
            profile.homeView = {
                ...profile.homeView,
                ...homeView
            };
        }
        this._saveData();
        return profile;
    }

    cloneDeviceView(targetDeviceId, sourceDeviceId) {
        const source = this.data.profiles[sourceDeviceId];
        if (!source) throw new Error(`Source device profile "${sourceDeviceId}" not found`);

        const target = this.getOrCreateProfile(targetDeviceId);
        target.homeView = JSON.parse(JSON.stringify(source.homeView));
        this._saveData();
        return target;
    }

    toggleFavorite(deviceId, trackId) {
        const profile = this.getOrCreateProfile(deviceId);
        const favs = new Set(profile.homeView.favoriteTrackIds || []);
        let isFavorite = false;

        if (favs.has(trackId)) {
            favs.delete(trackId);
        } else {
            favs.add(trackId);
            isFavorite = true;
        }

        profile.homeView.favoriteTrackIds = Array.from(favs);
        this._saveData();
        return { isFavorite, favoriteTrackIds: profile.homeView.favoriteTrackIds };
    }

    // =========================================================================
    // Shared Playlists Management
    // =========================================================================

    listPlaylists() {
        return Object.values(this.data.playlists).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    getPlaylist(id) {
        return this.data.playlists[id] || null;
    }

    createPlaylist({ name, ownerDeviceId = 'system', ownerName = 'Shared User', trackIds = [] }) {
        const id = this.generateId('pl');
        const now = Date.now();
        const playlist = {
            id,
            name: name.trim() || 'Untitled Playlist',
            ownerDeviceId,
            ownerName,
            trackIds: Array.isArray(trackIds) ? trackIds : [],
            createdAt: now,
            updatedAt: now
        };
        this.data.playlists[id] = playlist;
        this._saveData();
        return playlist;
    }

    updatePlaylist(id, { name, trackIds }) {
        const playlist = this.data.playlists[id];
        if (!playlist) return null;

        if (name !== undefined) playlist.name = name.trim();
        if (Array.isArray(trackIds)) playlist.trackIds = trackIds;
        playlist.updatedAt = Date.now();

        this._saveData();
        return playlist;
    }

    deletePlaylist(id) {
        if (!this.data.playlists[id]) return false;
        delete this.data.playlists[id];

        // Clean up from pinned playlists
        for (const prof of Object.values(this.data.profiles)) {
            if (prof.homeView && Array.isArray(prof.homeView.pinnedPlaylistIds)) {
                prof.homeView.pinnedPlaylistIds = prof.homeView.pinnedPlaylistIds.filter(pid => pid !== id);
            }
        }

        this._saveData();
        return true;
    }

    addTrackToPlaylist(playlistId, trackId) {
        const playlist = this.data.playlists[playlistId];
        if (!playlist) return null;

        if (!playlist.trackIds.includes(trackId)) {
            playlist.trackIds.push(trackId);
            playlist.updatedAt = Date.now();
            this._saveData();
        }
        return playlist;
    }

    removeTrackFromPlaylist(playlistId, trackId) {
        const playlist = this.data.playlists[playlistId];
        if (!playlist) return null;

        playlist.trackIds = playlist.trackIds.filter(id => id !== trackId);
        playlist.updatedAt = Date.now();
        this._saveData();
        return playlist;
    }
}

module.exports = { ProfileService };
