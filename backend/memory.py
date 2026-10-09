"""
Conversation memory: a vector database of every signed-in conversation.

Each entry keeps what the user asked (question, photo, section), what the
stylist saw and suggested, how the model responded (raw output, retries,
response time) and which products were shown. A text embedding of the
conversation makes it searchable by meaning:

- the stylist recalls a user's similar past conversations to stay
  consistent with their taste without repeating itself;
- review_history.py searches everything, for studying answer quality.

Storage: data/memory.db (SQLite + the sqlite-vec extension). Embeddings are
made on this computer by fastembed (BAAI/bge-small-en-v1.5, 384 numbers,
~25 ms each), so they don't depend on the shared Ollama server.

Privacy: only signed-in users with History on are stored. Photos are saved
in the user's own uploads folder. "Clear my history" and account deletion
erase entries, vectors and photos.
"""

import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

import sqlite_vec

import accounts

logger = logging.getLogger("omnifit.memory")

DB_PATH = accounts.DATA_DIR / "memory.db"
MODEL_DIR = accounts.DATA_DIR / "models"

EMBED_MODEL = "BAAI/bge-small-en-v1.5"
EMBED_DIMENSIONS = 384

# Entries kept per user; the oldest are removed beyond this
MAX_ENTRIES_PER_USER = int(os.getenv("MAX_HISTORY_PER_USER", "2000"))

# How close a past conversation must be to count as "similar" (cosine
# distance: 0 = same meaning)
# (bge-small scores related-but-different topics around 0.2-0.25)
RECALL_MAX_DISTANCE = 0.18
RECALL_COUNT = 3

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS interactions (
    num INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    created_at REAL NOT NULL,
    kind TEXT NOT NULL,             -- stylist | browse | failed
    question TEXT NOT NULL,
    department TEXT,
    region TEXT,
    image_file TEXT,
    seen TEXT,                      -- what the stylist saw in the photo
    request_type TEXT,
    suggestions TEXT,               -- short readable summary
    response_json TEXT,             -- the full answer sent to the page
    raw_response TEXT,              -- the model's own output
    attempts INTEGER,
    latency_ms INTEGER,
    personalized INTEGER,
    recalled_ids TEXT,              -- past conversations used for this answer
    products_json TEXT,             -- products shown for it
    embedded INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_interactions_user ON interactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS history_settings (
    user_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS interaction_vectors USING vec0(
    user_id TEXT PARTITION KEY,
    embedding FLOAT[{EMBED_DIMENSIONS}] distance_metric=cosine
);
"""


# ---------------------------------------------------------
# Database
# ---------------------------------------------------------

_schema_ready = False


def connect() -> sqlite3.Connection:
    global _schema_ready

    accounts.DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.enable_load_extension(True)
    sqlite_vec.load(connection)
    connection.enable_load_extension(False)

    if not _schema_ready:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(SCHEMA)
        # Columns added after the first release
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(interactions)")}
        if "age_group" not in columns:
            connection.execute("ALTER TABLE interactions ADD COLUMN age_group TEXT")
        _schema_ready = True

    return connection


# ---------------------------------------------------------
# Embeddings (local, CPU)
# ---------------------------------------------------------

_model = None
_model_lock = threading.Lock()
_load_failed_at = 0.0

# After a failed load (e.g. no internet for the first download), wait this
# long before trying again instead of retrying on every request
LOAD_RETRY_SECONDS = 600


class EmbeddingUnavailable(Exception):
    pass


def ready() -> bool:
    """True once the embedding model is loaded (recall never waits for it)."""
    return _model is not None


def _embedder():
    global _model, _load_failed_at
    with _model_lock:
        if _model is None:
            if time.time() - _load_failed_at < LOAD_RETRY_SECONDS:
                raise EmbeddingUnavailable("embedding model not available yet")
            try:
                from fastembed import TextEmbedding

                os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
                _model = TextEmbedding(EMBED_MODEL, cache_dir=str(MODEL_DIR))
            except Exception:
                _load_failed_at = time.time()
                raise
        return _model


def warm_up() -> None:
    """Load the embedding model ahead of the first conversation."""
    try:
        embed("warm up")
    except Exception:
        logger.exception("Embedding model failed to load; history search is off until it does")


def embed(text: str) -> bytes:
    vector = next(iter(_embedder().embed([text[:2000]])))
    return sqlite_vec.serialize_float32(vector.tolist())


# ---------------------------------------------------------
# Settings
# ---------------------------------------------------------

def history_enabled(user_id: str) -> bool:
    with connect() as connection:
        row = connection.execute(
            "SELECT enabled FROM history_settings WHERE user_id = ?", (user_id,)
        ).fetchone()
    return bool(row["enabled"]) if row else True


def set_history_enabled(user_id: str, enabled: bool) -> None:
    with connect() as connection:
        connection.execute(
            "INSERT INTO history_settings (user_id, enabled) VALUES (?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled",
            (user_id, int(enabled)),
        )


# ---------------------------------------------------------
# Text summaries
# ---------------------------------------------------------

def describe_seen(result: dict) -> str:
    analysis = result.get("outfit_analysis") or {}
    items = [
        " ".join(part for part in (item.get("color"), item.get("pattern") if item.get("pattern") != "solid" else "",
                                   item.get("fit"), item.get("item")) if part)
        for item in analysis.get("visible_items") or []
    ]
    style = analysis.get("overall_style") or ""
    return "; ".join(items) + (f" ({style})" if style and items else style)


def describe_suggestions(result: dict) -> str:
    lines = []
    for recommendation in result.get("recommendations") or []:
        if result.get("request_type") == "item_options":
            lines.append(" ".join(part for part in (
                recommendation.get("color"), recommendation.get("style") or recommendation.get("item")
            ) if part))
        else:
            pieces = []
            for piece in ("top", "layer", "bottom", "footwear", "accessories", "extra"):
                value = recommendation.get(piece)
                name = value.get("name") if isinstance(value, dict) else value
                if name:
                    kept = " (kept)" if piece in (recommendation.get("keep") or []) else ""
                    pieces.append(f"{name}{kept}")
            title = recommendation.get("title") or "Look"
            lines.append(f"{title}: {', '.join(pieces)}")
    return " | ".join(line for line in lines if line)


def _embed_text(row: sqlite3.Row) -> str:
    parts = [f"Question: {row['question']}"]
    if row["seen"]:
        parts.append(f"Photo shows: {row['seen']}")
    if row["suggestions"]:
        parts.append(f"Suggested: {row['suggestions']}")
    return "\n".join(parts)


# ---------------------------------------------------------
# Recording
# ---------------------------------------------------------

def new_id() -> str:
    return uuid.uuid4().hex


def record(
    user_id: str,
    interaction_id: str,
    kind: str,
    question: str,
    *,
    department: str = "",
    region: str = "",
    image: Optional[tuple[bytes, str]] = None,
    result: Optional[dict] = None,
    raw_response: str = "",
    attempts: int = 1,
    latency_ms: int = 0,
    personalized: bool = False,
    recalled_ids: Optional[list[str]] = None,
    products: Optional[dict] = None,
    age_group: Optional[str] = None,
) -> None:
    """Store one conversation (fast: the embedding is added by embed_pending)."""
    image_file = accounts.save_image(user_id, image[0], image[1]) if image else None
    result = result or {}

    with connect() as connection:
        connection.execute(
            """INSERT INTO interactions (id, user_id, created_at, kind, question, department, region,
                   image_file, seen, request_type, suggestions, response_json, raw_response,
                   attempts, latency_ms, personalized, recalled_ids, products_json, age_group)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                interaction_id, user_id, time.time(), kind, question[:1000], department, region,
                image_file, describe_seen(result), result.get("request_type"),
                describe_suggestions(result), json.dumps(result) if result else None,
                (raw_response or "")[:20000], attempts, latency_ms, int(personalized),
                json.dumps(recalled_ids or []),
                json.dumps(_summarize_products(products)) if products else None,
                age_group,
            ),
        )

    _trim(user_id)


