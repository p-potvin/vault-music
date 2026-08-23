const path = require('path');
require('dotenv').config();

module.exports = {
    PORT: parseInt(process.env.PORT, 10) || 8733,
    HOST: process.env.HOST || '0.0.0.0',
    MUSIC_DIR: process.env.MUSIC_DIR || 'G:\\Music',
    DOWNLOADS_DIR: process.env.DOWNLOADS_DIR || 'G:\\Music\\Downloads',
    LOCAL_DB_PATH: process.env.LOCAL_DB_PATH || 'I:\\Musicbrainz\\musicbrainz_local.sqlite',
    MUSICBRAINZ_HOST: process.env.MUSICBRAINZ_HOST || 'musicbrainz.org',
    MUSICBRAINZ_RPS: parseFloat(process.env.MUSICBRAINZ_RPS) || 1,

    // Local PC Services Integration (100.71.101.21 / localhost)
    JACKETT_URL: process.env.JACKETT_URL || 'http://127.0.0.1:9117',
    JACKETT_API_KEY: process.env.JACKETT_API_KEY || '',
    QBITTORRENT_URL: process.env.QBITTORRENT_URL || 'http://127.0.0.1:8081',
    QBITTORRENT_USER: process.env.QBITTORRENT_USER || '',
    QBITTORRENT_PASS: process.env.QBITTORRENT_PASS || '',

    SUPPORTED_AUDIO_EXT: new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac', '.opus', '.wma', '.aiff'])
};
