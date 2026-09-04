const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { extractAudioFileMetadata } = require('../musicbrainz/tag-reader');

class LibraryService {
    constructor(musicDir = config.MUSIC_DIR, additionalDirs = config.MUSIC_DIRS) {
        this.musicDirs = Array.isArray(additionalDirs) && additionalDirs.length > 0 
            ? additionalDirs.map(d => path.resolve(d)) 
            : [path.resolve(musicDir)];
        this.musicDir = this.musicDirs[0];
        this.tracks = []; // Array of track objects
        this.tracksById = new Map(); // id -> track
        this.artists = new Map(); // artistName -> { name, trackCount, albumCount, albums: Set }
        this.albums = new Map(); // albumId -> { id, title, artist, trackCount, year, coverPath, tracks: [] }
        this.isScanning = false;
        this.lastScanTime = 0;
    }

    generateId(input) {
        return crypto.createHash('md5').update(input).digest('hex').slice(0, 16);
    }

    scanLibrary() {
        if (this.isScanning) return { scanning: true, count: this.tracks.length };
        this.isScanning = true;

        const newTracks = [];
        const newTracksById = new Map();
        const newArtists = new Map();
        const newAlbums = new Map();

        const walk = (currentDir) => {
            let entries = [];
            try {
                entries = fs.readdirSync(currentDir, { withFileTypes: true });
            } catch (_) {
                return;
            }

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== '.thumbs' && entry.name !== 'node_modules' && !entry.name.startsWith('.') && entry.name.toLowerCase() !== 'applemusic_backup') {
                        walk(fullPath);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (config.SUPPORTED_AUDIO_EXT.has(ext)) {
                        const trackMeta = extractAudioFileMetadata(fullPath);
                        const trackId = this.generateId(fullPath);
                        const albumDir = path.dirname(fullPath);

                        const artistName = trackMeta.effectiveArtist || 'Unknown Artist';
                        const albumArtist = trackMeta.effectiveAlbumArtist || artistName;
                        const albumTitle = trackMeta.effectiveAlbum || 'Unknown Album';
                        const trackTitle = trackMeta.effectiveTitle || path.basename(fullPath, ext);

                        // Use combined album title + album artist for unique album ID if metadata exists, else album directory
                        const albumKey = (albumTitle && albumTitle !== 'Unknown Album')
                            ? (albumTitle.toLowerCase() + '::' + albumArtist.toLowerCase())
                            : albumDir;
                        const albumId = this.generateId(albumKey);

                        // Look for local album cover in album folder
                        let coverPath = null;
                        const potentialCovers = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'front.jpg', 'cover.jpeg', 'front.png'];
                        for (const name of potentialCovers) {
                            const p = path.join(albumDir, name);
                            if (fs.existsSync(p)) {
                                coverPath = p;
                                break;
                            }
                        }

                        let stats;
                        try { stats = fs.statSync(fullPath); } catch (_) { stats = { size: 0, mtime: new Date() }; }

                        const trackObj = {
                            id: trackId,
                            title: trackTitle,
                            artist: artistName,
                            album: albumTitle,
                            albumId: albumId,
                            year: trackMeta.embeddedYear || null,
                            trackNumber: trackMeta.embeddedTrack || null,
                            genre: trackMeta.embeddedGenre || null,
                            filePath: fullPath,
                            fileName: entry.name,
                            fileSize: stats.size,
                            lastModified: stats.mtime,
                            coverPath: coverPath,
                            streamUrl: `/api/v1/stream/${trackId}`,
                            coverUrl: coverPath ? `/api/v1/art/${albumId}` : null
                        };

                        newTracks.push(trackObj);
                        newTracksById.set(trackId, trackObj);

                        // Aggregate Album
                        if (!newAlbums.has(albumId)) {
                            newAlbums.set(albumId, {
                                id: albumId,
                                title: albumTitle,
                                artist: albumArtist,
                                albumDir: albumDir,
                                year: trackObj.year,
                                genre: trackObj.genre,
                                coverPath: coverPath,
                                coverUrl: coverPath ? `/api/v1/art/${albumId}` : null,
                                trackCount: 0,
                                tracks: []
                            });
                        }
                        const albumObj = newAlbums.get(albumId);
                        albumObj.trackCount++;
                        albumObj.tracks.push(trackObj);
                        if (!albumObj.coverPath && coverPath) {
                            albumObj.coverPath = coverPath;
                            albumObj.coverUrl = `/api/v1/art/${albumId}`;
                        }
                        if (!albumObj.year && trackObj.year) {
                            albumObj.year = trackObj.year;
                        }

                        // Aggregate Artists (both track artist and primary album artist)
                        const artistNamesToTrack = new Set([artistName, albumArtist]);
                        for (const aName of artistNamesToTrack) {
                            if (!aName) continue;
                            if (!newArtists.has(aName)) {
                                newArtists.set(aName, {
                                    name: aName,
                                    trackCount: 0,
                                    albumCount: 0,
                                    albums: new Set()
                                });
                            }
                            const artistObj = newArtists.get(aName);
                            artistObj.trackCount++;
                            artistObj.albums.add(albumId);
                        }
                    }
                }
            }
        };

        for (const dir of this.musicDirs) {
            if (fs.existsSync(dir)) {
                walk(dir);
            }
        }

        // Sort tracks inside each album by track number or title
        for (const [_, alb] of newAlbums.entries()) {
            alb.tracks.sort((a, b) => {
                const numA = parseInt(a.trackNumber, 10);
                const numB = parseInt(b.trackNumber, 10);
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                return (a.title || '').localeCompare(b.title || '');
            });
        }

        // Finalize artist album counts
        for (const [_, art] of newArtists.entries()) {
            art.albumCount = art.albums.size;
            art.albums = Array.from(art.albums);
        }

        this.tracks = newTracks;
        this.tracksById = newTracksById;
        this.artists = newArtists;
        this.albums = newAlbums;
        this.lastScanTime = Date.now();
        this.isScanning = false;

        return {
            totalTracks: this.tracks.length,
            totalAlbums: this.albums.size,
            totalArtists: this.artists.size,
            lastScanTime: this.lastScanTime
        };
    }

    getTrack(id) {
        return this.tracksById.get(id) || null;
    }

    getAlbum(id) {
        return this.albums.get(id) || null;
    }

    getArtist(name) {
        return this.artists.get(name) || null;
    }

    listTracks({ query = '', artist = '', album = '', page = 1, limit = 50, sort = 'title', order = 'asc' } = {}) {
        let results = this.tracks;

        if (query) {
            const q = query.toLowerCase().trim();
            results = results.filter(t =>
                (t.title && t.title.toLowerCase().includes(q)) ||
                (t.artist && t.artist.toLowerCase().includes(q)) ||
                (t.album && t.album.toLowerCase().includes(q)) ||
                (t.fileName && t.fileName.toLowerCase().includes(q)) ||
                (t.genre && t.genre.toLowerCase().includes(q))
            );
        }

        if (artist) {
            const a = artist.toLowerCase().trim();
            results = results.filter(t => t.artist && t.artist.toLowerCase().includes(a));
        }

        if (album) {
            const alb = album.toLowerCase().trim();
            results = results.filter(t => t.album && t.album.toLowerCase().includes(alb));
        }

        // Sorting
        results.sort((a, b) => {
            const valA = (a[sort] || '').toString().toLowerCase();
            const valB = (b[sort] || '').toString().toLowerCase();
            return order === 'desc' ? valB.localeCompare(valA) : valA.localeCompare(valB);
        });

        const total = results.length;
        const offset = (page - 1) * limit;
        const paged = results.slice(offset, offset + limit);

        return {
            total,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            totalPages: Math.ceil(total / limit) || 1,
            tracks: paged
        };
    }

    listAlbums({ query = '', page = 1, limit = 100 } = {}) {
        let results = Array.from(this.albums.values());

        if (query) {
            const q = query.toLowerCase().trim();
            results = results.filter(a =>
                (a.title && a.title.toLowerCase().includes(q)) ||
                (a.artist && a.artist.toLowerCase().includes(q))
            );
        }

        results.sort((a, b) => a.title.localeCompare(b.title));
        const total = results.length;
        const offset = (page - 1) * limit;
        const paged = results.slice(offset, offset + limit);

        return {
            total,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            totalPages: Math.ceil(total / limit) || 1,
            albums: paged
        };
    }

    listArtists({ query = '', page = 1, limit = 100 } = {}) {
        let results = Array.from(this.artists.values());

        if (query) {
            const q = query.toLowerCase().trim();
            results = results.filter(a => a.name && a.name.toLowerCase().includes(q));
        }

        results.sort((a, b) => a.name.localeCompare(b.name));
        const total = results.length;
        const offset = (page - 1) * limit;
        const paged = results.slice(offset, offset + limit);

        return {
            total,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            totalPages: Math.ceil(total / limit) || 1,
            artists: paged
        };
    }
}

module.exports = { LibraryService };
