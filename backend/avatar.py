"""
My Mannequin: a signed-in person's body photos and the measurements taken
from them, for the 3D mannequin on the Try-On page.

Kept small on purpose: at most one photo per view (front, side, back) and
the face framed for the mannequin's head, each under MAX_PHOTO_BYTES,
replaced when a new one is sent. Photos live in the
person's own upload folder and are only ever served back to them. Deleting
the mannequin, or the account, removes them.

The measuring itself happens in the browser; the server only stores the
result.
"""

import json
import time
from pathlib import Path
from typing import Optional

import accounts

# "face": the face as framed for the mannequin's head (a small square picture)
VIEWS = ("front", "side", "back", "face")
MAX_PHOTO_BYTES = 1_500_000
MAX_DATA_CHARS = 12_000

TABLE = """
CREATE TABLE IF NOT EXISTS avatar_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    photos TEXT NOT NULL,
    updated_at REAL NOT NULL
);
"""

_schema_ready = False


def connect():
    global _schema_ready
    connection = accounts.connect()
    if not _schema_ready:
        connection.executescript(TABLE)
        _schema_ready = True
    return connection


def _row(user_id: str):
    with connect() as connection:
        return connection.execute("SELECT * FROM avatar_profiles WHERE user_id = ?", (user_id,)).fetchone()


def get(user_id: str) -> Optional[dict]:
    """{"data": {...}, "photos": ["front", ...], "updated_at"} or None."""
    row = _row(user_id)
    if not row:
        return None
    files = json.loads(row["photos"])
    return {
        "data": json.loads(row["data"]),
        "photos": [view for view in VIEWS if view in files and accounts.image_path(user_id, files[view])],
        "updated_at": row["updated_at"],
    }


def photo_path(user_id: str, view: str) -> Optional[Path]:
    row = _row(user_id)
    files = json.loads(row["photos"]) if row else {}
    return accounts.image_path(user_id, files.get(view, "")) if view in VIEWS else None


def save(user_id: str, data: dict, photos: dict[str, tuple[bytes, str]]) -> dict:
    """Stores the measurements and any new photos ({view: (bytes, extension)}).
    A new photo replaces the old one for that view."""
    row = _row(user_id)
    files = json.loads(row["photos"]) if row else {}

    for view, (image_bytes, extension) in photos.items():
        if view not in VIEWS:
            continue
        old = accounts.image_path(user_id, files.get(view, ""))
        files[view] = accounts.save_image(user_id, image_bytes, extension)
        if old:
            old.unlink(missing_ok=True)

    with connect() as connection:
        connection.execute(
            "INSERT INTO avatar_profiles (user_id, data, photos, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, photos = excluded.photos, updated_at = excluded.updated_at",
            (user_id, json.dumps(data), json.dumps(files), time.time()),
        )
    return get(user_id)


def delete(user_id: str) -> bool:
    row = _row(user_id)
    if not row:
        return False
    for file_name in json.loads(row["photos"]).values():
        path = accounts.image_path(user_id, file_name)
        if path:
            path.unlink(missing_ok=True)
    with connect() as connection:
        connection.execute("DELETE FROM avatar_profiles WHERE user_id = ?", (user_id,))
    return True
