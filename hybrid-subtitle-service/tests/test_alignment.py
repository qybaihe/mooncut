from hybrid_subtitle.alignment import (
    align_transcript,
    apply_glossary,
    build_alignment_stats,
)
from hybrid_subtitle.providers import ProviderWord
from hybrid_subtitle.providers import DeepgramResult
from hybrid_subtitle import processor


def test_mimo_spelling_is_kept_with_deepgram_timing() -> None:
    words = [
        ProviderWord("讲到", 0.0, 0.4, 0.98),
        ProviderWord("codeck", 0.4, 1.0, 0.90),
        ProviderWord("的时候", 1.0, 1.6, 0.96),
    ]
    aligned = align_transcript("讲到 Codec 的时候", words, duration_ms=1600)

    assert aligned.transcript == "讲到 Codec 的时候"
    codec = [item for item in aligned.characters if item.text.lower() in set("codec")]
    assert codec[0].start_ms >= 400
    assert codec[-1].end_ms <= 1000
    assert all(left.start_ms <= right.start_ms for left, right in zip(codec, codec[1:]))
    assert aligned.stats.mapped_ratio > 0.9


def test_missing_authority_character_is_interpolated() -> None:
    words = [
        ProviderWord("你好", 0.0, 0.5, 0.95),
        ProviderWord("世界", 0.8, 1.3, 0.95),
    ]
    aligned = align_transcript("你好啊世界", words, duration_ms=1300)
    inserted = next(item for item in aligned.characters if item.text == "啊")

    assert inserted.source == "interpolated"
    assert 500 <= inserted.start_ms <= inserted.end_ms <= 800
    stats = build_alignment_stats(aligned.characters)
    assert stats.uncertain_ranges[0].text == "啊"


def test_glossary_uses_timestamp_transcript_to_correct_mimo_text() -> None:
    corrected, corrections = apply_glossary(
        "讲到 product 的时候，需要自动淡出页面。",
        "讲到codeck的时候需要自动弹出页面。",
        ["Codec", "Codex", "弹出页面"],
    )

    assert corrected == "讲到 Codec 的时候，需要自动弹出页面。"
    assert [item.term for item in corrections] == ["Codec", "弹出页面"]


def test_alignment_falls_back_to_timestamp_transcript_after_mimo_text_mismatch(
    monkeypatch,
) -> None:
    timestamp_result = DeepgramResult(
        transcript="备用字幕",
        words=[
            ProviderWord("备用", 0.0, 0.4, 0.99),
            ProviderWord("字幕", 0.4, 0.8, 0.99),
        ],
        request_id=None,
        detected_language="zh-CN",
    )
    original_align = processor.align_transcript
    attempted_texts: list[str] = []

    def fail_once(*, authoritative_text: str, **kwargs):
        attempted_texts.append(authoritative_text)
        if len(attempted_texts) == 1:
            raise ValueError("MiMo wording is not alignable")
        return original_align(authoritative_text=authoritative_text, **kwargs)

    monkeypatch.setattr(processor, "align_transcript", fail_once)
    aligned, used_fallback = processor._align_with_timestamp_fallback(
        authoritative_text="完全不匹配的文本",
        timestamp_result=timestamp_result,
        duration_ms=800,
        offset_ms=0,
        fallback_already_used=False,
        strict_hybrid=False,
    )

    assert used_fallback is True
    assert attempted_texts == ["完全不匹配的文本", "备用字幕"]
    assert aligned.transcript == "备用字幕"
