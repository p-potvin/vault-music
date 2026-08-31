const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { LidarrService } = require('./lidarr-service');

class DownloadService {
    constructor(options = {}) {
        this.jackettUrl = options.jackettUrl || config.JACKETT_URL;
        this.jackettApiKey = options.jackettApiKey || config.JACKETT_API_KEY;
        this.qbittorrentUrl = options.qbittorrentUrl || config.QBITTORRENT_URL;
        this.qbittorrentUser = options.qbittorrentUser || config.QBITTORRENT_USER;
        this.qbittorrentPass = options.qbittorrentPass || config.QBITTORRENT_PASS;
        this.downloadsDir = options.downloadsDir || config.DOWNLOADS_DIR;
        this.lidarrService = new LidarrService({
            lidarrUrl: options.lidarrUrl || config.LIDARR_URL,
            apiKey: options.lidarrApiKey || config.LIDARR_API_KEY
        });
        this.qbitCookie = null;
    }

    _request(url, reqOptions = {}) {
        return new Promise((resolve) => {
            const parsedUrl = new URL(url);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;

            const opts = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: reqOptions.method || 'GET',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
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
                        headers: res.headers
                    });
                });
            });

            req.on('error', (err) => resolve({ error: err.message }));
            req.setTimeout(reqOptions.timeout || 12000, () => {
                req.destroy();
                resolve({ error: 'Request timeout' });
            });

            if (reqOptions.body) {
                req.write(reqOptions.body);
            }
            req.end();
        });
    }

    /**
     * Get list of configured Jackett indexers on this machine.
     */
    async getIndexers() {
        const indexers = [
            { id: 'all', name: 'All Configured Indexers' },
            { id: 'lidarr', name: 'Lidarr (OVH Media Stack)' }
        ];

        // Check Jackett Indexers directory on Windows
        const indexersDir = 'C:\\ProgramData\\Jackett\\Indexers';
        if (fs.existsSync(indexersDir)) {
            try {
                const files = fs.readdirSync(indexersDir);
                for (const file of files) {
                    if (file.endsWith('.json') && !file.endsWith('.bak')) {
                        const id = file.replace('.json', '');
                        const cleanName = id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        indexers.push({ id, name: cleanName });
                    }
                }
            } catch (_) {}
        }

        return indexers;
    }

    /**
     * Search torrents / releases via Jackett and/or Lidarr.
     */
    async searchTorrents(query, { indexer = 'all', category = 3000, filterMusic = false, timeout = 12000 } = {}) {
        let results = [];

        // If indexer is explicitly 'lidarr', search Lidarr releases only
        if (indexer === 'lidarr') {
            const lidarrRes = await this.lidarrService.searchReleases(query);
            return {
                query,
                indexer: 'lidarr',
                category,
                filterMusic,
                total: lidarrRes.total || 0,
                results: lidarrRes.results || []
            };
        }

        // 1. Search Jackett
        if (this.jackettUrl && this.jackettApiKey) {
            const targetIndexer = indexer || 'all';
            let endpoint = `${this.jackettUrl}/api/v2.0/indexers/${encodeURIComponent(targetIndexer)}/results?apikey=${encodeURIComponent(this.jackettApiKey)}&Query=${encodeURIComponent(query)}`;

            if (category && category !== 'all' && category !== '0') {
                endpoint += `&Category=${encodeURIComponent(category)}`;
            }

            const res = await this._request(endpoint, { timeout });
            if (!res.error && res.data && Array.isArray(res.data.Results)) {
                const jackettResults = res.data.Results.map(item => ({
                    title: item.Title,
                    tracker: item.Tracker,
                    size: item.Size,
                    formattedSize: this._formatBytes(item.Size),
                    seeders: item.Seeders || 0,
                    leechers: item.Peers || 0,
                    categoryDesc: item.CategoryDesc || 'Audio',
                    publishDate: item.PublishDate,
                    magnetUri: item.MagnetUri || null,
                    link: item.Link || null,
                    source: 'jackett'
                }));
                results.push(...jackettResults);
            }
        }

        // 2. If indexer is 'all', also query Lidarr releases as supplemental provider
        if (indexer === 'all') {
            try {
                const lidarrRes = await this.lidarrService.searchReleases(query);
                if (lidarrRes && Array.isArray(lidarrRes.results)) {
                    results.push(...lidarrRes.results);
                }
            } catch (_) {}
        }

        // Server-side music filter fallback
        if (filterMusic) {
            const musicRegex = /\b(flac|mp3|320kbps|320|lossless|alac|aac|wav|ogg|vinyl|cd|discography|album|ep|single|remaster|soundtrack|ost|audio)\b/i;
            const videoExcludeRegex = /\b(1080p|720p|2160p|4k|hdr|hevc|x264|x265|bluray|bdrip|webrip|dvdrip|hdtv|s\d{2}e\d{2}|season\s*\d+)\b/i;

            results = results.filter(r => {
                const title = r.title || '';
                const isAudioCat = (r.categoryDesc || '').toLowerCase().includes('audio') || (r.categoryDesc || '').toLowerCase().includes('music');
                if (isAudioCat) return true;
                return musicRegex.test(title) && !videoExcludeRegex.test(title);
            });
        }

        // Deduplicate by title/guid and sort by seeders descending
        const seen = new Set();
        const uniqueResults = [];
        for (const r of results) {
            const key = (r.title || '').trim().toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(r);
            }
        }

        uniqueResults.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));

        return {
            query,
            indexer: indexer || 'all',
            category,
            filterMusic,
            total: uniqueResults.length,
            results: uniqueResults
        };
    }

    _formatBytes(bytes) {
        if (!bytes || isNaN(bytes)) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Authenticate with local qBittorrent and store session cookie.
     */
    async _ensureQbitAuth() {
        if (!this.qbittorrentUser || !this.qbittorrentPass) return true;

        const loginUrl = `${this.qbittorrentUrl}/api/v2/auth/login`;
        const postData = `username=${encodeURIComponent(this.qbittorrentUser)}&password=${encodeURIComponent(this.qbittorrentPass)}`;

        const res = await this._request(loginUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            },
            body: postData
        });

        if (res.headers && res.headers['set-cookie']) {
            const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie']];
            const sidCookie = cookies.find(c => c.startsWith('SID='));
            if (sidCookie) {
                this.qbitCookie = sidCookie.split(';')[0];
            }
        }

        return res.status === 200 && res.raw && res.raw.includes('Ok.');
    }

    /**
     * Send magnet link or torrent URL to local qBittorrent.
     */
    async addDownload({ magnetUrl, torrentUrl, savePath = this.downloadsDir, category = 'music' }) {
        if (!magnetUrl && !torrentUrl) {
            return { success: false, error: 'magnetUrl or torrentUrl is required' };
        }

        await this._ensureQbitAuth();

        const targetUrl = magnetUrl || torrentUrl;
        const addEndpoint = `${this.qbittorrentUrl}/api/v2/torrents/add`;

        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        let body = '';

        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="urls"\r\n\r\n`;
        body += `${targetUrl}\r\n`;

        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="savepath"\r\n\r\n`;
        body += `${savePath}\r\n`;

        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="category"\r\n\r\n`;
        body += `${category}\r\n`;

        body += `--${boundary}--\r\n`;

        const headers = {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': Buffer.byteLength(body)
        };
        if (this.qbitCookie) headers['Cookie'] = this.qbitCookie;

        const res = await this._request(addEndpoint, {
            method: 'POST',
            headers,
            body
        });

        if (res.error) {
            return { success: false, error: res.error };
        }

        return {
            success: res.status === 200,
            status: res.status,
            message: res.status === 200 ? 'Torrent added to qBittorrent queue' : 'qBittorrent response received',
            raw: res.raw || res.data
        };
    }

    /**
     * Get active download queue from both local qBittorrent and OVH Lidarr.
     */
    async getDownloadQueue({ category = '' } = {}) {
        const items = [];

        // 1. Fetch qBittorrent queue
        try {
            await this._ensureQbitAuth();
            let url = `${this.qbittorrentUrl}/api/v2/torrents/info`;
            if (category) url += `?category=${encodeURIComponent(category)}`;

            const headers = {};
            if (this.qbitCookie) headers['Cookie'] = this.qbitCookie;

            const res = await this._request(url, { headers });
            if (!res.error && Array.isArray(res.data)) {
                const qbItems = res.data.map(t => ({
                    id: t.hash,
                    name: t.name,
                    size: t.size,
                    formattedSize: this._formatBytes(t.size),
                    progress: (t.progress * 100).toFixed(1) + '%',
                    progressPct: Math.round(t.progress * 100),
                    downloadSpeed: this._formatBytes(t.dlspeed) + '/s',
                    uploadSpeed: this._formatBytes(t.upspeed) + '/s',
                    state: t.state,
                    eta: t.eta,
                    category: t.category,
                    savePath: t.save_path,
                    source: 'qbittorrent'
                }));
                items.push(...qbItems);
            }
        } catch (_) {}

        // 2. Fetch Lidarr queue
        try {
            const lidarrQueue = await this.lidarrService.getQueue();
            if (lidarrQueue && Array.isArray(lidarrQueue.items)) {
                items.push(...lidarrQueue.items);
            }
        } catch (_) {}

        return {
            success: true,
            total: items.length,
            items
        };
    }
}

module.exports = { DownloadService };
