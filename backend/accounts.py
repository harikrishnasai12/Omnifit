"""
User accounts, sessions, the Style Library and recommendation history.

Stored in a separate SQLite database (data/users.db) from the product
catalog, so the catalog can be rebuilt without touching user data.

Security notes:
- Passwords are hashed with scrypt (Python standard library) and a random salt.
- Session tokens are random; only their SHA-256 hash is stored, so a copy of
  the database can't be used to log in.
- Saved images live under data/uploads/<user id>/ and are only served to
  their owner.
"""

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import uuid
from collections import Counter
from pathlib import Path
from typing import Optional

DATA_DIR = Path(os.getenv("USER_DATA_DIR", str(Path(__file__).with_name("data"))))
DB_PATH = DATA_DIR / "users.db"
UPLOADS_DIR = DATA_DIR / "uploads"

SESSION_DAYS = 30
SESSION_SECONDS = SESSION_DAYS * 24 * 3600

# scrypt cost: ~50 ms per hash, strong enough for passwords
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS library_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    source TEXT NOT NULL,
    platform TEXT,
    source_url TEXT,
    title TEXT,
    note TEXT,
    image_file TEXT,
    analysis TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_library_user ON library_items(user_id, created_at);

-- Clothes the user owns (My Wardrobe): one row per garment; garments from
-- the same photo share its image file
CREATE TABLE IF NOT EXISTS wardrobe_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    image_file TEXT,
    piece TEXT NOT NULL,
    department TEXT
);

CREATE INDEX IF NOT EXISTS idx_wardrobe_user ON wardrobe_items(user_id, created_at);

CREATE TABLE IF NOT EXISTS shown_products (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    shown_at REAL NOT NULL,
    PRIMARY KEY (user_id, product_id)
);
"""


class AccountError(Exception):
    """A problem the user should see (wrong password, email taken, ...)."""


# ---------------------------------------------------------
# Database
# ---------------------------------------------------------

_schema_ready = False


def connect() -> sqlite3.Connection:
    global _schema_ready

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")

    if not _schema_ready:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(SCHEMA)
        _schema_ready = True

    return connection


# ---------------------------------------------------------
# Passwords
# ---------------------------------------------------------

MIN_PASSWORD_LENGTH = 8


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: Optional[str]) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False

    _, salt_hex, digest_hex = stored.split("$")
    digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)


# A fixed hash to check against when the email doesn't exist, so a failed
# login takes the same time either way (doesn't reveal which emails exist)
_DUMMY_HASH = hash_password(secrets.token_hex(8))


# ---------------------------------------------------------
# Users
# ---------------------------------------------------------

def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _public_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"] or (row["email"] or "").split("@")[0],
        "has_password": bool(row["password_hash"]),
        "has_google": bool(row["google_sub"]),
    }


def register(email: str, password: str, name: str = "") -> dict:
    email = _normalize_email(email)

    if "@" not in email or "." not in email.split("@")[-1] or len(email) > 254:
        raise AccountError("Please enter a valid email address.")

    if len(password) < MIN_PASSWORD_LENGTH:
        raise AccountError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")

    with connect() as connection:
        if connection.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            raise AccountError("An account with this email already exists. Please sign in.")

        user_id = uuid.uuid4().hex
        connection.execute(
            "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, email, (name or "").strip()[:60] or None, hash_password(password), time.time())
        )
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    return _public_user(row)


def authenticate(email: str, password: str) -> dict:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE email = ?", (_normalize_email(email),)
        ).fetchone()

    if not verify_password(password, row["password_hash"] if row else _DUMMY_HASH) or not row:
        raise AccountError("Email or password is incorrect.")

    return _public_user(row)


def upsert_google_user(google_sub: str, email: str, name: str) -> dict:
    """Sign in with Google: find by Google id, else link to an existing
    account with the same (Google-verified) email, else create one."""
    email = _normalize_email(email)

    with connect() as connection:
        row = connection.execute("SELECT * FROM users WHERE google_sub = ?", (google_sub,)).fetchone()

        if not row and email:
            row = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if row:
                connection.execute("UPDATE users SET google_sub = ? WHERE id = ?", (google_sub, row["id"]))

        if not row:
            user_id = uuid.uuid4().hex
            connection.execute(
                "INSERT INTO users (id, email, name, google_sub, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, email or None, (name or "").strip()[:60] or None, google_sub, time.time())
            )
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        else:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()

    return _public_user(row)


def delete_user(user_id: str) -> None:
    """Delete the account and everything stored for it, including images."""
    with connect() as connection:
        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))

    user_dir = UPLOADS_DIR / user_id
    if user_dir.is_dir():
        for path in user_dir.iterdir():
            path.unlink(missing_ok=True)
        user_dir.rmdir()


# ---------------------------------------------------------
# Sessions
# ---------------------------------------------------------

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)

    with connect() as connection:
        # Tidy up expired sessions while we're here
        connection.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        connection.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (_token_hash(token), user_id, time.time() + SESSION_SECONDS)
        )

    return token


def user_for_session(token: Optional[str]) -> Optional[dict]:
    if not token or len(token) > 100:
        return None

    with connect() as connection:
        row = connection.execute(
            """
            SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (_token_hash(token), time.time())
        ).fetchone()

    return _public_user(row) if row else None


