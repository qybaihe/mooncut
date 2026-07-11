from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import httpx

from .alignment import (
    AlignedText,
    CoreSlice,
    apply_glossary,
    align_transcript,
    build_alignment_stats,
    build_words,
    join_core_slices,
    slice_alignment_to_core,
)
from .audio import AudioChunk, create_chunks, normalize_audio, probe_duration
from .config import Settings
from .models import GlossaryCorrection, JobOptions, ProviderMetadata, SubtitleResult
from .providers import (
    DeepgramClient,
    DeepgramResult,
    FasterWhisperClient,
    MimoClient,
    ProviderError,
)
from .subtitles import segment_transcript


ProgressCallback = Callable[[float, str], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class _ChunkOutput:
    index: int
    core_slice: CoreSlice
    used_fallback: bool
    glossary_corrections: list[GlossaryCorrection]


def _align_with_timestamp_fallback(
    authoritative_text: str,
    timestamp_result: DeepgramResult,
    duration_ms: int,
    offset_ms: int,
    fallback_already_used: bool,
    strict_hybrid: bool,
) -> tuple[AlignedText, bool]:
    """Align MiMo text first and fall back to the timestamp provider safely.

    A transcript can be linguistically useful yet too divergent from the
    acoustic tokens to align.  In that narrow case the timestamp transcript is
    the only defensible fallback.  Keep this transition in one testable helper
    so a recovery-path typo cannot turn a recoverable job into a NameError.
    """
    try:
        return (
            align_transcript(
                authoritative_text=authoritative_text,
                timestamp_words=timestamp_result.words,
                duration_ms=duration_ms,
                offset_ms=offset_ms,
            ),
            fallback_already_used,
        )
    except ValueError:
        if fallback_already_used or strict_hybrid:
            raise
        return (
            align_transcript(
                authoritative_text=timestamp_result.transcript,
                timestamp_words=timestamp_result.words,
                duration_ms=duration_ms,
                offset_ms=offset_ms,
            ),
            True,
        )


class SubtitleProcessor:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def process(
        self,
        job_id: str,
        input_path: Path,
        work_dir: Path,
        options: JobOptions,
        progress: ProgressCallback,
    ) -> SubtitleResult:
        normalized_audio = work_dir / "normalized.wav"
        await progress(0.03, "extracting_audio")
        await normalize_audio(input_path, normalized_audio)
        duration = await probe_duration(normalized_audio)

        await progress(0.08, "splitting_audio")
        chunks = await create_chunks(
            normalized_audio=normalized_audio,
            chunks_dir=work_dir / "chunks",
            duration=duration,
            chunk_seconds=options.chunk_seconds,
            overlap_seconds=options.overlap_seconds,
        )
        await progress(0.12, f"transcribing_0_of_{len(chunks)}")

        timeout = httpx.Timeout(
            self.settings.provider_timeout_seconds,
            connect=min(20.0, self.settings.provider_timeout_seconds),
        )
        semaphore = asyncio.Semaphore(self.settings.chunk_concurrency)
        completed = 0
        progress_lock = asyncio.Lock()

        async with httpx.AsyncClient(timeout=timeout) as client:
            mimo = MimoClient(self.settings, client)
            timestamp_provider = (
                DeepgramClient(self.settings, client)
                if self.settings.resolved_timestamp_provider == "deepgram"
                else FasterWhisperClient(self.settings)
            )

            async def process_chunk(chunk: AudioChunk) -> _ChunkOutput:
                nonlocal completed
                async with semaphore:
                    mimo_task = mimo.transcribe(chunk.path, options.language)
                    timestamp_task = timestamp_provider.transcribe(
                        chunk.path,
                        options.language,
                        options.glossary,
                        chunk.duration,
                    )
                    mimo_result, timestamp_result = await asyncio.gather(
                        mimo_task,
                        timestamp_task,
                        return_exceptions=True,
                    )
                    if isinstance(timestamp_result, BaseException):
                        raise timestamp_result
                    used_fallback = isinstance(mimo_result, BaseException)
                    if used_fallback and options.strict_hybrid:
                        raise ProviderError("mimo", str(mimo_result))
                    authoritative_text = (
                        timestamp_result.transcript
                        if used_fallback
                        else str(mimo_result)
                    )
                    glossary_corrections: list[GlossaryCorrection] = []
                    if not used_fallback:
                        authoritative_text, glossary_corrections = apply_glossary(
                            authoritative_text,
                            timestamp_result.transcript,
                            options.glossary,
                        )
                        glossary_corrections = [
                            correction.model_copy(update={"chunk_index": chunk.index})
                            for correction in glossary_corrections
                        ]
                    aligned, used_fallback = _align_with_timestamp_fallback(
                        authoritative_text=authoritative_text,
                        timestamp_result=timestamp_result,
                        duration_ms=round(chunk.duration * 1000),
                        offset_ms=round(chunk.extract_start * 1000),
                        fallback_already_used=used_fallback,
                        strict_hybrid=options.strict_hybrid,
                    )
                    if used_fallback:
                        # Glossary corrections describe the authoritative MiMo
                        # text only; do not report them when its text was not
                        # ultimately used in the subtitle timeline.
                        glossary_corrections = []
                    core_slice = slice_alignment_to_core(
                        aligned,
                        core_start_ms=round(chunk.core_start * 1000),
                        core_end_ms=round(chunk.core_end * 1000),
                        include_end=chunk.index == len(chunks) - 1,
                    )
                async with progress_lock:
                    completed += 1
                    fraction = 0.12 + 0.72 * completed / len(chunks)
                    await progress(
                        fraction,
                        f"transcribing_{completed}_of_{len(chunks)}",
                    )
                return _ChunkOutput(
                    index=chunk.index,
                    core_slice=core_slice,
                    used_fallback=used_fallback,
                    glossary_corrections=glossary_corrections,
                )

            outputs = await asyncio.gather(*(process_chunk(chunk) for chunk in chunks))

        await progress(0.88, "aligning_timeline")
        outputs.sort(key=lambda item: item.index)
        transcript, characters = join_core_slices(
            [item.core_slice for item in outputs]
        )
        if not transcript or not characters:
            raise RuntimeError("no aligned speech remained after chunk merge")

        words = build_words(transcript, characters)
        stats = build_alignment_stats(characters)
        segments = segment_transcript(
            transcript=transcript,
            characters=characters,
            max_chars_per_line=options.max_chars_per_line,
            max_lines=options.max_lines,
        )
        duration_ms = round(duration * 1000)
        for segment in segments:
            segment.start_ms = min(segment.start_ms, duration_ms)
            segment.end_ms = min(max(segment.start_ms, segment.end_ms), duration_ms)

        await progress(0.94, "rendering_subtitles")
        return SubtitleResult(
            job_id=job_id,
            language=options.language,
            duration_ms=duration_ms,
            transcript=transcript,
            segments=segments,
            words=words,
            characters=characters,
            alignment=stats,
            providers=ProviderMetadata(
                text_provider=self.settings.mimo_model,
                timestamp_provider=timestamp_provider.provider_name,
                chunk_count=len(chunks),
                fallback_chunks=sum(item.used_fallback for item in outputs),
                glossary_corrections=[
                    correction
                    for item in outputs
                    for correction in item.glossary_corrections
                ],
            ),
        )
