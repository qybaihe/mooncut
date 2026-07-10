from hybrid_subtitle.models import TimedCharacter
from hybrid_subtitle.subtitles import render_srt, render_vtt, segment_transcript


def _characters(text: str) -> list[TimedCharacter]:
    result = []
    timed_index = 0
    for original_index, character in enumerate(text):
        if not character.isalnum():
            continue
        result.append(
            TimedCharacter(
                text=character,
                original_index=original_index,
                start_ms=timed_index * 200,
                end_ms=(timed_index + 1) * 200,
                confidence=0.9,
                source="deepgram",
            )
        )
        timed_index += 1
    return result


def test_segments_break_on_sentence_punctuation() -> None:
    text = "你好，这是第一句。接下来是第二句！"
    segments = segment_transcript(text, _characters(text), 10, 2)

    assert [item.text for item in segments] == ["你好，这是第一句。", "接下来是第二句！"]
    assert segments[0].end_ms <= segments[1].start_ms


def test_srt_and_vtt_render_expected_timestamps() -> None:
    text = "测试字幕。"
    segments = segment_transcript(text, _characters(text), 16, 2)

    assert "00:00:00,000 --> 00:00:00,800" in render_srt(segments)
    assert render_vtt(segments).startswith("WEBVTT\n\n00:00:00.000")


def test_wrapping_does_not_duplicate_the_last_line() -> None:
    text = "讲到 product 的时候，需要自动淡出页面。"
    segments = segment_transcript(text, _characters(text), 16, 2)

    assert segments[0].text.count("需要自动淡出页面") == 1
