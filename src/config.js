const path = require('path');
require('dotenv').config();

const primaryMusicDir = process.env.MUSIC_DIR || 'G:\\Music';
const secondaryMusicDir = process.env.SECONDARY_MUSIC_DIR || 'I:\\Music';

module.exports = {
    PORT: parseInt(process.env.PORT, 10) || 8733,
    HOST: process.env.HOST || '0.0.0.0',
    MUSIC_DIR: primaryMusicDir,
    MUSIC_DIRS: [primaryMusicDir, secondaryMusicDir].filter(Boolean),
    DOWNLOADS_DIR: process.env.DOWNLOADS_DIR || path.join(primaryMusicDir, 'Downloads'),
    APPLE_MUSIC_SOURCE_DIR: process.env.APPLE_MUSIC_SOURCE_DIR || path.join(process.env.USERPROFILE || 'C:\\Users\\Administrator', 'Music', 'Apple Music'),
    APPLE_MUSIC_BACKUP_DIR: process.env.APPLE_MUSIC_BACKUP_DIR || path.join(primaryMusicDir, 'AppleMusic_Backup'),
    MAX_LIBRARY_SIZE_GB: parseFloat(process.env.MAX_LIBRARY_SIZE_GB) || 35.0,

    LOCAL_DB_PATH: process.env.LOCAL_DB_PATH || 'I:\\Musicbrainz\\musicbrainz_local.sqlite',
    MUSICBRAINZ_HOST: process.env.MUSICBRAINZ_HOST || 'musicbrainz.org',
    MUSICBRAINZ_RPS: parseFloat(process.env.MUSICBRAINZ_RPS) || 1,

    // Lidarr Music Manager Integration (vps-ovhcloud / media stack)
    LIDARR_URL: process.env.LIDARR_URL || 'http://100.67.25.118:8686',
    LIDARR_API_KEY: process.env.LIDARR_API_KEY || '',

    // Local PC Services Integration (100.71.101.21 / localhost)
    JACKETT_URL: process.env.JACKETT_URL || 'http://127.0.0.1:9117',
    JACKETT_API_KEY: process.env.JACKETT_API_KEY || '',
    QBITTORRENT_URL: process.env.QBITTORRENT_URL || 'http://127.0.0.1:8082',
    QBITTORRENT_USER: process.env.QBITTORRENT_USER || 'vault-music',
    QBITTORRENT_PASS: process.env.QBITTORRENT_PASS || '',

    SUPPORTED_AUDIO_EXT: new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac', '.opus', '.wma', '.aiff'])
};
