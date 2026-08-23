import sqlite3

db_path = r"I:\Musicbrainz\musicbrainz_local.sqlite"
conn = sqlite3.connect(db_path)
cur = conn.cursor()

tables = cur.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
print("Tables in DB:", tables)

for t in tables:
    name = t[0]
    count = cur.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
    print(f"  {name}: {count:,} rows")
