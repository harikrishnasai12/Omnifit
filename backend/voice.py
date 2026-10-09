"""
Voice input: speech to text on OmniFit's own server (faster-whisper, free).

The browser records the question and uploads it; the audio is decoded in
memory, transcribed and discarded - never written to disk or logged.
English uses the fast "base" model; Tamil and Hindi use "small", which is
much more accurate for them. Models are downloaded once to data/models.
"""

import io
import logging
import os
import threading

import accounts

logger = logging.getLogger("omnifit.voice")

MODEL_DIR = accounts.DATA_DIR / "models" / "whisper"

# Language chip on the page -> Whisper language code and model size
LANGUAGES = {
    "en-IN": ("en", os.getenv("WHISPER_MODEL_EN", "base")),
    "ta-IN": ("ta", os.getenv("WHISPER_MODEL_OTHER", "small")),
    "hi-IN": ("hi", os.getenv("WHISPER_MODEL_OTHER", "small")),
}

MAX_AUDIO_BYTES = 3 * 1024 * 1024
MAX_AUDIO_SECONDS = 30

_models: dict[str, object] = {}
_models_lock = threading.Lock()
# Transcription is CPU-heavy: one at a time, so the server stays responsive
_busy = threading.Semaphore(1)


class VoiceError(Exception):
    """A problem the user should see."""


def _model(size: str):
    with _models_lock:
        if size not in _models:
            from faster_whisper import WhisperModel

            os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
            _models[size] = WhisperModel(size, device="cpu", compute_type="int8", download_root=str(MODEL_DIR))
        return _models[size]


def warm_up() -> None:
    """Load the English model ahead of the first question."""
    try:
        _model(LANGUAGES["en-IN"][1])
    except Exception:
        logger.exception("Voice model failed to load; voice input will retry on first use")


def transcribe(audio: bytes, language: str) -> str:
    if language not in LANGUAGES:
        language = "en-IN"
    code, size = LANGUAGES[language]

    if not audio:
        raise VoiceError("No audio was recorded.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise VoiceError(f"Please keep your question under {MAX_AUDIO_SECONDS} seconds.")

    from faster_whisper.audio import decode_audio

    try:
        samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
    except Exception:
        raise VoiceError("Couldn't read the recording. Please try again.")

    if len(samples) / 16000 > MAX_AUDIO_SECONDS + 1:
        raise VoiceError(f"Please keep your question under {MAX_AUDIO_SECONDS} seconds.")

    if not _busy.acquire(timeout=60):
        raise VoiceError("Voice input is busy. Please try again in a moment.")
    try:
        segments, _info = _model(size).transcribe(
            samples,
            language=code,
            beam_size=1,
            vad_filter=True,
            # A fashion hint helps with garment names in mixed speech
            initial_prompt="Fashion and clothing: shirt, kurta, saree, jeans, sneakers, lehenga, veshti.",
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
    finally:
        _busy.release()

    if not text:
        raise VoiceError("Didn't catch that. Please speak a little closer to the microphone.")
    return text[:500]
