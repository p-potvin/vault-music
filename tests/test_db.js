const { LocalMusicBrainzDb } = require('../src/musicbrainz/local-db');

const db = new LocalMusicBrainzDb('I:\\Musicbrainz\\musicbrainz_local.sqlite');
console.log('Local DB Available:', db.isAvailable);

if (db.isAvailable) {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('Tables:', tables);

    for (const t of tables) {
        const count = db.query(`SELECT count(*) as count FROM ${t.name}`);
        console.log(`  - ${t.name}:`, count[0]?.count?.toLocaleString());
    }

    console.log('\nTesting search for "Breezeblocks":');
    const result = db.searchRecording({ title: 'Breezeblocks', artist: 'Alt-J' });
    console.log('Search result:', result);
}
