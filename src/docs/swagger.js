const swaggerUi = require('swagger-ui-express');

const openApiSpec = {
    openapi: '3.0.3',
    info: {
        title: 'Vault Music API',
        version: '1.0.0',
        description: 'Internal Tailscale Audio Streaming, Local MusicBrainz Metadata Engine, and Download Manager for VaultWares.',
        contact: {
            name: 'VaultWares',
            email: 'contact@vaultwares.ca',
            url: 'https://vaultwares.ca'
        }
    },
    servers: [
        {
            url: 'https://music.vaultwares.ca',
            description: 'Greencloud Tailnet HTTPS Gateway'
        },
        {
            url: 'http://100.71.101.21:8733',
            description: 'Direct Tailscale Node (Clopeux-Desktop)'
        },
        {
            url: 'http://localhost:8733',
            description: 'Local Development Server'
        }
    ],
    tags: [
        { name: 'Streaming', description: 'HTTP byte-range audio & album artwork streaming' },
        { name: 'Library', description: 'Music library indexing, artists, albums, and tracks' },
        { name: 'Profiles', description: 'Tailscale device identification, custom views, and view duplication' },
        { name: 'Playlists', description: 'Shared playlists across all Tailscale devices' },
        { name: 'Metadata', description: 'MusicBrainz local database & online metadata matching' },
        { name: 'Downloads', description: 'Local Jackett torrent search and qBittorrent download manager' },
        { name: 'System', description: 'Health checks and server status' }
    ],
    paths: {
        '/health': {
            get: {
                tags: ['System'],
                summary: 'Server health check',
                responses: {
                    200: {
                        description: 'Server is healthy',
                        content: {
                            'application/json': {
                                example: { status: 'healthy', uptime: 120.4, service: 'vault-music' }
                            }
                        }
                    }
                }
            }
        },
        '/api/v1/stream/{trackId}': {
            get: {
                tags: ['Streaming'],
                summary: 'Stream audio file by track ID',
                description: 'Streams the audio file supporting HTTP 206 Partial Content (Range requests) for seeking in HTML5 players.',
                parameters: [
                    {
                        name: 'trackId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        description: 'Unique 16-character MD5 track ID'
                    }
                ],
                responses: {
                    200: { description: 'Full audio stream' },
                    206: { description: 'Partial audio stream (byte-range chunk)' },
                    404: { description: 'Track not found' }
                }
            }
        },
        '/api/v1/art/{albumId}': {
            get: {
                tags: ['Streaming'],
                summary: 'Get album cover image',
                parameters: [
                    {
                        name: 'albumId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    200: { description: 'Album cover image (JPEG/PNG)' },
                    404: { description: 'Artwork not found' }
                }
            }
        },
        '/api/v1/tracks': {
            get: {
                tags: ['Library'],
                summary: 'List tracks with search and pagination',
                parameters: [
                    { name: 'query', in: 'query', schema: { type: 'string' }, description: 'Search term for title/artist/album' },
                    { name: 'artist', in: 'query', schema: { type: 'string' } },
                    { name: 'album', in: 'query', schema: { type: 'string' } },
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
                    { name: 'sort', in: 'query', schema: { type: 'string', default: 'title' } },
                    { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } }
                ],
                responses: {
                    200: { description: 'Paginated list of tracks' }
                }
            }
        },
        '/api/v1/tracks/{id}': {
            get: {
                tags: ['Library'],
                summary: 'Get track details',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    200: { description: 'Track details' },
                    404: { description: 'Track not found' }
                }
            }
        },
        '/api/v1/albums': {
            get: {
                tags: ['Library'],
                summary: 'List all albums',
                parameters: [
                    { name: 'query', in: 'query', schema: { type: 'string' } },
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
                ],
                responses: {
                    200: { description: 'Paginated list of albums' }
                }
            }
        },
        '/api/v1/albums/{id}': {
            get: {
                tags: ['Library'],
                summary: 'Get album details and tracklist',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    200: { description: 'Album details with full tracklist' },
                    404: { description: 'Album not found' }
                }
            }
        },
        '/api/v1/artists': {
            get: {
                tags: ['Library'],
                summary: 'List all artists',
                parameters: [
                    { name: 'query', in: 'query', schema: { type: 'string' } },
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
                ],
                responses: {
                    200: { description: 'Paginated list of artists' }
                }
            }
        },
        '/api/v1/artists/{name}': {
            get: {
                tags: ['Library'],
                summary: 'Get artist details and songs',
                parameters: [
                    { name: 'name', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    200: { description: 'Artist details' },
                    404: { description: 'Artist not found' }
                }
            }
        },
        '/api/v1/library/scan': {
            post: {
                tags: ['Library'],
                summary: 'Trigger immediate library re-scan',
                responses: {
                    200: { description: 'Scan results summary' }
                }
            }
        },
        '/api/v1/profiles/me': {
            get: {
                tags: ['Profiles'],
                summary: 'Get current Tailscale device profile & custom homeView',
                responses: { 200: { description: 'Device profile and custom home layout' } }
            },
            post: {
                tags: ['Profiles'],
                summary: 'Update device name or homeView configuration',
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    homeView: { type: 'object' }
                                }
                            }
                        }
                    }
                },
                responses: { 200: { description: 'Updated device profile' } }
            }
        },
        '/api/v1/profiles': {
            get: {
                tags: ['Profiles'],
                summary: 'List all connected Tailscale devices/profiles',
                responses: { 200: { description: 'List of devices' } }
            }
        },
        '/api/v1/profiles/clone-view': {
            post: {
                tags: ['Profiles'],
                summary: 'Duplicate view and home screen preferences from another device',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    sourceDeviceId: { type: 'string' }
                                },
                                required: ['sourceDeviceId']
                            }
                        }
                    }
                },
                responses: { 200: { description: 'Cloned device view' } }
            }
        },
        '/api/v1/profiles/playlists/all': {
            get: {
                tags: ['Playlists'],
                summary: 'List all shared playlists across devices',
                responses: { 200: { description: 'List of playlists' } }
            }
        },
        '/api/v1/profiles/playlists': {
            post: {
                tags: ['Playlists'],
                summary: 'Create a new shared playlist',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    trackIds: { type: 'array', items: { type: 'string' } }
                                },
                                required: ['name']
                            }
                        }
                    }
                },
                responses: { 201: { description: 'Created playlist' } }
            }
        },
        '/api/v1/metadata/status': {
            get: {
                tags: ['Metadata'],
                summary: 'Get status of MusicBrainz metadata engine & local database',
                responses: {
                    200: { description: 'Metadata service status' }
                }
            }
        },
        '/api/v1/metadata/match-track': {
            post: {
                tags: ['Metadata'],
                summary: 'Match a single audio file against local SQLite DB and MusicBrainz API',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    trackId: { type: 'string' },
                                    filePath: { type: 'string' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: { description: 'Metadata match results' }
                }
            }
        },
        '/api/v1/metadata/populate': {
            post: {
                tags: ['Metadata'],
                summary: 'Start background metadata population job for library tracks',
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    downloadArt: { type: 'boolean', default: true },
                                    writeNfo: { type: 'boolean', default: true },
                                    writeJson: { type: 'boolean', default: true },
                                    limit: { type: 'integer', default: 0 }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: { description: 'Job started status' }
                }
            }
        },
        '/api/v1/downloads/search': {
            get: {
                tags: ['Downloads'],
                summary: 'Search torrent indexers (Jackett / Comet) for audio releases',
                parameters: [
                    { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
                    { name: 'category', in: 'query', schema: { type: 'integer', default: 3000 } }
                ],
                responses: {
                    200: { description: 'Torrent search results' }
                }
            }
        },
        '/api/v1/downloads/add': {
            post: {
                tags: ['Downloads'],
                summary: 'Push magnet link or torrent URL to qBittorrent',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    magnetUrl: { type: 'string' },
                                    torrentUrl: { type: 'string' },
                                    savePath: { type: 'string' },
                                    category: { type: 'string', default: 'music' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: { description: 'Download added status' }
                }
            }
        },
        '/api/v1/downloads/queue': {
            get: {
                tags: ['Downloads'],
                summary: 'Get active download queue from qBittorrent',
                parameters: [
                    { name: 'category', in: 'query', schema: { type: 'string', default: 'music' } }
                ],
                responses: {
                    200: { description: 'Active torrent downloads' }
                }
            }
        }
    }
};

function setupSwagger(app) {
    app.get('/openapi.json', (req, res) => {
        res.json(openApiSpec);
    });

    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
        customCss: `
            .swagger-ui .topbar { background-color: #0d1117; }
            .swagger-ui { background-color: #0b0813; color: #f0f6fc; }
        `,
        customSiteTitle: 'Vault Music API Documentation'
    }));
}

module.exports = { setupSwagger, openApiSpec };
