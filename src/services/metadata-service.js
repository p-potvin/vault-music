const fs = require('fs');
const path = require('path');
const config = require('../config');
const { MusicBrainzClient } = require('../musicbrainz/client');
const { LocalMusicBrainzDb } = require('../musicbrainz/local-db');
const { extractAudioFileMetadata } = require('../musicbrainz/tag-reader');
const { generateAlbumNfo, generateArtistNfo } = require('../musicbrainz/nfo-generator');

class MetadataService {
    constructor(options = {}) {
        this.localDb = new LocalMusicBrainzDb(options.localDbPath || config.LOCAL_DB_PATH);
        this.client = new MusicBrainzClient({
            host: options.host || config.MUSICBRAINZ_HOST,
            rps: options.rps || config.MUSICBRAINZ_RPS
        });
        this.status = {
            isRunning: false,
            total: 0,
            processed: 0,
            matched: 0,
            unmatched: 0,
            coversDownloaded: 0,
            nfosWritten: 0,
            startTime: null,
            lastRun: null,
            currentTrack: ''
        };
    }

    getStatus() {
        return {
            ...this.status,
            localDbAvailable: this.localDb.isAvailable,
            localDbPath: this.localDb.dbPath,
            remoteHost: this.client.host
        };
    }

    async matchSingleTrack(filePath) {
        const fileMeta = extractAudioFileMetadata(filePath);
        const searchParams = {
            title: fileMeta.effectiveTitle,
            artist: fileMeta.effectiveArtist,
            album: fileMeta.effectiveAlbum
        };

        let result = null;
        let source = 'none';

        if (this.localDb.isAvailable) {
            result = this.localDb.searchRecording(searchParams);
            if (result) source = 'local_db';
        }

        if (!result) {
            result = await this.client.searchRecording(searchParams);
            if (result) source = 'musicbrainz_api';
        }

        return {
            filePath,
            fileMeta,
            metadata: result,
            source
        };
    }

    async populateLibrary(tracks, { downloadArt = true, writeNfo = true, writeJson = true } = {}) {
        if (this.status.isRunning) return { error: 'Population job is already running' };

        this.status = {
            isRunning: true,
            total: tracks.length,
            processed: 0,
            matched: 0,
            unmatched: 0,
            coversDownloaded: 0,
            nfosWritten: 0,
            startTime: Date.now(),
            lastRun: null,
            currentTrack: ''
        };

        const results = [];
        const albumTracksMap = new Map();

        // Run processing asynchronously
        (async () => {
            try {
                for (const track of tracks) {
                    this.status.currentTrack = `${track.artist} - ${track.title}`;
                    const match = await this.matchSingleTrack(track.filePath);
                    this.status.processed++;

                    if (match.metadata) {
                        this.status.matched++;
                        results.push(match);

                        const albumDir = path.dirname(track.filePath);
                        if (!albumTracksMap.has(albumDir)) {
                            albumTracksMap.set(albumDir, []);
                        }
                        albumTracksMap.get(albumDir).push(match);
                    } else {
                        this.status.unmatched++;
                    }
                }

                // Process Album Art & NFOs
                for (const [albumDir, albumMatches] of albumTracksMap.entries()) {
                    if (albumMatches.length === 0) continue;
                    const primary = albumMatches[0].metadata;
                    const albumTitle = primary.album || albumMatches[0].fileMeta.effectiveAlbum || path.basename(albumDir);
                    const artistName = primary.artist || albumMatches[0].fileMeta.effectiveArtist || path.basename(path.dirname(albumDir));
                    let coverUrl = '';

                    if (downloadArt && (primary.releaseMbid || primary.releaseGroupMbid)) {
                        const coverPath = path.join(albumDir, 'cover.jpg');
                        if (!fs.existsSync(coverPath)) {
                            try {
                                const art = await this.client.getCoverArt(primary.releaseMbid, primary.releaseGroupMbid);
                                if (art && art.image) {
                                    coverUrl = art.thumbnails?.['500'] || art.image;
                                    const dl = await this.client.downloadImage(coverUrl, coverPath);
                                    if (dl.success) this.status.coversDownloaded++;
                                }
                            } catch (_) {}
                        }
                    }

                    if (writeNfo) {
                        const albumNfoPath = path.join(albumDir, 'album.nfo');
                        const nfoXml = generateAlbumNfo({
                            album: albumTitle,
                            artist: artistName,
                            year: primary.releaseYear,
                            releaseDate: primary.releaseDate,
                            genres: primary.genres,
                            releaseMbid: primary.releaseMbid,
                            artistMbid: primary.artistMbid,
                            coverUrl
                        });
                        fs.writeFileSync(albumNfoPath, nfoXml, 'utf8');
                        this.status.nfosWritten++;

                        const artistDir = path.dirname(albumDir);
                        const artistNfoPath = path.join(artistDir, 'artist.nfo');
                        if (!fs.existsSync(artistNfoPath)) {
                            const artistXml = generateArtistNfo({
                                artist: artistName,
                                artistSortName: primary.artistSortName,
                                artistMbid: primary.artistMbid,
                                artistCountry: primary.artistCountry,
                                genres: primary.genres
                            });
                            fs.writeFileSync(artistNfoPath, artistXml, 'utf8');
                        }
                    }

                    if (writeJson) {
                        const albumJsonPath = path.join(albumDir, 'album.json');
                        const albumData = {
                            album: albumTitle,
                            artist: artistName,
                            year: primary.releaseYear,
                            releaseDate: primary.releaseDate,
                            genres: primary.genres,
                            musicbrainz: {
                                releaseMbid: primary.releaseMbid,
                                releaseGroupMbid: primary.releaseGroupMbid,
                                artistMbid: primary.artistMbid
                            },
                            tracks: albumMatches.map(m => ({
                                file: path.basename(m.filePath),
                                title: m.metadata.title,
                                artist: m.metadata.artist,
                                trackNumber: m.metadata.trackNumber,
                                recordingMbid: m.metadata.recordingMbid
                            }))
                        };
                        fs.writeFileSync(albumJsonPath, JSON.stringify(albumData, null, 2), 'utf8');
                    }
                }
            } finally {
                this.status.isRunning = false;
                this.status.lastRun = new Date().toISOString();
                this.status.currentTrack = '';
            }
        })();

        return { started: true, total: tracks.length };
    }
}

module.exports = { MetadataService };
