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
    async searchJackett(query) {
        if (!query) return [];
        return new Promise((resolve) => {
            try {
                const encodedQuery = encodeURIComponent(query);
                const url = new URL(`${this.jackettUrl}/api/v2.0/indexers/all/results?apikey=${this.jackettApiKey}&Query=${encodedQuery}&Category=3000`);

                const opts = {
                    hostname: url.hostname,
                    port: url.port || 9117,
                    path: url.pathname + url.search,
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    timeout: 10000
                };

                const req = http.request(opts, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            const results = Array.isArray(parsed.Results) ? parsed.Results : [];
                            resolve(this._processAndRankReleases(results));
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
                // Find highest ranked lossy release first
                const lossyRelease = releases.find(r => !r.isLossless);
                bestRelease = lossyRelease || releases[0];
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
     * Send approved releases to local qBittorrent on port 8081 with category 'music'.
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

        return this._addToQbittorrent(release.magnetUrl || release.downloadUrl);
    }

    async _addToQbittorrent(torrentUrl) {
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

                const opts = {
                    hostname: '127.0.0.1',
                    port: 8081,
                    path: '/api/v2/torrents/add',
                    method: 'POST',
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'Content-Length': Buffer.byteLength(postData)
                    },
                    timeout: 8000
                };

                const req = http.request(opts, (res) => {
                    let body = '';
                    res.on('data', c => { body += c; });
                    res.on('end', () => {
                        if (res.statusCode === 200 || res.statusCode === 201) {
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
