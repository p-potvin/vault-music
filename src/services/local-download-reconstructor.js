const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('../config');

class LocalDownloadReconstructor {
    constructor(options = {}) {
        this.jackettUrl = options.jackettUrl || config.JACKETT_URL;
        this.jackettApiKey = options.jackettApiKey || config.JACKETT_API_KEY;
        this.qbitUrl = options.qbitUrl || config.QBITTORRENT_URL;
        this.qbitUser = options.qbitUser || config.QBITTORRENT_USER;
        this.qbitPass = options.qbitPass || config.QBITTORRENT_PASS;
        this.maxLibrarySizeGb = options.maxLibrarySizeGb || config.MAX_LIBRARY_SIZE_GB || 35.0;
        this.jackettConfigDir = options.jackettConfigDir || 'C:\\ProgramData\\Jackett\\Indexers';
        this._tagCache = null;
        this.qbitSid = null;
    }

    /**
     * Compute current total library disk space used in G:\Music
     */
    getLibraryStorageUsage() {
        let totalBytes = 0;
        const targetDir = config.MUSIC_DIR;

        const scanSize = (dir) => {
            if (!fs.existsSync(dir)) return;
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        // Skip Apple Music backup snapshot directory from media calculation
                        if (entry.name.toLowerCase() === 'applemusic_backup') continue;
                        scanSize(fullPath);
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (config.SUPPORTED_AUDIO_EXT.has(ext)) {
                            const stat = fs.statSync(fullPath);
                            totalBytes += stat.size;
                        }
                    }
                }
            } catch (_) {}
        };

        scanSize(targetDir);

        const usedGb = parseFloat((totalBytes / (1024 * 1024 * 1024)).toFixed(2));
        const maxGb = this.maxLibrarySizeGb;
        const remainingGb = parseFloat(Math.max(0, maxGb - usedGb).toFixed(2));
        const percentUsed = Math.min(100, Math.round((usedGb / maxGb) * 100));

        return {
            usedBytes: totalBytes,
            usedGb,
            maxGb,
            remainingGb,
            percentUsed,
            targetDir,
            isCapReached: usedGb >= maxGb
        };
    }

    /**
     * Search Jackett for releases matching a song / album query.
     */
    /**
     * Resolve the indexers carrying a Jackett tag by reading the Jackett
     * indexer configs. Jackett's HTTP API does not expose tags.
     */
    resolveTaggedIndexers(tag) {
        if (!tag) return [];
        if (this._tagCache && this._tagCache.tag === tag && Date.now() - this._tagCache.at < 60000) {
            return this._tagCache.ids;
        }

        const wanted = tag.toLowerCase();
        const ids = [];
        try {
            for (const file of fs.readdirSync(this.jackettConfigDir)) {
                if (!file.toLowerCase().endsWith('.json')) continue;
                try {
                    const entries = JSON.parse(fs.readFileSync(path.join(this.jackettConfigDir, file), 'utf8'));
                    if (!Array.isArray(entries)) continue;
                    const entry = entries.find(item => item && item.id === 'tags');
                    const value = entry && typeof entry.value === 'string' ? entry.value : '';
                    const tags = value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
                    if (tags.includes(wanted)) ids.push(file.replace(/\.json$/i, ''));
                } catch (_) {}
            }
        } catch (_) {}

        this._tagCache = { tag, at: Date.now(), ids };
        return ids;
    }

    _searchIndexer(indexerId, query, { category = 3000, timeout = 25000 } = {}) {
        return new Promise((resolve) => {
            try {
                const encodedQuery = encodeURIComponent(query);
                let endpoint = `${this.jackettUrl}/api/v2.0/indexers/${encodeURIComponent(indexerId)}/results?apikey=${this.jackettApiKey}&Query=${encodedQuery}`;
                if (category) endpoint += `&Category=${encodeURIComponent(category)}`;
                const url = new URL(endpoint);

                const req = http.request({
                    hostname: url.hostname,
                    port: url.port || 9117,
                    path: url.pathname + url.search,
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    timeout
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(this._processAndRankReleases(Array.isArray(parsed.Results) ? parsed.Results : []));
                        } catch (_) {
                            resolve([]);
                        }
                    });
                });

                req.on('error', () => resolve([]));
                req.on('timeout', () => { req.destroy(); resolve([]); });
                req.end();
            } catch (_) {
                resolve([]);
            }
        });
    }

    /**
     * Search Jackett. When a tag is supplied the query is sent to just the
     * indexers carrying that tag, stopping early once a release reaches
     * stopAtSeeders and satisfies filter (if provided).
     */
    async searchJackett(query, { tag = null, category = 3000, timeout = 25000, stopAtSeeders = null, filter = null } = {}) {
        if (!query) return [];

        const indexers = tag ? this.resolveTaggedIndexers(tag) : [];
        if (tag && indexers.length === 0) {
            return [];
        }
        if (!tag && indexers.length === 0) {
            return this._searchIndexer('all', query, { category, timeout });
        }

        const merged = new Map();
        for (const indexer of indexers) {
            const releases = await this._searchIndexer(indexer, query, { category, timeout });
            for (const release of releases) {
                if (!merged.has(release.title)) merged.set(release.title, release);
            }
            if (stopAtSeeders !== null) {
                const hasThresholdRelease = [...merged.values()].some(r => (!filter || filter(r)) && (r.seeders || 0) >= stopAtSeeders);
                if (hasThresholdRelease) break;
            }
        }
        return [...merged.values()].sort((a, b) => b.score - a.score);
    }
    /**
     * Quality Classifier:
     * - MP3 128k / 192k ➔ Tier 1 (Preferred Low Quality)
     * - MP3 320k / AAC / VBR ➔ Tier 2 (Standard Lossy)
     * - FLAC / ALAC / Lossless ➔ Tier 3 (Lossless - Needs Confirmation)
     */
    _classifyQuality(title) {
        const t = (title || '').toLowerCase();

        // 1. Check for Lossless
        if (t.includes('flac') || t.includes('alac') || t.includes('lossless') || t.includes('wavpack') || t.includes('ape') || t.includes('24bit') || t.includes('24-bit')) {
            return {
                category: 'lossless',
                label: 'Lossless (FLAC/ALAC)',
                score: 10,
                isLossless: true,
                needsConfirmation: true
            };
        }

        // 2. Check for Preferred Low Quality (128kbps - 192kbps)
        if (t.includes('128') || t.includes('128k') || t.includes('128kbps') || t.includes('160k') || t.includes('192k') || t.includes('192kbps') || t.includes('v2')) {
            return {
                category: 'low-lossy',
                label: 'MP3 128k / 192k (Preferred)',
                score: 100,
                isLossless: false,
                needsConfirmation: false
            };
        }

        // 3. Check for Mid / High Quality Lossy (256k, 320k, V0, AAC)
        if (t.includes('320') || t.includes('320k') || t.includes('320kbps') || t.includes('256k') || t.includes('v0') || t.includes('mp3') || t.includes('aac')) {
            return {
                category: 'high-lossy',
                label: 'MP3 / AAC Lossy',
                score: 80,
                isLossless: false,
                needsConfirmation: false
            };
        }

        // Default standard lossy
        return {
            category: 'standard-lossy',
            label: 'Audio Release',
            score: 50,
            isLossless: false,
            needsConfirmation: false
        };
    }

    _processAndRankReleases(rawResults) {
        const processed = rawResults.map(r => {
            const quality = this._classifyQuality(r.Title);
            const sizeBytes = r.Size || 0;
            const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);

            return {
                title: r.Title,
                tracker: r.Tracker || 'Jackett',
                size: sizeBytes,
                formattedSize: `${sizeMb} MB`,
                seeders: r.Seeders || 0,
                leechers: r.Peers || 0,
                magnetUrl: r.MagnetUri,
                downloadUrl: r.Link,
                quality: quality.label,
                qualityCategory: quality.category,
                score: quality.score + (Math.min(50, r.Seeders || 0)),
                isLossless: quality.isLossless,
                needsConfirmation: quality.needsConfirmation
            };
        });

        // Sort by quality score first, then seeders
        processed.sort((a, b) => b.score - a.score);
        return processed;
    }

    _normalizeKey(value) {
        return (value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    /**
     * Build album-level download suggestions from a playlist, keeping only
     * albums that have at least one track missing from the library.
     */
    buildSuggestions(playlist, libraryTracks = [], { maxAlbums = 10 } = {}) {
        const ownedExactTracks = new Set();
        const ownedAnyTracks = new Set();
        const ownedAlbums = new Set();
        for (const track of libraryTracks) {
            const artistKey = this._normalizeKey(track.artist);
            const titleKey = this._normalizeKey(track.title);
            const albumKey = this._normalizeKey(track.album);
            if (artistKey && titleKey) {
                ownedAnyTracks.add(`${artistKey}|${titleKey}`);
                if (albumKey) {
                    ownedExactTracks.add(`${artistKey}|${albumKey}|${titleKey}`);
                }
            }
            if (artistKey && albumKey) {
                ownedAlbums.add(`${artistKey}|${albumKey}`);
            }
        }

        const albums = new Map();
        for (const track of playlist.tracks || []) {
            if (!track.title && !track.album) continue;
            const artist = track.artist || '';
            const album = track.album || track.title;
            const key = `${this._normalizeKey(artist)}|${this._normalizeKey(album)}`;
            if (!albums.has(key)) albums.set(key, { artist, album, tracks: [] });

            const exactKey = `${this._normalizeKey(artist)}|${this._normalizeKey(album)}|${this._normalizeKey(track.title)}`;
            const genericKey = `${this._normalizeKey(artist)}|${this._normalizeKey(track.title)}`;
            const isOwned = ownedExactTracks.has(exactKey) || (!track.album && ownedAnyTracks.has(genericKey));

            albums.get(key).tracks.push({
                title: track.title,
                artist,
                album,
                owned: isOwned,
            });
        }

        const suggestions = [];
        for (const entry of albums.values()) {
            const missing = entry.tracks.filter(t => !t.owned);
            if (missing.length === 0) continue;
            suggestions.push({
                artist: entry.artist,
                album: entry.album,
                totalTracks: entry.tracks.length,
                missingCount: missing.length,
                ownedCount: entry.tracks.length - missing.length,
                alreadyInLibrary: ownedAlbums.has(`${this._normalizeKey(entry.artist)}|${this._normalizeKey(entry.album)}`),
                tracks: entry.tracks,
            });
        }

        suggestions.sort((a, b) => b.missingCount - a.missingCount || a.artist.localeCompare(b.artist));

        return {
            playlistName: playlist.name,
            totalTracks: (playlist.tracks || []).length,
            missingTracks: suggestions.reduce((n, s) => n + s.missingCount, 0),
            totalAlbums: suggestions.length,
            returnedAlbums: Math.min(suggestions.length, maxAlbums),
            albums: suggestions.slice(0, maxAlbums),
        };
    }

    _pickByThreshold(releases, thresholds) {
        for (const min of thresholds) {
            const eligible = releases.filter(r => (r.seeders || 0) >= min);
            if (eligible.length > 0) {
                return eligible.slice().sort((a, b) => b.score - a.score)[0];
            }
        }
        return null;
    }

    _thresholdFor(seeders, thresholds) {
        const matched = thresholds.find(t => seeders >= t);
        return matched === undefined ? null : matched;
    }

    _looksLikeAlbum(title, album) {
        const haystack = this._normalizeKey(title);
        const needle = this._normalizeKey(album);
        if (!needle) return true;
        if (haystack.includes(needle)) return true;
        const tokens = needle.split(' ').filter(word => word.length > 2);
        if (tokens.length === 0) return true;
        const matched = tokens.filter(token => haystack.includes(token)).length;
        return matched === tokens.length || (tokens.length > 3 && matched / tokens.length >= 0.8);
    }

    /**
     * Find the best release for one album, preferring well-seeded results and
     * relaxing the seeder threshold before giving up.
     */
    async findReleaseForAlbum(artist, album, { tag = 'music', thresholds = [20, 15, 10, 5], maxQueries = 2 } = {}) {
        const primary = [artist, album].filter(Boolean).join(' ').trim();
        const queries = [];
        if (primary) queries.push(primary);
        if (album && this._normalizeKey(album) !== this._normalizeKey(primary)) queries.push(album);

        const seen = new Map();
        let queriesUsed = 0;
        let accepted = null;

        for (const query of queries.slice(0, maxQueries)) {
            queriesUsed++;
            const releases = await this.searchJackett(query, {
                tag,
                stopAtSeeders: thresholds[0],
                filter: r => !r.isLossless && this._looksLikeAlbum(r.title, album)
            });
            for (const release of releases) {
                if (!release.magnetUrl && !release.downloadUrl) continue;
                if (release.isLossless) continue;
                if (!this._looksLikeAlbum(release.title, album)) continue;
                if (!seen.has(release.title)) seen.set(release.title, release);
            }
            const strong = this._pickByThreshold([...seen.values()], [thresholds[0]]);
            if (strong) { accepted = strong; break; }
        }

        const allReleases = [...seen.values()];
        const chosen = accepted || this._pickByThreshold(allReleases, thresholds);
        const candidates = allReleases
            .sort((a, b) => (b.seeders || 0) - (a.seeders || 0) || b.score - a.score)
            .slice(0, 5);

        return {
            query: primary,
            queriesUsed,
            found: !!chosen,
            threshold: chosen ? this._thresholdFor(chosen.seeders || 0, thresholds) : null,
            bestRelease: chosen,
            candidates,
        };
    }

    /**
     * Match a bounded list of albums sequentially, stopping each album as soon
     * as a release clears the seeder threshold.
     */
    async matchAlbums(albums, { maxAlbums = 10, tag = 'music', thresholds } = {}) {
        const limited = (albums || []).slice(0, maxAlbums);
        const results = [];
        for (const album of limited) {
            const match = await this.findReleaseForAlbum(album.artist, album.album, { tag, thresholds });
            results.push({ ...album, ...match });
        }
        const matchedCount = results.filter(r => r.found).length;
        return {
            totalAlbums: limited.length,
            matchedCount,
            unmatchedCount: limited.length - matchedCount,
            queriesUsed: results.reduce((n, r) => n + (r.queriesUsed || 0), 0),
            results,
        };
    }

    _magnetHash(url) {
        const match = /xt=urn:btih:([a-z0-9]+)/i.exec(url || '');
        return match ? match[1].toLowerCase() : null;
    }

    /**
     * Remove a torrent from the isolated qBittorrent instance.
     */
    async cancelDownload(hash, { deleteFiles = false } = {}) {
        if (!hash || typeof hash !== 'string') return { success: false, error: 'Torrent hash is required' };
        const cleanHash = hash.trim().toLowerCase();
        if (!/^[a-f0-9]{40}$/i.test(cleanHash) && !/^[a-z2-7]{32}$/i.test(cleanHash)) {
            return { success: false, error: 'Invalid torrent hash format' };
        }
        await this._ensureQbitAuth();
        const parsedUrl = new URL(this.qbitUrl);
        const body = `hashes=${encodeURIComponent(cleanHash)}&deleteFiles=${deleteFiles ? 'true' : 'false'}`;

        return new Promise((resolve) => {
            const headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            };
            if (this.qbitSid) headers['Cookie'] = this.qbitSid;

            const req = http.request({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 8082,
                path: '/api/v2/torrents/delete',
                method: 'POST',
                headers,
                timeout: 8000
            }, (res) => {
                let data = '';
                res.on('data', c => { data += c; });
                res.on('end', () => resolve({ success: res.statusCode === 200, status: res.statusCode, hash }));
            });
            req.on('error', (err) => resolve({ success: false, error: err.message }));
            req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'qBittorrent timeout' }); });
            req.write(body);
            req.end();
        });
    }

    /**
     * Match all tracks from a selected playlist against Jackett.
     */
    async matchPlaylistTracks(playlist) {
        if (!playlist || !playlist.tracks) {
            return { success: false, error: 'Invalid playlist data' };
        }

        const matches = [];
        const storageUsage = this.getLibraryStorageUsage();

        for (const track of playlist.tracks) {
            const query = `${track.artist} ${track.title}`.trim();
            const releases = await this.searchJackett(query);

            let bestRelease = null;
            if (releases.length > 0) {
                // Find highest ranked lossy release first (lossless not allowed)
                const lossyRelease = releases.find(r => !r.isLossless);
                bestRelease = lossyRelease || null;
            }

            matches.push({
                track,
                query,
                matchFound: !!bestRelease,
                bestRelease: bestRelease ? {
                    title: bestRelease.title,
                    tracker: bestRelease.tracker,
                    formattedSize: bestRelease.formattedSize,
                    sizeBytes: bestRelease.size,
                    seeders: bestRelease.seeders,
                    quality: bestRelease.quality,
                    isLossless: bestRelease.isLossless,
                    needsConfirmation: bestRelease.needsConfirmation,
                    magnetUrl: bestRelease.magnetUrl,
                    downloadUrl: bestRelease.downloadUrl
                } : null,
                allReleases: releases.slice(0, 5)
            });
        }

        const totalEstimatedBytes = matches.reduce((acc, m) => acc + (m.bestRelease?.sizeBytes || 0), 0);
        const totalEstimatedMb = (totalEstimatedBytes / (1024 * 1024)).toFixed(1);
        const totalEstimatedGb = (totalEstimatedBytes / (1024 * 1024 * 1024)).toFixed(2);

        const wouldExceedCap = (storageUsage.usedBytes + totalEstimatedBytes) > (storageUsage.maxGb * 1024 * 1024 * 1024);

        return {
            success: true,
            playlistName: playlist.name,
            totalTracks: playlist.tracks.length,
            matchedCount: matches.filter(m => m.matchFound).length,
            totalEstimatedMb: `${totalEstimatedMb} MB`,
            totalEstimatedGb: `${totalEstimatedGb} GB`,
            storageUsage,
            wouldExceedCap,
            matches
        };
    }

    /**
     * Authenticate against the isolated VaultStreaming qBittorrent WebUI.
     */
    async _ensureQbitAuth() {
        if (!this.qbitUser || !this.qbitPass) return true;
        if (this.qbitSid) return true;

        const parsedUrl = new URL(this.qbitUrl);
        const postData = `username=${encodeURIComponent(this.qbitUser)}&password=${encodeURIComponent(this.qbitPass)}`;

        return new Promise((resolve) => {
            const req = http.request({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 80,
                path: '/api/v2/auth/login',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 8000
            }, (res) => {
                let body = '';
                res.on('data', c => { body += c; });
                res.on('end', () => {
                    const cookies = res.headers['set-cookie'] || [];
                    const sid = (Array.isArray(cookies) ? cookies : [cookies]).find(x => x.startsWith('SID='));
                    if (sid) this.qbitSid = sid.split(';')[0];
                    resolve(res.statusCode === 200 && body.includes('Ok.'));
                });
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.write(postData);
            req.end();
        });
    }

    /**
     * Send approved releases to the isolated VaultStreaming qBittorrent (category 'music').
     */
    async queueDownload(release, allowLossless = false) {
        if (!release || (!release.magnetUrl && !release.downloadUrl)) {
            return { success: false, error: 'No download URL or magnet link provided' };
        }

        // Storage Guardrail Check
        const storage = this.getLibraryStorageUsage();
        const incomingBytes = release.sizeBytes || release.size || (15 * 1024 * 1024);
        if (storage.usedBytes + incomingBytes > (storage.maxGb * 1024 * 1024 * 1024)) {
            return {
                success: false,
                guardrailBlocked: true,
                error: `35 GB Storage Guardrail Exceeded: Current ${storage.usedGb} GB + Incoming would exceed ${storage.maxGb} GB limit.`
            };
        }

        // Lossless Confirmation Check
        if (release.isLossless && !allowLossless) {
            return {
                success: false,
                confirmationRequired: true,
                error: `Release is Lossless (${release.quality}). Explicit user confirmation required.`
            };
        }

        const target = release.magnetUrl || release.downloadUrl;
        const result = await this._addToQbittorrent(target);
        return { ...result, hash: this._magnetHash(target) };
    }

    async _addToQbittorrent(torrentUrl) {
        await this._ensureQbitAuth();
        const parsedUrl = new URL(this.qbitUrl);
        return new Promise((resolve) => {
            try {
                const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
                const postData = [
                    `--${boundary}`,
                    'Content-Disposition: form-data; name="urls"',
                    '',
                    torrentUrl,
                    `--${boundary}`,
                    'Content-Disposition: form-data; name="category"',
                    '',
                    'music',
                    `--${boundary}`,
                    'Content-Disposition: form-data; name="savepath"',
                    '',
                    config.DOWNLOADS_DIR,
                    `--${boundary}--`
                ].join('\r\n');

                const headers = {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': Buffer.byteLength(postData)
                };
                if (this.qbitSid) headers['Cookie'] = this.qbitSid;

                const opts = {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || 8082,
                    path: '/api/v2/torrents/add',
                    method: 'POST',
                    headers,
                    timeout: 8000
                };

                const req = http.request(opts, (res) => {
                    let body = '';
                    res.on('data', c => { body += c; });
                    res.on('end', () => {
                        if (res.statusCode === 200 || res.statusCode === 201) {
                            if (typeof body === 'string' && body.trim() === 'Fails.') {
                                resolve({
                                    success: false,
                                    error: 'qBittorrent rejected torrent: Fails.'
                                });
                                return;
                            }
                            resolve({
                                success: true,
                                message: 'Torrent queued in qBittorrent successfully',
                                category: 'music',
                                destination: config.DOWNLOADS_DIR
                            });
                        } else {
                            resolve({
                                success: false,
                                error: `qBittorrent HTTP ${res.statusCode}: ${body || 'Failed to add torrent'}`
                            });
                        }
                    });
                });

                req.on('error', (err) => resolve({ success: false, error: 'qBittorrent connection error: ' + err.message }));
                req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'qBittorrent timeout' }); });
                req.write(postData);
                req.end();
            } catch (err) {
                resolve({ success: false, error: err.message });
            }
        });
    }
}

module.exports = { LocalDownloadReconstructor };
