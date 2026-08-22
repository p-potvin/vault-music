# Vault Music (🎵)

Internal Tailscale music server for VaultWares: stream audio over HTTP, index local tracks, match metadata with local MusicBrainz dumps, and search/download new tracks via Jackett and qBittorrent.

---

## Features

- **HTTP Audio Streaming**: Native byte-range audio streaming with seeking support (`HTTP 206 Partial Content`) for MP3, FLAC, M4A, WAV, OGG, Opus, and AAC.
- **OpenAPI 3.0 & Swagger UI**: Interactive API documentation available at [`/docs`](http://localhost:8733/docs) and specification at [`/openapi.json`](http://localhost:8733/openapi.json).
- **MusicBrainz Integration**:
  - **Local SQLite Engine**: Sub-millisecond offline metadata matching using local PostgreSQL dumps (`I:\Musicbrainz\musicbrainz_local.sqlite`).
  - **Cover Art Archive & Online Client**: Fallback online client with token-bucket rate limiting and automatic 503 backoff recovery.
  - **NFO / JSON Generation**: Serializes standard Kodi/Jellyfin/Plex `album.nfo`, `artist.nfo`, and `album.json`.
- **Search & Download Pipeline**:
  - Torrent indexer queries via **Jackett** (`http://100.67.25.118:9117`) and **Comet** (`http://100.67.25.118:5173`).
  - One-click magnet pushing to **qBittorrent** (`http://100.67.25.118:8080`) directly into `G:\Music\Downloads`.
- **Tailscale & Greencloud Gateway**:
  - Reverse proxied via Greencloud at `https://music.vaultwares.ca`.
  - Direct local address on Tailnet: `http://100.71.101.21:8733`.

---

## API Endpoints

### 1. Streaming
- `GET /api/v1/stream/:trackId` — Stream audio with Range support
- `GET /api/v1/art/:albumId` — Get album cover image

### 2. Library
- `GET /api/v1/tracks` — List tracks with search, filtering, and pagination
- `GET /api/v1/tracks/:id` — Get track details
- `GET /api/v1/albums` — List all albums
- `GET /api/v1/albums/:id` — Get album details with tracklist
- `GET /api/v1/artists` — List all artists
- `GET /api/v1/artists/:name` — Get artist details and songs
- `POST /api/v1/library/scan` — Trigger library re-scan

### 3. Metadata
- `GET /api/v1/metadata/status` — Get status of local DB & online client
- `POST /api/v1/metadata/match-track` — Match single audio file
- `POST /api/v1/metadata/populate` — Start batch metadata population job

### 4. Downloads
- `GET /api/v1/downloads/search?q=...` — Search indexers for audio releases
- `POST /api/v1/downloads/add` — Push torrent/magnet to qBittorrent
- `GET /api/v1/downloads/queue` — View active qBittorrent downloads

---

## Quick Start

```powershell
# Install dependencies
npm install

# Start server
npm start

# Run unit & integration tests
npm test
```
