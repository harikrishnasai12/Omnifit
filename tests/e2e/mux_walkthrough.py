"""
Make the narrated MP4s: the screen recording from record_walkthrough.mjs
plus each scene's narration WAV (from build_walkthrough.py --audio), placed
at the moment that scene started. H.264 video + AAC audio, 1280x720, 25 fps.

Usage (with the backend venv; PyAV comes with faster-whisper):
    python tests/e2e/mux_walkthrough.py <walkthrough folder> [persona ...]
"""

import json
import sys
import wave
from fractions import Fraction
from pathlib import Path

import av
import numpy as np

FPS = 25
LEAD_IN = 0.4      # seconds of the first scene kept before it starts
TAIL = 1.5         # seconds kept after the last narration ends


def load_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path)) as wav:
        rate, width, channels = wav.getframerate(), wav.getsampwidth(), wav.getnchannels()
        raw = wav.readframes(wav.getnframes())
    samples = np.frombuffer(raw, dtype=np.int16 if width == 2 else np.uint8).astype(np.float32)
    samples = samples / 32768.0 if width == 2 else (samples - 128) / 128.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def narration_track(persona: dict, timeline: list[dict], start_wall: int, audio_dir: Path) -> tuple[np.ndarray, int]:
    scenes = persona["scenes"]
    clips, rate = [], None
    for entry in timeline:
        scene = scenes[entry["index"]]
        samples, rate = load_wav(audio_dir / scene["audio"])
        clips.append(((entry["wall"] - start_wall) / 1000, samples))
    end = max(offset + len(samples) / rate for offset, samples in clips) + TAIL
    track = np.zeros(int(end * rate) + 1, dtype=np.float32)
    for offset, samples in clips:
        begin = int(offset * rate)
        track[begin:begin + len(samples)] += samples
    return np.clip(track, -1, 1), rate


def screen_frames(folder: Path, pid: str, frames: list[dict]):
    """(wall ms, decoded frame) for each screencast JPEG, in time order."""
    decoder = av.CodecContext.create("mjpeg", "r")
    with open(folder / "video" / f"{pid}.frames", "rb") as source:
        for entry in sorted(frames, key=lambda f: f["wall"]):
            source.seek(entry["offset"])
            for frame in decoder.decode(av.Packet(source.read(entry["size"]))):
                yield entry["wall"], frame


def mux(folder: Path, persona: dict) -> Path:
    pid = persona["id"]
    meta = json.loads((folder / "video" / f"{pid}.json").read_text())
    timeline = [entry for entry in meta["timeline"] if entry["pid"] == meta["timeline"][0]["pid"]]
    start_wall = timeline[0]["wall"] - int(LEAD_IN * 1000)
    audio, rate = narration_track(persona, timeline, start_wall, folder / "audio")
    duration = len(audio) / rate

    out_path = folder / "video" / f"omnifit-{pid}.mp4"
    output = av.open(str(out_path), "w")
    # Mostly still slides: quality-based rate control keeps files small
    video = output.add_stream("libx264", rate=FPS, options={"crf": "26", "preset": "medium", "tune": "stillimage"})
    video.width, video.height, video.pix_fmt = 1280, 720, "yuv420p"
    sound = output.add_stream("aac", rate=rate)
    sound.layout = "mono"

    # Video: constant 25 fps; the screencast only sends a frame when the
    # screen changes, so each frame is held until the next one
    written, total, last = 0, int(duration * FPS), None

    def emit(frame, until: int) -> None:
        nonlocal written
        out = frame.reformat(width=1280, height=720, format="yuv420p")
        # Decoded JPEGs are marked as keyframes; let the encoder choose instead
        out.pict_type = av.video.frame.PictureType.NONE
        while written < min(until, total):
            out.pts = written
            out.time_base = Fraction(1, FPS)
            for packet in video.encode(out):
                output.mux(packet)
            written += 1

    for wall, frame in screen_frames(folder, pid, meta["frames"]):
        index = int((wall - start_wall) / 1000 * FPS)
        if last is not None and index > written:
            emit(last, index)
        last = frame
        if written >= total:
            break
    if last is not None:
        emit(last, total)        # hold the last frame to the end of the voice
    for packet in video.encode():
        output.mux(packet)

    # Audio: the narration track, in 1024-sample AAC frames
    pts = 0
    for begin in range(0, len(audio), 1024):
        chunk = audio[begin:begin + 1024]
        frame = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="fltp", layout="mono")
        frame.sample_rate = rate
        frame.pts = pts
        frame.time_base = Fraction(1, rate)
        pts += len(chunk)
        for packet in sound.encode(frame):
            output.mux(packet)
    for packet in sound.encode():
        output.mux(packet)

    output.close()
    print(f"{out_path.name}: {duration:.0f} s, {out_path.stat().st_size / 1e6:.1f} MB")
    return out_path


def main(folder: Path, wanted: list[str]) -> None:
    story = json.loads((folder / "story.json").read_text(encoding="utf-8"))
    for persona in story["personas"]:
        if not wanted or persona["id"] in wanted:
            mux(folder, persona)


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2:])
