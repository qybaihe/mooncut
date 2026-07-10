from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher

import jieba

from .models import (
    AlignmentStats,
    GlossaryCorrection,
    TimedCharacter,
    TimedWord,
    UncertainRange,
)
from .providers import ProviderWord


@dataclass(frozen=True, slots=True)
class _AuthorityAtom:
    text: str
    normalized: str
    original_index: int


@dataclass(frozen=True, slots=True)
class _TimestampAtom:
    normalized: str
    start_ms: float
    end_ms: float
    confidence: float


@dataclass(frozen=True, slots=True)
class AlignedText:
    transcript: str
    characters: list[TimedCharacter]
    words: list[TimedWord]
    stats: AlignmentStats


@dataclass(frozen=True, slots=True)
class CoreSlice:
    transcript: str
    characters: list[TimedCharacter]


@dataclass(frozen=True, slots=True)
class _GlossaryCandidate:
    term: str
    timestamp_start: int
    timestamp_end: int
    score: float


def _normalized_units(character: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", character).casefold()
    return [unit for unit in normalized if unit.isalnum()]


def _authority_atoms(text: str) -> list[_AuthorityAtom]:
    atoms: list[_AuthorityAtom] = []
    for index, character in enumerate(text):
        for unit in _normalized_units(character):
            atoms.append(
                _AuthorityAtom(
                    text=character,
                    normalized=unit,
                    original_index=index,
                )
            )
    return atoms


def _normalized_text(text: str) -> str:
    return "".join(
        unit for character in text for unit in _normalized_units(character)
    )


def _timestamp_atoms(
    words: list[ProviderWord],
    offset_ms: int,
) -> list[_TimestampAtom]:
    atoms: list[_TimestampAtom] = []
    for word in words:
        units = [
            unit
            for character in word.text
            for unit in _normalized_units(character)
        ]
        if not units:
            continue
        start_ms = word.start * 1000 + offset_ms
        end_ms = word.end * 1000 + offset_ms
        span = max(1.0, end_ms - start_ms)
        for index, unit in enumerate(units):
            atoms.append(
                _TimestampAtom(
                    normalized=unit,
                    start_ms=start_ms + span * index / len(units),
                    end_ms=start_ms + span * (index + 1) / len(units),
                    confidence=word.confidence,
                )
            )
    return atoms


def _character_class(value: str) -> str:
    codepoint = ord(value[0])
    if 0x3400 <= codepoint <= 0x9FFF:
        return "han"
    if value.isascii() and value.isalnum():
        return "ascii"
    return "other"


def _substitution_cost(left: str, right: str) -> float:
    if left == right:
        return 0.0
    if _character_class(left) == _character_class(right):
        return 0.82
    return 1.15


def _align_atoms(
    authority: list[_AuthorityAtom],
    timestamps: list[_TimestampAtom],
) -> list[tuple[int | None, bool]]:
    """Return timestamp atom index and exact-match flag for every authority atom."""
    rows = len(authority)
    columns = len(timestamps)
    previous = [column * 0.85 for column in range(columns + 1)]
    trace = [bytearray(columns + 1) for _ in range(rows + 1)]
    for column in range(1, columns + 1):
        trace[0][column] = 2
    for row in range(1, rows + 1):
        trace[row][0] = 1
        current = [float(row)] + [0.0] * columns
        for column in range(1, columns + 1):
            diagonal = previous[column - 1] + _substitution_cost(
                authority[row - 1].normalized,
                timestamps[column - 1].normalized,
            )
            up = previous[column] + 1.0
            left = current[column - 1] + 0.85
            best = min(diagonal, up, left)
            current[column] = best
            trace[row][column] = 0 if best == diagonal else (1 if best == up else 2)
        previous = current

    mapping: list[tuple[int | None, bool]] = [(None, False)] * rows
    row, column = rows, columns
    while row > 0 or column > 0:
        operation = trace[row][column]
        if row > 0 and column > 0 and operation == 0:
            exact = authority[row - 1].normalized == timestamps[column - 1].normalized
            mapping[row - 1] = (column - 1, exact)
            row -= 1
            column -= 1
        elif row > 0 and (column == 0 or operation == 1):
            row -= 1
        else:
            column -= 1
    return mapping


def _best_glossary_window(
    term: str,
    timestamp_atoms: list[_AuthorityAtom],
) -> _GlossaryCandidate | None:
    target = list(_normalized_text(term))
    source = [atom.normalized for atom in timestamp_atoms]
    if not target or not source:
        return None
    minimum_length = max(1, len(target) - 2)
    maximum_length = min(len(source), len(target) + 2)
    best: _GlossaryCandidate | None = None
    for width in range(minimum_length, maximum_length + 1):
        for start in range(0, len(source) - width + 1):
            score = SequenceMatcher(
                None,
                target,
                source[start : start + width],
                autojunk=False,
            ).ratio()
            if best is None or score > best.score:
                best = _GlossaryCandidate(
                    term=term,
                    timestamp_start=start,
                    timestamp_end=start + width,
                    score=score,
                )
    threshold = 1.0 if len(target) <= 2 else (0.82 if len(target) <= 4 else 0.72)
    return best if best and best.score >= threshold else None


def apply_glossary(
    authoritative_text: str,
    timestamp_text: str,
    glossary: list[str],
) -> tuple[str, list[GlossaryCorrection]]:
    if not glossary:
        return authoritative_text, []
    authority = _authority_atoms(authoritative_text)
    timestamp_authority = _authority_atoms(timestamp_text)
    if not authority or not timestamp_authority:
        return authoritative_text, []
    timestamp_atoms = [
        _TimestampAtom(
            normalized=atom.normalized,
            start_ms=0,
            end_ms=0,
            confidence=1,
        )
        for atom in timestamp_authority
    ]
    mapping = _align_atoms(authority, timestamp_atoms)
    candidates = [
        candidate
        for term in glossary
        if (candidate := _best_glossary_window(term, timestamp_authority)) is not None
    ]
    candidates.sort(key=lambda item: (item.score, len(_normalized_text(item.term))), reverse=True)

    replacements: list[tuple[int, int, GlossaryCorrection]] = []
    occupied_timestamp_ranges: list[tuple[int, int]] = []
    occupied_authority_ranges: list[tuple[int, int]] = []
    for candidate in candidates:
        if any(
            candidate.timestamp_start < end and candidate.timestamp_end > start
            for start, end in occupied_timestamp_ranges
        ):
            continue
        authority_atom_indexes = [
            index
            for index, (timestamp_index, _) in enumerate(mapping)
            if timestamp_index is not None
            and candidate.timestamp_start <= timestamp_index < candidate.timestamp_end
        ]
        if not authority_atom_indexes:
            continue
        start = min(authority[index].original_index for index in authority_atom_indexes)
        end = max(authority[index].original_index for index in authority_atom_indexes) + 1
        if candidate.term.isascii():
            allowed = set("_+-.#")
            while start > 0 and (
                authoritative_text[start - 1].isascii()
                and (authoritative_text[start - 1].isalnum() or authoritative_text[start - 1] in allowed)
            ):
                start -= 1
            while end < len(authoritative_text) and (
                authoritative_text[end].isascii()
                and (authoritative_text[end].isalnum() or authoritative_text[end] in allowed)
            ):
                end += 1
        if any(start < used_end and end > used_start for used_start, used_end in occupied_authority_ranges):
            continue
        replaced_text = authoritative_text[start:end]
        if _normalized_text(replaced_text) == _normalized_text(candidate.term):
            occupied_timestamp_ranges.append(
                (candidate.timestamp_start, candidate.timestamp_end)
            )
            continue
        timestamp_original_start = timestamp_authority[candidate.timestamp_start].original_index
        timestamp_original_end = timestamp_authority[candidate.timestamp_end - 1].original_index + 1
        correction = GlossaryCorrection(
            term=candidate.term,
            replaced_text=replaced_text,
            timestamp_match=timestamp_text[timestamp_original_start:timestamp_original_end],
            match_confidence=candidate.score,
        )
        replacements.append((start, end, correction))
        occupied_timestamp_ranges.append((candidate.timestamp_start, candidate.timestamp_end))
        occupied_authority_ranges.append((start, end))

    corrected = authoritative_text
    for start, end, correction in sorted(replacements, key=lambda item: item[0], reverse=True):
        corrected = corrected[:start] + correction.term + corrected[end:]
    return corrected, [item[2] for item in sorted(replacements, key=lambda item: item[0])]


def _fill_unmapped(
    entries: list[dict[str, float | str | None]],
    duration_ms: int,
    offset_ms: int,
) -> None:
    index = 0
    while index < len(entries):
        if entries[index]["start_ms"] is not None:
            index += 1
            continue
        run_start = index
        while index < len(entries) and entries[index]["start_ms"] is None:
            index += 1
        run_end = index
        count = run_end - run_start
        previous = entries[run_start - 1] if run_start > 0 else None
        following = entries[run_end] if run_end < len(entries) else None
        lower = (
            float(previous["end_ms"])
            if previous and previous["end_ms"] is not None
            else float(offset_ms)
        )
        upper = (
            float(following["start_ms"])
            if following and following["start_ms"] is not None
            else float(offset_ms + duration_ms)
        )
        if upper <= lower:
            anchor = lower
            lower = max(float(offset_ms), anchor - 40.0 * count)
            upper = min(float(offset_ms + duration_ms), anchor + 40.0 * count)
        if upper <= lower:
            upper = lower + max(1.0, 20.0 * count)
        width = (upper - lower) / count
        for position in range(count):
            entry = entries[run_start + position]
            entry["start_ms"] = lower + width * position
            entry["end_ms"] = lower + width * (position + 1)
            entry["confidence"] = 0.35
            entry["source"] = "interpolated"


def _collapse_original_characters(
    text: str,
    authority: list[_AuthorityAtom],
    entries: list[dict[str, float | str | None]],
) -> list[TimedCharacter]:
    grouped: dict[int, list[dict[str, float | str | None]]] = {}
    for atom, entry in zip(authority, entries, strict=True):
        grouped.setdefault(atom.original_index, []).append(entry)

    result: list[TimedCharacter] = []
    for original_index in sorted(grouped):
        group = grouped[original_index]
        sources = {str(entry["source"]) for entry in group}
        source = (
            "interpolated"
            if "interpolated" in sources
            else ("substitution" if "substitution" in sources else "deepgram")
        )
        result.append(
            TimedCharacter(
                text=text[original_index],
                original_index=original_index,
                start_ms=max(0, round(min(float(entry["start_ms"]) for entry in group))),
                end_ms=max(0, round(max(float(entry["end_ms"]) for entry in group))),
                confidence=sum(float(entry["confidence"]) for entry in group) / len(group),
                source=source,
            )
        )
    return result


def build_words(text: str, characters: list[TimedCharacter]) -> list[TimedWord]:
    by_original_index = {character.original_index: character for character in characters}
    character_position = {
        character.original_index: position for position, character in enumerate(characters)
    }
    result: list[TimedWord] = []
    for token, start, end in jieba.tokenize(text, mode="default"):
        if not any(character.isalnum() for character in token):
            continue
        timed = [
            by_original_index[index]
            for index in range(start, end)
            if index in by_original_index
        ]
        if not timed:
            continue
        positions = [character_position[item.original_index] for item in timed]
        result.append(
            TimedWord(
                text=token,
                start_ms=min(item.start_ms for item in timed),
                end_ms=max(item.end_ms for item in timed),
                confidence=sum(item.confidence for item in timed) / len(timed),
                character_start=min(positions),
                character_end=max(positions) + 1,
            )
        )
    return result


def build_alignment_stats(characters: list[TimedCharacter]) -> AlignmentStats:
    if not characters:
        return AlignmentStats(
            exact_ratio=0,
            mapped_ratio=0,
            average_confidence=0,
            uncertain_ranges=[],
        )
    exact = sum(character.source == "deepgram" for character in characters)
    mapped = sum(character.source != "interpolated" for character in characters)
    uncertain: list[UncertainRange] = []
    active: list[TimedCharacter] = []

    def flush() -> None:
        if not active:
            return
        uncertain.append(
            UncertainRange(
                text="".join(item.text for item in active),
                start_ms=active[0].start_ms,
                end_ms=active[-1].end_ms,
                reason=(
                    "timestamp_interpolated"
                    if any(item.source == "interpolated" for item in active)
                    else "low_alignment_confidence"
                ),
            )
        )
        active.clear()

    for character in characters:
        is_uncertain = character.source == "interpolated" or character.confidence < 0.55
        if is_uncertain:
            if active and character.original_index > active[-1].original_index + 1:
                flush()
            active.append(character)
        else:
            flush()
    flush()
    return AlignmentStats(
        exact_ratio=exact / len(characters),
        mapped_ratio=mapped / len(characters),
        average_confidence=sum(item.confidence for item in characters) / len(characters),
        uncertain_ranges=uncertain,
    )


def align_transcript(
    authoritative_text: str,
    timestamp_words: list[ProviderWord],
    duration_ms: int,
    offset_ms: int = 0,
) -> AlignedText:
    authority = _authority_atoms(authoritative_text)
    timestamps = _timestamp_atoms(timestamp_words, offset_ms)
    if not authority:
        raise ValueError("authoritative transcript has no alignable characters")
    if not timestamps:
        raise ValueError("timestamp transcript has no alignable characters")

    mapping = _align_atoms(authority, timestamps)
    entries: list[dict[str, float | str | None]] = []
    for timestamp_index, exact in mapping:
        if timestamp_index is None:
            entries.append(
                {
                    "start_ms": None,
                    "end_ms": None,
                    "confidence": 0.0,
                    "source": None,
                }
            )
            continue
        timestamp = timestamps[timestamp_index]
        entries.append(
            {
                "start_ms": timestamp.start_ms,
                "end_ms": timestamp.end_ms,
                "confidence": timestamp.confidence if exact else timestamp.confidence * 0.62,
                "source": "deepgram" if exact else "substitution",
            }
        )
    _fill_unmapped(entries, duration_ms, offset_ms)
    characters = _collapse_original_characters(authoritative_text, authority, entries)
    return AlignedText(
        transcript=authoritative_text,
        characters=characters,
        words=build_words(authoritative_text, characters),
        stats=build_alignment_stats(characters),
    )


def slice_alignment_to_core(
    aligned: AlignedText,
    core_start_ms: int,
    core_end_ms: int,
    include_end: bool,
) -> CoreSlice:
    def inside(character: TimedCharacter) -> bool:
        midpoint = (character.start_ms + character.end_ms) / 2
        return (
            core_start_ms <= midpoint <= core_end_ms
            if include_end
            else core_start_ms <= midpoint < core_end_ms
        )

    kept = [character for character in aligned.characters if inside(character)]
    if not kept:
        return CoreSlice(transcript="", characters=[])
    start = min(character.original_index for character in kept)
    end = max(character.original_index for character in kept) + 1
    while end < len(aligned.transcript) and not aligned.transcript[end].isalnum():
        end += 1
    transcript = aligned.transcript[start:end].strip()
    left_trim = len(aligned.transcript[start:end]) - len(aligned.transcript[start:end].lstrip())
    actual_start = start + left_trim
    rebased: list[TimedCharacter] = []
    for character in kept:
        if actual_start <= character.original_index < end:
            rebased.append(
                character.model_copy(
                    update={"original_index": character.original_index - actual_start}
                )
            )
    return CoreSlice(transcript=transcript, characters=rebased)


def join_core_slices(slices: list[CoreSlice]) -> tuple[str, list[TimedCharacter]]:
    transcript = ""
    characters: list[TimedCharacter] = []
    for item in slices:
        if not item.transcript:
            continue
        separator = ""
        if transcript and transcript[-1].isascii() and transcript[-1].isalnum():
            first = item.transcript[0]
            if first.isascii() and first.isalnum():
                separator = " "
        offset = len(transcript) + len(separator)
        transcript += separator + item.transcript
        characters.extend(
            character.model_copy(
                update={"original_index": character.original_index + offset}
            )
            for character in item.characters
        )
    return transcript, characters
