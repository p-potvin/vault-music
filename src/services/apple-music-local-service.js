const fs = require('fs');
const path = require('path');
const config = require('../config');
const { readPlaylists } = require('./apple-musicdb-parser');

const SKIP_DIRS = new Set(['media', 'artwork', 'artwork_originals']);
const INDEX_FILE = 'snapshot_index.json';
const MUSICDB_REL = path.join('Apple Music Library.musiclibrary', 'Library.musicdb');

class AppleMusicLocalService {
    constructor(options = {}) {
        this.sourceDir = options.sourceDir || config.APPLE_MUSIC_SOURCE_DIR;
        this.backupDir = options.backupDir || config.APPLE_MUSIC_BACKUP_DIR;
        this.indexPath = path.join(this.backupDir, INDEX_FILE);
    }

    _readIndex() {
        try {
            const data = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
            if (data && data.files) return data;
        } catch (_) {}
        return { version: 1, updatedAt: null, sourceDir: this.sourceDir, files: {} };
    }

    /**
     * Incrementally clone Apple Music library files into the backup directory.
     * Files already present with a matching size and mtime are skipped, so a
     * refresh only copies what actually changed.
     */
    async createSafeSnapshot() {
        if (!fs.existsSync(this.sourceDir)) {
            return { success: false, error: `Source directory does not exist: ${this.sourceDir}` };
        }

        try {
            if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });

            const previous = this._readIndex();
            const nextFiles = {};
            let copied = 0;
            let skipped = 0;
            let totalBytes = 0;

