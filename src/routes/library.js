const express = require('express');

function createLibraryRouter(libraryService) {
    const router = express.Router();

    router.get('/tracks', (req, res) => {
        const { query, artist, album, page, limit, sort, order } = req.query;
        const data = libraryService.listTracks({
            query,
            artist,
            album,
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 50,
            sort: sort || 'title',
            order: order || 'asc'
        });
        res.json(data);
    });

    router.get('/tracks/:id', (req, res) => {
        const track = libraryService.getTrack(req.params.id);
        if (!track) return res.status(404).json({ error: 'Track not found' });
        res.json(track);
    });

    router.get('/albums', (req, res) => {
        const { query, page, limit } = req.query;
        const data = libraryService.listAlbums({
            query,
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 50
        });
        res.json(data);
    });

    router.get('/albums/:id', (req, res) => {
        const album = libraryService.getAlbum(req.params.id);
        if (!album) return res.status(404).json({ error: 'Album not found' });
        res.json(album);
    });

    router.get('/artists', (req, res) => {
        const { query, page, limit } = req.query;
        const data = libraryService.listArtists({
            query,
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 50
        });
        res.json(data);
    });

    router.get('/artists/:name', (req, res) => {
        const artist = libraryService.getArtist(decodeURIComponent(req.params.name));
        if (!artist) return res.status(404).json({ error: 'Artist not found' });
        const tracks = libraryService.listTracks({ artist: artist.name, limit: 500 }).tracks;
        res.json({ ...artist, tracks });
    });

    router.post('/scan', (req, res) => {
        const result = libraryService.scanLibrary();
        res.json({ message: 'Library scanned successfully', ...result });
    });

    return router;
}

module.exports = { createLibraryRouter };
