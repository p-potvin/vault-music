/**
 * Vault Music — Dual Phone & Desktop Audio Controller + Offline PWA Engine
 */

document.addEventListener('DOMContentLoaded', async () => {
    let tracks = [];
    let currentTrackIndex = -1;
    let currentTrackObj = null;
    let isPlaying = false;
    let cachedTrackIds = new Set();
    const audio = document.getElementById('audio-element');

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW registration failed:', err));
    }

    // Load initial cached track IDs
    async function refreshCachedIds() {
        try {
            const offlineTracks = await getAllOfflineTracks();
            cachedTrackIds = new Set(offlineTracks.map(t => t.id));
            document.querySelectorAll('.offline-badge-count').forEach(el => el.innerText = cachedTrackIds.size);
        } catch (_) {}
    }
    await refreshCachedIds();

    // UI Element References
    const tracksContainer = document.getElementById('tracks-container');
    const albumsGrid = document.getElementById('albums-grid');
    const artistsGrid = document.getElementById('artists-grid');
    const offlineContainer = document.getElementById('offline-tracks-container');
    const phoneSearchInput = document.getElementById('phone-search-input');
    const desktopSearchInput = document.getElementById('desktop-search-input');

    // Mini Player Elements
    const miniPlayer = document.getElementById('mini-player');
    const miniArt = document.getElementById('mini-art');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniProgressBar = document.getElementById('mini-progress-bar');
    const btnMiniPlay = document.getElementById('btn-mini-play');
    const btnMiniPrev = document.getElementById('btn-mini-prev');
    const btnMiniNext = document.getElementById('btn-mini-next');

    // Full-Screen Sheet Elements
    const sheet = document.getElementById('now-playing-sheet');
    const btnCloseSheet = document.getElementById('btn-close-sheet');
    const sheetArt = document.getElementById('sheet-art');
    const sheetTitle = document.getElementById('sheet-title');
    const sheetArtist = document.getElementById('sheet-artist');
    const sheetSeekBar = document.getElementById('sheet-seek-bar');
    const sheetCurrentTime = document.getElementById('sheet-current-time');
    const sheetDurationTime = document.getElementById('sheet-duration-time');
    const btnSheetPlay = document.getElementById('btn-sheet-play');
    const btnSheetPrev = document.getElementById('btn-sheet-prev');
    const btnSheetNext = document.getElementById('btn-sheet-next');
    const btnSheetDownload = document.getElementById('btn-sheet-download');
    const btnSheetOffline = document.getElementById('btn-sheet-offline');

    // Format seconds to M:SS
    function formatTime(sec) {
        if (!sec || isNaN(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // Toggle Phone / Desktop Mode on demand
    const btnSwitchMode = document.getElementById('btn-switch-mode');
    if (btnSwitchMode) {
        btnSwitchMode.addEventListener('click', () => {
            document.body.classList.toggle('phone-mode-active');
            const isPhone = document.body.classList.contains('phone-mode-active');
            btnSwitchMode.querySelector('span').innerText = isPhone ? '💻 Switch to Desktop UI' : '📱 Switch to Phone UI';
        });
    }

    // Navigation Switcher (Desktop & Mobile Navs)
    function switchTab(tabId) {
        document.querySelectorAll('.nav-btn, .m-nav-item').forEach(b => {
            if (b.dataset.tab === tabId) b.classList.add('active');
            else b.classList.remove('active');
        });

        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const target = document.getElementById(`tab-${tabId}`);
        if (target) target.classList.add('active');

        if (tabId === 'albums') loadAlbums();
        if (tabId === 'artists') loadArtists();
        if (tabId === 'offline') loadOfflineTab();
        if (tabId === 'metadata') pollMetadataStatus();
        if (tabId === 'downloads') loadDownloadQueue();
    }

    document.querySelectorAll('.nav-btn, .m-nav-item').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Expand Mini-Player to Full Sheet on Mobile
    document.getElementById('mini-track-info').addEventListener('click', () => {
        sheet.classList.add('open');
    });
    btnCloseSheet.addEventListener('click', () => {
        sheet.classList.remove('open');
    });

    // Load Tracks
    async function loadTracks(query = '') {
        try {
            const url = query ? `/api/v1/tracks?query=${encodeURIComponent(query)}` : '/api/v1/tracks?limit=250';
            const res = await fetch(url);
            const data = await res.json();
            tracks = data.tracks || [];
            document.getElementById('tracks-count').innerText = data.total || 0;

            tracksContainer.innerHTML = '';
            if (tracks.length === 0) {
                tracksContainer.innerHTML = `<div class="empty-state">No tracks found. Click "Scan Library" to index.</div>`;
                return;
            }

            tracks.forEach((t, i) => {
                const isCached = cachedTrackIds.has(t.id);
                const row = document.createElement('div');
                row.className = 'track-row';
                row.innerHTML = `
                    <div class="track-main-info">
                        <div class="track-number">${i + 1}</div>
                        <div class="track-texts">
                            <div class="track-title">${t.title}</div>
                            <div class="track-sub">${t.artist} • ${t.album}</div>
                        </div>
                    </div>
                    <div class="track-actions">
                        <button class="track-action-btn btn-offline ${isCached ? 'cached' : ''}" title="Cache Offline in PWA">
                            <span>${isCached ? 'Saved' : 'Save'}</span> 💾
                        </button>
                        <button class="track-action-btn btn-direct-download" title="Download to iOS Files / iCloud">
                            <span>Get</span> ⬇️
                        </button>
                    </div>
                `;

                // Play track when clicking main row
                row.querySelector('.track-main-info').addEventListener('click', () => playTrack(i));

                // Save to IndexedDB Offline Cache
                const btnOffline = row.querySelector('.btn-offline');
                btnOffline.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    btnOffline.innerText = 'Saving...';
                    try {
                        await saveTrackOffline(t);
                        await refreshCachedIds();
                        btnOffline.className = 'track-action-btn btn-offline cached';
                        btnOffline.innerHTML = '<span>Saved</span> 💾';
                    } catch (err) {
                        alert('Failed to cache track: ' + err.message);
                    }
                });

                // Direct file download for iOS Files / iCloud Drive
                const btnDl = row.querySelector('.btn-direct-download');
                btnDl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const a = document.createElement('a');
                    a.href = `/api/v1/download/${t.id}`;
                    a.download = `${t.artist} - ${t.title}.mp3`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                });

                tracksContainer.appendChild(row);
            });
        } catch (err) {
            console.error('Failed to load tracks:', err);
        }
    }

    // Load Offline Tab
    async function loadOfflineTab() {
        try {
            const offlineTracks = await getAllOfflineTracks();
            const usage = await getOfflineStorageUsage();
            document.getElementById('offline-stats-summary').innerText = `${usage.count} tracks cached • ${usage.formattedSize} used`;

            offlineContainer.innerHTML = '';
            if (offlineTracks.length === 0) {
                offlineContainer.innerHTML = `<div class="empty-state">No offline tracks saved yet. Tap "Save 💾" next to any song to store it for offline airplane-mode playback.</div>`;
                return;
            }

            offlineTracks.forEach((t, i) => {
                const row = document.createElement('div');
                row.className = 'track-row';
                const sizeMb = (t.size / (1024 * 1024)).toFixed(1);
                row.innerHTML = `
                    <div class="track-main-info">
                        <div class="track-number">${i + 1}</div>
                        <div class="track-texts">
                            <div class="track-title">${t.title}</div>
                            <div class="track-sub">${t.artist} • ${sizeMb} MB</div>
                        </div>
                    </div>
                    <div class="track-actions">
                        <button class="track-action-btn" style="color: #ef4444;" title="Remove from offline cache">🗑️</button>
                    </div>
                `;

                row.querySelector('.track-main-info').addEventListener('click', () => {
                    playOfflineBlob(t);
                });

                row.querySelector('.track-actions button').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await removeTrackOffline(t.id);
                    await refreshCachedIds();
                    loadOfflineTab();
                });

                offlineContainer.appendChild(row);
            });
        } catch (err) {
            console.error('Failed to load offline tab:', err);
        }
    }

    // Playback Controller
    async function playTrack(index) {
        if (index < 0 || index >= tracks.length) return;
        currentTrackIndex = index;
        currentTrackObj = tracks[index];

        // Check if track is cached offline in IndexedDB
        const offlineItem = await getOfflineTrack(currentTrackObj.id);
        if (offlineItem && offlineItem.blob) {
            playOfflineBlob(offlineItem);
            return;
        }

        audio.src = currentTrackObj.streamUrl;
        audio.play().catch(e => console.warn('Audio play prevented:', e));
        updatePlayerUI(currentTrackObj);
    }

    function playOfflineBlob(offlineTrack) {
        currentTrackObj = offlineTrack;
        const blobUrl = URL.createObjectURL(offlineTrack.blob);
        audio.src = blobUrl;
        audio.play().catch(e => console.warn('Audio play prevented:', e));
        updatePlayerUI(offlineTrack);
    }

    function updatePlayerUI(t) {
        isPlaying = true;
        const artHtml = t.coverUrl ? `<img src="${t.coverUrl}">` : '🎵';

        miniTitle.innerText = t.title;
        miniArtist.innerText = `${t.artist} — ${t.album}`;
        miniArt.innerHTML = artHtml;
        btnMiniPlay.innerText = '⏸';

        sheetTitle.innerText = t.title;
        sheetArtist.innerText = `${t.artist} • ${t.album}`;
        sheetArt.innerHTML = artHtml;
        btnSheetPlay.innerText = '⏸';

        // Update iOS Lockscreen / MediaSession Controls
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: t.title,
                artist: t.artist,
                album: t.album,
                artwork: t.coverUrl ? [{ src: t.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : []
            });

            navigator.mediaSession.setActionHandler('play', () => { audio.play(); isPlaying = true; updatePlayButtons(); });
            navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); isPlaying = false; updatePlayButtons(); });
            navigator.mediaSession.setActionHandler('previoustrack', () => { if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1); });
            navigator.mediaSession.setActionHandler('nexttrack', () => { if (currentTrackIndex < tracks.length - 1) playTrack(currentTrackIndex + 1); });
            navigator.mediaSession.setActionHandler('seekto', (details) => { if (details.seekTime) audio.currentTime = details.seekTime; });
        }

        // Direct Download link on Now Playing Sheet
        btnSheetDownload.onclick = () => {
            window.location.href = `/api/v1/download/${t.id}`;
        };

        btnSheetOffline.onclick = async () => {
            btnSheetOffline.innerText = '⏳';
            await saveTrackOffline(t);
            await refreshCachedIds();
            btnSheetOffline.innerText = '✓';
        };
    }

    function updatePlayButtons() {
        const char = audio.paused ? '▶' : '⏸';
        btnMiniPlay.innerText = char;
        btnSheetPlay.innerText = char;
    }

    function togglePlayPause() {
        if (!audio.src || currentTrackIndex === -1) {
            if (tracks.length > 0) playTrack(0);
            return;
        }
        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
        updatePlayButtons();
    }

    btnMiniPlay.addEventListener('click', (e) => { e.stopPropagation(); togglePlayPause(); });
    btnSheetPlay.addEventListener('click', togglePlayPause);

    btnMiniPrev.addEventListener('click', (e) => { e.stopPropagation(); if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1); });
    btnSheetPrev.addEventListener('click', () => { if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1); });

    btnMiniNext.addEventListener('click', (e) => { e.stopPropagation(); if (currentTrackIndex < tracks.length - 1) playTrack(currentTrackIndex + 1); });
    btnSheetNext.addEventListener('click', () => { if (currentTrackIndex < tracks.length - 1) playTrack(currentTrackIndex + 1); });

    audio.addEventListener('timeupdate', () => {
        if (!isNaN(audio.duration) && audio.duration > 0) {
            const pct = (audio.currentTime / audio.duration) * 100;
            miniProgressBar.style.width = `${pct}%`;
            sheetSeekBar.value = pct;
            sheetCurrentTime.innerText = formatTime(audio.currentTime);
            sheetDurationTime.innerText = formatTime(audio.duration);
        }
    });

    audio.addEventListener('ended', () => {
        if (currentTrackIndex < tracks.length - 1) playTrack(currentTrackIndex + 1);
        else updatePlayButtons();
    });

    sheetSeekBar.addEventListener('input', () => {
        if (audio.duration) audio.currentTime = (sheetSeekBar.value / 100) * audio.duration;
    });

    // Search filters
    let searchTimer = null;
    const handleSearch = (val) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadTracks(val.trim()), 200);
    };

    if (phoneSearchInput) phoneSearchInput.addEventListener('input', (e) => handleSearch(e.target.value));
    if (desktopSearchInput) desktopSearchInput.addEventListener('input', (e) => handleSearch(e.target.value));

    // Initial Load
    loadTracks();
});
