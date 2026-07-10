from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from .config import Settings
from .models import JobOptions, JobRecord, JobState
from .processor import SubtitleProcessor
from .store import JobStore
from .subtitles import render_srt, render_vtt


LOGGER = logging.getLogger(__name__)


class UploadTooLargeError(ValueError):
    pass


class JobBusyError(RuntimeError):
    pass


class JobManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = JobStore(settings.jobs_dir)
        self.processor = SubtitleProcessor(settings)
        self.tasks: set[asyncio.Task[None]] = set()
        self.job_semaphore = asyncio.Semaphore(settings.job_concurrency)

    async def startup(self) -> None:
        await asyncio.to_thread(self.store.mark_interrupted_jobs_failed)

    async def shutdown(self) -> None:
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def create_job(self, upload: UploadFile, options: JobOptions) -> JobRecord:
        job_id = uuid4().hex
        original_filename = Path(upload.filename or "upload.bin").name
        suffix = Path(original_filename).suffix.lower()
        suffix = suffix if re.fullmatch(r"\.[a-z0-9]{1,10}", suffix) else ".bin"
        record = JobRecord(
            id=job_id,
            status=JobState.QUEUED,
            original_filename=original_filename,
            content_type=upload.content_type,
            options=options,
        )
        directory = await asyncio.to_thread(self.store.create, record)
        input_path = directory / f"input{suffix}"
        size = 0
        maximum = self.settings.max_upload_mb * 1024 * 1024
        try:
            with input_path.open("wb") as destination:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > maximum:
                        raise UploadTooLargeError(
                            f"upload exceeds {self.settings.max_upload_mb} MB"
                        )
                    destination.write(chunk)
        except Exception:
            await asyncio.to_thread(self.store.delete, job_id)
            raise
        finally:
            await upload.close()
        if size == 0:
            await asyncio.to_thread(self.store.delete, job_id)
            raise ValueError("uploaded file is empty")
        record = await asyncio.to_thread(self.store.update, job_id, input_bytes=size)
        task = asyncio.create_task(self._run(record.id, input_path))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return record

    async def _run(self, job_id: str, input_path: Path) -> None:
        try:
            async with self.job_semaphore:
                await self._process(job_id, input_path)
        except asyncio.CancelledError:
            await asyncio.to_thread(
                self.store.update,
                job_id,
                status=JobState.FAILED,
                stage="cancelled",
                error="job cancelled because the service is shutting down",
            )
            raise
        except Exception as exc:
            LOGGER.exception("subtitle job %s failed", job_id)
            try:
                await asyncio.to_thread(
                    self.store.update,
                    job_id,
                    status=JobState.FAILED,
                    stage="failed",
                    error=str(exc)[:1200],
                )
            except Exception:
                LOGGER.exception("could not persist failure for job %s", job_id)

    async def _process(self, job_id: str, input_path: Path) -> None:
        record = await asyncio.to_thread(
            self.store.update,
            job_id,
            status=JobState.PROCESSING,
            progress=0.01,
            stage="starting",
            error=None,
        )

        async def progress(value: float, stage: str) -> None:
            await asyncio.to_thread(
                self.store.update,
                job_id,
                progress=max(0.0, min(value, 0.99)),
                stage=stage,
            )

        result = await self.processor.process(
            job_id=job_id,
            input_path=input_path,
            work_dir=self.store.job_dir(job_id),
            options=record.options,
            progress=progress,
        )
        result_data = result.model_dump(mode="json")
        await asyncio.to_thread(
            self.store.write_json,
            job_id,
            "result.json",
            result_data,
        )
        artifacts: dict[str, str] = {}
        if "json" in record.options.formats:
            artifacts["json"] = "result.json"
        if "srt" in record.options.formats:
            await asyncio.to_thread(
                self.store.write_text,
                job_id,
                "subtitles.srt",
                render_srt(result.segments),
            )
            artifacts["srt"] = "subtitles.srt"
        if "vtt" in record.options.formats:
            await asyncio.to_thread(
                self.store.write_text,
                job_id,
                "subtitles.vtt",
                render_vtt(result.segments),
            )
            artifacts["vtt"] = "subtitles.vtt"
        await asyncio.to_thread(
            self.store.update,
            job_id,
            status=JobState.COMPLETED,
            progress=1.0,
            stage="completed",
            artifacts=artifacts,
        )

    async def delete_job(self, job_id: str) -> None:
        record = await asyncio.to_thread(self.store.load, job_id)
        if record.status == JobState.PROCESSING:
            raise JobBusyError("processing jobs cannot be deleted")
        await asyncio.to_thread(self.store.delete, job_id)
