/**
 * MusicBrainz API & Cover Art Archive Client.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { RateLimiter } = require('./rate-limiter');

const pkg = require('../../package.json');
const DEFAULT_USER_AGENT = `VaultMusic/${pkg.version || '1.0.0'} ( contact@vaultwares.ca )`;

class MusicBrainzClient {
    constructor(options = {}) {
        this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
        this.host = options.host || 'musicbrainz.org';
        const isOfficialMb = this.host === 'musicbrainz.org';
        this.rps = options.rps !== undefined ? options.rps : (isOfficialMb ? 1 : 50);
        this.limiter = new RateLimiter(this.rps);
        this.cache = new Map();
    }

    async _getJson(url) {
        return this.limiter.schedule(() => {
            return new Promise((resolve, reject) => {
                const parsedUrl = new URL(url);
                const protocol = parsedUrl.protocol === 'http:' ? http : https;
                const reqOptions = {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    headers: {
                        'User-Agent': this.userAgent,
                        'Accept': 'application/json'
                    }
                };

                const req = protocol.request(reqOptions, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        return resolve(this._getJson(res.headers.location));
                    }

                    if (res.statusCode === 404) {
                        return resolve(null);
                    }

                    if (res.statusCode >= 400) {
                        const err = new Error(`MusicBrainz HTTP error ${res.statusCode}`);
                        err.status = res.statusCode;
                        err.headers = res.headers;
                        return reject(err);
                    }

                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            resolve(json);
                        } catch (parseErr) {
                            reject(new Error(`Failed to parse MusicBrainz JSON: ${parseErr.message}`));
                        }
                    });
                });

                req.on('error', reject);
                req.setTimeout(15000, () => {
                    req.destroy(new Error('MusicBrainz request timeout'));
                });
                req.end();
            });
        });
    }

    async downloadImage(imageUrl, targetPath) {
        return this.limiter.schedule(() => {
            return new Promise((resolve, reject) => {
                const protocol = imageUrl.startsWith('https') ? https : http;
                const req = protocol.get(imageUrl, {
                    headers: { 'User-Agent': this.userAgent }
                }, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        return resolve(this.downloadImage(res.headers.location, targetPath));
                    }

                    if (res.statusCode !== 200) {
                        return resolve({ success: false, status: res.statusCode });
                    }

                    const dir = path.dirname(targetPath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                    const fileStream = fs.createWriteStream(targetPath);
                    res.pipe(fileStream);

                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve({ success: true, targetPath });
                    });
                    fileStream.on('error', (err) => {
                        try { fs.unlinkSync(targetPath); } catch (_) {}
                        reject(err);
                    });
                });

                req.on('error', reject);
                req.setTimeout(20000, () => {
                    req.destroy(new Error('Image download timeout'));
                });
            });
        });
    }

    async searchRecording({ title, artist, album }) {
        if (!title && !artist) return null;

        const cacheKey = `rec:${title || ''}|${artist || ''}|${album || ''}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

        const clean = (s) => (s || '').replace(/["\\]/g, ' ').trim();
        const unquote = (s) => (s || '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

        const queries = [];
        if (title && artist && album) {
            queries.push(`recording:"${clean(title)}" AND artist:"${clean(artist)}" AND release:"${clean(album)}"`);
        }
        if (title && artist) {
            queries.push(`recording:"${clean(title)}" AND artist:"${clean(artist)}"`);
            queries.push(`recording:(${unquote(title)}) AND artist:(${unquote(artist)})`);
            queries.push(`"${clean(title)}" AND "${clean(artist)}"`);
            queries.push(`${unquote(title)} ${unquote(artist)}`);
        }
        if (title) {
            queries.push(`recording:"${clean(title)}"`);
            queries.push(`recording:(${unquote(title)})`);
            queries.push(`"${clean(title)}"`);
        }

        for (const q of queries) {
            if (!q.trim()) continue;
            const url = `https://${this.host}/ws/2/recording/?query=${encodeURIComponent(q)}&limit=5&fmt=json`;
            try {
                const res = await this._getJson(url);
                if (res && Array.isArray(res.recordings) && res.recordings.length > 0) {
                    const best = res.recordings[0];
                    const metadata = this._formatRecordingResult(best);
                    this.cache.set(cacheKey, metadata);
                    return metadata;
                }
            } catch (err) {
                // Try next query fallback
            }
        }

        this.cache.set(cacheKey, null);
        return null;
    }

    async searchRelease({ album, artist }) {
        if (!album && !artist) return null;
        const cacheKey = `rel:${album || ''}|${artist || ''}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

        const clean = (s) => (s || '').replace(/["\\]/g, ' ').trim();
        const unquote = (s) => (s || '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

        const queries = [];
        if (album && artist) {
            queries.push(`release:"${clean(album)}" AND artist:"${clean(artist)}"`);
            queries.push(`release:(${unquote(album)}) AND artist:(${unquote(artist)})`);
        } else if (album) {
            queries.push(`release:"${clean(album)}"`);
        }

        for (const q of queries) {
            const url = `https://${this.host}/ws/2/release/?query=${encodeURIComponent(q)}&limit=3&fmt=json`;
            try {
                const res = await this._getJson(url);
                if (res && Array.isArray(res.releases) && res.releases.length > 0) {
                    const best = res.releases[0];
                    const fullRelease = await this.getRelease(best.id);
                    this.cache.set(cacheKey, fullRelease);
                    return fullRelease;
                }
            } catch (_) {}
        }
        this.cache.set(cacheKey, null);
        return null;
    }

    async getRelease(releaseMbid) {
        if (!releaseMbid) return null;
        const cacheKey = `rel_mbid:${releaseMbid}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

        const url = `https://${this.host}/ws/2/release/${releaseMbid}?inc=recordings+artist-credits+labels+genres+tags+ratings+media&fmt=json`;
        try {
            const res = await this._getJson(url);
            this.cache.set(cacheKey, res);
            return res;
        } catch (_) {
            return null;
        }
    }

    async getCoverArt(releaseMbid, releaseGroupMbid) {
        if (!releaseMbid && !releaseGroupMbid) return null;

        const cacheKey = `art:${releaseMbid || releaseGroupMbid}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

        if (releaseMbid) {
            try {
                const url = `https://coverartarchive.org/release/${releaseMbid}`;
                const res = await this._getJson(url);
                if (res && Array.isArray(res.images) && res.images.length > 0) {
                    const front = res.images.find(img => img.front) || res.images[0];
                    const art = {
                        image: front.image,
                        thumbnails: front.thumbnails || {},
                        source: 'release'
                    };
                    this.cache.set(cacheKey, art);
                    return art;
                }
            } catch (_) {}
        }

        if (releaseGroupMbid) {
            try {
                const url = `https://coverartarchive.org/release-group/${releaseGroupMbid}`;
                const res = await this._getJson(url);
                if (res && Array.isArray(res.images) && res.images.length > 0) {
                    const front = res.images.find(img => img.front) || res.images[0];
                    const art = {
                        image: front.image,
                        thumbnails: front.thumbnails || {},
                        source: 'release-group'
                    };
                    this.cache.set(cacheKey, art);
                    return art;
                }
            } catch (_) {}
        }

        this.cache.set(cacheKey, null);
        return null;
    }

    _formatRecordingResult(rec) {
        const release = (rec.releases && rec.releases[0]) || null;
        const artistCredit = (rec['artist-credit'] && rec['artist-credit'][0]) || null;
        const artistObj = artistCredit ? (artistCredit.artist || artistCredit) : null;

        const genres = [];
        if (Array.isArray(rec.genres)) rec.genres.forEach(g => genres.push(g.name));
        if (Array.isArray(rec.tags)) rec.tags.forEach(t => genres.push(t.name));
        if (release && Array.isArray(release.tags)) release.tags.forEach(t => genres.push(t.name));

        return {
            recordingMbid: rec.id,
            title: rec.title,
            length: rec.length ? Math.round(rec.length / 1000) : null,
            score: rec.score || 100,
            artist: artistObj ? artistObj.name : (rec['artist-credit'] ? rec['artist-credit'].map(c => c.name || c.artist?.name).join(', ') : ''),
            artistMbid: artistObj ? artistObj.id : null,
            artistSortName: artistObj ? artistObj['sort-name'] : '',
            artistType: artistObj ? artistObj.type : '',
            artistCountry: artistObj ? artistObj.country : '',
            album: release ? release.title : '',
            releaseMbid: release ? release.id : null,
            releaseGroupMbid: release && release['release-group'] ? release['release-group'].id : null,
            releaseDate: release ? release.date : (rec['first-release-date'] || ''),
            releaseYear: release && release.date ? release.date.slice(0, 4) : (rec['first-release-date'] ? rec['first-release-date'].slice(0, 4) : ''),
            trackNumber: (release && release.media && release.media[0] && release.media[0].track && release.media[0].track[0]) ? release.media[0].track[0].number : null,
            country: release ? release.country : '',
            status: release ? release.status : '',
            genres: [...new Set(genres)].slice(0, 5),
        };
    }
}

module.exports = { MusicBrainzClient, DEFAULT_USER_AGENT };