def _summarize_products(products: dict) -> dict:
    return {
        key: [
            {"id": p["id"], "title": p["title"], "store": p["store"], "price": p["price"],
             "closest_match_without": p.get("closest_match_without") or []}
            for p in found.get("products", [])
        ]
        for key, found in products.items()
    }


def attach_products(user_id: str, interaction_id: str, products: dict) -> None:
    """Remember which products the page showed for a conversation."""
    with connect() as connection:
        connection.execute(
            "UPDATE interactions SET products_json = ? WHERE id = ? AND user_id = ?",
            (json.dumps(_summarize_products(products)), interaction_id, user_id),
        )


def embed_pending(limit: int = 50) -> int:
    """Add vectors for entries that don't have one yet."""
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM interactions WHERE embedded = 0 AND kind != 'failed' ORDER BY num LIMIT ?",
            (limit,),
        ).fetchall()

        for row in rows:
            vector = embed(_embed_text(row))
            connection.execute(
                "INSERT OR REPLACE INTO interaction_vectors (rowid, user_id, embedding) VALUES (?, ?, ?)",
                (row["num"], row["user_id"], vector),
            )
            connection.execute("UPDATE interactions SET embedded = 1 WHERE num = ?", (row["num"],))

    return len(rows)


def _trim(user_id: str) -> None:
    with connect() as connection:
        old = connection.execute(
            "SELECT num, image_file FROM interactions WHERE user_id = ? "
            "ORDER BY created_at DESC LIMIT -1 OFFSET ?",
            (user_id, MAX_ENTRIES_PER_USER),
        ).fetchall()
    if old:
        _delete_rows(user_id, old)


