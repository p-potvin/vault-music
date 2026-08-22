/**
 * Local MusicBrainz SQLite Database Client.
 * Enables instant offline searches against the local SQLite database dump.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class LocalMusicBrainzDb {
    constructor(dbPath = 'I:\\Musicbrainz\\musicbrainz_local.sqlite') {
        this.dbPath = path.resolve(dbPath);
        this.isAvailable = fs.existsSync(this.dbPath);
    }

    query(sql, params = []) {
        if (!this.isAvailable) return [];

        const pyScript = `
import sqlite3, json, sys
conn = sqlite3.connect(r'''${this.dbPath}''')
cur = conn.cursor()
sql = sys.argv[1]
params = json.loads(sys.argv[2])
cur.execute(sql, params)
cols = [desc[0] for desc in cur.description] if cur.description else []
rows = [dict(zip(cols, row)) for row in cur.fetchall()]
print(json.dumps(rows))
`;
        try {
            const out = execFileSync('python', ['-c', pyScript, sql, JSON.stringify(params)], {
                encoding: 'utf8',
                timeout: 5000
            });
            return JSON.parse(out.trim() || '[]');
        } catch (err) {
            return [];
        }
    }

    searchRecording({ title, artist, album }) {
        if (!this.isAvailable || (!title && !artist)) return null;

        const clean = (s) => (s || '').trim();

        let sql = `
            SELECT r.gid as recordingMbid, r.name as title, r.length,
                   ac.name as artist, ac.id as artistCreditId
            FROM recordings r
            LEFT JOIN artist_credits ac ON r.artist_credit_id = ac.id
            WHERE r.name LIKE ? AND ac.name LIKE ?
            LIMIT 1
        `;
        let rows = this.query(sql, [`${clean(title)}%`, `%${clean(artist)}%`]);
        if (rows.length > 0) return this._formatResult(rows[0]);

        sql = `
            SELECT r.gid as recordingMbid, r.name as title, r.length,
                   ac.name as artist, ac.id as artistCreditId
            FROM recordings r
            LEFT JOIN artist_credits ac ON r.artist_credit_id = ac.id
            WHERE r.name LIKE ?
            LIMIT 1
        `;
        rows = this.query(sql, [`${clean(title)}%`]);
        if (rows.length > 0) return this._formatResult(rows[0]);

        return null;
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
            releaseYear: '',
            releaseDate: '',
            trackNumber: null,
            genres: [],
            source: 'local_db'
        };
    }
}

module.exports = { LocalMusicBrainzDb };
