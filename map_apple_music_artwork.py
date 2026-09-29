import argparse
import difflib
import json
import os
import re
import shutil
import sqlite3
import struct
import time
import unicodedata
import zlib
from io import BytesIO

import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

LIBRARY_DIR = os.environ.get(
    "APPLE_MUSIC_LIBRARY_DIR",
    os.path.join(os.environ.get("USERPROFILE", r"C:\Users\Administrator"), "Music", "Apple Music", "Apple Music Library.musiclibrary"),
)
DB_PATH = os.path.join(LIBRARY_DIR, "artwork.sqlite")
MUSICDB_PATH = os.path.join(LIBRARY_DIR, "Library.musicdb")
CACHE_DIR = os.path.join(LIBRARY_DIR, "artwork")
OUTPUT_DIR = os.environ.get("APPLE_MUSIC_ARTWORK_OUTPUT_DIR", r"G:\MusicArtworkMapped")
MUSICDB_AES_KEY = b"BHUILuilfghuila3"
ITUNES_API = "https://itunes.apple.com"

QUALITY_TAGS = re.compile(
    r"\b(?:flac|alac|lossless|wavpack|ape|mp3|aac|m4a|320\s?kbps?|256\s?kbps?|"
    r"192\s?kbps?|160\s?kbps?|128\s?kbps?|v0|v2|24\s?bit|16\s?bit|web\s?[- ]?dl|"
    r"web|cd|vinyl|remaster(?:ed)?|proper|repack|discography|digital\s?download)\b",
    re.IGNORECASE,
)


def clean_filename(name):
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    return " ".join(name.split()).strip()


def parse_musicdb_metadata(musicdb_path):
    if not os.path.exists(musicdb_path):
        print(f"[-] Warning: Library.musicdb not found at {musicdb_path}")
        return {}, {}, {}

    try:
        with open(musicdb_path, "rb") as source:
            source.read(4)
            header_size, = struct.unpack("<I", source.read(4))
            header = source.read(header_size - 8)
            file_size, = struct.unpack("<I", header[0:4])
            encrypted_size, = struct.unpack("<I", header[76:80])
            data_size = file_size - header_size
            encrypted_size = data_size - (data_size % 16) if encrypted_size > file_size else encrypted_size
            source.seek(header_size)
            raw = source.read()

        cipher = Cipher(algorithms.AES(MUSICDB_AES_KEY), modes.ECB())
        decryptor = cipher.decryptor()
        decrypted = decryptor.update(raw[:encrypted_size]) + decryptor.finalize()
        content = BytesIO(zlib.decompress(decrypted + raw[encrypted_size:]))

        def read_chunk():
            fourcc = content.read(4)
            if not fourcc:
                return None
            chunk_len, = struct.unpack("<I", content.read(4))
            prefix = 8
            if fourcc == b"boma":
                prefix += 4
                chunk_len, = struct.unpack("<I", content.read(4))
            return fourcc, content.read(chunk_len - prefix)

        def read_utf16_boma(chunk):
            _, encoding, length, _, _ = struct.unpack("<IIIII", chunk.read(20))
            return chunk.read(length).decode("utf-16" if encoding == 1 else "utf-8", errors="replace")

        albums, tracks, artists = {}, {}, {}
        while True:
            item = read_chunk()
            if not item:
                break
            fourcc, data = item
            chunk = BytesIO(data)
            if fourcc in (b"iama", b"itma", b"iAma"):
                chunk.read(4)
                boma_count, item_id = struct.unpack("<Iq", chunk.read(12))
                info = {}
                for _ in range(boma_count):
                    _, child_data = read_chunk_from(content)
                    child = BytesIO(child_data)
                    subtype, = struct.unpack("<I", child.read(4))
                    allowed = (300, 301, 302) if fourcc == b"iama" else ((400, 401) if fourcc == b"iAma" else (2, 3, 4, 0x1B))
                    if subtype in allowed:
                        info[subtype] = read_utf16_boma(child)
                if fourcc == b"iama":
                    albums[item_id] = (info.get(301) or info.get(302) or "Unknown Artist", info.get(300) or "Unknown Album")
                elif fourcc == b"itma":
                    tracks[item_id] = (info.get(4) or info.get(0x1B) or "Unknown Artist", info.get(3) or info.get(2) or "Unknown Album")
                else:
                    artists[item_id] = info.get(400) or "Unknown Artist"
        return albums, tracks, artists
    except Exception as exc:
        print(f"[-] Warning: Failed to parse Library.musicdb: {exc}")
        return {}, {}, {}


