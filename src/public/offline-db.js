/**
 * Client-side IndexedDB storage for offline PWA music playback on iOS/Desktop.
 */

const DB_NAME = 'VaultMusicOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Cache an audio track and its binary blob into IndexedDB.
 */
async function saveTrackOffline(track, onProgress) {
    const res = await fetch(track.streamUrl);
    if (!res.ok) throw new Error('Failed to fetch audio stream for offline cache');

    const blob = await res.blob();
    const db = await openDB();

    const offlineItem = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        year: track.year,
        coverUrl: track.coverUrl,
        blob: blob,
        size: blob.size,
        savedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(offlineItem);
        tx.oncomplete = () => resolve(offlineItem);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Get an offline track by ID.
 */
async function getOfflineTrack(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get all cached offline tracks.
 */
async function getAllOfflineTracks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Remove an offline track from IndexedDB.
 */
async function removeTrackOffline(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Calculate total offline storage usage.
 */
async function getOfflineStorageUsage() {
    const tracks = await getAllOfflineTracks();
    const totalBytes = tracks.reduce((acc, t) => acc + (t.size || 0), 0);
    return {
        count: tracks.length,
        totalBytes,
        formattedSize: (totalBytes / (1024 * 1024)).toFixed(1) + ' MB'
    };
}
