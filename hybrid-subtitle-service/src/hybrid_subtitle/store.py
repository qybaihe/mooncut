from __future__ import annotations

import json
import shutil
from pathlib import Path

from .models import JobRecord, JobState, utc_now


class JobNotFoundError(KeyError):
    pass


class JobStore:
    def __init__(self, jobs_dir: Path):
        self.jobs_dir = jobs_dir
        self.jobs_dir.mkdir(parents=True, exist_ok=True)

    def job_dir(self, job_id: str) -> Path:
        if len(job_id) != 32 or any(character not in "0123456789abcdef" for character in job_id):
            raise JobNotFoundError(job_id)
        return self.jobs_dir / job_id

    def create(self, record: JobRecord) -> Path:
        directory = self.job_dir(record.id)
        directory.mkdir(parents=True, exist_ok=False)
        self.save(record)
        return directory

    def save(self, record: JobRecord) -> None:
        directory = self.job_dir(record.id)
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / "status.json"
        temporary = directory / "status.json.tmp"
        temporary.write_text(record.model_dump_json(indent=2), encoding="utf-8")
        temporary.replace(destination)

    def load(self, job_id: str) -> JobRecord:
        path = self.job_dir(job_id) / "status.json"
        if not path.is_file():
            raise JobNotFoundError(job_id)
        return JobRecord.model_validate_json(path.read_text(encoding="utf-8"))

    def list(self, limit: int = 50) -> list[JobRecord]:
        records: list[JobRecord] = []
        for path in self.jobs_dir.glob("*/status.json"):
            try:
                records.append(
                    JobRecord.model_validate_json(path.read_text(encoding="utf-8"))
                )
            except (OSError, ValueError):
                continue
        records.sort(key=lambda item: item.created_at, reverse=True)
        return records[:limit]

    def update(self, job_id: str, **updates: object) -> JobRecord:
        record = self.load(job_id)
        updates["updated_at"] = utc_now()
        updated = record.model_copy(update=updates)
        self.save(updated)
        return updated

    def write_json(self, job_id: str, filename: str, data: dict[str, object]) -> Path:
        destination = self.job_dir(job_id) / filename
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(destination)
        return destination

    def write_text(self, job_id: str, filename: str, content: str) -> Path:
        destination = self.job_dir(job_id) / filename
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(destination)
        return destination

    def mark_interrupted_jobs_failed(self) -> None:
        for record in self.list(limit=100_000):
            if record.status in {JobState.QUEUED, JobState.PROCESSING}:
                self.update(
                    record.id,
                    status=JobState.FAILED,
                    stage="interrupted",
                    error="service restarted before this in-process job completed",
                )

    def delete(self, job_id: str) -> None:
        directory = self.job_dir(job_id)
        if not directory.exists():
            raise JobNotFoundError(job_id)
        shutil.rmtree(directory)