def read_chunk_from(stream):
    fourcc = stream.read(4)
    if not fourcc:
        raise EOFError("Unexpected end of Apple Music database chunk")
    chunk_len, = struct.unpack("<I", stream.read(4))
    prefix = 8
    if fourcc == b"boma":
        prefix += 4
        chunk_len, = struct.unpack("<I", stream.read(4))
    return fourcc, stream.read(chunk_len - prefix)


def _normalise(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(char for char in value if not unicodedata.combining(char)).casefold()
    return " ".join(re.findall(r"[a-z0-9]+", value))


def _similarity(left, right):
    left_norm, right_norm = _normalise(left), _normalise(right)
    if not left_norm or not right_norm:
        return 0.0
    sequence = difflib.SequenceMatcher(None, left_norm, right_norm).ratio()
    left_tokens, right_tokens = set(left_norm.split()), set(right_norm.split())
    overlap = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
    return max(sequence, overlap)


def parse_torrent_title(torrent_title):
    """Extract likely artist/album text from a release title without trusting quality tags."""
    title = os.path.basename((torrent_title or "").strip())
    title = re.sub(r"\.(?:torrent|zip|rar|7z|flac|mp3|m4a)$", "", title, flags=re.IGNORECASE)
    upc = re.search(r"\b(?:upc|ean)\s*[:=_ -]?\s*(\d{12,14})\b", title, re.IGNORECASE)
    if not upc:
        upc = re.search(r"\b(\d{12,14})\b", title)

    def clean_segment(segment):
        segment = re.sub(r"[_]+", " ", segment)
        segment = re.sub(r"\[[^\]]*\]", lambda match: " " if QUALITY_TAGS.search(match.group()) or re.search(r"\b(?:19|20)\d{2}\b", match.group()) else match.group(), segment)
        segment = re.sub(r"\(([^)]*)\)", lambda match: " " if QUALITY_TAGS.search(match.group()) or re.search(r"\b(?:19|20)\d{2}\b", match.group()) else match.group(1), segment)
        segment = QUALITY_TAGS.sub(" ", segment)
        segment = re.sub(r"\b(?:19|20)\d{2}\b", " ", segment)
        segment = re.sub(r"\b(?:320|256|192|160|128)\s?kbps?\b", " ", segment, flags=re.IGNORECASE)
        return " ".join(segment.split(".")).strip(" -_ .")

    cleaned = clean_segment(title)
    split = re.split(r"\s+(?:-|–|—)\s+", cleaned, maxsplit=1)
    artist, album = (split[0].strip(), split[1].strip()) if len(split) == 2 else ("", cleaned)
    return {"artist": artist, "album": album, "cleanedTitle": cleaned, "upc": upc.group(1) if upc else None}


def _itunes_request(path, params):
    response = requests.get(f"{ITUNES_API}/{path}", params=params, timeout=8, headers={"User-Agent": "VaultMusic/1.1"})
    response.raise_for_status()
    return response.json().get("results", [])


def _candidate_score(item, artist, album, cleaned_title):
    item_artist = item.get("artistName", "")
    item_album = item.get("collectionName") or item.get("trackName", "")
    album_score = _similarity(album or cleaned_title, item_album)
    if artist:
        artist_score = _similarity(artist, item_artist)
        score = 0.38 * artist_score + 0.62 * album_score
    else:
        artist_score = None
        score = album_score
    return score, artist_score, album_score


def resolve_torrent_apple_id(torrent_title, artist=None, album=None, country="ca", limit=25):
    parsed = parse_torrent_title(torrent_title)
    artist = (artist or parsed["artist"]).strip()
    album = (album or parsed["album"]).strip()
    if not album:
        return {"status": "no_query", "message": "Could not extract an album or search term from the torrent title."}

    if parsed["upc"]:
        try:
            results = _itunes_request("lookup", {"upc": parsed["upc"], "country": country})
            collections = [item for item in results if item.get("collectionId")]
            if collections:
                item = collections[0]
                return {"status": "matched", "matchMethod": "upc", "appleId": item["collectionId"], "artist": item.get("artistName"), "album": item.get("collectionName"), "artworkUrl": item.get("artworkUrl100"), "candidates": collections[:3]}
        except requests.RequestException:
            pass

    query = " ".join(part for part in (artist, album) if part).strip()
    queries = [query]
    if parsed["cleanedTitle"] and _normalise(parsed["cleanedTitle"]) != _normalise(query):
        queries.append(parsed["cleanedTitle"])

    found = {}
    for term in queries[:2]:
        for entity in ("album", "song"):
            try:
                results = _itunes_request("search", {"term": term, "entity": entity, "country": country, "limit": min(max(limit, 1), 25)})
            except requests.RequestException:
                continue
            for item in results:
                apple_id = item.get("collectionId")
                if not apple_id:
                    continue
                score, artist_score, album_score = _candidate_score(item, artist, album, parsed["cleanedTitle"])
                candidate = {
                    "appleId": apple_id,
                    "artist": item.get("artistName"),
                    "album": item.get("collectionName") or item.get("trackName"),
                    "releaseDate": item.get("releaseDate"),
                    "trackId": item.get("trackId"),
                    "score": round(score, 3),
                    "artistScore": round(artist_score, 3) if artist_score is not None else None,
                    "albumScore": round(album_score, 3),
                    "artworkUrl": item.get("artworkUrl100"),
                }
                if apple_id not in found or candidate["score"] > found[apple_id]["score"]:
                    found[apple_id] = candidate
        if found:
            break
        time.sleep(0.25)

    candidates = sorted(found.values(), key=lambda item: item["score"], reverse=True)[:5]
    if not candidates:
        return {"status": "not_found", "artistQuery": artist, "albumQuery": album, "candidates": []}

    best = candidates[0]
    margin = best["score"] - candidates[1]["score"] if len(candidates) > 1 else 1.0
    status = "matched" if best["score"] >= 0.82 and margin >= 0.04 else "review"
    return {"status": status, "matchMethod": "itunes_search", "artistQuery": artist, "albumQuery": album, "appleId": best["appleId"] if status == "matched" else None, "bestCandidate": best, "candidates": candidates}


def lookup_upc_batch(upc_list):
    results = {}
    for upc in list(dict.fromkeys(upc_list))[:100]:
        try:
            found = _itunes_request("lookup", {"upc": upc})
            if found:
                item = found[0]
                results[upc] = {"artist": item.get("artistName", "Unknown Artist"), "album": item.get("collectionName", item.get("trackName", "Unknown Album")), "appleId": item.get("collectionId"), "artworkUrl": item.get("artworkUrl100")}
        except requests.RequestException:
            pass
        time.sleep(0.1)
    return results


def export_artwork(max_export=100, dry_run=False):
    if not os.path.exists(CACHE_DIR) or not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"Missing Apple Music artwork cache or database: {CACHE_DIR}, {DB_PATH}")

    albums, tracks, artists = parse_musicdb_metadata(MUSICDB_PATH)
    connection = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        cache_items = connection.execute("SELECT artwork_id, size_kind, extension FROM cache_items").fetchall()
        item_map = {}
        for item_id, artwork_id, _ in connection.execute("SELECT item_id, artwork_id, source_kind FROM item_to_artwork"):
            item_map.setdefault(artwork_id, []).append(item_id)
        source_map = dict(connection.execute("SELECT artwork_id, location FROM artwork_source"))
    finally:
        connection.close()

    resolved, unresolved_upcs = {}, {}
    for artwork_id, size_kind, extension in cache_items:
        metadata = next((albums[item_id] for item_id in item_map.get(artwork_id, []) if item_id in albums), None)
        metadata = metadata or next((tracks[item_id] for item_id in item_map.get(artwork_id, []) if item_id in tracks), None)
        metadata = metadata or next(((artists[item_id], "Artist Photo") for item_id in item_map.get(artwork_id, []) if item_id in artists), None)
        if metadata:
            resolved[artwork_id] = (metadata, size_kind, extension)
        else:
            match = re.search(r"/(\d{10,14})(?:_|\.)", source_map.get(artwork_id, ""))
            if match:
                unresolved_upcs[artwork_id] = match.group(1)

    upc_results = lookup_upc_batch(unresolved_upcs.values()) if unresolved_upcs else {}
    item_by_id = {item[0]: item for item in cache_items}
    for artwork_id, upc in unresolved_upcs.items():
        if upc in upc_results:
            _, size_kind, extension = item_by_id[artwork_id]
            record = upc_results[upc]
            resolved[artwork_id] = ((record["artist"], record["album"]), size_kind, extension)

    limit = len(resolved) if max_export == 0 else min(max_export, len(resolved))
    print(f"Resolved {len(resolved)} cached images; exporting at most {limit}.")
    if dry_run:
        for _, (metadata, _, extension) in list(resolved.items())[:limit]:
            print(f"  {clean_filename(metadata[0] + ' - ' + metadata[1])}.{extension}")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    copied = 0
    for artwork_id, (metadata, size_kind, extension) in list(resolved.items())[:limit]:
        source_path = os.path.join(CACHE_DIR, f"{artwork_id}_sk{size_kind}.{extension}")
        if not os.path.exists(source_path):
            continue
        base_name = clean_filename(f"{metadata[0]} - {metadata[1]}") or f"Artwork_{artwork_id}"
        target_path = os.path.join(OUTPUT_DIR, f"{base_name}.{extension}")
        counter = 1
        while os.path.exists(target_path):
            target_path = os.path.join(OUTPUT_DIR, f"{base_name} ({counter}).{extension}")
            counter += 1
        shutil.copy2(source_path, target_path)
        copied += 1
    print(f"Exported {copied} files to {OUTPUT_DIR}.")


def main():
    parser = argparse.ArgumentParser(description="Apple Music artwork mapper and iTunes torrent-title resolver")
    parser.add_argument("--resolve-torrent-title", help="Resolve an iTunes collectionId from a torrent release title")
    parser.add_argument("--artist", help="Artist name to improve title-based matching")
    parser.add_argument("--album", help="Album name to improve title-based matching")
    parser.add_argument("--country", default="ca", help="iTunes storefront country code (default: ca)")
    parser.add_argument("--export", action="store_true", help="Export mapped cached artwork copies")
    parser.add_argument("--max-export", type=int, default=100, help="Maximum local cache images copied; 0 means unlimited")
    parser.add_argument("--dry-run", action="store_true", help="List mapped artwork without copying it")
    args = parser.parse_args()

    if args.resolve_torrent_title:
        print(json.dumps(resolve_torrent_apple_id(args.resolve_torrent_title, args.artist, args.album, args.country), ensure_ascii=False, indent=2))
        return
    if args.export or args.dry_run:
        export_artwork(max_export=max(0, args.max_export), dry_run=args.dry_run)
        return
    parser.print_help()


if __name__ == "__main__":
    main()