            const walk = (src, rel) => {
                const stats = fs.statSync(src);
                if (stats.isDirectory()) {
                    if (SKIP_DIRS.has(path.basename(src).toLowerCase())) return;
                    for (const entry of fs.readdirSync(src)) {
                        walk(path.join(src, entry), path.join(rel, entry));
                    }
                    return;
                }

                const key = rel.split(path.sep).join('/');
                nextFiles[key] = { size: stats.size, mtimeMs: Math.round(stats.mtimeMs) };
                totalBytes += stats.size;

                const target = path.join(this.backupDir, rel);
                const known = previous.files[key];
                const unchanged = known && known.size === nextFiles[key].size && known.mtimeMs === nextFiles[key].mtimeMs;

                if (unchanged && fs.existsSync(target)) {
                    skipped++;
                    return;
                }

                const targetDir = path.dirname(target);
                fs.mkdirSync(targetDir, { recursive: true });
                const tempTarget = path.join(targetDir, `.${path.basename(target)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
                try {
                    fs.copyFileSync(src, tempTarget);
                    fs.renameSync(tempTarget, target);
                    copied++;
                } catch (err) {
                    try {
                        if (fs.existsSync(tempTarget)) {
                            fs.unlinkSync(tempTarget);
                        }
                    } catch (_) {}
                    throw err;
                }
            };

            walk(this.sourceDir, '');

            const removed = Object.keys(previous.files).filter(key => !nextFiles[key]);
            for (const key of removed) {
                try {
                    fs.unlinkSync(path.join(this.backupDir, key.split('/').join(path.sep)));
                } catch (_) {}
            }

            const fileCount = Object.keys(nextFiles).length;
            const manifest = {
                timestamp: new Date().toISOString(),
                sourceDir: this.sourceDir,
                backupDir: this.backupDir,
                fileCount,
                totalBytes,
                formattedSize: (totalBytes / (1024 * 1024)).toFixed(2) + ' MB',
                copiedCount: copied,
                skippedCount: skipped,
                removedCount: removed.length,
                incremental: true,
            };

            fs.writeFileSync(path.join(this.backupDir, 'snapshot_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
            fs.writeFileSync(this.indexPath, JSON.stringify({
                version: 1,
                updatedAt: manifest.timestamp,
                sourceDir: this.sourceDir,
                files: nextFiles,
            }, null, 2), 'utf8');

            return {
                success: true,
                message: `Snapshot refreshed in ${this.backupDir}`,
                manifest,
            };
        } catch (err) {
            return { success: false, error: `Failed to create safe snapshot: ${err.message}` };
        }
    }

    /**
     * Get status of existing safe snapshot.
     */
    getSnapshotStatus() {
        const manifestPath = path.join(this.backupDir, 'snapshot_manifest.json');
        const index = this._readIndex();
        const indexedFiles = Object.keys(index.files || {}).length;

        if (fs.existsSync(manifestPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                return { hasSnapshot: true, manifest: data, indexedFiles, indexUpdatedAt: index.updatedAt };
            } catch (_) {}
        }

        const hasFiles = fs.existsSync(this.backupDir) && fs.readdirSync(this.backupDir).length > 0;
        return {
            hasSnapshot: hasFiles,
            backupDir: this.backupDir,
            sourceDir: this.sourceDir,
            indexedFiles,
            indexUpdatedAt: index.updatedAt,
        };
    }

    /**
     * Scans the safe snapshot for playlists. Apple Music playlists come from
     * the library database; exported .xml/.m3u/.json/.txt files are also read.
     */
    async scanSnapshotPlaylists({ includeSystem = false } = {}) {
        const snapshot = this.getSnapshotStatus();
        if (!snapshot.hasSnapshot) {
            await this.createSafeSnapshot();
        }

        const playlists = [];
        const seenIds = new Set();

        const musicDbPath = path.join(this.backupDir, MUSICDB_REL);
        if (fs.existsSync(musicDbPath)) {
            try {
                for (const playlist of readPlaylists(musicDbPath)) {
                    if (!includeSystem && playlist.isSystem) continue;
                    const id = `apple-${playlist.id}`;
                    if (seenIds.has(id)) continue;
                    seenIds.add(id);
                    playlists.push({
                        id,
                        name: playlist.name,
                        source: 'library-musicdb',
                        isSystem: playlist.isSystem,
                        trackCount: playlist.trackCount,
                        tracks: playlist.tracks,
                    });
                }
            } catch (err) {
                return { success: false, error: `Failed to read Apple Music playlists: ${err.message}`, playlists: [] };
            }
        }

        const scanDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath);
                    continue;
                }
                const ext = path.extname(entry.name).toLowerCase();
                if (!['.xml', '.m3u', '.m3u8', '.txt', '.json'].includes(ext)) continue;
                if (entry.name === INDEX_FILE || entry.name === 'snapshot_manifest.json') continue;
                try {
                    const parsed = this._parsePlaylistFile(fullPath);
                    if (parsed && parsed.tracks && parsed.tracks.length > 0 && !seenIds.has(parsed.id)) {
                        seenIds.add(parsed.id);
                        playlists.push(parsed);
                    }
                } catch (_) {}
            }
        };

        scanDir(this.backupDir);

        return {
            success: true,
            source: musicDbPath && fs.existsSync(musicDbPath) ? 'library-musicdb' : 'files',
            totalPlaylists: playlists.length,
            playlists,
        };
    }

    /**
     * Parses .xml, .m3u, .json, or .txt playlist files.
     */
    _parsePlaylistFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const baseName = path.basename(filePath, ext);
        const content = fs.readFileSync(filePath, 'utf8');

        if (ext === '.json') {
            const data = JSON.parse(content);
            return {
                id: 'pl-' + Buffer.from(baseName).toString('hex').substring(0, 10),
                name: data.name || baseName,
                source: filePath,
                trackCount: (data.tracks || []).length,
                tracks: data.tracks || []
            };
        }

        if (ext === '.m3u' || ext === '.m3u8') {
            const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
            const tracks = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.startsWith('#EXTINF:')) {
                    const info = line.substring(8);
                    const commaIdx = info.indexOf(',');
                    const meta = commaIdx !== -1 ? info.substring(commaIdx + 1) : info;
                    const parts = meta.split(' - ');
                    const artist = parts.length > 1 ? parts[0].trim() : 'Unknown Artist';
                    const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : parts[0].trim();
                    tracks.push({ title, artist, album: '' });
                } else if (!line.startsWith('#')) {
                    const titleCandidate = path.basename(line, path.extname(line));
                    if (!tracks.some(t => t.title === titleCandidate)) {
                        tracks.push({ title: titleCandidate, artist: 'Unknown Artist', album: '' });
                    }
                }
            }
            return {
                id: 'pl-' + Buffer.from(baseName).toString('hex').substring(0, 10),
                name: baseName,
                source: filePath,
                trackCount: tracks.length,
                tracks
            };
        }

        if (ext === '.txt') {
            const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            const tracks = [];
            for (const line of lines) {
                if (line.includes(' - ')) {
                    const [artist, ...rest] = line.split(' - ');
                    tracks.push({ artist: artist.trim(), title: rest.join(' - ').trim(), album: '' });
                } else {
                    tracks.push({ title: line, artist: 'Unknown Artist', album: '' });
                }
            }
            return {
                id: 'pl-' + Buffer.from(baseName).toString('hex').substring(0, 10),
                name: baseName,
                source: filePath,
                trackCount: tracks.length,
                tracks
            };
        }

        return null;
    }
}

module.exports = { AppleMusicLocalService };
