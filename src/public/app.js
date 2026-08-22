document.addEventListener('DOMContentLoaded', () => {
    let tracks = [];
    let currentTrackIndex = -1;
    const audio = document.getElementById('audio-element');

    // UI Elements
    const tracksList = document.getElementById('tracks-list');
    const albumsGrid = document.getElementById('albums-grid');
    const artistsGrid = document.getElementById('artists-grid');
    const searchInput = document.getElementById('search-input');
    const btnPlayPause = document.getElementById('btn-play-pause');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const seekBar = document.getElementById('seek-bar');
    const currentTimeEl = document.getElementById('current-time');
    const durationTimeEl = document.getElementById('duration-time');
    const volSlider = document.getElementById('vol-slider');
    const playerTitle = document.getElementById('player-title');
    const playerArtist = document.getElementById('player-artist');
    const playerArt = document.getElementById('player-art');

    // Format seconds to M:SS
    function formatTime(sec) {
        if (!sec || isNaN(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // Tab Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const tabId = `tab-${btn.dataset.tab}`;
            const target = document.getElementById(tabId);
            if (target) target.classList.add('active');

            if (btn.dataset.tab === 'albums') loadAlbums();
            if (btn.dataset.tab === 'artists') loadArtists();
            if (btn.dataset.tab === 'metadata') pollMetadataStatus();
            if (btn.dataset.tab === 'downloads') loadDownloadQueue();
        });
    });

    // Load Tracks
    async function loadTracks(query = '') {
        try {
            const url = query ? `/api/v1/tracks?query=${encodeURIComponent(query)}` : '/api/v1/tracks?limit=200';
            const res = await fetch(url);
            const data = await res.json();
            tracks = data.tracks || [];
            document.getElementById('tracks-count').innerText = data.total || 0;

            tracksList.innerHTML = '';
            if (tracks.length === 0) {
                tracksList.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: #8b949e;">No tracks found. Click "Scan Library" to index audio files.</td></tr>`;
                return;
            }

            tracks.forEach((t, i) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-family: var(--font-mono); color: var(--text-muted);">${i + 1}</td>
                    <td style="font-weight: 600;">${t.title}</td>
                    <td>${t.artist}</td>
                    <td style="color: var(--text-muted);">${t.album}</td>
                    <td style="font-family: var(--font-mono); font-size: 11px;">${t.year || '-'}</td>
                    <td>
                        <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px;">▶ Play</button>
                    </td>
                `;
                tr.addEventListener('click', () => playTrack(i));
                tracksList.appendChild(tr);
            });
        } catch (err) {
            console.error('Failed to load tracks:', err);
        }
    }

    // Load Albums
    async function loadAlbums() {
        try {
            const res = await fetch('/api/v1/albums?limit=100');
            const data = await res.json();
            const albums = data.albums || [];
            document.getElementById('albums-count').innerText = data.total || 0;

            albumsGrid.innerHTML = '';
            albums.forEach(alb => {
                const card = document.createElement('div');
                card.className = 'album-card';
                card.innerHTML = `
                    <div class="album-art-wrap">
                        ${alb.coverUrl ? `<img src="${alb.coverUrl}" alt="${alb.title}">` : '💿'}
                    </div>
                    <div class="album-title">${alb.title}</div>
                    <div class="album-artist">${alb.artist} • ${alb.trackCount} tracks</div>
                `;
                card.addEventListener('click', () => {
                    document.querySelector('.nav-item[data-tab="tracks"]').click();
                    searchInput.value = alb.title;
                    loadTracks(alb.title);
                });
                albumsGrid.appendChild(card);
            });
        } catch (err) {
            console.error('Failed to load albums:', err);
        }
    }

    // Load Artists
    async function loadArtists() {
        try {
            const res = await fetch('/api/v1/artists?limit=100');
            const data = await res.json();
            const artists = data.artists || [];
            document.getElementById('artists-count').innerText = data.total || 0;

            artistsGrid.innerHTML = '';
            artists.forEach(art => {
                const card = document.createElement('div');
                card.className = 'artist-card';
                card.innerHTML = `
                    <div class="album-art-wrap">🎤</div>
                    <div class="album-title">${art.name}</div>
                    <div class="album-artist">${art.trackCount} tracks • ${art.albumCount} albums</div>
                `;
                card.addEventListener('click', () => {
                    document.querySelector('.nav-item[data-tab="tracks"]').click();
                    searchInput.value = art.name;
                    loadTracks(art.name);
                });
                artistsGrid.appendChild(card);
            });
        } catch (err) {
            console.error('Failed to load artists:', err);
        }
    }

    // Playback Logic
    function playTrack(index) {
        if (index < 0 || index >= tracks.length) return;
        currentTrackIndex = index;
        const track = tracks[index];

        audio.src = track.streamUrl;
        audio.play().catch(e => console.warn('Audio play prevented:', e));

        playerTitle.innerText = track.title;
        playerArtist.innerText = `${track.artist} — ${track.album}`;
        playerArt.innerHTML = track.coverUrl ? `<img src="${track.coverUrl}">` : '🎵';
        btnPlayPause.innerText = '⏸';

        document.querySelectorAll('.tracks-table tbody tr').forEach((tr, i) => {
            if (i === index) tr.classList.add('playing');
            else tr.classList.remove('playing');
        });
    }

    btnPlayPause.addEventListener('click', () => {
        if (!audio.src || currentTrackIndex === -1) {
            if (tracks.length > 0) playTrack(0);
            return;
        }
        if (audio.paused) {
            audio.play();
            btnPlayPause.innerText = '⏸';
        } else {
            audio.pause();
            btnPlayPause.innerText = '▶';
        }
    });

    btnPrev.addEventListener('click', () => {
        if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1);
    });

    btnNext.addEventListener('click', () => {
        if (currentTrackIndex < tracks.length - 1) playTrack(currentTrackIndex + 1);
    });

    audio.addEventListener('timeupdate', () => {
        if (!isNaN(audio.duration) && audio.duration > 0) {
            const pct = (audio.currentTime / audio.duration) * 100;
            seekBar.value = pct;
            currentTimeEl.innerText = formatTime(audio.currentTime);
            durationTimeEl.innerText = formatTime(audio.duration);
        }
    });

    audio.addEventListener('ended', () => {
        if (currentTrackIndex < tracks.length - 1) {
            playTrack(currentTrackIndex + 1);
        } else {
            btnPlayPause.innerText = '▶';
        }
    });

    seekBar.addEventListener('input', () => {
        if (audio.duration) {
            audio.currentTime = (seekBar.value / 100) * audio.duration;
        }
    });

    volSlider.addEventListener('input', () => {
        audio.volume = volSlider.value;
    });

    // Search filter
    let searchDebounce = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            loadTracks(searchInput.value.trim());
        }, 200);
    });

    // Scan Button
    document.getElementById('btn-scan').addEventListener('click', async () => {
        const btn = document.getElementById('btn-scan');
        btn.innerText = 'Scanning...';
        await fetch('/api/v1/library/scan', { method: 'POST' });
        await loadTracks();
        btn.innerHTML = '<span>🔄</span> Scan Library';
    });

    // Quick Populate & Metadata Job
    async function pollMetadataStatus() {
        try {
            const res = await fetch('/api/v1/metadata/status');
            const data = await res.json();
            const dbStatus = document.getElementById('meta-db-status');
            const jobStatus = document.getElementById('meta-job-status');
            const progressBar = document.getElementById('meta-progress-bar');
            const statsText = document.getElementById('meta-stats-text');

            dbStatus.innerText = data.localDbAvailable
                ? `Active (Loaded from ${data.localDbPath})`
                : `Offline (Using MusicBrainz API at ${data.remoteHost})`;
            dbStatus.style.color = data.localDbAvailable ? '#10b981' : '#f59e0b';

            if (data.isRunning) {
                const pct = data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0;
                jobStatus.innerText = `Running (${pct}%) — ${data.currentTrack || 'Matching...'}`;
                progressBar.style.width = `${pct}%`;
                statsText.innerText = `${data.matched} matched / ${data.total} total (${data.coversDownloaded} covers, ${data.nfosWritten} NFOs)`;
                setTimeout(pollMetadataStatus, 1500);
            } else {
                jobStatus.innerText = data.lastRun ? `Completed at ${new Date(data.lastRun).toLocaleTimeString()}` : 'Idle';
                progressBar.style.width = '100%';
            }
        } catch (_) {}
    }

    document.getElementById('btn-start-populate').addEventListener('click', async () => {
        await fetch('/api/v1/metadata/populate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ downloadArt: true, writeNfo: true, writeJson: true })
        });
        pollMetadataStatus();
    });

    document.getElementById('btn-populate-quick').addEventListener('click', () => {
        document.querySelector('.nav-item[data-tab="metadata"]').click();
        document.getElementById('btn-start-populate').click();
    });

    // Torrent search (Jackett / Comet)
    document.getElementById('btn-search-torrents').addEventListener('click', async () => {
        const query = document.getElementById('torrent-search-input').value.trim();
        if (!query) return;
        const btn = document.getElementById('btn-search-torrents');
        const list = document.getElementById('torrents-results-list');
        btn.innerText = 'Searching...';
        list.innerHTML = `<tr><td colspan="5" style="text-align:center;">Searching Jackett & Comet...</td></tr>`;

        try {
            const res = await fetch(`/api/v1/downloads/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            const results = data.results || [];
            list.innerHTML = '';

            if (results.length === 0) {
                list.innerHTML = `<tr><td colspan="5" style="text-align:center; color: #8b949e;">No torrents found for "${query}".</td></tr>`;
            } else {
                results.forEach(item => {
                    const tr = document.createElement('tr');
                    const sizeMb = item.size ? (item.size / (1024 * 1024)).toFixed(1) + ' MB' : '-';
                    tr.innerHTML = `
                        <td style="font-weight: 600;">${item.title}</td>
                        <td>${item.tracker}</td>
                        <td style="font-family: var(--font-mono); font-size: 11px;">${sizeMb}</td>
                        <td style="color: #10b981; font-weight: 600;">${item.seeders || 0}</td>
                        <td><button class="btn btn-primary btn-sm" style="padding: 4px 8px; font-size: 11px;">Download</button></td>
                    `;
                    tr.querySelector('button').addEventListener('click', async () => {
                        await fetch('/api/v1/downloads/add', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ magnetUrl: item.magnetUri, torrentUrl: item.link })
                        });
                        alert(`Sent "${item.title}" to qBittorrent!`);
                        loadDownloadQueue();
                    });
                    list.appendChild(tr);
                });
            }
        } catch (err) {
            list.innerHTML = `<tr><td colspan="5" style="text-align:center; color: #ef4444;">Search failed: ${err.message}</td></tr>`;
        } finally {
            btn.innerText = 'Search Indexers';
        }
    });

    async function loadDownloadQueue() {
        try {
            const res = await fetch('/api/v1/downloads/queue');
            const data = await res.json();
            const list = document.getElementById('downloads-queue-list');
            list.innerHTML = '';
            const items = data.items || [];
            if (items.length === 0) {
                list.innerHTML = `<tr><td colspan="4" style="text-align:center; color: #8b949e;">No active music downloads in qBittorrent.</td></tr>`;
                return;
            }
            items.forEach(t => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight: 600;">${t.name}</td>
                    <td>${t.progress}</td>
                    <td style="font-family: var(--font-mono); font-size: 11px;">${(t.downloadSpeed / 1024).toFixed(0)} KB/s</td>
                    <td><span class="badge">${t.state}</span></td>
                `;
                list.appendChild(tr);
            });
        } catch (_) {}
    }

    // Initial Load
    loadTracks();
});
