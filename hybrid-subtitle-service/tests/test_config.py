from dataclasses import replace

from hybrid_subtitle.config import Settings


def test_local_timestamp_mode_needs_mimo_and_a_local_model(tmp_path) -> None:
    settings = replace(
        Settings.from_env(),
        mimo_api_key="mimo-test",
        deepgram_api_key="",
        timestamp_provider="faster-whisper",
        faster_whisper_model=str(tmp_path),
    )

    assert settings.resolved_timestamp_provider == "faster-whisper"
    assert settings.providers_ready is True


def test_auto_uses_deepgram_when_its_key_exists() -> None:
    settings = replace(
        Settings.from_env(),
        mimo_api_key="mimo-test",
        deepgram_api_key="deepgram-test",
        timestamp_provider="auto",
        faster_whisper_model="",
    )

    assert settings.resolved_timestamp_provider == "deepgram"
    assert settings.providers_ready is True
