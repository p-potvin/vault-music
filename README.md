# Vault Music (🎵)

Internal Tailscale music server for VaultWares: stream audio over HTTP, index local tracks with native FLAC Vorbis / MP3 ID3 metadata, match metadata with local MusicBrainz dumps, and search/download new tracks via Lidarr (OVH media stack) and local Jackett / qBittorrent.

---

## Features

- **HTTP Audio Streaming**: Native byte-range audio streaming with seeking support (`HTTP 206 Partial Content`) for MP3, FLAC, M4A, WAV, OGG, Opus, and AAC.
- **OpenAPI 3.0 & Swagger UI**: Interactive API documentation available at [`/docs`](http://localhost:8733/docs) and specification at [`/openapi.json`](http://localhost:8733/openapi.json).
- **MusicBrainz & Native Tag Engine**:
  - **Native Vorbis & ID3 Parser**: Direct embedded tag reading for FLAC, OGG, MP3 without external binary dependencies.
  - **Local SQLite Engine**: Sub-millisecond offline metadata matching using a SQLite database generated from MusicBrainz TSV dumps (`I:\Musicbrainz\musicbrainz_local.sqlite`).
  - **Cover Art Archive & Online Client**: Fallback online client with token-bucket rate limiting and automatic 503 backoff recovery.
  - **NFO / JSON Generation**: Serializes standard Kodi/Jellyfin/Plex `album.nfo`, `artist.nfo`, and `album.json`.
- **Search & Download Pipeline**:
  - Music searching & release downloads via **Lidarr** on OVH (`http://100.67.25.118:8686`).
  - Local indexer queries via **Jackett** (`http://127.0.0.1:9117`) and **qBittorrent** (`http://127.0.0.1:8081`).
- **Tailscale & Greencloud Gateway**:
  - Reverse proxied via Greencloud at `https://music.vaultwares.ca`.
  - Direct local address on Tailnet: `http://100.71.101.21:8733`.
- **Windows Background Service**:
  - Supervised `VaultMusic` scheduled task with automatic port `8733` reclamation and Tailscale logon supervision.

---

## API Endpoints

### 1. Streaming

- `GET /api/v1/stream/:trackId` — Stream audio with Range support
- `GET /api/v1/art/:albumId` — Get album cover image

### 2. Library

- `GET /api/v1/tracks` — List tracks with search, filtering, and pagination
- `GET /api/v1/tracks/:id` — Get track details
- `GET /api/v1/albums` — List all albums with search
- `GET /api/v1/albums/:id` — Get album details with complete tracklist
- `GET /api/v1/artists` — List all artists with search
- `GET /api/v1/artists/:name` — Get artist discography, albums, and songs
- `POST /api/v1/library/scan` — Trigger library re-scan

### 3. Metadata

- `GET /api/v1/metadata/status` — Get status of local DB & online client
- `POST /api/v1/metadata/match-track` — Match single audio file
- `POST /api/v1/metadata/populate` — Start batch metadata population job

### 4. Downloads

- `GET /api/v1/downloads/search?q=...` — Search indexers and Lidarr for releases
- `GET /api/v1/downloads/lidarr/status` — Check Lidarr system status
- `GET /api/v1/downloads/lidarr/search?q=...` — Search Lidarr music database
- `POST /api/v1/downloads/lidarr/grab` — Grab release for download in Lidarr
- `POST /api/v1/downloads/add` — Push torrent/magnet to qBittorrent
- `GET /api/v1/downloads/queue` — View active downloads queue (Lidarr & qBittorrent)

---

## Service Management

```powershell
# Check service status
powershell.exe -File service\status.ps1

# Start service
powershell.exe -File service\start.ps1

# Stop service
powershell.exe -File service\stop.ps1
```

---

## Quick Start

```powershell
# Install dependencies
npm install

# Start server manually
npm start

# Run unit & integration tests
npm test
```