def end_session(token: Optional[str]) -> None:
    if token:
        with connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


# ---------------------------------------------------------
# Style Library
# ---------------------------------------------------------

MAX_LIBRARY_ITEMS = 500


def save_image(user_id: str, image_bytes: bytes, extension: str) -> str:
    user_dir = UPLOADS_DIR / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    file_name = f"{uuid.uuid4().hex}.{extension}"
    (user_dir / file_name).write_bytes(image_bytes)
    return file_name


def image_path(user_id: str, file_name: str) -> Optional[Path]:
    # File names are generated by save_image; reject anything else
    if not file_name or "/" in file_name or "\\" in file_name or ".." in file_name:
        return None

    path = UPLOADS_DIR / user_id / file_name
    return path if path.is_file() else None


def add_library_item(user_id: str, item: dict) -> dict:
    with connect() as connection:
        count = connection.execute(
            "SELECT COUNT(*) FROM library_items WHERE user_id = ?", (user_id,)
        ).fetchone()[0]

        if count >= MAX_LIBRARY_ITEMS:
            raise AccountError(f"Your Style Library is full ({MAX_LIBRARY_ITEMS} items). Remove some to add more.")

        item_id = uuid.uuid4().hex
        connection.execute(
            """
            INSERT INTO library_items
            (id, user_id, created_at, source, platform, source_url, title, note, image_file, analysis)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id, user_id, time.time(), item["source"], item.get("platform"),
                item.get("source_url"), item.get("title"), item.get("note"),
                item.get("image_file"), json.dumps(item["analysis"]),
            )
        )

    return get_library_item(user_id, item_id)


def _public_item(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "source": row["source"],
        "platform": row["platform"],
        "source_url": row["source_url"],
        "title": row["title"],
        "note": row["note"],
        "has_image": bool(row["image_file"]),
        "analysis": json.loads(row["analysis"]),
    }


def get_library_item(user_id: str, item_id: str) -> Optional[dict]:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM library_items WHERE id = ? AND user_id = ?", (item_id, user_id)
        ).fetchone()

    return _public_item(row) if row else None


def get_library_image_file(user_id: str, item_id: str) -> Optional[Path]:
    with connect() as connection:
        row = connection.execute(
            "SELECT image_file FROM library_items WHERE id = ? AND user_id = ?", (item_id, user_id)
        ).fetchone()

    return image_path(user_id, row["image_file"]) if row and row["image_file"] else None


def list_library(user_id: str) -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM library_items WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()

    return [_public_item(row) for row in rows]


def delete_library_item(user_id: str, item_id: str) -> bool:
    path = get_library_image_file(user_id, item_id)

    with connect() as connection:
        deleted = connection.execute(
            "DELETE FROM library_items WHERE id = ? AND user_id = ?", (item_id, user_id)
        ).rowcount

    if deleted and path:
        path.unlink(missing_ok=True)

    return bool(deleted)


# ---------------------------------------------------------
# My Wardrobe (clothes the user owns)
# ---------------------------------------------------------

MAX_WARDROBE_ITEMS = 300


def add_wardrobe_pieces(user_id: str, image_file: Optional[str], pieces: list[dict], department: str) -> list[dict]:
    with connect() as connection:
        count = connection.execute(
            "SELECT COUNT(*) FROM wardrobe_items WHERE user_id = ?", (user_id,)
        ).fetchone()[0]

        if count + len(pieces) > MAX_WARDROBE_ITEMS:
            raise AccountError(f"Your wardrobe is full ({MAX_WARDROBE_ITEMS} pieces). Remove some to add more.")

        now = time.time()
        ids = []
        for offset, piece in enumerate(pieces):
            item_id = uuid.uuid4().hex
            ids.append(item_id)
            connection.execute(
                "INSERT INTO wardrobe_items (id, user_id, created_at, image_file, piece, department) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                # A tiny offset keeps the photo's garments in the order they were found
                (item_id, user_id, now + offset / 1000, image_file, json.dumps(piece), department),
            )

    return [item for item in list_wardrobe(user_id) if item["id"] in ids]


def _public_wardrobe_item(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "has_image": bool(row["image_file"]),
        "department": row["department"],
        **json.loads(row["piece"]),
    }


def list_wardrobe(user_id: str) -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM wardrobe_items WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()

    return [_public_wardrobe_item(row) for row in rows]


def get_wardrobe_image_file(user_id: str, item_id: str) -> Optional[Path]:
    with connect() as connection:
        row = connection.execute(
            "SELECT image_file FROM wardrobe_items WHERE id = ? AND user_id = ?", (item_id, user_id)
        ).fetchone()

    return image_path(user_id, row["image_file"]) if row and row["image_file"] else None


def delete_wardrobe_item(user_id: str, item_id: str) -> bool:
    with connect() as connection:
        row = connection.execute(
            "SELECT image_file FROM wardrobe_items WHERE id = ? AND user_id = ?", (item_id, user_id)
        ).fetchone()
        if not row:
            return False

        connection.execute("DELETE FROM wardrobe_items WHERE id = ? AND user_id = ?", (item_id, user_id))

        # The photo goes once no other garment from it is left
        still_used = row["image_file"] and connection.execute(
            "SELECT 1 FROM wardrobe_items WHERE user_id = ? AND image_file = ? LIMIT 1",
            (user_id, row["image_file"]),
        ).fetchone()

    if row["image_file"] and not still_used:
        path = image_path(user_id, row["image_file"])
        if path:
            path.unlink(missing_ok=True)

    return True


# ---------------------------------------------------------
# Taste profile (built from the Style Library)
# ---------------------------------------------------------

def taste_profile(user_id: str) -> dict:
    """Summarise what a user keeps saving: styles, colours, garments, section."""
    items = list_library(user_id)

    styles, colors, garments, departments = Counter(), Counter(), Counter(), Counter()

    for item in items:
        analysis = item["analysis"]
        styles.update(analysis.get("styles", []))
        colors.update(analysis.get("colors", []))
        garments.update(
            piece.get("item", "").lower() for piece in analysis.get("visible_items", []) if piece.get("item")
        )
        if analysis.get("department") in ("men", "women", "unisex"):
            departments[analysis["department"]] += 1

    def top(counter: Counter, limit: int) -> list[str]:
        # Only signals seen more than once count as taste, unless the library is tiny
        minimum = 2 if len(items) >= 4 else 1
        return [key for key, count in counter.most_common(limit) if count >= minimum]

    return {
        "item_count": len(items),
        "styles": top(styles, 3),
        "colors": top(colors, 4),
        "garments": top(garments, 4),
        "department": departments.most_common(1)[0][0] if departments else None,
    }


# ---------------------------------------------------------
# Products already shown (to avoid repeating them)
# ---------------------------------------------------------

SHOWN_MEMORY_DAYS = 14
# Products shown in the last few minutes belong to the current answer (it
# re-fetches when the budget changes) and must not be pushed down
SHOWN_GRACE_SECONDS = 10 * 60


def record_shown_products(user_id: str, product_ids: list[str]) -> None:
    now = time.time()

    with connect() as connection:
        connection.executemany(
            """
            INSERT INTO shown_products (user_id, product_id, shown_at) VALUES (?, ?, ?)
            ON CONFLICT(user_id, product_id) DO UPDATE SET shown_at = excluded.shown_at
            """,
            [(user_id, product_id, now) for product_id in dict.fromkeys(product_ids)]
        )


def recently_shown_products(user_id: str) -> set[str]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT product_id FROM shown_products WHERE user_id = ? AND shown_at > ? AND shown_at < ?",
            (user_id, time.time() - SHOWN_MEMORY_DAYS * 24 * 3600, time.time() - SHOWN_GRACE_SECONDS)
        ).fetchall()

    return {row["product_id"] for row in rows}
