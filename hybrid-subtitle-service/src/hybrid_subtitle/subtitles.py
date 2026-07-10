from __future__ import annotations

from .models import SubtitleSegment, TimedCharacter


STRONG_PUNCTUATION = set("。！？!?；;")
WEAK_PUNCTUATION = set("，,、：:")


def _display_count(text: str) -> int:
    return sum(not character.isspace() for character in text)


def _timing_for_range(
    characters: list[TimedCharacter],
    start: int,
    end: int,
) -> tuple[int, int] | None:
    timed = [
        character
        for character in characters
        if start <= character.original_index < end
    ]
    if not timed:
        return None
    return min(item.start_ms for item in timed), max(item.end_ms for item in timed)


def _line_wrap(text: str, max_chars_per_line: int, max_lines: int) -> str:
    if _display_count(text) <= max_chars_per_line:
        return text.strip()
    lines: list[str] = []
    remaining = text.strip()
    while remaining and len(lines) < max_lines:
        if _display_count(remaining) <= max_chars_per_line:
            lines.append(remaining)
            remaining = ""
            break
        count = 0
        split_at = 0
        preferred = 0
        for index, character in enumerate(remaining):
            if not character.isspace():
                count += 1
            if character in WEAK_PUNCTUATION or character.isspace():
                preferred = index + 1
            if count >= max_chars_per_line:
                split_at = preferred or index + 1
                break
        if split_at <= 0:
            split_at = len(remaining)
        lines.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].strip()
    if remaining:
        lines[-1] += remaining
    return "\n".join(lines)


def segment_transcript(
    transcript: str,
    characters: list[TimedCharacter],
    max_chars_per_line: int,
    max_lines: int,
    max_duration_ms: int = 6000,
) -> list[SubtitleSegment]:
    if not transcript or not characters:
        return []
    max_chars = max_chars_per_line * max_lines
    ranges: list[tuple[int, int]] = []
    start = 0
    index = 0
    last_weak: int | None = None
    first_time: int | None = None

    while index < len(transcript):
        character = transcript[index]
        if character in WEAK_PUNCTUATION:
            last_weak = index + 1
        timing = _timing_for_range(characters, index, index + 1)
        if timing and first_time is None:
            first_time = timing[0]
        current_duration = timing[1] - first_time if timing and first_time is not None else 0
        current_text = transcript[start : index + 1]
        hard_limit = _display_count(current_text) >= max_chars or current_duration >= max_duration_ms
        strong_break = character in STRONG_PUNCTUATION
        if hard_limit or strong_break:
            end = index + 1
            if hard_limit and not strong_break and last_weak and last_weak > start:
                end = last_weak
            ranges.append((start, end))
            start = end
            index = end
            last_weak = None
            first_time = None
            continue
        index += 1
    if start < len(transcript):
        ranges.append((start, len(transcript)))

    segments: list[SubtitleSegment] = []
    for range_start, range_end in ranges:
        raw_text = transcript[range_start:range_end].strip()
        if not raw_text:
            continue
        timing = _timing_for_range(characters, range_start, range_end)
        if not timing:
            continue
        start_ms, end_ms = timing
        end_ms = max(end_ms, start_ms + 400)
        segments.append(
            SubtitleSegment(
                index=len(segments) + 1,
                text=_line_wrap(raw_text, max_chars_per_line, max_lines),
                start_ms=start_ms,
                end_ms=end_ms,
            )
        )
    for current, following in zip(segments, segments[1:]):
        if current.end_ms > following.start_ms:
            current.end_ms = max(current.start_ms + 100, following.start_ms)
    return segments


def _format_srt_time(milliseconds: int) -> str:
    hours, remainder = divmod(max(0, milliseconds), 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def _format_vtt_time(milliseconds: int) -> str:
    return _format_srt_time(milliseconds).replace(",", ".")


def render_srt(segments: list[SubtitleSegment]) -> str:
    blocks = []
    for segment in segments:
        blocks.append(
            f"{segment.index}\n"
            f"{_format_srt_time(segment.start_ms)} --> {_format_srt_time(segment.end_ms)}\n"
            f"{segment.text}"
        )
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def render_vtt(segments: list[SubtitleSegment]) -> str:
    blocks = ["WEBVTT"]
    for segment in segments:
        blocks.append(
            f"{_format_vtt_time(segment.start_ms)} --> {_format_vtt_time(segment.end_ms)}\n"
            f"{segment.text}"
        )
    return "\n\n".join(blocks) + "\n"