# ---------------------------------------------------------
# Recall (personalisation) and search (review)
# ---------------------------------------------------------

def recall_similar(user_id: str, question: str, seen: str = "") -> list[dict]:
    """This user's past conversations closest in meaning to a new question."""
    if not ready():
        return []
    text =f"Question: {question}" + (f"\nPhoto shows: {seen}" if seen else "")
    with connect() as connection:
        matches = connection.execute(
            """SELECT i.id, i.question, i.suggestions, i.created_at, v.distance
               FROM interaction_vectors v JOIN interactions i ON i.num = v.rowid
               WHERE v.embedding MATCH ? AND v.k = ? AND v.user_id = ?
               ORDER BY v.distance""",
            (embed(text), RECALL_COUNT * 2, user_id),
        ).fetchall()

    return [
        dict(row) for row in matches
        if row["distance"] <= RECALL_MAX_DISTANCE and row["suggestions"]
    ][:RECALL_COUNT]


def recall_prompt_section(similar: list[dict]) -> str:
    if not similar:
        return ""

    lines = "\n".join(
        f'- They asked "{entry["question"][:160]}"; you suggested: {entry["suggestions"][:300]}'
        for entry in similar
    )
    return f"""PAST CONVERSATIONS WITH THIS USER (the most similar to this question):
{lines}
Stay consistent with what suited them, but do NOT repeat these exact suggestions:
offer new pieces, colours or combinations so every answer brings something fresh."""


def search(query: str, user_id: Optional[str] = None, limit: int = 10) -> list[dict]:
    """Conversations closest in meaning to a text, for one user or everyone."""
    vector = embed(query)
    with connect() as connection:
        if user_id:
            rows = connection.execute(
                """SELECT i.*, v.distance FROM interaction_vectors v JOIN interactions i ON i.num = v.rowid
                   WHERE v.embedding MATCH ? AND v.k = ? AND v.user_id = ? ORDER BY v.distance""",
                (vector, limit, user_id),
            ).fetchall()
        else:
            rows = connection.execute(
                """SELECT i.*, v.distance FROM interaction_vectors v JOIN interactions i ON i.num = v.rowid
                   WHERE v.embedding MATCH ? AND v.k = ? ORDER BY v.distance""",
                (vector, limit),
            ).fetchall()
    return [dict(row) for row in rows]


# ---------------------------------------------------------
# The user's own history
# ---------------------------------------------------------

def _public_entry(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "kind": row["kind"],
        "question": row["question"],
        "has_image": bool(row["image_file"]),
        "seen": row["seen"] or "",
        "suggestions": row["suggestions"] or "",
    }


def list_history(user_id: str, limit: int = 50, before: Optional[float] = None) -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM interactions WHERE user_id = ? AND kind != 'failed' AND created_at < ? "
            "ORDER BY created_at DESC LIMIT ?",
            (user_id, before or time.time() + 1, limit),
        ).fetchall()
    return [_public_entry(row) for row in rows]


def history_image(user_id: str, interaction_id: str) -> Optional[Path]:
    with connect() as connection:
        row = connection.execute(
            "SELECT image_file FROM interactions WHERE id = ? AND user_id = ?", (interaction_id, user_id)
        ).fetchone()
    return accounts.image_path(user_id, row["image_file"]) if row and row["image_file"] else None


def _delete_rows(user_id: str, rows: list) -> None:
    with connect() as connection:
        for row in rows:
            connection.execute("DELETE FROM interaction_vectors WHERE rowid = ?", (row["num"],))
            connection.execute("DELETE FROM interactions WHERE num = ?", (row["num"],))

    for row in rows:
        path = accounts.image_path(user_id, row["image_file"]) if row["image_file"] else None
        if path:
            path.unlink(missing_ok=True)


def delete_entry(user_id: str, interaction_id: str) -> bool:
    with connect() as connection:
        rows = connection.execute(
            "SELECT num, image_file FROM interactions WHERE id = ? AND user_id = ?", (interaction_id, user_id)
        ).fetchall()
    _delete_rows(user_id, rows)
    return bool(rows)


def clear_history(user_id: str) -> int:
    with connect() as connection:
        rows = connection.execute(
            "SELECT num, image_file FROM interactions WHERE user_id = ?", (user_id,)
        ).fetchall()
    _delete_rows(user_id, rows)
    return len(rows)


def delete_user(user_id: str) -> None:
    """Everything stored for a deleted account (photos go with the uploads folder)."""
    clear_history(user_id)
    with connect() as connection:
        connection.execute("DELETE FROM history_settings WHERE user_id = ?", (user_id,))
