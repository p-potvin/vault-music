/**
 * MusicBrainz lookups through vault-raggae, the catalog owner (no file of our own, no Python).
 *
 * The 22 Aug MusicBrainz dump this app used to open from `I:\Musicbrainz` (spawning `python -c` for every query)
 * now lives with vault-raggae (`G:\Catalogs\Musicbrainz`, store `musicbrainz`, read-only) and was deleted from I:
 * on Sat 31 Oct 2026, so every lookup had gone online at 1 request/s. Two gateway routes replace it:
 *
 *   POST /v1/sql/musicbrainz   {"op": "read", "sql", "params"}   recordings / artist credits (33.9 M recordings)
 *   GET  /v1/catalog/search    ?category=music                   the release for an album name (MBID, cover art)
 *
 * With the release found, `metadata-service` no longer needs musicbrainz.org for cover art, album and year. Track
 * numbers are not looked up here (the dump has no index on tracks.recording_id). If the gateway does not answer, the
 * request is tried once more after RETRY_DELAY_MS; if that fails too, the gateway is skipped for RETRY_MS (each
 * lookup in that window goes to musicbrainz.org at once, so a batch is not stalled) and asked again after it.
 * No token for musicbrainz.org: its ws/2 limit is ~1 request/s per IP whoever asks (the Live Data Feed token only
 * opens the feed's downloads; checked Sat 07 Nov 2026, musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
 */

const config = require('../config');

const TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 2000;
const RETRY_MS = 60 * 1000;

/** Lower-case, accents and punctuation out, for comparing names. */
function norm(s) {
    return (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** A title without its featuring credit or upload noise: "Havana (Audio) ft. Young Thug" -> "Havana". */
function cleanTitle(s) {
    return (s || '')
        .replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, '')
        .replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, '')
        .replace(/\s*[([]\s*(?:official[^)\]]*|audio|lyrics?[^)\]]*|explicit|clean|visuali[sz]er)\s*[)\]]/gi, '')
        .trim();
}

class LocalMusicBrainzDb {
    constructor(baseUrl = config.RAGGAE_URL, { fetchImpl, retryDelayMs = RETRY_DELAY_MS } = {}) {
        this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
        this.dbPath = `${this.baseUrl}/v1/sql/musicbrainz`; // shown in /status as before
        this.fetch = fetchImpl || globalThis.fetch;
        this.retryDelayMs = retryDelayMs;
        this.downUntil = 0;
        this.lastError = null;
    }

    /** False while the gateway is in its back-off after a failed request. */
    get isAvailable() {
        return Boolean(this.baseUrl) && Date.now() >= this.downUntil;
    }

    /**
     * One gateway request; a connection error or a 5xx is tried once more after RETRY_DELAY_MS (a gateway restart
     * takes ~20 s, a blip less), then the caller's lookup is given up and the back-off starts.
     */
    async _request(route, init) {
        try {
            return await this._requestOnce(route, init);
        } catch (err) {
            if (err.status && err.status < 500) throw err;
            await new Promise(r => setTimeout(r, this.retryDelayMs));
            return this._requestOnce(route, init);
        }
    }

