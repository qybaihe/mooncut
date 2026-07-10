from __future__ import annotations

import asyncio
import hmac
import json
from contextlib import asynccontextmanager

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Security,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import APIKeyHeader
from pydantic import ValidationError

from . import __version__
from .config import Settings
from .jobs import JobBusyError, JobManager, UploadTooLargeError
from .models import HealthResponse, JobOptions, JobRecord, JobResponse, JobState
from .store import JobNotFoundError


service_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _parse_list_field(value: str) -> list[str]:
    value = value.strip()
    if not value:
        return []
    if value.startswith("["):
        parsed = json.loads(value)
        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            raise ValueError("expected a JSON array of strings")
        return parsed
    return [item.strip() for item in value.split(",") if item.strip()]


def _job_response(record: JobRecord) -> JobResponse:
    base = f"/v1/subtitle-jobs/{record.id}"
    return JobResponse(
        id=record.id,
        status=record.status,
        progress=record.progress,
        stage=record.stage,
        original_filename=record.original_filename,
        created_at=record.created_at,
        updated_at=record.updated_at,
        error=record.error,
        status_url=base,
        result_url=f"{base}/result" if record.status == JobState.COMPLETED else None,
        downloads={
            artifact_format: f"{base}/artifacts/{artifact_format}"
            for artifact_format in record.artifacts
        },
    )


async def require_service_key(
    request: Request,
    provided: str | None = Security(service_key_header),
) -> None:
    expected = request.app.state.settings.service_api_key
    if not expected:
        return
    authorization = request.headers.get("Authorization", "")
    if not provided and authorization.lower().startswith("bearer "):
        provided = authorization[7:].strip()
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing service API key",
            headers={"WWW-Authenticate": "Bearer"},
        )


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    manager = JobManager(resolved_settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await manager.startup()
        yield
        await manager.shutdown()

    application = FastAPI(
        title="Hybrid Subtitle API",
        summary="MiMo text accuracy with Deepgram word timing",
        version=__version__,
        lifespan=lifespan,
    )
    application.state.settings = resolved_settings
    application.state.manager = manager

    if resolved_settings.cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=list(resolved_settings.cors_origins),
            allow_credentials=False,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "X-API-Key"],
        )

    protected = [Depends(require_service_key)]

    @application.get("/", include_in_schema=False)
    async def root() -> dict[str, str]:
        return {"service": "hybrid-subtitle-api", "docs": "/docs"}

    @application.get("/healthz", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok" if resolved_settings.providers_ready else "configuration_required",
            providers_configured=resolved_settings.providers_ready,
            service_auth_enabled=bool(resolved_settings.service_api_key),
            version=__version__,
        )

    @application.post(
        "/v1/subtitle-jobs",
        response_model=JobResponse,
        status_code=status.HTTP_202_ACCEPTED,
        dependencies=protected,
    )
    async def create_subtitle_job(
        file: UploadFile = File(..., description="Audio or video file readable by FFmpeg"),
        language: str = Form("zh-CN"),
        glossary: str = Form("", description="Comma list or JSON string array"),
        formats: str = Form("json,srt,vtt", description="Comma list or JSON string array"),
        chunk_seconds: float | None = Form(None),
        overlap_seconds: float | None = Form(None),
        max_chars_per_line: int = Form(16),
        max_lines: int = Form(2),
        strict_hybrid: bool = Form(False),
    ) -> JobResponse:
        if not resolved_settings.providers_ready:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="MIMO_API_KEY and DEEPGRAM_API_KEY must both be configured",
            )
        try:
            options = JobOptions(
                language=language,
                glossary=_parse_list_field(glossary),
                formats=_parse_list_field(formats),
                chunk_seconds=chunk_seconds or resolved_settings.chunk_seconds,
                overlap_seconds=(
                    overlap_seconds
                    if overlap_seconds is not None
                    else resolved_settings.chunk_overlap_seconds
                ),
                max_chars_per_line=max_chars_per_line,
                max_lines=max_lines,
                strict_hybrid=strict_hybrid,
            )
        except (ValueError, json.JSONDecodeError, ValidationError) as exc:
            detail = exc.errors() if isinstance(exc, ValidationError) else str(exc)
            raise HTTPException(status_code=422, detail=detail) from exc
        try:
            record = await manager.create_job(file, options)
        except UploadTooLargeError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _job_response(record)

    @application.get(
        "/v1/subtitle-jobs",
        response_model=list[JobResponse],
        dependencies=protected,
    )
    async def list_subtitle_jobs(
        limit: int = Query(20, ge=1, le=100),
    ) -> list[JobResponse]:
        records = await asyncio.to_thread(manager.store.list, limit)
        return [_job_response(record) for record in records]

    @application.get(
        "/v1/subtitle-jobs/{job_id}",
        response_model=JobResponse,
        dependencies=protected,
    )
    async def get_subtitle_job(job_id: str) -> JobResponse:
        try:
            record = await asyncio.to_thread(manager.store.load, job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc
        return _job_response(record)

    @application.get(
        "/v1/subtitle-jobs/{job_id}/result",
        dependencies=protected,
    )
    async def get_subtitle_result(job_id: str) -> JSONResponse:
        try:
            record = await asyncio.to_thread(manager.store.load, job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc
        if record.status != JobState.COMPLETED:
            raise HTTPException(
                status_code=409,
                detail=f"job is {record.status.value}",
            )
        path = manager.store.job_dir(job_id) / "result.json"
        return JSONResponse(json.loads(path.read_text(encoding="utf-8")))

    @application.get(
        "/v1/subtitle-jobs/{job_id}/artifacts/{artifact_format}",
        dependencies=protected,
    )
    async def download_artifact(job_id: str, artifact_format: str) -> FileResponse:
        try:
            record = await asyncio.to_thread(manager.store.load, job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc
        filename = record.artifacts.get(artifact_format)
        if not filename:
            raise HTTPException(status_code=404, detail="artifact not found")
        path = manager.store.job_dir(job_id) / filename
        media_types = {
            "json": "application/json",
            "srt": "application/x-subrip",
            "vtt": "text/vtt",
        }
        return FileResponse(
            path,
            filename=filename,
            media_type=media_types.get(artifact_format, "application/octet-stream"),
        )

    @application.delete(
        "/v1/subtitle-jobs/{job_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=protected,
    )
    async def delete_subtitle_job(job_id: str) -> None:
        try:
            await manager.delete_job(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc
        except JobBusyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    return application


app = create_app()
