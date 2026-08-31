/**
 * Vault Music — Client Application Engine
 * Tailnet Audio Streaming, Catppuccin SVG Icons, Interactive Mini-Player, Batch Offline Download, Swipe Gestures, Shuffle All, Playlists & Lidarr Search.
 */

document.addEventListener('DOMContentLoaded', async () => {
    let tracks = [];
    let albums = [];
    let artists = [];
    let playlists = [];
    let currentPlaylistObj = null;
    let currentTrackIndex = -1;
    let currentTrackObj = null;
    let isPlaying = false;
    let isShuffleMode = false;
    let currentProfile = null;
    let cachedTrackIds = new Set();
    let currentActiveTab = 'home';

    // Device Profile ID setup
    let deviceId = localStorage.getItem('vault_music_device_id');
    if (!deviceId) {
        deviceId = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
        localStorage.setItem('vault_music_device_id', deviceId);
    }

    // Helper for API fetch with X-Device-Id
    async function apiFetch(url, options = {}) {
        const headers = {
            'X-Device-Id': deviceId,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        return fetch(url, { ...options, headers });
    }

    // Icon helper shorthand
    const icon = (name, extraClass = '', size = 20) => {
        return window.getSvgIcon ? window.getSvgIcon(name, extraClass, size) : '';
    };

    // Initialize static icons across UI
    function initStaticIcons() {
        const setIcon = (id, name, size = 18) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = icon(name, '', size);
        };

        // Desktop nav icons
        setIcon('nav-icon-home', 'home', 18);
        setIcon('nav-icon-tracks', 'music', 18);
        setIcon('nav-icon-artists', 'users', 18);
        setIcon('nav-icon-albums', 'disc', 18);
        setIcon('nav-icon-playlists', 'folder', 18);
        setIcon('nav-icon-offline', 'save', 18);
        setIcon('nav-icon-metadata', 'sparkles', 18);
        setIcon('nav-icon-downloads', 'cloud-download', 18);
        setIcon('btn-switch-mode-icon', 'smartphone', 16);
        setIcon('nav-icon-docs', 'book', 16);

        // Mobile bottom tab icons
        setIcon('mob-icon-home', 'home', 22);
        setIcon('mob-icon-tracks', 'music', 22);
        setIcon('mob-icon-artists', 'users', 22);
        setIcon('mob-icon-albums', 'disc', 22);
        setIcon('mob-icon-playlists', 'folder', 22);
        setIcon('mob-icon-downloads', 'search', 22);

        // Mini player controls
        const btnMiniShuffle = document.getElementById('btn-mini-shuffle');
        if (btnMiniShuffle) btnMiniShuffle.innerHTML = icon('shuffle', '', 18);
        const btnMiniPrev = document.getElementById('btn-mini-prev');
        if (btnMiniPrev) btnMiniPrev.innerHTML = icon('skip-back', '', 18);
        const btnMiniPlay = document.getElementById('btn-mini-play');
        if (btnMiniPlay) btnMiniPlay.innerHTML = icon('play', '', 18);
        const btnMiniNext = document.getElementById('btn-mini-next');
        if (btnMiniNext) btnMiniNext.innerHTML = icon('skip-forward', '', 18);
        const btnMiniFav = document.getElementById('btn-mini-fav');
        if (btnMiniFav) btnMiniFav.innerHTML = icon('heart', '', 18);

        // Sheet transport controls
        const btnSheetShuffle = document.getElementById('btn-sheet-shuffle');
        if (btnSheetShuffle) btnSheetShuffle.innerHTML = icon('shuffle', '', 20);
        const btnSheetPlay = document.getElementById('btn-sheet-play');
        if (btnSheetPlay) btnSheetPlay.innerHTML = icon('play', '', 28);
        const btnSheetPrev = document.getElementById('btn-sheet-prev');
        if (btnSheetPrev) btnSheetPrev.innerHTML = icon('skip-back', '', 24);
        const btnSheetNext = document.getElementById('btn-sheet-next');
        if (btnSheetNext) btnSheetNext.innerHTML = icon('skip-forward', '', 24);
        const btnSheetFav = document.getElementById('btn-sheet-fav');
        if (btnSheetFav) btnSheetFav.innerHTML = icon('heart', '', 22);
    }
    initStaticIcons();

    // Cache refresh helper
    async function refreshCachedIds() {
        if (window.VaultOfflineDB) {
            const ids = await window.VaultOfflineDB.getCachedTrackIds();
            cachedTrackIds = new Set(ids);
            document.querySelectorAll('.offline-badge-count').forEach(el => {
                el.innerText = cachedTrackIds.size;
            });
        }
    }
    await refreshCachedIds();

    // DOM Elements
    const audio = document.getElementById('audio-element');
    const tracksContainer = document.getElementById('tracks-container');
    const albumsGrid = document.getElementById('albums-grid');
    const artistsGrid = document.getElementById('artists-grid');
    const playlistsGrid = document.getElementById('playlists-grid');
    const pinnedPlaylistsGrid = document.getElementById('pinned-playlists-grid');
    const homeFavoritesContainer = document.getElementById('home-favorites-container');
    const offlineTracksContainer = document.getElementById('offline-tracks-container');

    // Search Elements
    const phoneSearchInput = document.getElementById('phone-search-input');
    const btnClearTrackSearch = document.getElementById('btn-clear-track-search');
    const desktopSearchInput = document.getElementById('desktop-search-input');
    const artistsSearchInput = document.getElementById('artists-search-input');
    const btnClearArtistSearch = document.getElementById('btn-clear-artist-search');
    const albumsSearchInput = document.getElementById('albums-search-input');
    const btnClearAlbumSearch = document.getElementById('btn-clear-album-search');

    // Detail Views Elements
    const artistsMainView = document.getElementById('artists-main-view');
    const artistDetailView = document.getElementById('artist-detail-view');
    const btnBackToArtists = document.getElementById('btn-back-to-artists');
    const artistHeroAvatar = document.getElementById('artist-hero-avatar');
    const artistHeroName = document.getElementById('artist-hero-name');
    const artistHeroMeta = document.getElementById('artist-hero-meta');
    const btnPlayArtistAll = document.getElementById('btn-play-artist-all');
    const btnShuffleArtistAll = document.getElementById('btn-shuffle-artist-all');
    const btnDownloadArtistAll = document.getElementById('btn-download-artist-all');
    const artistAlbumsGrid = document.getElementById('artist-albums-grid');
    const artistTracksContainer = document.getElementById('artist-tracks-container');

    const albumsMainView = document.getElementById('albums-main-view');
    const albumDetailView = document.getElementById('album-detail-view');
    const btnBackToAlbums = document.getElementById('btn-back-to-albums');
    const albumHeroCover = document.getElementById('album-hero-cover');
    const albumHeroTitle = document.getElementById('album-hero-title');
    const albumHeroArtist = document.getElementById('album-hero-artist');
    const albumHeroMeta = document.getElementById('album-hero-meta');
    const btnPlayAlbumAll = document.getElementById('btn-play-album-all');
    const btnShuffleAlbumAll = document.getElementById('btn-shuffle-album-all');
    const btnDownloadAlbumAll = document.getElementById('btn-download-album-all');
    const albumTracksContainer = document.getElementById('album-tracks-container');

    const playlistsMainView = document.getElementById('playlists-main-view');
    const playlistDetailView = document.getElementById('playlist-detail-view');
    const btnBackToPlaylists = document.getElementById('btn-back-to-playlists');
    const playlistHeroName = document.getElementById('playlist-hero-name');
    const playlistHeroOwner = document.getElementById('playlist-hero-owner');
    const playlistHeroMeta = document.getElementById('playlist-hero-meta');
    const btnPlayPlaylistAll = document.getElementById('btn-play-playlist-all');
    const btnShufflePlaylistAll = document.getElementById('btn-shuffle-playlist-all');
    const btnDownloadPlaylistAll = document.getElementById('btn-download-playlist-all');
    const btnDeleteCurrentPl = document.getElementById('btn-delete-current-pl');
    const playlistTracksContainer = document.getElementById('playlist-tracks-container');

    // Mini Player Elements
    const miniPlayer = document.getElementById('mini-player');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniArt = document.getElementById('mini-art');
    const miniProgressContainer = document.getElementById('mini-progress-container');
    const miniProgressBar = document.getElementById('mini-progress-bar');
    const miniSeekSlider = document.getElementById('mini-seek-slider');
    const miniCurrentTime = document.getElementById('mini-current-time');
    const miniDurationTime = document.getElementById('mini-duration-time');
    const btnMiniShuffle = document.getElementById('btn-mini-shuffle');
    const btnMiniPrev = document.getElementById('btn-mini-prev');
    const btnMiniPlay = document.getElementById('btn-mini-play');
    const btnMiniNext = document.getElementById('btn-mini-next');
    const btnMiniFav = document.getElementById('btn-mini-fav');

    // Fullsheet Elements
    const sheet = document.getElementById('now-playing-sheet');
    const btnCloseSheet = document.getElementById('btn-close-sheet');
    const sheetTitle = document.getElementById('sheet-title');
    const sheetArtist = document.getElementById('sheet-artist');
    const sheetArt = document.getElementById('sheet-art');
    const sheetSeekBar = document.getElementById('sheet-seek-bar');
    const sheetCurrentTime = document.getElementById('sheet-current-time');
    const sheetDurationTime = document.getElementById('sheet-duration-time');
    const btnSheetShuffle = document.getElementById('btn-sheet-shuffle');
    const btnSheetPlay = document.getElementById('btn-sheet-play');
    const btnSheetPrev = document.getElementById('btn-sheet-prev');
    const btnSheetNext = document.getElementById('btn-sheet-next');
    const btnSheetFav = document.getElementById('btn-sheet-fav');
    const btnSheetDownload = document.getElementById('btn-sheet-download');
    const btnSheetOffline = document.getElementById('btn-sheet-offline');

    // Modals
    const profileModal = document.getElementById('profile-modal');
    const playlistModal = document.getElementById('playlist-modal');
    const addToPlaylistModal = document.getElementById('add-to-playlist-modal');
    const inputDeviceName = document.getElementById('input-device-name');
    const selectSourceDevice = document.getElementById('select-source-device');

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
            const modeText = document.getElementById('btn-switch-mode-text');
            if (modeText) modeText.innerText = isPhone ? 'Switch to Desktop UI' : 'Switch to Phone UI';
        });
    }

    // History API helper
    function pushNavigationState(state) {
        try {
            history.pushState(state, '', `#${state.tab || 'home'}`);
        } catch (_) {}
    }

    // Navigation Switcher (Desktop & Apple Tab Bars)
    window.switchTab = function(tabId, pushHistory = true) {
        currentActiveTab = tabId;
        if (pushHistory) {
            pushNavigationState({ tab: tabId, view: 'main' });
        }

        document.querySelectorAll('.nav-btn, .apple-tab').forEach(b => {
            if (b.dataset.tab === tabId) b.classList.add('active');
            else b.classList.remove('active');
        });

        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const target = document.getElementById(`tab-${tabId}`);
        if (target) target.classList.add('active');

        // Reset detail views when navigating directly
        if (tabId === 'artists') {
            if (artistDetailView) artistDetailView.style.display = 'none';
            if (artistsMainView) artistsMainView.style.display = 'block';
            loadArtists();
        } else if (tabId === 'albums') {
            if (albumDetailView) albumDetailView.style.display = 'none';
            if (albumsMainView) albumsMainView.style.display = 'block';
            loadAlbums();
        } else if (tabId === 'playlists') {
            if (playlistDetailView) playlistDetailView.style.display = 'none';
            if (playlistsMainView) playlistsMainView.style.display = 'block';
            loadPlaylistsTab();
        } else if (tabId === 'home') {
            loadHomeTab();
        } else if (tabId === 'tracks') {
            loadTracks();
        } else if (tabId === 'offline') {
            loadOfflineTab();
        } else if (tabId === 'downloads') {
            loadDownloadQueue();
        }
    };

    document.querySelectorAll('.nav-btn, .apple-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Expand Mini-Player to Full Sheet
    document.getElementById('mini-track-info').addEventListener('click', () => {
        sheet.classList.add('open');
        pushNavigationState({ sheetOpen: true });
    });
    btnCloseSheet.addEventListener('click', () => sheet.classList.remove('open'));

    // Handle Browser Back / Forward buttons
    window.addEventListener('popstate', (e) => {
        if (sheet.classList.contains('open')) {
            sheet.classList.remove('open');
            return;
        }

        const state = e.state;
        if (!state) {
            switchTab('home', false);
            return;
        }

        if (state.view === 'artist' && state.artistName) {
            switchTab('artists', false);
            openArtist(state.artistName, false);
        } else if (state.view === 'album' && state.albumId) {
            switchTab('albums', false);
            openAlbum(state.albumId, false);
        } else if (state.view === 'playlist' && state.playlistId) {
            switchTab('playlists', false);
            openPlaylist(state.playlistId, false);
        } else if (state.tab) {
            switchTab(state.tab, false);
        }
    });

    // =========================================================================
    // Touch Swipe Gestures Engine
    // =========================================================================
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;

    const mainViewport = document.getElementById('main-viewport');

    function handleSwipeGesture() {
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        // 1. Swipe down on fullscreen sheet to dismiss
        if (sheet.classList.contains('open') && deltaY > 70 && absY > absX) {
            sheet.classList.remove('open');
            return;
        }

        // 2. Swipe right to go back from sub-detail views
        if (deltaX > 80 && absX > absY * 1.3) {
            if (artistDetailView && artistDetailView.style.display === 'block') {
                backToArtists();
                return;
            }
            if (albumDetailView && albumDetailView.style.display === 'block') {
                backToAlbums();
                return;
            }
            if (playlistDetailView && playlistDetailView.style.display === 'block') {
                backToPlaylists();
                return;
            }
        }

        // 3. Swipe left/right between main tabs on mobile
        if (absX > 110 && absX > absY * 1.8) {
            const tabsOrder = ['home', 'tracks', 'artists', 'albums', 'playlists', 'downloads'];
            const currentIndex = tabsOrder.indexOf(currentActiveTab);
            if (currentIndex !== -1) {
                if (deltaX < -90 && currentIndex < tabsOrder.length - 1) {
                    switchTab(tabsOrder[currentIndex + 1]);
                } else if (deltaX > 90 && currentIndex > 0) {
                    switchTab(tabsOrder[currentIndex - 1]);
                }
            }
        }
    }

    if (mainViewport) {
        mainViewport.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        mainViewport.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
            handleSwipeGesture();
        }, { passive: true });
    }

    // =========================================================================
    // Shuffle & Randomizer Engine
    // =========================================================================

    function shuffleArray(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function updateShuffleUI() {
        if (btnMiniShuffle) btnMiniShuffle.classList.toggle('shuffle-active', isShuffleMode);
        if (btnSheetShuffle) btnSheetShuffle.classList.toggle('shuffle-active', isShuffleMode);
    }

    function toggleShuffleMode() {
        isShuffleMode = !isShuffleMode;
        updateShuffleUI();
    }

    if (btnMiniShuffle) btnMiniShuffle.addEventListener('click', (e) => { e.stopPropagation(); toggleShuffleMode(); });
    if (btnSheetShuffle) btnSheetShuffle.addEventListener('click', toggleShuffleMode);

    // =========================================================================
    // Batch Offline Downloader Engine
    // =========================================================================

    async function downloadTracksBatch(trackList, buttonEl, defaultLabel = 'Download All') {
        if (!trackList || trackList.length === 0) return;
        if (!window.VaultOfflineDB) {
            alert('Offline cache database is not supported in this browser.');
            return;
        }

        const textSpan = buttonEl.querySelector('.btn-text') || buttonEl;
        buttonEl.disabled = true;

        let savedCount = 0;
        let failedCount = 0;

        for (let i = 0; i < trackList.length; i++) {
            const t = trackList[i];
            textSpan.innerText = `Saving (${i + 1}/${trackList.length})...`;
            try {
                await saveTrackOffline(t);
                savedCount++;
                cachedTrackIds.add(t.id);
            } catch (err) {
                console.warn(`Failed to cache track ${t.title}:`, err);
                failedCount++;
            }
        }

        await refreshCachedIds();
        textSpan.innerText = `✓ Saved (${savedCount})`;
        setTimeout(() => {
            buttonEl.disabled = false;
            textSpan.innerText = defaultLabel;
        }, 2500);
    }

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

    // Duplicate View from Selected Device
    document.getElementById('btn-confirm-clone-view').addEventListener('click', async () => {
        const sourceDeviceId = selectSourceDevice.value;
        if (!sourceDeviceId) {
            alert('Please select a source device to clone view from.');
            return;
        }

        try {
            const res = await apiFetch('/api/v1/profiles/clone-view', {
                method: 'POST',
                body: JSON.stringify({ sourceDeviceId })
            });
            const updated = await res.json();
            currentProfile = updated;
            profileModal.classList.remove('open');
            alert(`✓ View successfully duplicated from source device!`);
            loadHomeTab();
        } catch (err) {
            alert('Failed to clone view: ' + err.message);
        }
    });

    // =========================================================================
    // Home Tab (Listen Now)
    // =========================================================================

    async function loadHomeTab() {
        await loadCurrentProfile();
        const now = new Date();
        const options = { weekday: 'long', month: 'short', day: 'numeric' };
        document.getElementById('ios-today-date').innerText = now.toLocaleDateString('en-US', options).toUpperCase();

        const pinnedIds = currentProfile?.homeView?.pinnedPlaylistIds || [];
        const favIds = currentProfile?.homeView?.favoriteTrackIds || [];
        document.getElementById('home-fav-count').innerText = favIds.length;

        // Render Pinned Playlists
        await loadPlaylistsData();
        pinnedPlaylistsGrid.innerHTML = '';

        const pinnedPls = playlists.filter(p => pinnedIds.includes(p.id));
        if (pinnedPls.length === 0) {
            pinnedPlaylistsGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    No pinned playlists on this device yet. Go to <a href="#" onclick="switchTab('playlists'); return false;" style="color: var(--ctp-mauve);">Playlists</a> and tap the pin button!
                </div>
            `;
        } else {
            pinnedPls.forEach(pl => {
                const card = document.createElement('div');
                card.className = 'playlist-card';
                card.innerHTML = `
                    <div class="pl-card-top">
                        <span class="pl-card-icon-svg">${icon('folder', '', 28)}</span>
                        <button class="pl-card-pin-btn pinned" title="Unpin from Home">${icon('pin', '', 16)}</button>
                    </div>
                    <div class="pl-card-title">${pl.name}</div>
                    <div class="pl-card-owner">by ${pl.ownerName || 'Shared'}</div>
                    <div class="pl-card-meta">${pl.trackIds.length} track(s)</div>
                `;

                card.addEventListener('click', (e) => {
                    if (e.target.closest('.pl-card-pin-btn')) return;
                    openPlaylist(pl.id);
                });

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
            homeFavoritesContainer.innerHTML = `<div class="empty-state">No favorite songs yet. Tap the favorite button on any song to add it here!</div>`;
        } else {
            if (tracks.length === 0) await loadTracksData();
            const favTracks = tracks.filter(t => favIds.includes(t.id));
            renderTrackList(favTracks, homeFavoritesContainer);
        }
    }

    // =========================================================================
    // Tracks Tab & Song Local Search
    // =========================================================================

    let debounceTimer = null;

    async function loadTracksData(query = '') {
        const url = query ? `/api/v1/tracks?query=${encodeURIComponent(query)}&limit=300` : '/api/v1/tracks?limit=300';
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

    function filterTracksClientSide(query) {
        if (!query) {
            renderTrackList(tracks, tracksContainer);
            document.getElementById('tracks-count').innerText = tracks.length;
            return;
        }
        const q = query.toLowerCase().trim();
        const filtered = tracks.filter(t =>
            (t.title && t.title.toLowerCase().includes(q)) ||
            (t.artist && t.artist.toLowerCase().includes(q)) ||
            (t.album && t.album.toLowerCase().includes(q)) ||
            (t.fileName && t.fileName.toLowerCase().includes(q))
        );
        renderTrackList(filtered, tracksContainer);
        document.getElementById('tracks-count').innerText = `${filtered.length} of ${tracks.length}`;
    }

    // Wire up phone and desktop search inputs for songs
    if (phoneSearchInput) {
        phoneSearchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            if (btnClearTrackSearch) {
                btnClearTrackSearch.style.display = query ? 'flex' : 'none';
            }
            if (tracks.length > 0) {
                filterTracksClientSide(query);
            }
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                loadTracks(query);
            }, 300);
        });
    }

    if (btnClearTrackSearch) {
        btnClearTrackSearch.addEventListener('click', () => {
            phoneSearchInput.value = '';
            btnClearTrackSearch.style.display = 'none';
            loadTracks('');
            phoneSearchInput.focus();
        });
    }

    // Shuffle all songs in library
    const btnShuffleTracksAll = document.getElementById('btn-shuffle-tracks-all');
    if (btnShuffleTracksAll) {
        btnShuffleTracksAll.addEventListener('click', async () => {
            if (tracks.length === 0) await loadTracksData();
            if (tracks.length > 0) {
                tracks = shuffleArray(tracks);
                isShuffleMode = true;
                updateShuffleUI();
                playTrack(0);
            }
        });
    }

    if (desktopSearchInput) {
        desktopSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (currentActiveTab === 'tracks') {
                if (phoneSearchInput) phoneSearchInput.value = query;
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => loadTracks(query), 250);
            } else if (currentActiveTab === 'artists') {
                if (artistsSearchInput) artistsSearchInput.value = query;
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => loadArtists(query), 250);
            } else if (currentActiveTab === 'albums') {
                if (albumsSearchInput) albumsSearchInput.value = query;
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => loadAlbums(query), 250);
            }
        });

        desktopSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = desktopSearchInput.value.trim();
                if (currentActiveTab === 'home' || currentActiveTab === 'playlists' || currentActiveTab === 'downloads') {
                    switchTab('tracks');
                    if (phoneSearchInput) phoneSearchInput.value = query;
                    loadTracks(query);
                }
            }
        });
    }

    function renderTrackList(trackList, container, options = {}) {
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
            const artHtml = t.coverUrl ? `<img src="${t.coverUrl}" alt="${t.title}">` : icon('music', '', 20);

            const row = document.createElement('div');
            row.className = `track-row ${isPlayingThis ? 'playing' : ''}`;
            
            const playlistRemoveBtn = options.inPlaylist ? `
                <button class="track-action-btn btn-del-pl-track" title="Remove from playlist">
                    ${icon('x', '', 16)}
                </button>
            ` : '';

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
                        ${isFav ? icon('heart-filled', '', 16) : icon('heart', '', 16)}
                    </button>
                    ${!options.inPlaylist ? `
                    <button class="track-action-btn btn-add-pl" title="Add to Playlist">
                        ${icon('plus', '', 16)}
                    </button>
                    ` : ''}
                    <button class="track-action-btn btn-offline ${isCached ? 'cached' : ''}" title="Cache Offline">
                        ${icon('save', '', 16)}
                        <span>${isCached ? 'Saved' : 'Save'}</span>
                    </button>
                    <button class="track-action-btn btn-direct-download" title="Download to iOS Files">
                        ${icon('download', '', 16)}
                        <span>Get</span>
                    </button>
                    ${playlistRemoveBtn}
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
                btnFav.innerHTML = data.isFavorite ? icon('heart-filled', '', 16) : icon('heart', '', 16);
                btnFav.classList.toggle('fav-active', data.isFavorite);
                if (currentProfile) currentProfile.homeView.favoriteTrackIds = data.favoriteTrackIds;
            });

            // Add to Playlist modal trigger
            const btnAddPl = row.querySelector('.btn-add-pl');
            if (btnAddPl) {
                btnAddPl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openAddToPlaylistModal(t.id);
                });
            }

            // Remove from Playlist
            const btnDelPl = row.querySelector('.btn-del-pl-track');
            if (btnDelPl && options.playlistId) {
                btnDelPl.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await apiFetch(`/api/v1/profiles/playlists/${options.playlistId}/tracks`, {
                        method: 'DELETE',
                        body: JSON.stringify({ trackId: t.id })
                    });
                    await openPlaylist(options.playlistId, false);
                });
            }

            // Offline Cache
            const btnOffline = row.querySelector('.btn-offline');
            btnOffline.addEventListener('click', async (e) => {
                e.stopPropagation();
                btnOffline.innerHTML = `${icon('save', '', 16)} <span>Saving...</span>`;
                try {
                    await saveTrackOffline(t);
                    await refreshCachedIds();
                    btnOffline.className = 'track-action-btn btn-offline cached';
                    btnOffline.innerHTML = `${icon('save', '', 16)} <span>Saved</span>`;
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
    // Artists Page Engine
    // =========================================================================

    let artistsDebounceTimer = null;

    async function loadArtists(query = '') {
        try {
            const url = query ? `/api/v1/artists?query=${encodeURIComponent(query)}&limit=150` : '/api/v1/artists?limit=150';
            const res = await fetch(url);
            const data = await res.json();
            artists = data.artists || [];
            document.getElementById('artists-count').innerText = data.total || 0;
            renderArtistsGrid(artists);
        } catch (err) {
            console.error('Failed to load artists:', err);
        }
    }

    function renderArtistsGrid(artistsList) {
        if (!artistsGrid) return;
        artistsGrid.innerHTML = '';

        if (!artistsList || artistsList.length === 0) {
            artistsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">No artists found.</div>`;
            return;
        }

        artistsList.forEach(art => {
            const card = document.createElement('div');
            card.className = 'artist-card';

            const initials = art.name.substring(0, 2).toUpperCase();

            card.innerHTML = `
                <div class="artist-avatar-wrap">
                    <span>${initials}</span>
                </div>
                <div class="artist-name" title="${art.name}">${art.name}</div>
                <div class="artist-meta">${art.albumCount || (art.albums ? art.albums.length : 0)} album(s) • ${art.trackCount || 0} song(s)</div>
            `;

            card.addEventListener('click', () => openArtist(art.name));
            artistsGrid.appendChild(card);
        });
    }

    async function openArtist(artistName, pushHistory = true) {
        if (!artistDetailView || !artistsMainView) return;

        if (pushHistory) {
            pushNavigationState({ tab: 'artists', view: 'artist', artistName });
        }

        artistsMainView.style.display = 'none';
        artistDetailView.style.display = 'block';

        artistHeroName.innerText = artistName;
        artistHeroAvatar.innerHTML = `<span>${artistName.substring(0, 2).toUpperCase()}</span>`;
        artistHeroMeta.innerText = 'Loading discography...';
        artistAlbumsGrid.innerHTML = '';
        artistTracksContainer.innerHTML = '<div class="empty-state">Loading songs...</div>';

        try {
            const res = await fetch(`/api/v1/artists/${encodeURIComponent(artistName)}`);
            const data = await res.json();

            const artistAlbums = data.albums || [];
            const artistTracks = data.tracks || [];

            artistHeroMeta.innerText = `${artistAlbums.length} album(s) • ${artistTracks.length} song(s)`;

            // Render albums section
            const albumsSection = document.getElementById('artist-albums-section');
            if (artistAlbums.length > 0) {
                albumsSection.style.display = 'block';
                renderAlbumsGrid(artistAlbums, artistAlbumsGrid);
            } else {
                albumsSection.style.display = 'none';
            }

            // Render tracks section
            renderTrackList(artistTracks, artistTracksContainer);

            // Play all button
            btnPlayArtistAll.onclick = () => {
                if (artistTracks.length > 0) {
                    tracks = artistTracks;
                    playTrack(0);
                }
            };

            // Shuffle all button
            if (btnShuffleArtistAll) {
                btnShuffleArtistAll.onclick = () => {
                    if (artistTracks.length > 0) {
                        tracks = shuffleArray(artistTracks);
                        isShuffleMode = true;
                        updateShuffleUI();
                        playTrack(0);
                    }
                };
            }

            // Download all artist tracks offline
            if (btnDownloadArtistAll) {
                btnDownloadArtistAll.onclick = () => {
                    downloadTracksBatch(artistTracks, btnDownloadArtistAll, 'Download All');
                };
            }
        } catch (err) {
            artistTracksContainer.innerHTML = `<div class="empty-state">Error loading artist: ${err.message}</div>`;
        }
    }

    function backToArtists() {
        if (artistDetailView) artistDetailView.style.display = 'none';
        if (artistsMainView) artistsMainView.style.display = 'block';
    }

    if (btnBackToArtists) btnBackToArtists.addEventListener('click', backToArtists);

    if (artistsSearchInput) {
        artistsSearchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            if (btnClearArtistSearch) {
                btnClearArtistSearch.style.display = query ? 'flex' : 'none';
            }
            clearTimeout(artistsDebounceTimer);
            artistsDebounceTimer = setTimeout(() => loadArtists(query), 250);
        });
    }

    if (btnClearArtistSearch) {
        btnClearArtistSearch.addEventListener('click', () => {
            artistsSearchInput.value = '';
            btnClearArtistSearch.style.display = 'none';
            loadArtists('');
            artistsSearchInput.focus();
        });
    }

    // =========================================================================
    // Albums Page Engine (Single Click Open Fix)
    // =========================================================================

    let albumsDebounceTimer = null;

    async function loadAlbums(query = '') {
        try {
            const url = query ? `/api/v1/albums?query=${encodeURIComponent(query)}&limit=150` : '/api/v1/albums?limit=150';
            const res = await fetch(url);
            const data = await res.json();
            albums = data.albums || [];
            document.getElementById('albums-count').innerText = data.total || 0;
            renderAlbumsGrid(albums, albumsGrid);
        } catch (err) {
            console.error('Failed to load albums:', err);
        }
    }

    function renderAlbumsGrid(albumsList, targetGrid = albumsGrid) {
        if (!targetGrid) return;
        targetGrid.innerHTML = '';

        if (!albumsList || albumsList.length === 0) {
            targetGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">No albums found.</div>`;
            return;
        }

        albumsList.forEach(alb => {
            const card = document.createElement('div');
            card.className = 'album-card';

            const artHtml = alb.coverUrl ? `<img src="${alb.coverUrl}" alt="${alb.title}">` : icon('disc', '', 36);

            card.innerHTML = `
                <div class="album-art-wrap">
                    ${artHtml}
                    <button class="album-quick-play" title="Play Album">${icon('play', '', 18)}</button>
                </div>
                <div class="album-title" title="${alb.title}">${alb.title}</div>
                <div class="album-artist" title="${alb.artist}">${alb.artist}</div>
                <div class="album-year-badge">${alb.year ? alb.year + ' • ' : ''}${alb.trackCount || (alb.tracks ? alb.tracks.length : 0)} track(s)</div>
            `;

            // Reliable single-click open on both desktop and touch mobile
            card.addEventListener('click', (e) => {
                if (e.target.closest('.album-quick-play')) return;
                openAlbum(alb.id);
            });

            // Quick Play button
            const btnQuickPlay = card.querySelector('.album-quick-play');
            btnQuickPlay.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (alb.tracks && alb.tracks.length > 0) {
                    tracks = alb.tracks;
                    playTrack(0);
                } else {
                    const res = await fetch(`/api/v1/albums/${alb.id}`);
                    const fullAlb = await res.json();
                    if (fullAlb && fullAlb.tracks && fullAlb.tracks.length > 0) {
                        tracks = fullAlb.tracks;
                        playTrack(0);
                    }
                }
            });

            targetGrid.appendChild(card);
        });
    }

    async function openAlbum(albumId, pushHistory = true) {
        if (!albumDetailView || !albumsMainView) return;

        if (pushHistory) {
            pushNavigationState({ tab: 'albums', view: 'album', albumId });
        }

        albumsMainView.style.display = 'none';
        albumDetailView.style.display = 'block';

        albumHeroTitle.innerText = 'Loading album...';
        albumHeroArtist.innerText = '';
        albumHeroMeta.innerText = '';
        albumHeroCover.innerHTML = icon('disc', '', 48);
        albumTracksContainer.innerHTML = '<div class="empty-state">Loading tracklist...</div>';

        try {
            const res = await fetch(`/api/v1/albums/${albumId}`);
            const alb = await res.json();

            albumHeroTitle.innerText = alb.title;
            albumHeroArtist.innerText = alb.artist;
            albumHeroArtist.style.cursor = 'pointer';
            albumHeroArtist.onclick = () => {
                switchTab('artists');
                openArtist(alb.artist);
            };

            albumHeroMeta.innerText = `${alb.year ? alb.year + ' • ' : ''}${alb.trackCount || (alb.tracks ? alb.tracks.length : 0)} track(s)`;
            albumHeroCover.innerHTML = alb.coverUrl ? `<img src="${alb.coverUrl}" alt="${alb.title}">` : icon('disc', '', 48);

            const albumTracks = alb.tracks || [];
            renderTrackList(albumTracks, albumTracksContainer);

            // Play all album tracks
            btnPlayAlbumAll.onclick = () => {
                if (albumTracks.length > 0) {
                    tracks = albumTracks;
                    playTrack(0);
                }
            };

            // Shuffle all album tracks
            if (btnShuffleAlbumAll) {
                btnShuffleAlbumAll.onclick = () => {
                    if (albumTracks.length > 0) {
                        tracks = shuffleArray(albumTracks);
                        isShuffleMode = true;
                        updateShuffleUI();
                        playTrack(0);
                    }
                };
            }

            // Download entire album offline
            if (btnDownloadAlbumAll) {
                btnDownloadAlbumAll.onclick = () => {
                    downloadTracksBatch(albumTracks, btnDownloadAlbumAll, 'Download Album');
                };
            }
        } catch (err) {
            albumTracksContainer.innerHTML = `<div class="empty-state">Error loading album: ${err.message}</div>`;
        }
    }

    function backToAlbums() {
        if (albumDetailView) albumDetailView.style.display = 'none';
        if (albumsMainView) albumsMainView.style.display = 'block';
    }

    if (btnBackToAlbums) btnBackToAlbums.addEventListener('click', backToAlbums);

    if (albumsSearchInput) {
        albumsSearchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            if (btnClearAlbumSearch) {
                btnClearAlbumSearch.style.display = query ? 'flex' : 'none';
            }
            clearTimeout(albumsDebounceTimer);
            albumsDebounceTimer = setTimeout(() => loadAlbums(query), 250);
        });
    }

    if (btnClearAlbumSearch) {
        btnClearAlbumSearch.addEventListener('click', () => {
            albumsSearchInput.value = '';
            btnClearAlbumSearch.style.display = 'none';
            loadAlbums('');
            albumsSearchInput.focus();
        });
    }

    // =========================================================================
    // Shared Playlists Tab & Dedicated Playlist Detail View Engine
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
                    <span class="pl-card-icon-svg">${icon('folder', '', 28)}</span>
                    <button class="pl-card-pin-btn ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Unpin from Home' : 'Pin to Home'}">
                        ${icon('pin', '', 16)}
                    </button>
                </div>
                <div class="pl-card-title">${pl.name}</div>
                <div class="pl-card-owner">by ${pl.ownerName || 'Shared'}</div>
                <div class="pl-card-meta">${pl.trackIds.length} song(s)</div>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.closest('.pl-card-pin-btn')) return;
                openPlaylist(pl.id);
            });

            card.querySelector('.pl-card-pin-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                await togglePinPlaylist(pl.id);
                loadPlaylistsTab();
            });

            playlistsGrid.appendChild(card);
        });
    }

    async function togglePinPlaylist(playlistId) {
        try {
            const res = await apiFetch('/api/v1/profiles/pin', {
                method: 'POST',
                body: JSON.stringify({ playlistId })
            });
            if (!res.ok) {
                console.warn(`Failed to pin playlist: HTTP ${res.status}`);
                return;
            }
            const data = await res.json();
            if (currentProfile && data.pinnedPlaylistIds) {
                currentProfile.homeView.pinnedPlaylistIds = data.pinnedPlaylistIds;
            }
        } catch (err) {
            console.error('Failed to toggle pin playlist:', err);
        }
    }

    async function openPlaylist(playlistId, pushHistory = true) {
        await loadPlaylistsData();
        const pl = playlists.find(p => p.id === playlistId);
        if (!pl) return;
        currentPlaylistObj = pl;

        if (pushHistory) {
            pushNavigationState({ tab: 'playlists', view: 'playlist', playlistId });
        }

        // Switch to Playlist Detail View
        if (playlistsMainView) playlistsMainView.style.display = 'none';
        if (playlistDetailView) playlistDetailView.style.display = 'block';

        playlistHeroName.innerText = pl.name;
        playlistHeroOwner.innerText = `by ${pl.ownerName || 'Shared'}`;
        playlistHeroMeta.innerText = `${pl.trackIds.length} track(s)`;
        playlistTracksContainer.innerHTML = '<div class="empty-state">Loading playlist tracks...</div>';

        if (tracks.length === 0) await loadTracksData();
        const plTracks = tracks.filter(t => pl.trackIds.includes(t.id));

        renderTrackList(plTracks, playlistTracksContainer, { inPlaylist: true, playlistId: pl.id });

        // Play all button
        btnPlayPlaylistAll.onclick = () => {
            if (plTracks.length > 0) {
                tracks = plTracks;
                playTrack(0);
            }
        };

        // Shuffle all playlist button
        if (btnShufflePlaylistAll) {
            btnShufflePlaylistAll.onclick = () => {
                if (plTracks.length > 0) {
                    tracks = shuffleArray(plTracks);
                    isShuffleMode = true;
                    updateShuffleUI();
                    playTrack(0);
                }
            };
        }

        // Download all playlist tracks offline
        if (btnDownloadPlaylistAll) {
            btnDownloadPlaylistAll.onclick = () => {
                downloadTracksBatch(plTracks, btnDownloadPlaylistAll, 'Download All');
            };
        }

        // Delete playlist button
        btnDeleteCurrentPl.onclick = async () => {
            if (confirm(`Are you sure you want to delete the playlist "${pl.name}"?`)) {
                await apiFetch(`/api/v1/profiles/playlists/${pl.id}`, { method: 'DELETE' });
                backToPlaylists();
                await loadPlaylistsTab();
            }
        };
    }

    function backToPlaylists() {
        if (playlistDetailView) playlistDetailView.style.display = 'none';
        if (playlistsMainView) playlistsMainView.style.display = 'block';
    }

    if (btnBackToPlaylists) btnBackToPlaylists.addEventListener('click', backToPlaylists);

    // Create New Playlist Modals
    const btnNewPlaylistTop = document.getElementById('btn-new-playlist-top');
    const btnCreatePlaylistMain = document.getElementById('btn-create-playlist-main');
    const inputPlaylistName = document.getElementById('input-playlist-name');
    const btnConfirmCreatePl = document.getElementById('btn-confirm-create-pl');

    function openCreatePlaylistModal() {
        inputPlaylistName.value = '';
        playlistModal.classList.add('open');
        inputPlaylistName.focus();
    }

    if (btnNewPlaylistTop) btnNewPlaylistTop.addEventListener('click', openCreatePlaylistModal);
    if (btnCreatePlaylistMain) btnCreatePlaylistMain.addEventListener('click', openCreatePlaylistModal);
    document.getElementById('btn-close-playlist-modal').addEventListener('click', () => playlistModal.classList.remove('open'));

    btnConfirmCreatePl.addEventListener('click', async () => {
        const name = inputPlaylistName.value.trim();
        if (!name) return;
        try {
            await apiFetch('/api/v1/profiles/playlists', {
                method: 'POST',
                body: JSON.stringify({ name })
            });
            playlistModal.classList.remove('open');
            await loadPlaylistsTab();
        } catch (err) {
            alert('Failed to create playlist: ' + err.message);
        }
    });

    // Add Track to Playlist Modal
    let pendingTrackIdToAdd = null;
    async function openAddToPlaylistModal(trackId) {
        pendingTrackIdToAdd = trackId;
        await loadPlaylistsData();
        const picker = document.getElementById('playlists-picker-list');
        picker.innerHTML = '';

        if (playlists.length === 0) {
            picker.innerHTML = `<div class="empty-state">No playlists found. Create one first!</div>`;
        } else {
            playlists.forEach(pl => {
                const item = document.createElement('div');
                item.className = 'playlist-picker-item';
                item.innerHTML = `<span>${icon('folder', '', 18)} ${pl.name}</span> <small>(${pl.trackIds.length} tracks)</small>`;
                item.addEventListener('click', async () => {
                    await apiFetch(`/api/v1/profiles/playlists/${pl.id}/tracks`, {
                        method: 'POST',
                        body: JSON.stringify({ trackId: pendingTrackIdToAdd })
                    });
                    addToPlaylistModal.classList.remove('open');
                    alert(`✓ Track added to playlist "${pl.name}"`);
                });
                picker.appendChild(item);
            });
        }
        addToPlaylistModal.classList.add('open');
    }

    document.getElementById('btn-close-add-pl-modal').addEventListener('click', () => addToPlaylistModal.classList.remove('open'));

    // =========================================================================
    // Offline Storage & Airplane Mode Tab (IndexedDB & Service Worker)
    // =========================================================================

    async function saveTrackOffline(track) {
        if (!window.VaultOfflineDB) throw new Error('Offline storage engine unavailable');
        const res = await fetch(`/api/v1/stream/${track.id}`);
        const blob = await res.blob();
        await window.VaultOfflineDB.saveTrack(track, blob);
    }

    async function loadOfflineTab() {
        if (!window.VaultOfflineDB) return;
        const offlineTracks = await window.VaultOfflineDB.getAllTracks();

        let totalBytes = 0;
        offlineTracks.forEach(t => { if (t.blob) totalBytes += t.blob.size; });
        const mb = (totalBytes / (1024 * 1024)).toFixed(1);
        document.getElementById('offline-stats-summary').innerText = `${offlineTracks.length} song(s) • ${mb} MB`;

        offlineTracksContainer.innerHTML = '';
        if (offlineTracks.length === 0) {
            offlineTracksContainer.innerHTML = `<div class="empty-state">No songs saved offline yet. Tap the Save button on any song!</div>`;
            return;
        }

        offlineTracks.forEach((t, i) => {
            const row = document.createElement('div');
            row.className = 'track-row';
            row.innerHTML = `
                <div class="track-main-info">
                    <div class="track-art-thumb">${icon('save', '', 20)}</div>
                    <div class="track-texts">
                        <div class="track-title">${t.title}</div>
                        <div class="track-sub">${t.artist} • ${((t.blob?.size || 0) / 1048576).toFixed(1)} MB</div>
                    </div>
                </div>
                <div class="track-actions">
                    <button class="track-action-btn btn-del-offline" title="Delete from cache">
                        ${icon('trash', '', 16)}
                    </button>
                </div>
            `;

            row.querySelector('.track-main-info').addEventListener('click', () => {
                playOfflineBlob(t);
            });

            row.querySelector('.btn-del-offline').addEventListener('click', async (e) => {
                e.stopPropagation();
                await window.VaultOfflineDB.deleteTrack(t.id);
                await refreshCachedIds();
                loadOfflineTab();
            });

            offlineTracksContainer.appendChild(row);
        });
    }

    // =========================================================================
    // Core Audio Player & Media Session Engine
    // =========================================================================

    function playTrack(index) {
        if (index < 0 || index >= tracks.length) return;
        currentTrackIndex = index;
        const t = tracks[index];
        currentTrackObj = t;

        audio.src = `/api/v1/stream/${t.id}`;
        audio.play().catch(e => console.warn('Audio autoplay prevented:', e));

        updatePlayerUI(t);
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
        const artHtml = t.coverUrl ? `<img src="${t.coverUrl}">` : icon('music', '', 22);

        miniTitle.innerText = t.title;
        miniArtist.innerText = `${t.artist} — ${t.album}`;
        miniArt.innerHTML = artHtml;
        btnMiniPlay.innerHTML = icon('pause', '', 18);

        sheetTitle.innerText = t.title;
        sheetArtist.innerText = `${t.artist} • ${t.album}`;
        sheetArt.innerHTML = t.coverUrl ? `<img src="${t.coverUrl}">` : icon('music', '', 80);
        btnSheetPlay.innerHTML = icon('pause', '', 28);

        const isFav = currentProfile?.homeView?.favoriteTrackIds?.includes(t.id);
        btnMiniFav.innerHTML = isFav ? icon('heart-filled', '', 18) : icon('heart', '', 18);
        btnSheetFav.innerHTML = isFav ? icon('heart-filled', '', 22) : icon('heart', '', 22);

        updateShuffleUI();

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: t.title,
                artist: t.artist,
                album: t.album,
                artwork: t.coverUrl ? [{ src: t.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : []
            });

            navigator.mediaSession.setActionHandler('play', () => { audio.play(); isPlaying = true; updatePlayButtons(); });
            navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); isPlaying = false; updatePlayButtons(); });
            navigator.mediaSession.setActionHandler('previoustrack', playPreviousTrack);
            navigator.mediaSession.setActionHandler('nexttrack', playNextTrack);
            navigator.mediaSession.setActionHandler('seekto', (details) => { if (details.seekTime) audio.currentTime = details.seekTime; });
        }

        btnSheetDownload.onclick = () => { window.location.href = `/api/v1/download/${t.id}`; };
        btnSheetOffline.onclick = async () => {
            const label = btnSheetOffline.querySelector('.sheet-action-text');
            if (label) label.innerText = 'Saving...';
            await saveTrackOffline(t);
            await refreshCachedIds();
            if (label) label.innerText = 'Saved Offline';
        };

        const toggleFavHandler = async () => {
            const res = await apiFetch('/api/v1/profiles/favorite', {
                method: 'POST',
                body: JSON.stringify({ trackId: t.id })
            });
            const data = await res.json();
            btnMiniFav.innerHTML = data.isFavorite ? icon('heart-filled', '', 18) : icon('heart', '', 18);
            btnSheetFav.innerHTML = data.isFavorite ? icon('heart-filled', '', 22) : icon('heart', '', 22);
            if (currentProfile) currentProfile.homeView.favoriteTrackIds = data.favoriteTrackIds;
        };

        btnMiniFav.onclick = (e) => { e.stopPropagation(); toggleFavHandler(); };
        btnSheetFav.onclick = toggleFavHandler;
    }

    function updatePlayButtons() {
        const isPaused = audio.paused;
        btnMiniPlay.innerHTML = isPaused ? icon('play', '', 18) : icon('pause', '', 18);
        btnSheetPlay.innerHTML = isPaused ? icon('play', '', 28) : icon('pause', '', 28);
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

    function playNextTrack() {
        if (tracks.length === 0) return;
        if (isShuffleMode && tracks.length > 1) {
            let nextIdx;
            do {
                nextIdx = Math.floor(Math.random() * tracks.length);
            } while (nextIdx === currentTrackIndex);
            playTrack(nextIdx);
        } else {
            if (currentTrackIndex < tracks.length - 1) {
                playTrack(currentTrackIndex + 1);
            } else {
                updatePlayButtons();
            }
        }
    }

    function playPreviousTrack() {
        if (tracks.length === 0) return;
        if (isShuffleMode && tracks.length > 1) {
            let prevIdx;
            do {
                prevIdx = Math.floor(Math.random() * tracks.length);
            } while (prevIdx === currentTrackIndex);
            playTrack(prevIdx);
        } else {
            if (currentTrackIndex > 0) {
                playTrack(currentTrackIndex - 1);
            }
        }
    }

    btnMiniPlay.addEventListener('click', (e) => { e.stopPropagation(); togglePlayPause(); });
    btnSheetPlay.addEventListener('click', togglePlayPause);
    btnMiniPrev.addEventListener('click', (e) => { e.stopPropagation(); playPreviousTrack(); });
    btnSheetPrev.addEventListener('click', playPreviousTrack);
    btnMiniNext.addEventListener('click', (e) => { e.stopPropagation(); playNextTrack(); });
    btnSheetNext.addEventListener('click', playNextTrack);

    // Interactive seek handlers for mini player
    if (miniSeekSlider) {
        miniSeekSlider.addEventListener('input', (e) => {
            e.stopPropagation();
            if (audio.duration) {
                audio.currentTime = (miniSeekSlider.value / 100) * audio.duration;
            }
        });
    }

    if (miniProgressContainer) {
        miniProgressContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!audio.duration) return;
            const rect = miniProgressContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const pct = Math.max(0, Math.min(1, clickX / rect.width));
            audio.currentTime = pct * audio.duration;
        });
    }

    audio.addEventListener('timeupdate', () => {
        if (!isNaN(audio.duration) && audio.duration > 0) {
            const pct = (audio.currentTime / audio.duration) * 100;
            if (miniProgressBar) miniProgressBar.style.width = `${pct}%`;
            if (miniSeekSlider) miniSeekSlider.value = pct;
            if (miniCurrentTime) miniCurrentTime.innerText = formatTime(audio.currentTime);
            if (miniDurationTime) miniDurationTime.innerText = formatTime(audio.duration);

            sheetSeekBar.value = pct;
            sheetCurrentTime.innerText = formatTime(audio.currentTime);
            sheetDurationTime.innerText = formatTime(audio.duration);
        }
    });

    audio.addEventListener('ended', playNextTrack);

    sheetSeekBar.addEventListener('input', () => {
        if (audio.duration) audio.currentTime = (sheetSeekBar.value / 100) * audio.duration;
    });

    // =========================================================================
    // Search & Download (Lidarr OVH & Local Jackett / qBittorrent)
    // =========================================================================

    const torrentSearchInput = document.getElementById('torrent-search-input');
    const selectIndexer = document.getElementById('select-indexer');
    const selectCategory = document.getElementById('select-category');
    const checkFilterMusic = document.getElementById('check-filter-music');
    const torrentsResultsList = document.getElementById('torrents-results-list');
    const downloadsQueueList = document.getElementById('downloads-queue-list');
    const btnSearchTorrents = document.getElementById('btn-search-torrents');
    const btnRefreshQueue = document.getElementById('btn-refresh-queue');

    async function loadIndexersList() {
        if (!selectIndexer) return;
        try {
            const res = await apiFetch('/api/v1/downloads/indexers');
            const indexers = await res.json();
            if (Array.isArray(indexers) && indexers.length > 0) {
                selectIndexer.innerHTML = '';
                indexers.forEach(idx => {
                    const opt = document.createElement('option');
                    opt.value = idx.id;
                    opt.innerText = idx.name;
                    selectIndexer.appendChild(opt);
                });
            }
        } catch (_) {}
    }

    async function executeTorrentSearch() {
        const query = torrentSearchInput.value.trim();
        if (!query) return;

        const indexer = selectIndexer ? selectIndexer.value : 'all';
        const category = selectCategory ? selectCategory.value : '3000';
        const filterMusic = checkFilterMusic ? checkFilterMusic.checked : true;

        torrentsResultsList.innerHTML = `<div class="empty-state">Searching indexers (${indexer})...</div>`;
        btnSearchTorrents.disabled = true;
        btnSearchTorrents.innerHTML = `${icon('refresh', '', 18)} <span>Searching...</span>`;

        try {
            const url = `/api/v1/downloads/search?q=${encodeURIComponent(query)}&indexer=${encodeURIComponent(indexer)}&category=${encodeURIComponent(category)}&filterMusic=${filterMusic}`;
            const res = await apiFetch(url);
            const data = await res.json();
            const results = data.results || [];
            document.getElementById('results-count').innerText = results.length;

            torrentsResultsList.innerHTML = '';
            if (results.length === 0) {
                torrentsResultsList.innerHTML = `<div class="empty-state">No releases found. Try searching with "All Categories" or unchecking "Smart Audio Filter".</div>`;
                return;
            }

            results.forEach(r => {
                const card = document.createElement('div');
                card.className = 'torrent-result-card';
                card.innerHTML = `
                    <div class="torrent-main-info">
                        <div class="torrent-title">${r.title}</div>
                        <div class="torrent-badges">
                            <span class="t-badge tracker">${r.source === 'lidarr' ? 'Lidarr' : (r.tracker || 'Indexer')}</span>
                            <span class="t-badge">${r.formattedSize || 'N/A'}</span>
                            <span class="t-badge seeds">▲ ${r.seeders} seeds</span>
                            <span class="t-badge">▼ ${r.leechers} peers</span>
                            <span class="t-badge">${r.quality || r.categoryDesc || 'Audio'}</span>
                        </div>
                    </div>
                    <button class="btn-send-qbit" title="Download release">
                        ${icon('download', '', 16)}
                        <span>Get</span>
                    </button>
                `;

                const btnGet = card.querySelector('.btn-send-qbit');
                btnGet.addEventListener('click', async () => {
                    btnGet.disabled = true;
                    btnGet.innerHTML = `${icon('refresh', '', 16)} <span>Adding...</span>`;
                    try {
                        let addData = null;
                        if (r.source === 'lidarr') {
                            const lidarrRes = await apiFetch('/api/v1/downloads/lidarr/grab', {
                                method: 'POST',
                                body: JSON.stringify({
                                    guid: r.guid,
                                    indexerId: r.indexerId,
                                    downloadUrl: r.downloadUrl,
                                    title: r.title
                                })
                            });
                            addData = await lidarrRes.json();
                        } else {
                            const addRes = await apiFetch('/api/v1/downloads/add', {
                                method: 'POST',
                                body: JSON.stringify({
                                    magnetUrl: r.magnetUri || r.magnetUrl,
                                    torrentUrl: r.link || r.downloadUrl,
                                    category: 'music'
                                })
                            });
                            addData = await addRes.json();
                        }

                        if (addData && addData.success) {
                            btnGet.className = 'btn-send-qbit sent';
                            btnGet.innerHTML = `${icon('check', '', 16)} <span>Queued</span>`;
                            loadDownloadQueue();
                        } else {
                            btnGet.disabled = false;
                            btnGet.innerHTML = `${icon('x', '', 16)} <span>Failed</span>`;
                            alert('Download error: ' + (addData?.error || 'Failed to grab release'));
                        }
                    } catch (err) {
                        btnGet.disabled = false;
                        btnGet.innerHTML = `${icon('x', '', 16)} <span>Error</span>`;
                        alert('Error: ' + err.message);
                    }
                });

                torrentsResultsList.appendChild(card);
            });
        } catch (err) {
            torrentsResultsList.innerHTML = `<div class="empty-state">Error searching indexers: ${err.message}</div>`;
        } finally {
            btnSearchTorrents.disabled = false;
            btnSearchTorrents.innerHTML = `${icon('download', '', 18)} <span>Search Releases</span>`;
        }
    }

    if (btnSearchTorrents) btnSearchTorrents.addEventListener('click', executeTorrentSearch);
    if (torrentSearchInput) {
        torrentSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') executeTorrentSearch();
        });
    }

    async function loadDownloadQueue() {
        if (!downloadsQueueList) return;
        try {
            const res = await apiFetch('/api/v1/downloads/queue');
            const data = await res.json();
            const items = data.items || [];
            document.getElementById('queue-count').innerText = items.length;

            downloadsQueueList.innerHTML = '';
            if (items.length === 0) {
                downloadsQueueList.innerHTML = `<div class="empty-state">No active downloads in queue.</div>`;
                return;
            }

            items.forEach(item => {
                const card = document.createElement('div');
                card.className = 'queue-item-card';
                card.innerHTML = `
                    <div class="queue-title">${item.name}</div>
                    <div class="queue-progress-bg">
                        <div class="queue-progress-bar" style="width: ${item.progressPct}%"></div>
                    </div>
                    <div class="queue-meta-row">
                        <span>Progress: ${item.progress} (${item.formattedSize}) [${item.source || 'media'}]</span>
                        <span>DL: ${item.downloadSpeed || ''} | State: ${item.state || item.status || 'Active'}</span>
                    </div>
                `;
                downloadsQueueList.appendChild(card);
            });
        } catch (_) {}
    }

    if (btnRefreshQueue) btnRefreshQueue.addEventListener('click', loadDownloadQueue);

    // =========================================================================
    // Apple Music Offline Reconstructor & 35 GB Storage Guardrail Engine
    // =========================================================================

    const btnScanAppleMusic = document.getElementById('btn-scan-apple-music');
    const selectApplePlaylist = document.getElementById('select-apple-playlist');
    const btnMatchPlaylist = document.getElementById('btn-match-playlist');
    const reconstructorResultsContainer = document.getElementById('reconstructor-results-container');
    const reconstructorMatchesTbody = document.getElementById('reconstructor-matches-tbody');
    const matchCountText = document.getElementById('match-count-text');
    const btnQueueReconstruction = document.getElementById('btn-queue-reconstruction');
    const btnPostProcessMetadata = document.getElementById('btn-post-process-metadata');
    const snapshotStatusBanner = document.getElementById('snapshot-status-banner');

    let discoveredPlaylists = [];
    let currentPlaylistMatches = [];

    async function loadStorageStatus() {
        try {
            const res = await apiFetch('/api/v1/downloads/storage-status');
            const data = await res.json();
            if (data) {
                const usedEl = document.getElementById('storage-used-text');
                if (usedEl) usedEl.innerText = `${data.usedGb} GB`;
                const maxEl = document.getElementById('storage-max-text');
                if (maxEl) maxEl.innerText = `${data.maxGb} GB`;
                const remEl = document.getElementById('storage-remaining-text');
                if (remEl) remEl.innerText = `${data.remainingGb} GB remaining`;
                const fillEl = document.getElementById('storage-quota-bar-fill');
                if (fillEl) {
                    fillEl.style.width = `${data.percentUsed}%`;
                    fillEl.className = 'storage-quota-bar-fill';
                    if (data.percentUsed > 85) fillEl.classList.add('danger');
                    else if (data.percentUsed > 65) fillEl.classList.add('warning');
                }
            }
        } catch (_) {}
    }

    if (btnScanAppleMusic) {
        btnScanAppleMusic.addEventListener('click', async () => {
            btnScanAppleMusic.disabled = true;
            document.getElementById('btn-scan-apple-text').innerText = 'Cloning & Scanning...';

            try {
                const res = await apiFetch('/api/v1/downloads/apple-music-local/backup-and-scan', { method: 'POST' });
                const data = await res.json();
                discoveredPlaylists = data.playlists || [];

                selectApplePlaylist.innerHTML = '';
                if (discoveredPlaylists.length === 0) {
                    selectApplePlaylist.innerHTML = '<option value="">No playlists found in backup</option>';
                    btnMatchPlaylist.disabled = true;
                } else {
                    discoveredPlaylists.forEach((pl, idx) => {
                        const opt = document.createElement('option');
                        opt.value = idx;
                        opt.innerText = `${pl.name} (${pl.trackCount} tracks)`;
                        selectApplePlaylist.appendChild(opt);
                    });
                    btnMatchPlaylist.disabled = false;
                }

                if (data.snapshot && data.snapshot.manifest) {
                    snapshotStatusBanner.innerHTML = `<span>✓ Safe Snapshot verified: <code>${data.snapshot.manifest.backupDir}</code> (${data.snapshot.manifest.fileCount} files, ${data.snapshot.manifest.formattedSize})</span>`;
                }
            } catch (err) {
                alert('Failed to scan Apple Music: ' + err.message);
            } finally {
                btnScanAppleMusic.disabled = false;
                document.getElementById('btn-scan-apple-text').innerText = '🛡️ Safe Clone & Scan';
            }
        });
    }

    if (btnMatchPlaylist) {
        btnMatchPlaylist.addEventListener('click', async () => {
            const idx = parseInt(selectApplePlaylist.value, 10);
            const playlist = discoveredPlaylists[idx];
            if (!playlist) return;

            btnMatchPlaylist.disabled = true;
            btnMatchPlaylist.innerHTML = `<span>Searching Jackett (128k/192k)...</span>`;

            try {
                const res = await apiFetch('/api/v1/downloads/apple-music-local/match-playlist', {
                    method: 'POST',
                    body: JSON.stringify({ playlist })
                });
                const data = await res.json();
                currentPlaylistMatches = data.matches || [];

                matchCountText.innerText = `${data.matchedCount}/${data.totalTracks}`;
                reconstructorMatchesTbody.innerHTML = '';

                currentPlaylistMatches.forEach((m, mIdx) => {
                    const tr = document.createElement('tr');
                    const trackName = `${m.track.artist} - ${m.track.title}`;
                    
                    if (m.matchFound && m.bestRelease) {
                        const r = m.bestRelease;
                        let badgeClass = 'q-badge lossy';
                        if (r.quality.includes('128') || r.quality.includes('192')) badgeClass = 'q-badge low';
                        else if (r.isLossless) badgeClass = 'q-badge lossless';

                        const confirmCell = r.isLossless ? `
                            <label class="confirm-checkbox-wrap">
                                <input type="checkbox" class="check-lossless-confirm" data-idx="${mIdx}">
                                <span>Confirm Lossless</span>
                            </label>
                        ` : `<span style="color: var(--ctp-green); font-size: 12px;">✓ Approved</span>`;

                        tr.innerHTML = `
                            <td><strong>${trackName}</strong></td>
                            <td title="${r.title}">${r.title.substring(0, 36)}... <small>(${r.tracker})</small></td>
                            <td><span class="${badgeClass}">${r.quality}</span></td>
                            <td>${r.formattedSize}</td>
                            <td>${confirmCell}</td>
                        `;
                    } else {
                        tr.innerHTML = `
                            <td><strong>${trackName}</strong></td>
                            <td colspan="4" style="color: var(--ctp-peach); font-style: italic;">No match found on indexers</td>
                        `;
                    }
                    reconstructorMatchesTbody.appendChild(tr);
                });

                reconstructorResultsContainer.style.display = 'block';
            } catch (err) {
                alert('Failed to match playlist: ' + err.message);
            } finally {
                btnMatchPlaylist.disabled = false;
                btnMatchPlaylist.innerHTML = `<span>🔍 Match Releases (128k/192k)</span>`;
            }
        });
    }

    if (btnQueueReconstruction) {
        btnQueueReconstruction.addEventListener('click', async () => {
            if (!currentPlaylistMatches || currentPlaylistMatches.length === 0) return;

            const releasesToQueue = [];
            let unconfirmedLossless = 0;

            const checkboxes = document.querySelectorAll('.check-lossless-confirm');
            const confirmedIndices = new Set();
            checkboxes.forEach(cb => {
                if (cb.checked) confirmedIndices.add(parseInt(cb.dataset.idx, 10));
            });

            currentPlaylistMatches.forEach((m, idx) => {
                if (m.matchFound && m.bestRelease) {
                    if (m.bestRelease.isLossless && !confirmedIndices.has(idx)) {
                        unconfirmedLossless++;
                        return;
                    }
                    releasesToQueue.push(m.bestRelease);
                }
            });

            if (releasesToQueue.length === 0) {
                alert('No releases ready to queue. ' + (unconfirmedLossless > 0 ? `${unconfirmedLossless} lossless tracks need checkbox confirmation.` : ''));
                return;
            }

            btnQueueReconstruction.disabled = true;
            btnQueueReconstruction.innerHTML = `<span>Queueing (${releasesToQueue.length})...</span>`;

            try {
                const res = await apiFetch('/api/v1/downloads/apple-music-local/queue-download', {
                    method: 'POST',
                    body: JSON.stringify({ releases: releasesToQueue, allowLossless: true })
                });
                const data = await res.json();

                if (data.blockedCount > 0) {
                    alert(`⚠️ Queued ${data.successCount} releases. ${data.blockedCount} were blocked by guardrails or confirmation.`);
                } else {
                    alert(`✓ Successfully queued ${data.successCount} releases to local qBittorrent!`);
                }
                await loadDownloadQueue();
                await loadStorageStatus();
            } catch (err) {
                alert('Queue error: ' + err.message);
            } finally {
                btnQueueReconstruction.disabled = false;
                btnQueueReconstruction.innerHTML = `<span>📥 Queue to qBittorrent</span>`;
            }
        });
    }

    if (btnPostProcessMetadata) {
        btnPostProcessMetadata.addEventListener('click', async () => {
            btnPostProcessMetadata.disabled = true;
            btnPostProcessMetadata.innerHTML = `<span>Enriching with MusicBrainz...</span>`;

            try {
                const res = await apiFetch('/api/v1/downloads/post-process', { method: 'POST' });
                const data = await res.json();
                alert(`✓ MusicBrainz tagging complete! Enriched ${data.processedCount} downloaded track(s) and re-indexed library.`);
                await loadTracks();
                await loadStorageStatus();
            } catch (err) {
                alert('Post-process error: ' + err.message);
            } finally {
                btnPostProcessMetadata.disabled = false;
                btnPostProcessMetadata.innerHTML = `<span>✨ MusicBrainz Tagging</span>`;
            }
        });
    }

    // Initial App Load
    await loadCurrentProfile();
    await loadIndexersList();
    await loadStorageStatus();
    await loadHomeTab();
});

