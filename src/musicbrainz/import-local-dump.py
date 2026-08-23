#!/usr/bin/env python3
"""
==============================================================================
Vault Music — MusicBrainz Local TSV Dump Importer & Indexer
==============================================================================
"""

import os
import sys
import time
import sqlite3
import argparse
from pathlib import Path

# Ensure UTF-8 output encoding on Windows console
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def parse_args():
    parser = argparse.ArgumentParser(description="Import MusicBrainz TSV dump into high-speed local SQLite database")
    parser.add_argument("--dump-dir", default=r"I:\Musicbrainz\Datadump-20260822\mbdump", help="Path to extracted mbdump directory")
    parser.add_argument("--out", default=r"I:\Musicbrainz\musicbrainz_local.sqlite", help="Output SQLite database path")
    parser.add_argument("--limit", type=int, default=0, help="Limit rows per table for test/dry runs (0 = all)")
    return parser.parse_args()

def init_db(db_path):
    print(f"[1/5] Initializing SQLite database at: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    conn.execute("PRAGMA cache_size = -1000000;")
    
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS artist_credits (
        id INTEGER PRIMARY KEY,
        name TEXT
    );

    CREATE TABLE IF NOT EXISTS release_groups (
        id INTEGER PRIMARY KEY,
        gid TEXT,
        name TEXT,
        artist_credit_id INTEGER,
        type INTEGER
    );

    CREATE TABLE IF NOT EXISTS releases (
        id INTEGER PRIMARY KEY,
        gid TEXT,
        name TEXT,
        artist_credit_id INTEGER,
        release_group_id INTEGER,
        date_year INTEGER,
        date_month INTEGER,
        date_day INTEGER,
        country TEXT,
        status TEXT
    );

    CREATE TABLE IF NOT EXISTS recordings (
        id INTEGER PRIMARY KEY,
        gid TEXT,
        name TEXT,
        artist_credit_id INTEGER,
        length INTEGER
    );

    CREATE TABLE IF NOT EXISTS tracks (
        id INTEGER PRIMARY KEY,
        gid TEXT,
        recording_id INTEGER,
        medium_id INTEGER,
        position INTEGER,
        number TEXT,
        name TEXT,
        artist_credit_id INTEGER,
        length INTEGER
    );

    CREATE TABLE IF NOT EXISTS medium (
        id INTEGER PRIMARY KEY,
        release_id INTEGER,
        position INTEGER,
        format INTEGER,
        name TEXT,
        track_count INTEGER
    );
    """)
    conn.commit()
    return conn

def stream_tsv(filepath, limit=0):
    if not os.path.exists(filepath):
        print(f"  [Skip] File not found: {filepath}")
        return
    
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        count = 0
        for line in f:
            if limit > 0 and count >= limit:
                break
            parts = line.rstrip("\r\n").split("\t")
            row = [None if p == r"\N" else p for p in parts]
            yield row
            count += 1

def import_artist_credits(conn, dump_dir, limit=0):
    path = os.path.join(dump_dir, "artist_credit")
    if not os.path.exists(path):
        path = os.path.join(dump_dir, "artist_credit.tsv")
    if not os.path.exists(path):
        return

    print("  Importing artist_credit...")
    cur = conn.cursor()
    batch = []
    total = 0
    t0 = time.time()
    for row in stream_tsv(path, limit):
        if len(row) >= 2:
            try:
                batch.append((int(row[0]), row[1]))
            except ValueError:
                continue
        if len(batch) >= 100000:
            cur.executemany("INSERT OR REPLACE INTO artist_credits (id, name) VALUES (?, ?)", batch)
            conn.commit()
            total += len(batch)
            batch = []
            print(f"\r    {total:,} artist credits imported...", end="", flush=True)
    if batch:
        cur.executemany("INSERT OR REPLACE INTO artist_credits (id, name) VALUES (?, ?)", batch)
        conn.commit()
        total += len(batch)
    print(f"\r  [OK] {total:,} artist credits imported in {time.time()-t0:.1f}s")

def import_releases(conn, dump_dir, limit=0):
    path = os.path.join(dump_dir, "release")
    if not os.path.exists(path):
        path = os.path.join(dump_dir, "release.tsv")
    if not os.path.exists(path):
        return

    print("  Importing releases...")
    cur = conn.cursor()
    batch = []
    total = 0
    t0 = time.time()
    for row in stream_tsv(path, limit):
        if len(row) >= 5:
            try:
                rel_id = int(row[0])
                gid = row[1]
                name = row[2]
                ac_id = int(row[3]) if row[3] else None
                rg_id = int(row[4]) if row[4] else None
                batch.append((rel_id, gid, name, ac_id, rg_id))
            except ValueError:
                continue
        if len(batch) >= 100000:
            cur.executemany("INSERT OR REPLACE INTO releases (id, gid, name, artist_credit_id, release_group_id) VALUES (?, ?, ?, ?, ?)", batch)
            conn.commit()
            total += len(batch)
            batch = []
            print(f"\r    {total:,} releases imported...", end="", flush=True)
    if batch:
        cur.executemany("INSERT OR REPLACE INTO releases (id, gid, name, artist_credit_id, release_group_id) VALUES (?, ?, ?, ?, ?)", batch)
        conn.commit()
        total += len(batch)
    print(f"\r  [OK] {total:,} releases imported in {time.time()-t0:.1f}s")
 
def import_recordings(conn, dump_dir, limit=0):
    path = os.path.join(dump_dir, "recording")
    if not os.path.exists(path):
        path = os.path.join(dump_dir, "recording.tsv")
    if not os.path.exists(path):
        return

    print("  Importing recordings...")
    cur = conn.cursor()
    batch = []
    total = 0
    t0 = time.time()
    for row in stream_tsv(path, limit):
        if len(row) >= 5:
            try:
                rec_id = int(row[0])
                gid = row[1]
                name = row[2]
                ac_id = int(row[3]) if row[3] else None
                length = int(row[4]) if row[4] else None
                batch.append((rec_id, gid, name, ac_id, length))
            except ValueError:
                continue
        if len(batch) >= 100000:
            cur.executemany("INSERT OR REPLACE INTO recordings (id, gid, name, artist_credit_id, length) VALUES (?, ?, ?, ?, ?)", batch)
            conn.commit()
            total += len(batch)
            batch = []
            print(f"\r    {total:,} recordings imported...", end="", flush=True)
    if batch:
        cur.executemany("INSERT OR REPLACE INTO recordings (id, gid, name, artist_credit_id, length) VALUES (?, ?, ?, ?, ?)", batch)
        conn.commit()
        total += len(batch)
    print(f"\r  [OK] {total:,} recordings imported in {time.time()-t0:.1f}s")

def build_indexes(conn):
    print("\n[3/5] Building performance indexes...")
    t0 = time.time()
    conn.executescript("""
    CREATE INDEX IF NOT EXISTS idx_ac_name ON artist_credits(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_rec_name ON recordings(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_rec_ac ON recordings(artist_credit_id);
    CREATE INDEX IF NOT EXISTS idx_rel_name ON releases(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_rel_ac ON releases(artist_credit_id);
    """)
    conn.commit()
    print(f"[OK] Indexes created in {time.time()-t0:.1f}s")

def main():
    args = parse_args()
    print("=" * 70)
    print(" MUSICBRAINZ LOCAL TSV DUMP IMPORTER")
    print("=" * 70)
    print(f" Source Dump Dir : {args.dump_dir}")
    print(f" Target Database : {args.out}")
    if args.limit > 0:
        print(f" Row Limit       : {args.limit}")
    print("=" * 70 + "\n")

    dump_path = Path(args.dump_dir)
    if not dump_path.exists():
        print(f"[Error] Dump directory '{dump_path}' does not exist.")
        sys.exit(1)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    conn = init_db(args.out)

    print("\n[2/5] Streaming raw tables into SQLite...")
    import_artist_credits(conn, str(dump_path), args.limit)
    import_releases(conn, str(dump_path), args.limit)
    import_recordings(conn, str(dump_path), args.limit)

    build_indexes(conn)
    conn.close()
    print("\n[5/5] Importer complete!")

if __name__ == "__main__":
    main()
