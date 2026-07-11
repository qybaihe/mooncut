#!/usr/bin/env python3
"""Offline word-timestamp transcription fallback for deployed MoonCut jobs."""

from __future__ import annotations

import argparse
import json
import os

from faster_whisper import WhisperModel


def milliseconds(value: float | None) -> int:
    return max(0, round((value or 0.0) * 1000))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--duration-ms", type=int, required=True)
    args = parser.parse_args()

    threads = max(1, int(os.getenv("MOONCUT_WHISPER_THREADS", "4")))
    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        cpu_threads=threads,
        num_workers=1,
        download_root=os.getenv("MOONCUT_WHISPER_CACHE"),
    )
    language = None if args.language.lower() == "auto" else args.language
    segments_iter, _ = model.transcribe(
        args.input,
        language=language,
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
        condition_on_previous_text=False,
        initial_prompt="MoonCut, Remotion, Codex, OpenAI, MiniMax, MiMo, GLM",
    )

    segments = []
    words = []
    transcript_parts = []
    for index, segment in enumerate(segments_iter, start=1):
        text = segment.text.strip()
        if not text:
            continue
        transcript_parts.append(text)
        segments.append({
            "index": index,
            "text": text,
            "start_ms": milliseconds(segment.start),
            "end_ms": milliseconds(segment.end),
        })
        for word in segment.words or []:
            token = word.word.strip()
            if not token:
                continue
            words.append({
                "text": token,
                "start_ms": milliseconds(word.start),
                "end_ms": milliseconds(word.end),
                "confidence": word.probability,
            })

    print(json.dumps({
        "duration_ms": args.duration_ms,
        "transcript": "".join(transcript_parts),
        "segments": segments,
        "words": words,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
