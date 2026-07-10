from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    mimo_api_key: str
    deepgram_api_key: str
    service_api_key: str
    max_upload_mb: int
    chunk_seconds: float
    chunk_overlap_seconds: float
    provider_timeout_seconds: float
    provider_max_retries: int
    chunk_concurrency: int
    job_concurrency: int
    mimo_base_url: str
    mimo_model: str
    deepgram_base_url: str
    deepgram_model: str
    deepgram_mip_opt_out: bool
    cors_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        origins = tuple(
            origin.strip()
            for origin in os.getenv("CORS_ORIGINS", "").split(",")
            if origin.strip()
        )
        return cls(
            data_dir=Path(os.getenv("DATA_DIR", "./data")).expanduser().resolve(),
            mimo_api_key=os.getenv("MIMO_API_KEY", "").strip(),
            deepgram_api_key=os.getenv("DEEPGRAM_API_KEY", "").strip(),
            service_api_key=os.getenv("SERVICE_API_KEY", "").strip(),
            max_upload_mb=int(os.getenv("MAX_UPLOAD_MB", "1024")),
            chunk_seconds=float(os.getenv("CHUNK_SECONDS", "45")),
            chunk_overlap_seconds=float(os.getenv("CHUNK_OVERLAP_SECONDS", "0.8")),
            provider_timeout_seconds=float(
                os.getenv("PROVIDER_TIMEOUT_SECONDS", "120")
            ),
            provider_max_retries=int(os.getenv("PROVIDER_MAX_RETRIES", "3")),
            chunk_concurrency=max(1, int(os.getenv("CHUNK_CONCURRENCY", "2"))),
            job_concurrency=max(1, int(os.getenv("JOB_CONCURRENCY", "2"))),
            mimo_base_url=os.getenv(
                "MIMO_BASE_URL",
                "https://api.xiaomimimo.com/v1/chat/completions",
            ),
            mimo_model=os.getenv("MIMO_MODEL", "mimo-v2.5-asr"),
            deepgram_base_url=os.getenv(
                "DEEPGRAM_BASE_URL", "https://api.deepgram.com/v1/listen"
            ),
            deepgram_model=os.getenv("DEEPGRAM_MODEL", "nova-3"),
            deepgram_mip_opt_out=_env_bool("DEEPGRAM_MIP_OPT_OUT"),
            cors_origins=origins,
        )

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @property
    def providers_ready(self) -> bool:
        return bool(self.mimo_api_key and self.deepgram_api_key)
