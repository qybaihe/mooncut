from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JobState(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class JobOptions(BaseModel):
    language: Literal["auto", "zh", "zh-CN", "en", "en-US"] = "zh-CN"
    glossary: list[str] = Field(default_factory=list, max_length=100)
    formats: list[Literal["json", "srt", "vtt"]] = Field(
        default_factory=lambda: ["json", "srt", "vtt"]
    )
    chunk_seconds: float = Field(default=45, ge=10, le=180)
    overlap_seconds: float = Field(default=0.8, ge=0, le=5)
    max_chars_per_line: int = Field(default=16, ge=6, le=40)
    max_lines: int = Field(default=2, ge=1, le=3)
    strict_hybrid: bool = False

    @field_validator("glossary")
    @classmethod
    def clean_glossary(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for value in values:
            term = value.strip()
            key = term.casefold()
            if term and key not in seen:
                cleaned.append(term[:100])
                seen.add(key)
        return cleaned

    @field_validator("formats")
    @classmethod
    def unique_formats(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(values or ["json"]))


class TimedCharacter(BaseModel):
    text: str
    original_index: int
    start_ms: int
    end_ms: int
    confidence: float = Field(ge=0, le=1)
    source: Literal["deepgram", "substitution", "interpolated"]


class TimedWord(BaseModel):
    text: str
    start_ms: int
    end_ms: int
    confidence: float = Field(ge=0, le=1)
    character_start: int
    character_end: int


class SubtitleSegment(BaseModel):
    index: int
    text: str
    start_ms: int
    end_ms: int


class UncertainRange(BaseModel):
    text: str
    start_ms: int
    end_ms: int
    reason: str


class AlignmentStats(BaseModel):
    exact_ratio: float = Field(ge=0, le=1)
    mapped_ratio: float = Field(ge=0, le=1)
    average_confidence: float = Field(ge=0, le=1)
    uncertain_ranges: list[UncertainRange] = Field(default_factory=list)


class GlossaryCorrection(BaseModel):
    term: str
    replaced_text: str
    timestamp_match: str
    match_confidence: float = Field(ge=0, le=1)
    chunk_index: int | None = None


class ProviderMetadata(BaseModel):
    text_provider: str = "mimo-v2.5-asr"
    timestamp_provider: str = "deepgram-nova-3"
    chunk_count: int
    fallback_chunks: int = 0
    glossary_corrections: list[GlossaryCorrection] = Field(default_factory=list)


class SubtitleResult(BaseModel):
    job_id: str
    language: str
    duration_ms: int
    transcript: str
    segments: list[SubtitleSegment]
    words: list[TimedWord]
    characters: list[TimedCharacter]
    alignment: AlignmentStats
    providers: ProviderMetadata


class JobRecord(BaseModel):
    id: str
    status: JobState
    progress: float = Field(default=0, ge=0, le=1)
    stage: str = "queued"
    original_filename: str
    content_type: str | None = None
    input_bytes: int = 0
    options: JobOptions
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    error: str | None = None
    artifacts: dict[str, str] = Field(default_factory=dict)


class JobResponse(BaseModel):
    id: str
    status: JobState
    progress: float
    stage: str
    original_filename: str
    created_at: datetime
    updated_at: datetime
    error: str | None = None
    status_url: str
    result_url: str | None = None
    downloads: dict[str, str] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: str
    providers_configured: bool
    service_auth_enabled: bool
    version: str