    async _requestOnce(route, init) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const res = await this.fetch(`${this.baseUrl}${route}`, {
                ...init,
                headers: { 'Content-Type': 'application/json', 'x-vw-project': 'vault-music', ...(init && init.headers) },
                signal: ctrl.signal
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                const msg = body && body.error ? `${body.error.type}: ${body.error.message}` : `HTTP ${res.status}`;
                throw Object.assign(new Error(msg), { status: res.status });
            }
            return body;
        } finally {
            clearTimeout(timer);
        }
    }

    /** One read statement on the gateway's MusicBrainz store; rows as objects. [] when unavailable. */
    async query(sql, params = []) {
        if (!this.isAvailable) return [];
        try {
            const out = await this._request('/v1/sql/musicbrainz', {
                method: 'POST',
                body: JSON.stringify({ op: 'read', sql, params })
            });
            const cols = out.columns || [];
            return (out.rows || []).map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
        } catch (err) {
            this._fail(err);
            return [];
        }
    }

    _fail(err) {
        this.lastError = err.message;
        // A SQL error is ours; only connection trouble and gateway failures back off.
        if (!err.status || err.status >= 500) this.downUntil = Date.now() + RETRY_MS;
    }

    /**
     * Best recording for title + artist, most exact first:
     *   1. artist credit and title both exact (artist index, then that credit's recordings);
     *   2. title exact, artist anywhere in the credit ("X feat. Y");
     *   3. title prefix, artist anywhere in the credit (the old local query);
     *   4. title exact alone, only for a title with letters or digits.
     * A short title prefix ("Love%") can take seconds on 33.9 M recordings, so it runs only after the exact tries.
     */
    async searchRecording({ title, artist, album }) {
        const t = (title || '').trim();
        let a = (artist || '').trim();
        if (/^(unknown artist|various artists|unknown)$/i.test(a)) a = '';
        if (!this.isAvailable || !t) return null;

        const esc = (s) => s.replace(/[!%_]/g, (m) => '!' + m);
        const cols = `r.gid AS recordingMbid, r.name AS title, r.length AS length, ac.name AS artist`;
        const titles = [...new Set([t, cleanTitle(t)].filter(Boolean))];
        // "Playboi Carti, Skepta" / "A feat. B": MusicBrainz credits often read differently; the first name anchors.
        const primary = a.split(/\s*(?:,|;|&|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing)\s+/i)[0].trim();
        const artists = [...new Set([a, primary].filter(Boolean))];
        const tries = [];
        if (a) {
            for (const ti of titles) {
                for (const ar of artists) {
                    tries.push([`SELECT ${cols} FROM artist_credits ac JOIN recordings r ON r.artist_credit_id = ac.id
                                 WHERE ac.name = ? COLLATE NOCASE AND r.name = ? COLLATE NOCASE LIMIT 1`, [ar, ti]]);
                }
                tries.push([`SELECT ${cols} FROM recordings r JOIN artist_credits ac ON r.artist_credit_id = ac.id
                             WHERE r.name = ? COLLATE NOCASE AND ac.name LIKE ? ESCAPE '!' LIMIT 1`, [ti, `%${esc(primary)}%`]]);
            }
            tries.push([`SELECT ${cols} FROM recordings r JOIN artist_credits ac ON r.artist_credit_id = ac.id
                         WHERE r.name LIKE ? ESCAPE '!' AND ac.name LIKE ? ESCAPE '!' LIMIT 1`,
                        [`${esc(titles[titles.length - 1])}%`, `%${esc(primary)}%`]]);
        } else if (/[\p{L}\p{N}]/u.test(t)) {
            // Title alone only when no artist is known: with an artist, a title-only hit is someone else's song
            // (measured Sat 07 Nov: "$uicideboy$ - Cold Turkey" became Cheap Trick); musicbrainz.org does better.
            for (const ti of titles) {
                tries.push([`SELECT ${cols} FROM recordings r LEFT JOIN artist_credits ac ON r.artist_credit_id = ac.id
                             WHERE r.name = ? COLLATE NOCASE LIMIT 1`, [ti]]);
            }
        }

        let row = null;
        for (const [sql, params] of tries) {
            [row] = await this.query(sql, params);
            if (row || !this.isAvailable) break;
        }
        if (!row) return null;

        const result = this._formatResult(row);
        const release = await this.findRelease({ album, artist: a || row.artist });
        if (release) Object.assign(result, release);
        return result;
    }

    /**
     * The release for an album name, from the catalog's music items (`mb:rel:<mbid>`): same title and an artist
     * credit naming the artist. Gives the release / release-group MBIDs and the year, which cover art needs.
     */
    async findRelease({ album, artist }) {
        const al = norm(album);
        if (!al || !this.isAvailable) return null;
        let items = [];
        try {
            const q = encodeURIComponent(`${artist || ''} ${album}`.trim());
            const out = await this._request(`/v1/catalog/search?q=${q}&category=music&limit=10`, { method: 'GET' });
            items = (out && out.results) || [];
        } catch (err) {
            this._fail(err);
            return null;
        }
        const ar = norm(artist);
        const hit = items.find(it => norm(it.title) === al && String(it.catalog_id || '').startsWith('mb:rel:')
            && (!ar || norm(it.subtitle_or_artist).includes(ar) || ar.includes(norm(it.subtitle_or_artist))));
        if (!hit) return null;

        const ext = hit.external_ids || {};
        const out = {
            album: hit.title,
            releaseMbid: ext.mbid || hit.catalog_id.slice('mb:rel:'.length),
            releaseGroupMbid: null,
            releaseYear: hit.year ? String(hit.year) : '',
            releaseDate: hit.release_date || '',
            country: ext.country || '',
            genres: (hit.genres || []).filter(g => g && g !== 'Album').slice(0, 5)
        };
        if (ext.rel_id) {
            const [rel] = await this.query(
                `SELECT rg.gid AS rgMbid, r.date_year AS y, r.date_month AS m, r.date_day AS d, r.country AS country
                 FROM releases r LEFT JOIN release_groups rg ON rg.id = r.release_group_id WHERE r.id = ?`, [ext.rel_id]);
            if (rel) {
                out.releaseGroupMbid = rel.rgMbid || null;
                if (rel.y) {
                    out.releaseYear = String(rel.y);
                    const pad = (n) => String(n).padStart(2, '0');
                    out.releaseDate = rel.m ? `${rel.y}-${pad(rel.m)}${rel.d ? `-${pad(rel.d)}` : ''}` : String(rel.y);
                }
                if (rel.country && !out.country) out.country = rel.country;
            }
        }
        return out;
    }

    _formatResult(row) {
        return {
            recordingMbid: row.recordingMbid,
            title: row.title,
            length: row.length ? Math.round(row.length / 1000) : null,
            artist: row.artist,
            artistMbid: null,
            album: '',
            releaseMbid: null,
            releaseGroupMbid: null,
            releaseYear: '',
            releaseDate: '',
            trackNumber: null,
            genres: [],
            source: 'local_db'
        };
    }
}

module.exports = { LocalMusicBrainzDb, norm, cleanTitle };
