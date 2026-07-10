from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .config import Settings


class ProviderError(RuntimeError):
    def __init__(self, provider: str, message: str, status_code: int | None = None):
        super().__init__(f"{provider}: {message}")
        self.provider = provider
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class ProviderWord:
    text: str
    start: float
    end: float
    confidence: float


@dataclass(frozen=True, slots=True)
class DeepgramResult:
    transcript: str
    words: list[ProviderWord]
    request_id: str | None
    detected_language: str | None


async def _post_with_retry(
    client: httpx.AsyncClient,
    provider: str,
    url: str,
    retries: int,
    **kwargs: Any,
) -> httpx.Response:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            response = await client.post(url, **kwargs)
            if response.status_code < 400:
                return response
            message = response.text[:800]
            if response.status_code not in {408, 409, 425, 429} and response.status_code < 500:
                raise ProviderError(provider, message, response.status_code)
            last_error = ProviderError(provider, message, response.status_code)
        except ProviderError:
            raise
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
        if attempt < retries:
            await asyncio.sleep(min(8.0, 0.7 * (2**attempt)))
    raise ProviderError(provider, f"request failed after retries: {last_error}")


class MimoClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client

    async def transcribe(self, audio_path: Path, language: str) -> str:
        if not self.settings.mimo_api_key:
            raise ProviderError("mimo", "MIMO_API_KEY is not configured")
        audio = await asyncio.to_thread(audio_path.read_bytes)
        encoded = base64.b64encode(audio).decode("ascii")
        mimo_language = {
            "zh-CN": "zh",
            "zh": "zh",
            "en-US": "en",
            "en": "en",
        }.get(language, "auto")
        payload = {
            "model": self.settings.mimo_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {"data": encoded, "format": "wav"},
                        }
                    ],
                }
            ],
            "asr_options": {"language": mimo_language},
            "stream": False,
        }
        response = await _post_with_retry(
            self.client,
            "mimo",
            self.settings.mimo_base_url,
            self.settings.provider_max_retries,
            headers={
                "Authorization": f"Bearer {self.settings.mimo_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        try:
            text = response.json()["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ProviderError("mimo", "response did not contain transcript text") from exc
        if not text:
            raise ProviderError("mimo", "empty transcript")
        return text


class DeepgramClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client

    async def transcribe(
        self,
        audio_path: Path,
        language: str,
        glossary: list[str],
        duration: float,
    ) -> DeepgramResult:
        if not self.settings.deepgram_api_key:
            raise ProviderError("deepgram", "DEEPGRAM_API_KEY is not configured")
        audio = await asyncio.to_thread(audio_path.read_bytes)
        params: list[tuple[str, str]] = [
            ("model", self.settings.deepgram_model),
            ("smart_format", "true"),
            ("punctuate", "true"),
            ("utterances", "true"),
        ]
        deepgram_language = {
            "zh": "zh-CN",
            "zh-CN": "zh-CN",
            "en": "en-US",
            "en-US": "en-US",
        }.get(language)
        if deepgram_language:
            params.append(("language", deepgram_language))
        else:
            params.append(("detect_language", "true"))
        if self.settings.deepgram_mip_opt_out:
            params.append(("mip_opt_out", "true"))
        if self.settings.deepgram_model.startswith("nova-3"):
            params.extend(("keyterm", term) for term in glossary)

        response = await _post_with_retry(
            self.client,
            "deepgram",
            self.settings.deepgram_base_url,
            self.settings.provider_max_retries,
            headers={
                "Authorization": f"Token {self.settings.deepgram_api_key}",
                "Content-Type": "audio/wav",
            },
            params=params,
            content=audio,
        )
        try:
            body = response.json()
            alternative = body["results"]["channels"][0]["alternatives"][0]
            transcript = alternative.get("transcript", "").strip()
            raw_words = alternative.get("words", [])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ProviderError("deepgram", "response did not contain an alternative") from exc

        words: list[ProviderWord] = []
        for raw in raw_words:
            text = str(raw.get("word", "")).strip()
            if not text or not any(char.isalnum() for char in text):
                continue
            start = max(0.0, min(float(raw.get("start", 0)), duration))
            end = max(start, min(float(raw.get("end", start)), duration))
            words.append(
                ProviderWord(
                    text=text,
                    start=start,
                    end=end,
                    confidence=max(0.0, min(float(raw.get("confidence", 0)), 1.0)),
                )
            )
        if not transcript or not words:
            raise ProviderError("deepgram", "empty transcript or timestamp list")
        metadata = body.get("metadata", {})
        channel = body["results"]["channels"][0]
        return DeepgramResult(
            transcript=transcript,
            words=words,
            request_id=metadata.get("request_id"),
            detected_language=channel.get("detected_language"),
        )

