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
 * With the release found, `metadata-service` no longer needs musicbrainz.org for cover art, album and year. Since the
 * reference was rebuilt from the full export (Sat 07 Nov 2026) the release, track and disc number, release group and
 * date come from its `tracks` / `medium` / `releases` / `release_groups` (see searchRecording); the catalog search
 * still adds genres, and is the release's only source for a recording with no track. If the gateway does not answer, the
 * request is tried once more after RETRY_DELAY_MS; if that fails too, the gateway is skipped for RETRY_MS (each
 * lookup in that window goes to musicbrainz.org at once, so a batch is not stalled) and asked again after it.
 * No token for musicbrainz.org: its ws/2 limit is ~1 request/s per IP whoever asks (the Live Data Feed token only
 * opens the feed's downloads; checked Sat 07 Nov 2026, musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
 */

const config = require('../config');

const TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 2000;
const RETRY_MS = 60 * 1000;
const CANDIDATES = 25;   // recordings kept per candidate query
const TRACK_ROWS = 500;  // tracks read for the candidates (Queen's "Bohemian Rhapsody": 464 tracks, 0.8 s)
const ALBUM_ROWS = 3000; // tracks read for the releases named like the file's album
const TYPE_RANK = { Album: 0, EP: 1, Single: 2 };

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

/**
 * Sort key of one track row, smaller is better, compared in this order:
 *   1. the album asked for: release or release-group name equal (0), one a prefix of the other (1), else (2);
 *   2. a release credited to the artist (a "Various Artists" compilation is not);
 *   3. an official release (not bootleg / promotion);
 *   4. release-group type Album, then EP, then Single, then the rest (the reference keeps the primary type only, so
 *      an artist's own best-of is an "Album" too; with no album asked, the earliest date below usually settles it);
 *   5. the earliest date: the release group's first release, else the release's own (undated last);
 *   6. the release's own date (the first pressing before a reissue of the same group);
 *   7. the order the recording was found in (exact credit first).
 */
function rankTrack(r, { album, artist, order = 0 }) {
    const al = norm(album);
    let albumKey = 0;
    if (al) {
        const names = [norm(r.releaseName), norm(r.rgName)].filter(Boolean);
        albumKey = names.includes(al) ? 0 : names.some(n => n.startsWith(al) || al.startsWith(n)) ? 1 : 2;
    }
    const ar = norm(artist);
    const own = !ar || norm(r.releaseArtist).includes(ar) ? 0 : 1;
    const official = r.status === 'Official' ? 0 : 1;
    const type = r.rgType in TYPE_RANK ? TYPE_RANK[r.rgType] : 3;
    const day = (y, m, d) => (y ? y * 10000 + (m || 12) * 100 + (d || 31) : 99999999);
    const own_date = day(r.y, r.m, r.d);
    const date = r.fy ? day(r.fy, r.fm, r.fd) : own_date;
    return [albumKey, own, official, type, date, own_date, order];
}

/** The result fields one track row gives (album, release, group, date, track / disc number). */
function trackFields(r) {
    const pad = (n) => String(n).padStart(2, '0');
    const date = (y, m, d) => (y ? (m ? `${y}-${pad(m)}${d ? `-${pad(d)}` : ''}` : String(y)) : '');
    const n = parseInt(r.number, 10);
    return {
        album: r.releaseName || '',
        releaseMbid: r.releaseMbid || null,
        releaseGroupMbid: r.rgMbid || null,
        releaseYear: String(r.y || r.fy || ''),
        releaseDate: date(r.y, r.m, r.d) || date(r.fy, r.fm, r.fd),
        originalYear: r.fy ? String(r.fy) : '',
        country: r.country || '',
        trackNumber: n > 0 ? n : (r.position || null),
        discNumber: r.disc || null,
        trackCount: r.trackCount || null,
        releaseType: r.rgType || ''
    };
}

function compareKeys(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
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
     * Best recording for title + artist (+ the album and track number the file is tagged with, when it has them).
     * First, with an album: that release's track (albumTrack). Otherwise candidate recordings, most exact first (each
     * step only when the one before found nothing):
     *   1. title exact (as given, then cleaned), with the artist credit exact **and** with the artist anywhere in the
     *      credit ("X feat. Y"), up to CANDIDATES each, together: a popular song has many recordings (single, album,
     *      remaster, live) and the exact credit is often the obscure one;
     *   2. title prefix, artist anywhere in the credit (the old local query);
     *   3. title exact alone, only when no artist is known and the title has letters or digits.
     * A short title prefix ("Love%") can take seconds on 33.9 M recordings, so it runs only after the exact tries.
     * Then every track of those recordings (music reference rebuilt Sat 07 Nov 2026: `tracks`, `medium`,
     * `release_groups` filled, `tracks.recording_id` indexed) in one query, and the best track (rankTrack) gives the
     * recording, album, track / disc number, release, release group, date and country.
     */
    async searchRecording({ title, artist, album, track }) {
        const t = (title || '').trim();
        let a = (artist || '').trim();
        if (/^(unknown artist|various artists|unknown)$/i.test(a)) a = '';
        if (!this.isAvailable || !t) return null;

        const esc = (s) => s.replace(/[!%_]/g, (m) => '!' + m);
        const cols = `r.id AS recordingId, r.gid AS recordingMbid, r.name AS title, r.length AS length, ac.name AS artist`;
        const titles = [...new Set([t, cleanTitle(t)].filter(Boolean))];
        // "Playboi Carti, Skepta" / "A feat. B": MusicBrainz credits often read differently; the first name anchors.
        const primary = a.split(/\s*(?:,|;|&|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing)\s+/i)[0].trim();
        const artists = [...new Set([a, primary].filter(Boolean))];
        const steps = [];
        if (a) {
            for (const ti of titles) {
                const step = artists.map(ar => [`SELECT ${cols} FROM artist_credits ac JOIN recordings r ON r.artist_credit_id = ac.id
                             WHERE ac.name = ? COLLATE NOCASE AND r.name = ? COLLATE NOCASE LIMIT ${CANDIDATES}`, [ar, ti]]);
                step.push([`SELECT ${cols} FROM recordings r JOIN artist_credits ac ON r.artist_credit_id = ac.id
                            WHERE r.name = ? COLLATE NOCASE AND ac.name LIKE ? ESCAPE '!' LIMIT ${CANDIDATES}`, [ti, `%${esc(primary)}%`]]);
                steps.push(step);
            }
            steps.push([[`SELECT ${cols} FROM recordings r JOIN artist_credits ac ON r.artist_credit_id = ac.id
                         WHERE r.name LIKE ? ESCAPE '!' AND ac.name LIKE ? ESCAPE '!' LIMIT ${CANDIDATES}`,
                        [`${esc(titles[titles.length - 1])}%`, `%${esc(primary)}%`]]]);
        } else if (/[\p{L}\p{N}]/u.test(t)) {
            // Title alone only when no artist is known: with an artist, a title-only hit is someone else's song
            // (measured Sat 07 Nov: "$uicideboy$ - Cold Turkey" became Cheap Trick); musicbrainz.org does better.
            for (const ti of titles) {
                steps.push([[`SELECT ${cols} FROM recordings r LEFT JOIN artist_credits ac ON r.artist_credit_id = ac.id
                             WHERE r.name = ? COLLATE NOCASE LIMIT ${CANDIDATES}`, [ti]]]);
            }
        }

        // The album the file names, read first: its tracks settle the recording whatever the title's punctuation
        // (MusicBrainz writes "Who I’ll Never Be", "A‐Gonna"; the exact-title queries miss those or find a live take).
        const onAlbum = album ? await this.albumTrack({ album, artist: primary || a, title: t, track }) : null;
        if (onAlbum) {
            const result = this._formatResult(onAlbum.row);
            Object.assign(result, onAlbum.fields);
            result.artistMbid = await this.artistMbid(onAlbum.row.recordingId);
            const release = await this.findRelease({ album, artist: a || onAlbum.row.artist });
            if (release && release.genres.length) result.genres = release.genres;
            return result;
        }

        const found = new Map(); // recordingId -> row, in the order found
        search: for (const step of steps) {
            for (const [sql, params] of step) {
                for (const row of await this.query(sql, params)) {
                    if (!found.has(row.recordingId)) found.set(row.recordingId, row);
                }
                if (!this.isAvailable) break search;
            }
            if (found.size) break;
        }
        if (!found.size) return null;

        const candidates = [...found.values()];
        const best = await this.bestTrack(candidates, { album, artist: primary || a });
        const row = best ? found.get(best.recordingId) || candidates[0] : candidates[0];
        const result = this._formatResult(row);
        if (best) Object.assign(result, best.fields);
        result.artistMbid = await this.artistMbid(row.recordingId);

        // The catalog's release item still brings genres; its release fields only when no track was found. Asked
        // only for an album the file names, as before: a music search costs 0.5-3 s on the gateway (Mon 16 Nov 2026).
        const release = await this.findRelease({ album, artist: a || row.artist });
        if (release) {
            if (best) {
                if (!result.genres.length) result.genres = release.genres;
            } else {
                Object.assign(result, release);
            }
        }
        return result;
    }

    /**
     * Every track of the candidate recordings (one query, at most TRACK_ROWS rows), ranked by rankTrack. Null when
     * none has a track (a standalone recording) or the query failed.
     */
    async bestTrack(candidates, { album, artist }) {
        const ids = candidates.map(c => c.recordingId).filter(id => id != null);
        if (!ids.length) return null;
        const rows = await this.query(
            `SELECT t.recording_id AS recordingId, t.number AS number, t.position AS position, m.position AS disc,
                    m.track_count AS trackCount, rl.gid AS releaseMbid, rl.name AS releaseName, rl.date_year AS y,
                    rl.date_month AS m, rl.date_day AS d, rl.country AS country, rl.status AS status,
                    rac.name AS releaseArtist, rg.gid AS rgMbid, rg.name AS rgName, rg.type AS rgType,
                    rg.first_year AS fy, rg.first_month AS fm, rg.first_day AS fd
             FROM tracks t JOIN medium m ON m.id = t.medium_id JOIN releases rl ON rl.id = m.release_id
             LEFT JOIN artist_credits rac ON rac.id = rl.artist_credit_id
             LEFT JOIN release_groups rg ON rg.id = rl.release_group_id
             WHERE t.recording_id IN (${ids.map(() => '?').join(',')}) LIMIT ${TRACK_ROWS}`, ids);
        if (!rows.length) return null;
        const order = new Map(ids.map((id, i) => [id, i]));
        const ranked = rows.map(r => ({ r, key: rankTrack(r, { album, artist, order: order.get(r.recordingId) }) }))
            .sort((x, y) => compareKeys(x.key, y.key));
        return { recordingId: ranked[0].r.recordingId, fields: trackFields(ranked[0].r) };
    }

    /**
     * The track of `title` on the release the file names: releases named `album` (as written, and with ' / ’
     * swapped), credited to the artist, their tracks compared on the normalized title (cleaned of "feat." too); a
     * track whose title starts the same and sits at the tagged track number also counts ("Whispers (I Hear Your)"
     * for "Whispers (I Hear You)"). Ranked as bestTrack. Null when no release or no track fits.
     */
    async albumTrack({ album, artist, title, track }) {
        const names = [...new Set([album, album.replace(/'/g, '’'), album.replace(/’/g, "'")])];
        const rows = await this.query(
            `SELECT t.recording_id AS recordingId, t.number AS number, t.position AS position, t.name AS trackName,
                    m.position AS disc, m.track_count AS trackCount, rl.gid AS releaseMbid, rl.name AS releaseName,
                    rl.date_year AS y, rl.date_month AS m, rl.date_day AS d, rl.country AS country, rl.status AS status,
                    rac.name AS releaseArtist, rg.gid AS rgMbid, rg.name AS rgName, rg.type AS rgType,
                    rg.first_year AS fy, rg.first_month AS fm, rg.first_day AS fd,
                    r.gid AS recordingMbid, r.name AS title, r.length AS length, ac.name AS artist
             FROM releases rl JOIN medium m ON m.release_id = rl.id JOIN tracks t ON t.medium_id = m.id
             JOIN recordings r ON r.id = t.recording_id LEFT JOIN artist_credits ac ON ac.id = r.artist_credit_id
             LEFT JOIN artist_credits rac ON rac.id = rl.artist_credit_id
             LEFT JOIN release_groups rg ON rg.id = rl.release_group_id
             WHERE rl.name COLLATE NOCASE IN (${names.map(() => '?').join(',')}) LIMIT ${ALBUM_ROWS}`, names);
        if (!rows.length) return null;
        const ar = norm(artist);
        const want = new Set([norm(title), norm(cleanTitle(title))].filter(Boolean));
        const tagNo = parseInt(track, 10) || null;
        const firstWord = (s) => norm(s).split(' ')[0];
        const fits = rows.filter(r => {
            if (ar && !norm(r.releaseArtist).includes(ar) && !norm(r.artist).includes(ar)) return false;
            const got = [norm(r.trackName), norm(r.title), norm(cleanTitle(r.trackName))];
            if (got.some(g => want.has(g))) return true;
            const no = parseInt(r.number, 10) || r.position;
            return tagNo != null && no === tagNo && firstWord(r.trackName) === firstWord(title);
        });
        if (!fits.length) return null;
        const best = fits.map(r => ({ r, key: rankTrack(r, { album, artist }) }))
            .sort((x, y) => compareKeys(x.key, y.key))[0].r;
        return { row: best, fields: trackFields(best) };
    }

    /** The first credited artist's MBID for a recording. Null when the reference has none. */
    async artistMbid(recordingId) {
        if (recordingId == null) return null;
        const [row] = await this.query(
            `SELECT a.gid AS gid FROM recordings r JOIN artist_credit_names acn ON acn.artist_credit = r.artist_credit_id
             JOIN artists a ON a.id = acn.artist WHERE r.id = ? ORDER BY acn.position LIMIT 1`, [recordingId]);
        return (row && row.gid) || null;
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
            originalYear: '',
            country: '',
            trackNumber: null,
            discNumber: null,
            trackCount: null,
            releaseType: '',
            genres: [],
            source: 'local_db'
        };
    }
}

module.exports = { LocalMusicBrainzDb, norm, cleanTitle, rankTrack };
