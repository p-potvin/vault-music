const http = require('http');
const https = require('https');
const config = require('../config');

class DownloadService {
    constructor(options = {}) {
        this.jackettUrl = options.jackettUrl || config.JACKETT_URL;
        this.jackettApiKey = options.jackettApiKey || config.JACKETT_API_KEY;
        this.cometUrl = options.cometUrl || config.COMET_URL;
        this.qbittorrentUrl = options.qbittorrentUrl || config.QBITTORRENT_URL;
        this.qbittorrentUser = options.qbittorrentUser || config.QBITTORRENT_USER;
        this.qbittorrentPass = options.qbittorrentPass || config.QBITTORRENT_PASS;
        this.downloadsDir = options.downloadsDir || config.DOWNLOADS_DIR;
    }

    _fetchJson(url, reqOptions = {}) {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;

            const opts = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: reqOptions.method || 'GET',
                headers: {
                    'Accept': 'application/json',
                    ...(reqOptions.headers || {})
                }
            };

            const req = protocol.request(opts, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve({ status: res.statusCode, data: json, headers: res.headers });
                    } catch (e) {
                        resolve({ status: res.statusCode, raw: data, headers: res.headers });
                    }
                });
            });

            req.on('error', (err) => resolve({ error: err.message }));
            req.setTimeout(10000, () => {
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
     * Search for audio tracks or albums via Jackett / Comet indexers.
     */
    async searchTorrents(query, { category = 3000 } = {}) {
        const results = [];

        // 1. Query Jackett API if configured
        if (this.jackettUrl) {
            const jackettEndpoint = `${this.jackettUrl}/api/v2.0/indexers/all/results?apikey=${encodeURIComponent(this.jackettApiKey)}&Query=${encodeURIComponent(query)}&Category=${category}`;
            const res = await this._fetchJson(jackettEndpoint);
            if (res && res.data && Array.isArray(res.data.Results)) {
                for (const item of res.data.Results) {
                    results.push({
                        title: item.Title,
                        tracker: item.Tracker,
                        size: item.Size,
                        seeders: item.Seeders,
                        leechers: item.Peers,
                        publishDate: item.PublishDate,
                        magnetUri: item.MagnetUri || null,
                        link: item.Link || null,
                        source: 'jackett'
                    });
                }
            }
        }

        // Sort by seeders descending
        results.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));

        return {
            query,
            total: results.length,
            results
        };
    }

    /**
     * Send magnet link or torrent URL to qBittorrent with music savepath.
     */
    async addDownload({ magnetUrl, torrentUrl, savePath = this.downloadsDir, category = 'music' }) {
        if (!magnetUrl && !torrentUrl) {
            return { success: false, error: 'magnetUrl or torrentUrl is required' };
        }

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

        const res = await this._fetchJson(addEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(body)
            },
            body
        });

        if (res.error) {
            return { success: false, error: res.error };
        }

        return {
            success: res.status === 200,
            status: res.status,
            message: res.status === 200 ? 'Torrent added to download queue' : 'qBittorrent response received',
            raw: res.raw || res.data
        };
    }

    /**
     * Get active download queue from qBittorrent.
     */
    async getDownloadQueue({ category = 'music' } = {}) {
        const url = `${this.qbittorrentUrl}/api/v2/torrents/info?category=${encodeURIComponent(category)}`;
        const res = await this._fetchJson(url);

        if (res.error) {
            return { success: false, error: res.error, items: [] };
        }

        const items = Array.isArray(res.data) ? res.data.map(t => ({
            hash: t.hash,
            name: t.name,
            size: t.size,
            progress: (t.progress * 100).toFixed(1) + '%',
            downloadSpeed: t.dlspeed,
            uploadSpeed: t.upspeed,
            state: t.state,
            eta: t.eta,
            savePath: t.save_path
        })) : [];

        return {
            success: true,
            total: items.length,
            items
        };
    }
}

module.exports = { DownloadService };
