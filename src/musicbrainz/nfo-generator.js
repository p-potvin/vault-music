/**
 * Metadata serializer for MusicBrainz results into standard XML NFO and JSON.
 */

function escapeXml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function generateAlbumNfo({ album, artist, year, releaseDate, genres = [], releaseMbid, artistMbid, coverUrl = '' }) {
    const lines = [
        '<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
        '<album>',
        `  <title>${escapeXml(album)}</title>`,
        `  <artist>${escapeXml(artist)}</artist>`,
        `  <albumartist>${escapeXml(artist)}</albumartist>`,
        year ? `  <year>${escapeXml(year)}</year>` : '',
        releaseDate ? `  <premiered>${escapeXml(releaseDate)}</premiered>` : '',
        releaseDate ? `  <releasedate>${escapeXml(releaseDate)}</releasedate>` : '',
        releaseMbid ? `  <musicbrainzalbumid>${escapeXml(releaseMbid)}</musicbrainzalbumid>` : '',
        artistMbid ? `  <musicbrainzartistid>${escapeXml(artistMbid)}</musicbrainzartistid>` : '',
        ...genres.map(g => `  <genre>${escapeXml(g)}</genre>`),
        coverUrl ? `  <thumb aspect="thumb">${escapeXml(coverUrl)}</thumb>` : '',
        '</album>'
    ];
    return lines.filter(Boolean).join('\n') + '\n';
}

function generateArtistNfo({ artist, artistSortName, artistMbid, artistCountry, genres = [] }) {
    const lines = [
        '<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
        '<artist>',
        `  <title>${escapeXml(artist)}</title>`,
        artistSortName ? `  <sorttitle>${escapeXml(artistSortName)}</sorttitle>` : `  <sorttitle>${escapeXml(artist)}</sorttitle>`,
        artistCountry ? `  <country>${escapeXml(artistCountry)}</country>` : '',
        artistMbid ? `  <musicbrainzartistid>${escapeXml(artistMbid)}</musicbrainzartistid>` : '',
        ...genres.map(g => `  <genre>${escapeXml(g)}</genre>`),
        '</artist>'
    ];
    return lines.filter(Boolean).join('\n') + '\n';
}

module.exports = {
    generateAlbumNfo,
    generateArtistNfo,
    escapeXml
};
