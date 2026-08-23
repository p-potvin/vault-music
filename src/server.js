const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

const { LibraryService } = require('./services/library-service');
const { MetadataService } = require('./services/metadata-service');
const { DownloadService } = require('./services/download-service');
const { ProfileService } = require('./services/profile-service');

const { createLibraryRouter } = require('./routes/library');
const { createStreamRouter } = require('./routes/stream');
const { createMetadataRouter } = require('./routes/metadata');
const { createDownloadsRouter } = require('./routes/downloads');
const { createProfilesRouter } = require('./routes/profiles');
const { setupSwagger } = require('./docs/swagger');

const app = express();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'Authorization', 'x-vw-token', 'x-device-id']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Services Initialization
const libraryService = new LibraryService(config.MUSIC_DIR);
const profileService = new ProfileService();
const metadataService = new MetadataService({
    localDbPath: config.LOCAL_DB_PATH,
    host: config.MUSICBRAINZ_HOST,
    rps: config.MUSICBRAINZ_RPS
});
const downloadService = new DownloadService({
    jackettUrl: config.JACKETT_URL,
    jackettApiKey: config.JACKETT_API_KEY,
    qbittorrentUrl: config.QBITTORRENT_URL,
    qbittorrentUser: config.QBITTORRENT_USER,
    qbittorrentPass: config.QBITTORRENT_PASS,
    downloadsDir: config.DOWNLOADS_DIR
});

// Setup Swagger UI & OpenAPI Specification at /docs & /openapi.json
setupSwagger(app);

// Mount API Routes
const apiRouter = express.Router();
apiRouter.use('/', createLibraryRouter(libraryService));
apiRouter.use('/', createStreamRouter(libraryService));
apiRouter.use('/profiles', createProfilesRouter(profileService, libraryService));
apiRouter.use('/metadata', createMetadataRouter(metadataService, libraryService));
apiRouter.use('/downloads', createDownloadsRouter(downloadService));

app.use('/api/v1', apiRouter);

// Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'vault-music',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        library: {
            tracks: libraryService.tracks.length,
            albums: libraryService.albums.size,
            artists: libraryService.artists.size,
            lastScan: libraryService.lastScanTime
        },
        metadata: {
            localDbAvailable: metadataService.localDb.isAvailable,
            localDbPath: metadataService.localDb.dbPath,
            remoteHost: metadataService.client.host
        }
    });
});

// Serve Front-End Web Client
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/docs') || req.path.startsWith('/openapi.json')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
if (require.main === module) {
    const server = app.listen(config.PORT, config.HOST, () => {
        console.log('======================================================================');
        console.log(` 🎵 VAULT MUSIC SERVER STARTED                                         `);
        console.log('======================================================================');
        console.log(` Port / Host      : http://${config.HOST}:${config.PORT}`);
        console.log(` Tailnet Gateway  : https://music.vaultwares.ca`);
        console.log(` OpenAPI / Docs   : http://${config.HOST}:${config.PORT}/docs`);
        console.log(` Music Directory  : ${config.MUSIC_DIR}`);
        console.log(` Local MB DB      : ${metadataService.localDb.isAvailable ? '✓ Available' : '✗ Offline'} (${config.LOCAL_DB_PATH})`);
        console.log('======================================================================\n');

        // Initial scan in background
        console.log('Indexing music library in background...');
        libraryService.scanLibrary();
        console.log(`✓ Indexed ${libraryService.tracks.length} track(s) across ${libraryService.albums.size} album(s).\n`);
    });

    process.on('SIGINT', () => {
        server.close(() => {
            console.log('Vault Music server shut down.');
            process.exit(0);
        });
    });
}

module.exports = { app, libraryService, metadataService, downloadService, profileService };
