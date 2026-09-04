const fs = require('fs');
const path = require('path');
const config = require('../config');
const { TagReader } = require('../musicbrainz/tag-reader');
const { MusicBrainzClient } = require('../musicbrainz/client');
const { LocalMusicBrainzDb } = require('../musicbrainz/local-db');
const { NfoGenerator } = require('../musicbrainz/nfo-generator');

class PostDownloadProcessor {
    constructor(options = {}) {
        this.downloadsDir = options.downloadsDir || config.DOWNLOADS_DIR;
        this.libraryService = options.libraryService || null;
        this.mbClient = new MusicBrainzClient({
            host: config.MUSICBRAINZ_HOST,
            rps: config.MUSICBRAINZ_RPS
        });
        this.localMbDb = new LocalMusicBrainzDb(config.LOCAL_DB_PATH);
    }

    /**
     * Scan downloads directory and populate MusicBrainz metadata for all audio files.
     */
    async processCompletedDownloads() {
        if (!fs.existsSync(this.downloadsDir)) {
            return { processedCount: 0, tracks: [] };
        }

        const audioFiles = [];
        const scan = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scan(full);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (config.SUPPORTED_AUDIO_EXT.has(ext)) {
                        audioFiles.push(full);
                    }
                }
            }
        };

        scan(this.downloadsDir);

        const results = [];
        for (const filePath of audioFiles) {
            try {
                const nfoPath = filePath.replace(/\.[^.]+$/, '.nfo');
                // Skip if already processed with .nfo
                if (fs.existsSync(nfoPath)) continue;

                const tags = await TagReader.readTags(filePath);
                const title = tags.effectiveTitle || path.basename(filePath, path.extname(filePath));
                const artist = tags.effectiveArtist || '';
                const album = tags.effectiveAlbum || '';

                // Query local MusicBrainz first
                let mbData = this.localMbDb.searchRecording({ title, artist, album });

                // If not found locally, query live MusicBrainz
                if (!mbData) {
                    const liveResults = await this.mbClient.searchRecordings({ title, artist, album, limit: 1 });
                    if (liveResults && liveResults.length > 0) {
                        mbData = liveResults[0];
                    }
                }

                if (mbData) {
                    const enriched = {
                        filePath,
                        filename: path.basename(filePath),
                        title: mbData.title || title,
                        artist: mbData.artist || artist,
                        album: mbData.album || album,
                        musicbrainzId: mbData.recordingMbid || null,
                        year: mbData.releaseYear || tags.embeddedYear || null,
                        genres: mbData.genres || tags.embeddedGenre ? [tags.embeddedGenre] : []
                    };

                    // Write .nfo sidecar
                    NfoGenerator.generateTrackNfo(enriched, nfoPath);
                    results.push(enriched);
                }
            } catch (err) {
                console.warn(`Failed to process download ${filePath}:`, err.message);
            }
        }

        // Trigger library re-index if library service is attached
        if (this.libraryService && results.length > 0) {
            this.libraryService.scanLibrary();
        }

        return {
            processedCount: results.length,
            tracks: results
        };
    }
}

module.exports = { PostDownloadProcessor };
