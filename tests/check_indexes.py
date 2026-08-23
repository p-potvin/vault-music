import sqlite3

conn = sqlite3.connect(r"I:\Musicbrainz\musicbrainz_local.sqlite")
cur = conn.cursor()

indexes = cur.execute("SELECT name, tbl_name FROM sqlite_master WHERE type='index';").fetchall()
print("Indexes:", indexes)
