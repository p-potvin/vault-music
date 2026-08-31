const http = require('http');
const https = require('https');
const config = require('../config');

class LidarrService {
    constructor(options = {}) {
        this.lidarrUrl = options.lidarrUrl || config.LIDARR_URL || 'http://100.67.25.118:8686';
        this.apiKey = options.apiKey || config.LIDARR_API_KEY || '5745e80062e14564a786f4d155ae250e';
    }

    _request(endpoint, reqOptions = {}) {
        return new Promise((resolve) => {
            try {
                const fullUrl = new URL(endpoint.startsWith('http') ? endpoint : `${this.lidarrUrl}${endpoint}`);
                const protocol = fullUrl.protocol === 'https:' ? https : http;

                const opts = {
                    hostname: fullUrl.hostname,
                    port: fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 80),
                    path: fullUrl.pathname + fullUrl.search,
                    method: reqOptions.method || 'GET',
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'X-Api-Key': this.apiKey,
                        ...(reqOptions.headers || {})
                    }
                };

                const req = protocol.request(opts, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        let parsedJson = null;
                        try {
                            parsedJson = JSON.parse(data);
                        } catch (_) {}
                        resolve({
                            status: res.statusCode,
                            data: parsedJson,
                            raw: data,
                            headers: res.headers,
                            ok: res.statusCode >= 200 && res.statusCode < 300
                        });
                    });
                });

                req.on('error', (err) => resolve({ ok: false, error: err.message }));
                req.setTimeout(reqOptions.timeout || 12000, () => {
                    req.destroy();
                    resolve({ ok: false, error: 'Request timeout' });
                });

                if (reqOptions.body) {
                    req.write(typeof reqOptions.body === 'string' ? reqOptions.body : JSON.stringify(reqOptions.body));
                }
                req.end();
            } catch (err) {
                resolve({ ok: false, error: err.message });
            }
        });
    }

    _formatBytes(bytes) {
        if (!bytes || isNaN(bytes)) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Check Lidarr health and system status.
     */
    async getStatus() {
        const res = await this._request('/api/v1/system/status');
        if (!res.ok) {
            return { online: false, error: res.error || `HTTP ${res.status}` };
        }
        return {
            online: true,
            appName: res.data?.appName || 'Lidarr',
            version: res.data?.version,
            branch: res.data?.branch,
            url: this.lidarrUrl
        };
    }

    /**
     * Search artists / albums on Lidarr.
     */
    async searchMusic(term) {
        if (!term) return [];
        const res = await this._request(`/api/v1/search?term=${encodeURIComponent(term)}`);
        if (!res.ok || !Array.isArray(res.data)) return [];

        return res.data.map(item => {
            if (item.album) {
                const alb = item.album || {};
                const art = alb.artist || item.artist || {};
                return {
                    type: 'album',
                    id: alb.foreignAlbumId || item.foreignId,
                    title: alb.title,
                    artistName: art.artistName || 'Unknown Artist',
                    foreignArtistId: art.foreignArtistId,
                    releaseDate: alb.releaseDate ? alb.releaseDate.split('T')[0] : null,
                    coverUrl: alb.remoteCover || (alb.images && alb.images[0]?.url) || null,
                    genres: alb.genres || art.genres || [],
                    ratings: alb.ratings || null
                };
            } else if (item.artist || item.artistName) {
                const art = item.artist || item;
                return {
                    type: 'artist',
                    id: art.foreignArtistId || item.foreignId,
                    artistName: art.artistName,
                    overview: art.overview,
                    disambiguation: art.disambiguation,
                    genres: art.genres || [],
                    posterUrl: art.remotePoster || (art.images && art.images[0]?.url) || null,
                    ratings: art.ratings || null
                };
            }
            return {
                type: 'unknown',
                id: item.foreignId || item.id,
                title: item.title || item.name
            };
        });
    }

    /**
     * Search releases / indexers via Lidarr release search endpoint.
     */
    async searchReleases(term) {
        if (!term) return { query: term, total: 0, results: [] };
        const res = await this._request(`/api/v1/release?term=${encodeURIComponent(term)}`, { timeout: 15000 });
        if (!res.ok) {
            return { query: term, total: 0, results: [], error: res.error || `HTTP ${res.status}` };
        }

        const raw = Array.isArray(res.data) ? res.data : [];
        const results = raw.map(r => ({
            title: r.title,
            guid: r.guid,
            indexerId: r.indexerId,
            indexer: r.indexer || 'Lidarr Indexer',
            size: r.size,
            formattedSize: this._formatBytes(r.size),
            seeders: r.seeders || 0,
            leechers: r.leechers || 0,
            protocol: r.protocol || 'torrent',
            quality: r.quality?.quality?.name || 'Standard',
            downloadUrl: r.downloadUrl,
            magnetUrl: r.magnetUrl || (r.downloadUrl && r.downloadUrl.startsWith('magnet:') ? r.downloadUrl : null),
            publishDate: r.publishDate,
            source: 'lidarr',
            approved: r.approved !== false
        }));

        results.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));

        return {
            query: term,
            total: results.length,
            results
        };
    }

    /**
     * Grab a release via Lidarr API to download it through the media stack.
     */
    async grabRelease(release) {
        if (!release || (!release.guid && !release.downloadUrl)) {
            return { success: false, error: 'Release guid or downloadUrl is required' };
        }

        const res = await this._request('/api/v1/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: {
                guid: release.guid,
                indexerId: release.indexerId || 0,
                downloadUrl: release.downloadUrl,
                title: release.title
            }
        });

        if (!res.ok) {
            return { success: false, error: res.error || `HTTP ${res.status}: ${res.raw}` };
        }

        return {
            success: true,
            status: res.status,
            message: 'Release grabbed successfully in Lidarr',
            data: res.data
        };
    }

    /**
     * Get active download queue from Lidarr.
     */
    async getQueue() {
        const res = await this._request('/api/v1/queue?includeUnknownArtistItems=true');
        if (!res.ok) {
            return { success: false, error: res.error || `HTTP ${res.status}`, items: [] };
        }

        const records = Array.isArray(res.data?.records) ? res.data.records : (Array.isArray(res.data) ? res.data : []);
        const items = records.map(q => ({
            id: q.id,
            name: q.title || q.artist?.artistName || 'Audio Download',
            size: q.size,
            formattedSize: this._formatBytes(q.size),
            sizeleft: q.sizeleft,
            progress: q.size > 0 ? (((q.size - q.sizeleft) / q.size) * 100).toFixed(1) + '%' : '0%',
            progressPct: q.size > 0 ? Math.round(((q.size - q.sizeleft) / q.size) * 100) : 0,
            status: q.status,
            trackedDownloadStatus: q.trackedDownloadStatus,
            timeleft: q.timeleft,
            estimatedCompletionTime: q.estimatedCompletionTime,
            indexer: q.indexer,
            downloadClient: q.downloadClient,
            source: 'lidarr'
        }));

        return {
            success: true,
            total: items.length,
            items
        };
    }
}

module.exports = { LidarrService };
