import sqlite3
import time
import sys

# Ensure UTF-8 output
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

print("Building indexes on I:\\Musicbrainz\\musicbrainz_local.sqlite...")
conn = sqlite3.connect(r"I:\Musicbrainz\musicbrainz_local.sqlite")
conn.execute("PRAGMA journal_mode = WAL;")
conn.execute("PRAGMA synchronous = OFF;")
conn.execute("PRAGMA temp_store = MEMORY;")
conn.execute("PRAGMA cache_size = -2000000;") # 2GB cache

statements = [
    ("idx_ac_name", "CREATE INDEX IF NOT EXISTS idx_ac_name ON artist_credits(name COLLATE NOCASE);"),
    ("idx_rec_name", "CREATE INDEX IF NOT EXISTS idx_rec_name ON recordings(name COLLATE NOCASE);"),
    ("idx_rec_ac", "CREATE INDEX IF NOT EXISTS idx_rec_ac ON recordings(artist_credit_id);"),
    ("idx_rel_name", "CREATE INDEX IF NOT EXISTS idx_rel_name ON releases(name COLLATE NOCASE);"),
    ("idx_rel_ac", "CREATE INDEX IF NOT EXISTS idx_rel_ac ON releases(artist_credit_id);")
]

for name, sql in statements:
    print(f"Creating {name}...")
    t0 = time.time()
    conn.execute(sql)
    conn.commit()
    print(f"  [OK] {name} created in {time.time()-t0:.1f}s")

conn.close()
print("All indexes built successfully!")
