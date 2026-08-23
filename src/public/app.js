/**
 * Vault Music — Apple Music Interface with Vaultsqware Obsidian & Iris
 */

document.addEventListener('DOMContentLoaded', async () => {
    let tracks = [];
    let playlists = [];
    let currentProfile = null;
    let currentTrackIndex = -1;
    let currentTrackObj = null;
    let isPlaying = false;
    let cachedTrackIds = new Set();
    let pendingTrackToAdd = null;
    const audio = document.getElementById('audio-element');

    // Display formatted today date for Apple Music "Listen Now" header
    const dateEl = document.getElementById('ios-today-date');
    if (dateEl) {
        const now = new Date();
        const options = { weekday: 'long', month: 'long', day: 'numeric' };
        dateEl.innerText = now.toLocaleDateString('en-US', options).toUpperCase();
    }

    // Generate or retrieve unique device token in localStorage if not on Tailscale header
    let clientDeviceId = localStorage.getItem('vault_music_device_id');
    if (!clientDeviceId) {
        clientDeviceId = 'ts-' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('vault_music_device_id', clientDeviceId);
    }

    // Helper for API requests with device header
    async function apiFetch(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'x-device-id': clientDeviceId,
            ...(options.headers || {})
        };
        return fetch(url, { ...options, headers });
    }

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW registration failed:', err));
    }

    // Refresh cached IDs from IndexedDB
    async function refreshCachedIds() {
        try {
            const offlineTracks = await getAllOfflineTracks();
            cachedTrackIds = new Set(offlineTracks.map(t => t.id));
            document.querySelectorAll('.offline-badge-count').forEach(el => el.innerText = cachedTrackIds.size);
        } catch (_) {}
    }
    await refreshCachedIds();

    // DOM Elements
    const tracksContainer = document.getElementById('tracks-container');
    const albumsGrid = document.getElementById('albums-grid');
    const artistsGrid = document.getElementById('artists-grid');
    const offlineContainer = document.getElementById('offline-tracks-container');
    const playlistsGrid = document.getElementById('playlists-grid');
    const pinnedPlaylistsGrid = document.getElementById('pinned-playlists-grid');
    const homeFavoritesContainer = document.getElementById('home-favorites-container');
    const phoneSearchInput = document.getElementById('phone-search-input');
    const desktopSearchInput = document.getElementById('desktop-search-input');

    // Modals
    const profileModal = document.getElementById('profile-modal');
    const playlistModal = document.getElementById('playlist-modal');
    const addToPlaylistModal = document.getElementById('add-to-playlist-modal');
    const inputDeviceName = document.getElementById('input-device-name');
    const selectSourceDevice = document.getElementById('select-source-device');
    const inputPlaylistName = document.getElementById('input-playlist-name');
    const playlistsPickerList = document.getElementById('playlists-picker-list');

    // Mini Player Elements
    const miniPlayer = document.getElementById('mini-player');
    const miniArt = document.getElementById('mini-art');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniProgressBar = document.getElementById('mini-progress-bar');
    const btnMiniPlay = document.getElementById('btn-mini-play');
    const btnMiniNext = document.getElementById('btn-mini-next');
    const btnMiniFav = document.getElementById('btn-mini-fav');

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
    const btnSheetFav = document.getElementById('btn-sheet-fav');
    const btnSheetDownload = document.getElementById('btn-sheet-download');
    const btnSheetOffline = document.getElementById('btn-sheet-offline');

    function formatTime(sec) {
        if (!sec || isNaN(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // Toggle Phone / Desktop Mode
    const btnSwitchMode = document.getElementById('btn-switch-mode');
    if (btnSwitchMode) {
        btnSwitchMode.addEventListener('click', () => {
            document.body.classList.toggle('phone-mode-active');
            const isPhone = document.body.classList.contains('phone-mode-active');
            btnSwitchMode.querySelector('span').innerText = isPhone ? '💻 Switch to Desktop UI' : '📱 Switch to Phone UI';
        });
    }

    // Navigation Switcher (Desktop & Apple Tab Bars)
    window.switchTab = function(tabId) {
        document.querySelectorAll('.nav-btn, .apple-tab').forEach(b => {
            if (b.dataset.tab === tabId) b.classList.add('active');
            else b.classList.remove('active');
        });

        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const target = document.getElementById(`tab-${tabId}`);
        if (target) target.classList.add('active');

        if (tabId === 'home') loadHomeTab();
        if (tabId === 'tracks') loadTracks();
        if (tabId === 'albums') loadAlbums();
        if (tabId === 'playlists') loadPlaylistsTab();
        if (tabId === 'offline') loadOfflineTab();
        if (tabId === 'downloads') loadDownloadQueue();
    };

    document.querySelectorAll('.nav-btn, .apple-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Expand Mini-Player to Full Sheet
    document.getElementById('mini-track-info').addEventListener('click', () => sheet.classList.add('open'));
    btnCloseSheet.addEventListener('click', () => sheet.classList.remove('open'));

    // =========================================================================
    // Device Profile & View Duplication Engine
    // =========================================================================

    async function loadCurrentProfile() {
        try {
            const res = await apiFetch('/api/v1/profiles/me');
            currentProfile = await res.json();

            const name = currentProfile.name || 'iPhone';
            document.getElementById('current-device-name').innerText = name;
            document.getElementById('mobile-device-tag').innerText = name;
            document.getElementById('device-meta-details').innerText = `Device ID: ${currentProfile.deviceId} | IP: ${currentProfile.clientIp || '100.71.101.21'}`;
            inputDeviceName.value = name;
        } catch (err) {
            console.error('Failed to load profile:', err);
        }
    }

    async function openProfileModal() {
        await loadCurrentProfile();
        try {
            const res = await apiFetch('/api/v1/profiles');
            const devices = await res.json();
            selectSourceDevice.innerHTML = '';
            
            const otherDevices = devices.filter(d => d.deviceId !== currentProfile.deviceId);
            if (otherDevices.length === 0) {
                selectSourceDevice.innerHTML = '<option value="">No other connected devices detected</option>';
            } else {
                otherDevices.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.deviceId;
                    opt.innerText = `${d.name} (${d.clientIp || 'Tailnet'}) — ${d.homeView?.pinnedPlaylistIds?.length || 0} pinned, ${d.homeView?.favoriteTrackIds?.length || 0} favs`;
                    selectSourceDevice.appendChild(opt);
                });
            }
        } catch (_) {}
        profileModal.classList.add('open');
    }

    document.getElementById('btn-open-profile-modal').addEventListener('click', openProfileModal);
    document.getElementById('btn-mobile-open-profile').addEventListener('click', openProfileModal);
    document.getElementById('btn-close-profile-modal').addEventListener('click', () => profileModal.classList.remove('open'));

    // Save Device Name
    document.getElementById('btn-save-profile-name').addEventListener('click', async () => {
        const newName = inputDeviceName.value.trim();
        if (newName) {
            await apiFetch('/api/v1/profiles/me', {
                method: 'POST',
                body: JSON.stringify({ name: newName })
            });
            await loadCurrentProfile();
            profileModal.classList.remove('open');
        }
    });

    // Duplicate View from Source Device
    document.getElementById('btn-confirm-clone-view').addEventListener('click', async () => {
        const sourceDeviceId = selectSourceDevice.value;
        if (!sourceDeviceId) {
            alert('Please select a source device to clone.');
            return;
        }

        try {
            const res = await apiFetch('/api/v1/profiles/clone-view', {
                method: 'POST',
                body: JSON.stringify({ sourceDeviceId })
            });
            const data = await res.json();
            if (data.success) {
                profileModal.classList.remove('open');
                await loadCurrentProfile();
                await loadHomeTab();
                alert('✓ Device view duplicated successfully!');
            } else {
                alert('Failed to clone view: ' + (data.error || 'Unknown error'));
            }
        } catch (err) {
            alert('Error cloning view: ' + err.message);
        }
    });

    // =========================================================================
    // Home Tab Rendering (Listen Now)
    // =========================================================================

    async function loadHomeTab() {
        if (!currentProfile) await loadCurrentProfile();
        const pinnedIds = currentProfile?.homeView?.pinnedPlaylistIds || [];
        const favIds = currentProfile?.homeView?.favoriteTrackIds || [];

        document.getElementById('home-fav-count').innerText = favIds.length;

        // Render Pinned Playlists
        await loadPlaylistsData();
        pinnedPlaylistsGrid.innerHTML = '';
        const pinnedPls = playlists.filter(pl => pinnedIds.includes(pl.id));

        if (pinnedPls.length === 0) {
            pinnedPlaylistsGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    No pinned playlists on this device yet. Go to <a href="#" onclick="switchTab('playlists'); return false;" style="color: var(--vwsq-iris-400);">Playlists</a> and tap the 📌 pin button!
                </div>
            `;
        } else {
            pinnedPls.forEach(pl => {
                const card = document.createElement('div');
                card.className = 'playlist-card';
                card.innerHTML = `
                    <div class="pl-card-top">
                        <span class="pl-card-icon">📂</span>
                        <button class="pl-card-pin-btn pinned" title="Unpin from Home">📌</button>
                    </div>
                    <div class="pl-card-title">${pl.name}</div>
                    <div class="pl-card-owner">by ${pl.ownerName || 'Shared'}</div>
                    <div class="pl-card-meta">${pl.trackIds.length} track(s)</div>
                `;

                card.addEventListener('click', () => openPlaylist(pl.id));
                card.querySelector('.pl-card-pin-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await togglePinPlaylist(pl.id);
                    loadHomeTab();
                });
                pinnedPlaylistsGrid.appendChild(card);
            });
        }

        // Render Favorite Tracks
        homeFavoritesContainer.innerHTML = '';
        if (favIds.length === 0) {
            homeFavoritesContainer.innerHTML = `<div class="empty-state">No favorite songs yet. Tap the ❤️ button on any song to add it here!</div>`;
        } else {
            if (tracks.length === 0) await loadTracksData();
            const favTracks = tracks.filter(t => favIds.includes(t.id));
            renderTrackList(favTracks, homeFavoritesContainer);
        }
    }

    // =========================================================================
    // Tracks Tab & Big Touch Track Rendering
    // =========================================================================

    async function loadTracksData(query = '') {
        const url = query ? `/api/v1/tracks?query=${encodeURIComponent(query)}` : '/api/v1/tracks?limit=300';
        const res = await fetch(url);
        const data = await res.json();
        tracks = data.tracks || [];
        document.getElementById('tracks-count').innerText = data.total || 0;
        return tracks;
    }

    async function loadTracks(query = '') {
        await loadTracksData(query);
        renderTrackList(tracks, tracksContainer);
    }

    function renderTrackList(trackList, container) {
        container.innerHTML = '';
        if (trackList.length === 0) {
            container.innerHTML = `<div class="empty-state">No songs found.</div>`;
            return;
        }

        const favIds = new Set(currentProfile?.homeView?.favoriteTrackIds || []);

        trackList.forEach((t, i) => {
            const isCached = cachedTrackIds.has(t.id);
            const isFav = favIds.has(t.id);
            const isPlayingThis = currentTrackObj && currentTrackObj.id === t.id;
            const artHtml = t.coverUrl ? `<img src="${t.coverUrl}">` : '🎵';

            const row = document.createElement('div');
            row.className = `track-row ${isPlayingThis ? 'playing' : ''}`;
            row.innerHTML = `
                <div class="track-main-info">
                    <div class="track-art-thumb">${artHtml}</div>
                    <div class="track-texts">
                        <div class="track-title">${t.title}</div>
                        <div class="track-sub">${t.artist} — ${t.album}</div>
                    </div>
                </div>
                <div class="track-actions">
                    <button class="track-action-btn btn-fav ${isFav ? 'fav-active' : ''}" title="Favorite">
                        ${isFav ? '❤️' : '🤍'}
                    </button>
                    <button class="track-action-btn btn-add-pl" title="Add to Playlist">
                        <span>+</span>
                    </button>
                    <button class="track-action-btn btn-offline ${isCached ? 'cached' : ''}" title="Cache Offline">
                        <span>${isCached ? 'Saved' : 'Save'}</span> 💾
                    </button>
                    <button class="track-action-btn btn-direct-download" title="Download to iOS Files">
                        <span>Get</span> ⬇️
                    </button>
                </div>
            `;

            // Play track
            row.querySelector('.track-main-info').addEventListener('click', () => {
                tracks = trackList;
                playTrack(i);
            });

            // Toggle Favorite
            const btnFav = row.querySelector('.btn-fav');
            btnFav.addEventListener('click', async (e) => {
                e.stopPropagation();
                const res = await apiFetch('/api/v1/profiles/favorite', {
                    method: 'POST',
                    body: JSON.stringify({ trackId: t.id })
                });
                const data = await res.json();
                btnFav.innerText = data.isFavorite ? '❤️' : '🤍';
                btnFav.classList.toggle('fav-active', data.isFavorite);
                if (currentProfile) currentProfile.homeView.favoriteTrackIds = data.favoriteTrackIds;
            });

            // Add to Playlist modal trigger
            row.querySelector('.btn-add-pl').addEventListener('click', (e) => {
                e.stopPropagation();
                openAddToPlaylistModal(t.id);
            });

            // Offline Cache
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

            // Direct Download for iOS Files
            const btnDl = row.querySelector('.btn-direct-download');
            btnDl.addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.href = `/api/v1/download/${t.id}`;
            });

            container.appendChild(row);
        });
    }

    // =========================================================================
    // Shared Playlists Tab
    // =========================================================================

    async function loadPlaylistsData() {
        try {
            const res = await apiFetch('/api/v1/profiles/playlists/all');
            playlists = await res.json();
            document.getElementById('desktop-pl-count').innerText = playlists.length;
            return playlists;
        } catch (_) {
            return [];
        }
    }

    async function loadPlaylistsTab() {
        await loadPlaylistsData();
        playlistsGrid.innerHTML = '';

        if (playlists.length === 0) {
            playlistsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">No playlists created yet. Tap "+ New" to start!</div>`;
            return;
        }

        const pinnedIds = new Set(currentProfile?.homeView?.pinnedPlaylistIds || []);

        playlists.forEach(pl => {
            const isPinned = pinnedIds.has(pl.id);
            const card = document.createElement('div');
            card.className = 'playlist-card';
            card.innerHTML = `
                <div class="pl-card-top">
                    <span class="pl-card-icon">📂</span>
                    <button class="pl-card-pin-btn ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Unpin from Home' : 'Pin to Home'}">
                        ${isPinned ? '📌' : '📍'}
                    </button>
                </div>
                <div class="pl-card-title">${pl.name}</div>
                <div class="pl-card-owner">by ${pl.ownerName || 'Shared'}</div>
                <div class="pl-card-meta">${pl.trackIds.length} song(s)</div>
            `;

            card.addEventListener('click', () => openPlaylist(pl.id));
            card.querySelector('.pl-card-pin-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                await togglePinPlaylist(pl.id);
                loadPlaylistsTab();
            });

            playlistsGrid.appendChild(card);
        });
    }

    async function togglePinPlaylist(playlistId) {
        if (!currentProfile) await loadCurrentProfile();
        const pinned = new Set(currentProfile.homeView.pinnedPlaylistIds || []);
        if (pinned.has(playlistId)) pinned.delete(playlistId);
        else pinned.add(playlistId);

        currentProfile.homeView.pinnedPlaylistIds = Array.from(pinned);
        await apiFetch('/api/v1/profiles/me', {
            method: 'POST',
            body: JSON.stringify({ homeView: currentProfile.homeView })
        });
    }

    async function openPlaylist(playlistId) {
        try {
            const res = await apiFetch(`/api/v1/profiles/playlists/${playlistId}`);
            const pl = await res.json();
            switchTab('tracks');
            tracks = pl.tracks || [];
            document.querySelector('#tab-tracks .ios-large-title').innerText = pl.name;
            renderTrackList(tracks, tracksContainer);
        } catch (err) {
            alert('Failed to load playlist: ' + err.message);
        }
    }

    // Create Playlist Modal Handlers
    function openCreatePlaylistModal() {
        inputPlaylistName.value = '';
        playlistModal.classList.add('open');
    }

    document.getElementById('btn-new-playlist-top').addEventListener('click', openCreatePlaylistModal);
    document.getElementById('btn-create-playlist-main').addEventListener('click', openCreatePlaylistModal);
    document.getElementById('btn-close-playlist-modal').addEventListener('click', () => playlistModal.classList.remove('open'));

    document.getElementById('btn-confirm-create-pl').addEventListener('click', async () => {
        const name = inputPlaylistName.value.trim();
        if (!name) return;

        await apiFetch('/api/v1/profiles/playlists', {
            method: 'POST',
            body: JSON.stringify({ name, trackIds: [] })
        });

        playlistModal.classList.remove('open');
        await loadPlaylistsTab();
    });

    // Add Track to Playlist Picker Modal
    async function openAddToPlaylistModal(trackId) {
        pendingTrackToAdd = trackId;
        await loadPlaylistsData();
        playlistsPickerList.innerHTML = '';

        if (playlists.length === 0) {
            playlistsPickerList.innerHTML = `<div class="empty-state">No playlists found. Create one first!</div>`;
        } else {
            playlists.forEach(pl => {
                const item = document.createElement('div');
                item.className = 'picker-item';
                item.innerHTML = `
                    <span>📂 ${pl.name}</span>
                    <span style="font-size: 12px; color: var(--vwsq-console-text-dim);">${pl.trackIds.length} songs</span>
                `;
                item.addEventListener('click', async () => {
                    await apiFetch(`/api/v1/profiles/playlists/${pl.id}/tracks`, {
                        method: 'POST',
                        body: JSON.stringify({ trackId: pendingTrackToAdd })
                    });
                    addToPlaylistModal.classList.remove('open');
                    alert(`✓ Added to "${pl.name}"`);
                });
                playlistsPickerList.appendChild(item);
            });
        }
        addToPlaylistModal.classList.add('open');
    }

    document.getElementById('btn-close-add-pl-modal').addEventListener('click', () => addToPlaylistModal.classList.remove('open'));

    // =========================================================================
    // Offline Tab
    // =========================================================================

    async function loadOfflineTab() {
        try {
            const offlineTracks = await getAllOfflineTracks();
            const usage = await getOfflineStorageUsage();
            document.getElementById('offline-stats-summary').innerText = `${usage.count} songs • ${usage.formattedSize}`;

            offlineContainer.innerHTML = '';
            if (offlineTracks.length === 0) {
                offlineContainer.innerHTML = `<div class="empty-state">No downloaded songs yet. Tap "Save 💾" next to any track to store it for offline playback.</div>`;
                return;
            }

            offlineTracks.forEach((t, i) => {
                const row = document.createElement('div');
                row.className = 'track-row';
                const sizeMb = (t.size / (1024 * 1024)).toFixed(1);
                row.innerHTML = `
                    <div class="track-main-info">
                        <div class="track-art-thumb">💾</div>
                        <div class="track-texts">
                            <div class="track-title">${t.title}</div>
                            <div class="track-sub">${t.artist} • ${sizeMb} MB</div>
                        </div>
                    </div>
                    <div class="track-actions">
                        <button class="track-action-btn" style="color: #ef4444;" title="Remove from cache">🗑️</button>
                    </div>
                `;

                row.querySelector('.track-main-info').addEventListener('click', () => playOfflineBlob(t));
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

    // =========================================================================
    // Playback Engine & Audio Player
    // =========================================================================

    async function playTrack(index) {
        if (index < 0 || index >= tracks.length) return;
        currentTrackIndex = index;
        currentTrackObj = tracks[index];

        const offlineItem = await getOfflineTrack(currentTrackObj.id);
        if (offlineItem && offlineItem.blob) {
            playOfflineBlob(offlineItem);
            return;
        }

        audio.src = currentTrackObj.streamUrl;
        audio.play().catch(e => console.warn('Audio play error:', e));
        updatePlayerUI(currentTrackObj);
    }

    function playOfflineBlob(offlineTrack) {
        currentTrackObj = offlineTrack;
        const blobUrl = URL.createObjectURL(offlineTrack.blob);
        audio.src = blobUrl;
        audio.play().catch(e => console.warn('Audio play error:', e));
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

        const isFav = currentProfile?.homeView?.favoriteTrackIds?.includes(t.id);
        btnMiniFav.innerText = isFav ? '❤️' : '🤍';
        btnSheetFav.innerText = isFav ? '❤️' : '🤍';

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

        btnSheetDownload.onclick = () => { window.location.href = `/api/v1/download/${t.id}`; };
        btnSheetOffline.onclick = async () => {
            btnSheetOffline.querySelector('span').innerText = '⏳ Saving...';
            await saveTrackOffline(t);
            await refreshCachedIds();
            btnSheetOffline.querySelector('span').innerText = '✓ Saved Offline';
        };

        const toggleFavHandler = async () => {
            const res = await apiFetch('/api/v1/profiles/favorite', {
                method: 'POST',
                body: JSON.stringify({ trackId: t.id })
            });
            const data = await res.json();
            btnMiniFav.innerText = data.isFavorite ? '❤️' : '🤍';
            btnSheetFav.innerText = data.isFavorite ? '❤️' : '🤍';
            if (currentProfile) currentProfile.homeView.favoriteTrackIds = data.favoriteTrackIds;
        };

        btnMiniFav.onclick = (e) => { e.stopPropagation(); toggleFavHandler(); };
        btnSheetFav.onclick = toggleFavHandler;
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
        if (audio.paused) audio.play();
        else audio.pause();
        updatePlayButtons();
    }

    btnMiniPlay.addEventListener('click', (e) => { e.stopPropagation(); togglePlayPause(); });
    btnSheetPlay.addEventListener('click', togglePlayPause);
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
        searchTimer = setTimeout(() => {
            switchTab('tracks');
            loadTracks(val.trim());
        }, 200);
    };

    if (phoneSearchInput) phoneSearchInput.addEventListener('input', (e) => handleSearch(e.target.value));
    if (desktopSearchInput) desktopSearchInput.addEventListener('input', (e) => handleSearch(e.target.value));

    // Initial App Load
    await loadCurrentProfile();
    await loadHomeTab();
});
