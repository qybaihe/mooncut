from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path


class AudioProcessingError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class AudioChunk:
    index: int
    path: Path
    core_start: float
    core_end: float
    extract_start: float
    extract_end: float

    @property
    def duration(self) -> float:
        return self.extract_end - self.extract_start


async def _run(*args: str) -> tuple[str, str]:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    out = stdout.decode("utf-8", errors="replace")
    err = stderr.decode("utf-8", errors="replace")
    if process.returncode != 0:
        command = Path(args[0]).name
        raise AudioProcessingError(f"{command} failed: {err[-1200:]}")
    return out, err


async def normalize_audio(input_path: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    await _run(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(output_path),
    )


async def probe_duration(path: Path) -> float:
    stdout, _ = await _run(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    )
    try:
        duration = float(stdout.strip())
    except ValueError as exc:
        raise AudioProcessingError("ffprobe returned an invalid duration") from exc
    if duration <= 0:
        raise AudioProcessingError("input has no usable audio duration")
    return duration


async def detect_silence_midpoints(
    path: Path,
    noise_db: float = -35,
    minimum_silence: float = 0.35,
) -> list[float]:
    _, stderr = await _run(
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-i",
        str(path),
        "-af",
        f"silencedetect=noise={noise_db}dB:d={minimum_silence}",
        "-f",
        "null",
        "-",
    )
    start_pattern = re.compile(r"silence_start:\s*([0-9.]+)")
    end_pattern = re.compile(r"silence_end:\s*([0-9.]+)")
    active_start: float | None = None
    midpoints: list[float] = []
    for line in stderr.splitlines():
        start_match = start_pattern.search(line)
        if start_match:
            active_start = float(start_match.group(1))
            continue
        end_match = end_pattern.search(line)
        if end_match and active_start is not None:
            end = float(end_match.group(1))
            midpoints.append((active_start + end) / 2)
            active_start = None
    return midpoints


def plan_chunk_boundaries(
    duration: float,
    silence_midpoints: list[float],
    chunk_seconds: float,
) -> list[tuple[float, float]]:
    if duration <= chunk_seconds:
        return [(0.0, duration)]

    minimum_chunk = max(5.0, min(15.0, chunk_seconds * 0.35))
    boundaries = [0.0]
    current = 0.0
    while duration - current > chunk_seconds:
        lower = current + minimum_chunk
        upper = min(duration, current + chunk_seconds)
        candidates = [point for point in silence_midpoints if lower <= point <= upper]
        boundary = max(candidates) if candidates else upper
        if boundary <= current + 0.1:
            boundary = upper
        boundaries.append(boundary)
        current = boundary
    boundaries.append(duration)
    return list(zip(boundaries, boundaries[1:]))


async def create_chunks(
    normalized_audio: Path,
    chunks_dir: Path,
    duration: float,
    chunk_seconds: float,
    overlap_seconds: float,
) -> list[AudioChunk]:
    chunks_dir.mkdir(parents=True, exist_ok=True)
    silence_points = await detect_silence_midpoints(normalized_audio)
    core_ranges = plan_chunk_boundaries(duration, silence_points, chunk_seconds)
    chunks: list[AudioChunk] = []

    for index, (core_start, core_end) in enumerate(core_ranges):
        extract_start = max(0.0, core_start - overlap_seconds)
        extract_end = min(duration, core_end + overlap_seconds)
        output_path = chunks_dir / f"chunk-{index:04d}.wav"
        await _run(
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{extract_start:.3f}",
            "-t",
            f"{extract_end - extract_start:.3f}",
            "-i",
            str(normalized_audio),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        )
        chunks.append(
            AudioChunk(
                index=index,
                path=output_path,
                core_start=core_start,
                core_end=core_end,
                extract_start=extract_start,
                extract_end=extract_end,
            )
        )
    return chunks
