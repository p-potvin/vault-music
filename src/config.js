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
    
    // Tailscale Services Integration
    COMET_URL: process.env.COMET_URL || 'http://100.67.25.118:5173',
    JACKETT_URL: process.env.JACKETT_URL || 'http://100.67.25.118:9117',
    JACKETT_API_KEY: process.env.JACKETT_API_KEY || '',
    QBITTORRENT_URL: process.env.QBITTORRENT_URL || 'http://100.67.25.118:8080',
    QBITTORRENT_USER: process.env.QBITTORRENT_USER || 'admin',
    QBITTORRENT_PASS: process.env.QBITTORRENT_PASS || '',
    
    SUPPORTED_AUDIO_EXT: new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac', '.opus', '.wma', '.aiff'])
};
