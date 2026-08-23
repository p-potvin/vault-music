const { LocalMusicBrainzDb } = require('../src/musicbrainz/local-db');

const db = new LocalMusicBrainzDb('I:\\Musicbrainz\\musicbrainz_local.sqlite');
console.log('Local DB Available:', db.isAvailable);

const testQueries = [
    { title: 'Breezeblocks', artist: 'Alt-J' },
    { title: 'Paris', artist: '$uicideboy$' },
    { title: 'Neon Horizon', artist: 'Synthwave' },
    { title: 'Bohemian Rhapsody', artist: 'Queen' },
    { title: 'Hotel California', artist: 'Eagles' }
];

console.log('\n--- Benchmarking Offline MusicBrainz Query Latency ---');
for (const q of testQueries) {
    const t0 = process.hrtime.bigint();
    const match = db.searchRecording(q);
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`\nQuery: "${q.artist} - ${q.title}"`);
    console.log(`Latency: ${elapsedMs.toFixed(2)} ms`);
    console.log(`Match:`, match);
}
