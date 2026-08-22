const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { extractAudioFileMetadata } = require('../musicbrainz/tag-reader');

class LibraryService {
    constructor(musicDir = config.MUSIC_DIR) {
        this.musicDir = path.resolve(musicDir);
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
                    if (entry.name !== '.thumbs' && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                        walk(fullPath);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (config.SUPPORTED_AUDIO_EXT.has(ext)) {
                        const trackMeta = extractAudioFileMetadata(fullPath);
                        const trackId = this.generateId(fullPath);
                        const albumDir = path.dirname(fullPath);
                        const albumId = this.generateId(albumDir);

                        // Look for local album cover
                        let coverPath = null;
                        const potentialCovers = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'front.jpg'];
                        for (const name of potentialCovers) {
                            const p = path.join(albumDir, name);
                            if (fs.existsSync(p)) {
                                coverPath = p;
                                break;
                            }
                        }

                        const artistName = trackMeta.effectiveArtist || 'Unknown Artist';
                        const albumTitle = trackMeta.effectiveAlbum || 'Unknown Album';
                        const trackTitle = trackMeta.effectiveTitle || path.basename(fullPath, ext);

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
                                artist: artistName,
                                albumDir: albumDir,
                                year: trackObj.year,
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

                        // Aggregate Artist
                        if (!newArtists.has(artistName)) {
                            newArtists.set(artistName, {
                                name: artistName,
                                trackCount: 0,
                                albumCount: 0,
                                albums: new Set()
                            });
                        }
                        const artistObj = newArtists.get(artistName);
                        artistObj.trackCount++;
                        artistObj.albums.add(albumId);
                    }
                }
            }
        };

        if (fs.existsSync(this.musicDir)) {
            walk(this.musicDir);
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
            const q = query.toLowerCase();
            results = results.filter(t =>
                t.title.toLowerCase().includes(q) ||
                t.artist.toLowerCase().includes(q) ||
                t.album.toLowerCase().includes(q)
            );
        }

        if (artist) {
            const a = artist.toLowerCase();
            results = results.filter(t => t.artist.toLowerCase() === a);
        }

        if (album) {
            const alb = album.toLowerCase();
            results = results.filter(t => t.album.toLowerCase() === alb);
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

    listAlbums({ query = '', page = 1, limit = 50 } = {}) {
        let results = Array.from(this.albums.values());

        if (query) {
            const q = query.toLowerCase();
            results = results.filter(a =>
                a.title.toLowerCase().includes(q) ||
                a.artist.toLowerCase().includes(q)
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

    listArtists({ query = '', page = 1, limit = 50 } = {}) {
        let results = Array.from(this.artists.values());

        if (query) {
            const q = query.toLowerCase();
            results = results.filter(a => a.name.toLowerCase().includes(q));
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
