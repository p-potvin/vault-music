# vault-music — agent notes

Local music server: Express API + static frontend on port 8733, fronted by
greencloud nginx at `https://music.vaultwares.ca` and the tailnet at
`100.71.101.21:8733`.

## Commands

- Run tests: `npm test` (runs `tests/run_tests.js`, all suites).
- Single suite: `node tests/<suite>_test.js`.
- Start/stop the service: `service/start.ps1` / `service/stop.ps1`.
- Register the VaultMusic task: `service/install-task.ps1`.

## Service layout

- `VaultMusic` task → `service/start-service.ps1`, which now also launches the
  dedicated qBittorrent instance before starting the API.
- `VaultStreaming-qBittorrent` task → isolated qBittorrent profile
  (`%APPDATA%\qBittorrent_VaultStreaming`), WebUI on **8082**. The user's own
  qBittorrent runs separately on **8081** — never target 8081 from app code.
- `VaultMusic-AppleMusicRefresh` task → `service/refresh-apple-music-snapshot.ps1`,
  daily at 11:00 with a 30 minute cap.

## Integrations

- **Jackett** on `127.0.0.1:9117`. The `music` tag (set per indexer in
  `C:\ProgramData\Jackett\Indexers\*.json`, `tags` config entry) selects the
  music indexers. Jackett's HTTP API does **not** expose tags, so the tag is
  resolved by reading those config files.
- Querying `/api/v2.0/indexers/all/results` is slow (tens of seconds) because it
  sweeps every configured indexer. Query the tagged indexers individually
  instead — they answer in milliseconds.
- **Lidarr** on the OVH media stack (`100.67.25.118:8686`).

## Apple Music library

- `Library.musicdb` is an `hfma` container: AES-128-ECB (key in
  `src/services/apple-musicdb-parser.js`), zlib-compressed, with flat
  length-prefixed chunks. A record chunk (`iama`/`itma`/`iAma`/`lpma`) is
  followed by its `boma` field chunks.
- Playlists are `lpma`: field `200` is the name, field `206` is one entry
  (position at byte 16, track ID at byte 28). Tracks are `itma` (fields 2/3/4 =
  title/album/artist).
- Snapshot lives at `G:\Music\AppleMusic_Backup`; refreshes are incremental via
  `snapshot_index.json` (size + mtime per file).
