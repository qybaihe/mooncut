from __future__ import annotations

import bisect
import hashlib
import json
import math
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal, Sequence

import cv2
import numpy as np

from .face_tracker import FaceData, FaceTracker, default_model_path


SCHEMA_VERSION = "mooncut.face-track.v1"
SampleState = Literal["detected", "interpolated", "held", "fallback"]


@dataclass(frozen=True)
class ReframeConfig:
    """Detection sampling, subject locking, and stabilization settings."""

    sample_fps: float = 15.0
    smoothing_ms: float = 420.0
    zoom_smoothing_ms: float = 700.0
    max_anchor_error_face_fraction: float = 0.05
    max_interpolation_gap_ms: float = 900.0
    max_hold_ms: float = 1_200.0
    continuity_threshold: float = 0.58
    subject_switch_delay_ms: float = 600.0
    switch_confirm_samples: int = 3
    fallback_center: tuple[float, float] = (0.5, 0.45)
    fallback_face_size: tuple[float, float] = (0.18, 0.18)
    preferred_track_id: int | None = None
    detector_conf: float = 0.3
    detector_iou: float = 0.5
    detector_imgsz: int = 640
    detector_max_det: int = 10
    device: str | None = "auto"

    def __post_init__(self) -> None:
        if self.sample_fps <= 0:
            raise ValueError("sample_fps must be positive")
        if self.smoothing_ms < 0 or self.zoom_smoothing_ms < 0:
            raise ValueError("smoothing durations must be non-negative")
        if not 0 < self.max_anchor_error_face_fraction <= 0.5:
            raise ValueError("max_anchor_error_face_fraction must be in (0, 0.5]")
        if self.max_interpolation_gap_ms < 0 or self.max_hold_ms < 0:
            raise ValueError("gap durations must be non-negative")
        if self.subject_switch_delay_ms < 0:
            raise ValueError("subject_switch_delay_ms must be non-negative")
        if self.switch_confirm_samples < 1:
            raise ValueError("switch_confirm_samples must be at least 1")
        if not 0 <= self.continuity_threshold <= 1:
            raise ValueError("continuity_threshold must be in [0, 1]")


@dataclass(frozen=True)
class SourceMetadata:
    name: str
    width: int
    height: int
    display_width: int
    display_height: int
    rotation_deg: int
    fps: float
    duration_ms: float
    frame_count: int
    file_size: int = 0
    sha256: str = ""


@dataclass(frozen=True)
class FaceTrackSample:
    frame_idx: int
    t_ms: float
    track_id: int | None
    bbox_norm: tuple[float, float, float, float]
    center_norm: tuple[float, float]
    face_size_norm: tuple[float, float]
    keypoints_norm: tuple[tuple[float, float, float], ...]
    confidence: float
    state: SampleState
    raw_bbox_norm: tuple[float, float, float, float] | None = None
    source_clipped: tuple[bool, bool, bool, bool] = (False, False, False, False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "frame_idx": self.frame_idx,
            "t_ms": round(self.t_ms, 3),
            "track_id": self.track_id,
            "bbox_norm": [round(value, 7) for value in self.bbox_norm],
            "center_norm": [round(value, 7) for value in self.center_norm],
            "face_size_norm": [round(value, 7) for value in self.face_size_norm],
            "keypoints_norm": [
                [round(value, 7) for value in point] for point in self.keypoints_norm
            ],
            "confidence": round(self.confidence, 6),
            "state": self.state,
            "raw_bbox_norm": (
                [round(value, 7) for value in self.raw_bbox_norm]
                if self.raw_bbox_norm is not None
                else None
            ),
            "source_clipped": {
                "left": self.source_clipped[0],
                "top": self.source_clipped[1],
                "right": self.source_clipped[2],
                "bottom": self.source_clipped[3],
            },
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> FaceTrackSample:
        center = value.get("center_norm", [0.5, 0.5])
        size = value.get("face_size_norm", [0.18, 0.18])
        bbox = value.get(
            "bbox_norm",
            [
                center[0] - size[0] / 2,
                center[1] - size[1] / 2,
                center[0] + size[0] / 2,
                center[1] + size[1] / 2,
            ],
        )
        clipped = value.get("source_clipped", {})
        raw_bbox = value.get("raw_bbox_norm")
        return cls(
            frame_idx=int(value.get("frame_idx", 0)),
            t_ms=float(value["t_ms"]),
            track_id=int(value["track_id"]) if value.get("track_id") is not None else None,
            bbox_norm=tuple(float(item) for item in bbox[:4]),
            center_norm=(float(center[0]), float(center[1])),
            face_size_norm=(float(size[0]), float(size[1])),
            keypoints_norm=tuple(
                (float(point[0]), float(point[1]), float(point[2]))
                for point in value.get("keypoints_norm", [])
            ),
            confidence=float(value.get("confidence", 0.0)),
            state=value.get("state", "fallback"),
            raw_bbox_norm=(
                tuple(float(item) for item in raw_bbox[:4]) if raw_bbox is not None else None
            ),
            source_clipped=(
                bool(clipped.get("left", False)),
                bool(clipped.get("top", False)),
                bool(clipped.get("right", False)),
                bool(clipped.get("bottom", False)),
            ),
        )


@dataclass
class FaceTrackManifest:
    source: SourceMetadata
    samples: list[FaceTrackSample]
    primary_track_id: int | None
    detector: dict[str, Any] = field(default_factory=dict)
    framing_defaults: dict[str, Any] = field(default_factory=dict)
    gaps: list[dict[str, Any]] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        self.samples.sort(key=lambda sample: sample.t_ms)
        for sample in self.samples:
            if not math.isfinite(sample.t_ms):
                raise ValueError("Face-track sample timestamps must be finite")

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "source": asdict(self.source),
            "detector": self.detector,
            "primary_track_id": self.primary_track_id,
            "samples": [sample.to_dict() for sample in self.samples],
            "gaps": self.gaps,
            "stats": self.stats,
            "framing_defaults": self.framing_defaults,
        }

    def write_json(self, path: str | Path) -> Path:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return output

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> FaceTrackManifest:
        if value.get("schema_version") != SCHEMA_VERSION:
            raise ValueError(
                f"Unsupported face-track schema: {value.get('schema_version')!r}; "
                f"expected {SCHEMA_VERSION!r}"
            )
        source = dict(value["source"])
        width, height = int(source["width"]), int(source["height"])
        metadata = SourceMetadata(
            name=str(source.get("name", "video")),
            width=width,
            height=height,
            display_width=int(source.get("display_width", width)),
            display_height=int(source.get("display_height", height)),
            rotation_deg=int(source.get("rotation_deg", 0)),
            fps=float(source.get("fps", 30.0)),
            duration_ms=float(source.get("duration_ms", 0.0)),
            frame_count=int(source.get("frame_count", 0)),
            file_size=int(source.get("file_size", 0)),
            sha256=str(source.get("sha256", "")),
        )
        return cls(
            source=metadata,
            samples=[FaceTrackSample.from_dict(sample) for sample in value.get("samples", [])],
            primary_track_id=(
                int(value["primary_track_id"])
                if value.get("primary_track_id") is not None
                else None
            ),
            detector=dict(value.get("detector", {})),
            framing_defaults=dict(value.get("framing_defaults", {})),
            gaps=list(value.get("gaps", [])),
            stats=dict(value.get("stats", {})),
            schema_version=value["schema_version"],
        )

    @classmethod
    def read_json(cls, path: str | Path) -> FaceTrackManifest:
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


@dataclass(frozen=True)
class FramingProfile:
    name: str
    width: int
    height: int
    face_fill: float
    anchor: tuple[float, float]
    shape: Literal["rect", "circle"] = "rect"
    max_zoom: float = 6.0
    background: str = "#050706"
    edge_mode: Literal["clamp", "blur"] = "clamp"

    @property
    def aspect_ratio(self) -> float:
        return self.width / self.height


FRAMING_PRESETS: dict[str, FramingProfile] = {
    "portrait": FramingProfile(
        name="portrait",
        width=1080,
        height=1920,
        face_fill=0.30,
        anchor=(0.5, 0.42),
        edge_mode="blur",
    ),
    "square": FramingProfile(
        name="square",
        width=1080,
        height=1080,
        face_fill=0.48,
        anchor=(0.5, 0.46),
        edge_mode="blur",
    ),
    "circle": FramingProfile(
        name="circle",
        width=1080,
        height=1080,
        face_fill=0.68,
        anchor=(0.5, 0.5),
        shape="circle",
        edge_mode="blur",
    ),
    "landscape": FramingProfile(
        name="landscape",
        width=1920,
        height=1080,
        face_fill=0.48,
        anchor=(0.5, 0.45),
        edge_mode="blur",
    ),
}


@dataclass(frozen=True)
class CropRect:
    left: float
    top: float
    width: float
    height: float


@dataclass
class _NormalizedFace:
    track_id: int
    bbox: np.ndarray
    center: np.ndarray
    size: np.ndarray
    keypoints: tuple[tuple[float, float, float], ...]
    confidence: float

    @property
    def area(self) -> float:
        return float(self.size[0] * self.size[1])


@dataclass
class _DetectionFrame:
    frame_idx: int
    t_ms: float
    faces: list[_NormalizedFace]


def _resolved_device(device: str | None) -> str | None:
    if device not in {None, "auto"}:
        return device
    try:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "0"
    except Exception:
        pass
    return None


def _normalize_face(face: FaceData, width: int, height: int) -> _NormalizedFace:
    x1, y1, x2, y2 = face.bbox
    anchor = face.anchor or face.center
    return _NormalizedFace(
        track_id=face.track_id,
        bbox=np.array([x1 / width, y1 / height, x2 / width, y2 / height], dtype=float),
        center=np.array([anchor[0] / width, anchor[1] / height], dtype=float),
        size=np.array([(x2 - x1) / width, (y2 - y1) / height], dtype=float),
        keypoints=tuple(
            (point[0] / width, point[1] / height, point[2]) for point in face.keypoints
        ),
        confidence=face.conf,
    )


def _dominant_track_id(
    frames: Sequence[_DetectionFrame], preferred_track_id: int | None = None
) -> int | None:
    by_id: dict[int, list[_NormalizedFace]] = {}
    for frame in frames:
        for face in frame.faces:
            if face.track_id >= 0:
                by_id.setdefault(face.track_id, []).append(face)

    if preferred_track_id is not None and preferred_track_id in by_id:
        return preferred_track_id
    if not by_id:
        return None

    def score(item: tuple[int, list[_NormalizedFace]]) -> float:
        _, faces = item
        areas = np.array([face.area for face in faces], dtype=float)
        centers = np.array([face.center for face in faces], dtype=float)
        distance = np.linalg.norm(centers - np.array([0.5, 0.45]), axis=1)
        center_bonus = max(0.55, 1.0 - float(np.median(distance)) * 0.45)
        # Coverage dominates. Size and center position only break close ties.
        return len(faces) * (1.0 + math.sqrt(float(np.median(areas)))) * center_bonus

    return max(by_id.items(), key=score)[0]


def _bbox_iou(left: np.ndarray, right: np.ndarray) -> float:
    intersection_left = max(float(left[0]), float(right[0]))
    intersection_top = max(float(left[1]), float(right[1]))
    intersection_right = min(float(left[2]), float(right[2]))
    intersection_bottom = min(float(left[3]), float(right[3]))
    intersection = max(0.0, intersection_right - intersection_left) * max(
        0.0, intersection_bottom - intersection_top
    )
    left_area = max(0.0, float(left[2] - left[0])) * max(0.0, float(left[3] - left[1]))
    right_area = max(0.0, float(right[2] - right[0])) * max(0.0, float(right[3] - right[1]))
    union = left_area + right_area - intersection
    return intersection / union if union > 0 else 0.0


def _continuity_score(previous: _NormalizedFace, candidate: _NormalizedFace) -> float:
    distance = min(1.0, float(np.linalg.norm(previous.center - candidate.center)) / 0.5)
    size_ratio = min(previous.area, candidate.area) / max(previous.area, candidate.area, 1e-9)
    return 0.55 * _bbox_iou(previous.bbox, candidate.bbox) + 0.30 * size_ratio + 0.15 * (
        1.0 - distance
    )


def _lock_subject(
    frames: Sequence[_DetectionFrame],
    primary_track_id: int | None,
    continuity_threshold: float,
    max_continuity_gap_ms: float = 1_200.0,
    switch_delay_ms: float = 600.0,
    switch_confirm_samples: int = 3,
) -> tuple[list[_NormalizedFace | None], int]:
    selected: list[_NormalizedFace | None] = []
    locked_id = primary_track_id
    previous: _NormalizedFace | None = None
    previous_t_ms: float | None = None
    pending_id: int | None = None
    pending_count = 0
    switches = 0

    for frame in frames:
        by_id = {face.track_id: face for face in frame.faces}
        face = by_id.get(locked_id) if locked_id is not None else None
        preferred_face = by_id.get(primary_track_id) if primary_track_id is not None else None

        if face is not None and preferred_face is not None and locked_id != primary_track_id:
            if pending_id == primary_track_id:
                pending_count += 1
            else:
                pending_id = primary_track_id
                pending_count = 1
            if pending_count >= switch_confirm_samples:
                switches += 1
                locked_id = primary_track_id
                face = preferred_face
                pending_id = None
                pending_count = 0
        elif face is not None:
            pending_id = None
            pending_count = 0
        elif previous is not None and previous_t_ms is not None and frame.faces:
            missing_ms = frame.t_ms - previous_t_ms
            candidate: _NormalizedFace | None = None
            if missing_ms >= switch_delay_ms:
                if missing_ms <= max_continuity_gap_ms:
                    continuity_candidate = max(
                        frame.faces, key=lambda item: _continuity_score(previous, item)
                    )
                    if _continuity_score(previous, continuity_candidate) >= continuity_threshold:
                        candidate = continuity_candidate
                else:
                    # After a long absence or scene cut, reacquire deliberately
                    # instead of comparing against a stale location forever.
                    candidate = max(
                        frame.faces,
                        key=lambda item: item.area
                        * (1.0 - min(0.45, float(np.linalg.norm(item.center - [0.5, 0.45])) * 0.35)),
                    )

            if candidate is None:
                pending_id = None
                pending_count = 0
            else:
                if candidate.track_id == pending_id:
                    pending_count += 1
                else:
                    pending_id = candidate.track_id
                    pending_count = 1
                if pending_count >= switch_confirm_samples:
                    if locked_id is not None and candidate.track_id != locked_id:
                        switches += 1
                    locked_id = candidate.track_id
                    face = candidate
                    pending_id = None
                    pending_count = 0
        elif face is None:
            # Confirmation means consecutive sampled observations. A blank
            # frame must not let a bystander's old pending count carry over.
            pending_id = None
            pending_count = 0

        if face is None and previous is None and frame.faces:
            # Do not discard a valid opening segment merely because the same
            # person receives a different (dominant) tracker ID later.
            face = max(
                frame.faces,
                key=lambda item: item.area
                * (1.0 - min(0.45, float(np.linalg.norm(item.center - [0.5, 0.45])) * 0.35)),
            )
            locked_id = face.track_id

        selected.append(face)
        if face is not None:
            previous = face
            previous_t_ms = frame.t_ms

    return selected, switches


def _nearest_valid_indices(valid: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    length = len(valid)
    previous = np.full(length, -1, dtype=int)
    following = np.full(length, -1, dtype=int)
    last = -1
    for index in range(length):
        if valid[index]:
            last = index
        previous[index] = last
    last = -1
    for index in range(length - 1, -1, -1):
        if valid[index]:
            last = index
        following[index] = last
    return previous, following


def _fill_missing(
    values: np.ndarray,
    times: np.ndarray,
    fallback: np.ndarray,
    max_interpolation_gap_ms: float,
    max_hold_ms: float,
) -> tuple[np.ndarray, list[SampleState]]:
    result = values.copy()
    valid = np.isfinite(result).all(axis=1)
    states: list[SampleState] = ["detected" if item else "fallback" for item in valid]
    if not valid.any():
        result[:] = fallback
        return result, states

    previous, following = _nearest_valid_indices(valid)
    for index in range(len(result)):
        if valid[index]:
            continue
        left, right = previous[index], following[index]
        if left >= 0 and right >= 0 and times[right] - times[left] <= max_interpolation_gap_ms:
            duration = max(1e-9, times[right] - times[left])
            progress = (times[index] - times[left]) / duration
            result[index] = result[left] + (result[right] - result[left]) * progress
            states[index] = "interpolated"
        elif left >= 0 and times[index] - times[left] <= max_hold_ms:
            result[index] = result[left]
            states[index] = "held"
        elif right >= 0 and times[right] - times[index] <= max_hold_ms:
            result[index] = result[right]
            states[index] = "held"
        else:
            result[index] = fallback
            states[index] = "fallback"
    return result, states


def _smooth_zero_phase(values: np.ndarray, times: np.ndarray, smoothing_ms: float) -> np.ndarray:
    if len(values) < 2 or smoothing_ms <= 0:
        return values.copy()

    def pass_filter(items: np.ndarray, item_times: np.ndarray) -> np.ndarray:
        output = items.copy()
        for index in range(1, len(items)):
            delta = max(0.0, float(item_times[index] - item_times[index - 1]))
            alpha = 1.0 - math.exp(-delta / max(smoothing_ms, 1e-6))
            output[index] = output[index - 1] + alpha * (items[index] - output[index - 1])
        return output

    forward = pass_filter(values, times)
    backward = pass_filter(values[::-1], -times[::-1])[::-1]
    return (forward + backward) / 2.0


def _sample_gaps(frames: Sequence[_DetectionFrame], selected: Sequence[_NormalizedFace | None]) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    start: int | None = None
    for index, face in enumerate(selected):
        if face is None and start is None:
            start = index
        at_end = index == len(selected) - 1
        if start is not None and (face is not None or at_end):
            end = index if face is None and at_end else index - 1
            gaps.append(
                {
                    "start_ms": round(frames[start].t_ms, 3),
                    "end_ms": round(frames[end].t_ms, 3),
                    "sample_count": end - start + 1,
                }
            )
            start = None
    return gaps


def _stabilize(
    frames: Sequence[_DetectionFrame],
    selected: Sequence[_NormalizedFace | None],
    config: ReframeConfig,
) -> list[FaceTrackSample]:
    if not frames:
        return []

    times = np.array([frame.t_ms for frame in frames], dtype=float)
    centers = np.full((len(frames), 2), np.nan, dtype=float)
    sizes = np.full((len(frames), 2), np.nan, dtype=float)
    for index, face in enumerate(selected):
        if face is not None:
            centers[index] = face.center
            sizes[index] = face.size

    observed_centers = centers.copy()
    valid_sizes = sizes[np.isfinite(sizes).all(axis=1)]
    size_fallback = (
        np.median(valid_sizes, axis=0)
        if len(valid_sizes)
        else np.array(config.fallback_face_size, dtype=float)
    )
    centers, center_states = _fill_missing(
        centers,
        times,
        np.array(config.fallback_center, dtype=float),
        config.max_interpolation_gap_ms,
        config.max_hold_ms,
    )
    sizes, size_states = _fill_missing(
        sizes,
        times,
        size_fallback,
        config.max_interpolation_gap_ms,
        config.max_hold_ms,
    )

    smoothed_centers = _smooth_zero_phase(centers, times, config.smoothing_ms)
    smoothed_log_sizes = _smooth_zero_phase(
        np.log(np.clip(sizes, 1e-5, 1.0)), times, config.zoom_smoothing_ms
    )
    smoothed_sizes = np.exp(smoothed_log_sizes)

    # Fixed low-pass smoothing can visibly lag during a quick handheld pan.
    # Keep the stabilization, but cap its distance from every real landmark
    # observation. Limits scale with the detected face and are bounded so the
    # rendered face stays near its requested anchor even under fast motion.
    observed = np.isfinite(observed_centers).all(axis=1)
    for index in np.flatnonzero(observed):
        limit = np.clip(
            sizes[index] * config.max_anchor_error_face_fraction,
            0.004,
            0.018,
        )
        delta = np.clip(
            smoothed_centers[index] - observed_centers[index],
            -limit,
            limit,
        )
        smoothed_centers[index] = observed_centers[index] + delta

    state_priority: dict[SampleState, int] = {
        "detected": 0,
        "interpolated": 1,
        "held": 2,
        "fallback": 3,
    }
    samples: list[FaceTrackSample] = []
    for index, frame in enumerate(frames):
        face = selected[index]
        state = max(
            (center_states[index], size_states[index]), key=lambda value: state_priority[value]
        )
        center = np.clip(smoothed_centers[index], 0.0, 1.0)
        size = np.clip(smoothed_sizes[index], 1e-5, 1.0)
        x1, y1 = center - size / 2
        x2, y2 = center + size / 2
        samples.append(
            FaceTrackSample(
                frame_idx=frame.frame_idx,
                t_ms=frame.t_ms,
                track_id=face.track_id if face is not None else None,
                bbox_norm=(float(x1), float(y1), float(x2), float(y2)),
                center_norm=(float(center[0]), float(center[1])),
                face_size_norm=(float(size[0]), float(size[1])),
                keypoints_norm=face.keypoints if face is not None else (),
                confidence=face.confidence if face is not None else 0.0,
                state=state,
                raw_bbox_norm=(
                    tuple(float(value) for value in face.bbox) if face is not None else None
                ),
                source_clipped=(
                    bool(face is not None and face.bbox[0] <= 0.002),
                    bool(face is not None and face.bbox[1] <= 0.002),
                    bool(face is not None and face.bbox[2] >= 0.998),
                    bool(face is not None and face.bbox[3] >= 0.998),
                ),
            )
        )
    return samples


def _capture_rotation(capture: cv2.VideoCapture) -> int:
    property_id = getattr(cv2, "CAP_PROP_ORIENTATION_META", None)
    if property_id is None:
        return 0
    value = capture.get(property_id)
    return int(round(value)) if np.isfinite(value) else 0


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_manifest_source(source: str | Path, metadata: SourceMetadata) -> None:
    """Reject a track file generated for a different video asset."""

    source_path = Path(source).expanduser().resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"Input video not found: {source_path}")
    actual_size = source_path.stat().st_size
    if metadata.file_size and actual_size != metadata.file_size:
        raise ValueError(
            "Face-track source mismatch: file size differs "
            f"({actual_size} != {metadata.file_size})."
        )
    if metadata.sha256:
        actual_sha256 = _sha256(source_path)
        if actual_sha256 != metadata.sha256:
            raise ValueError(
                "Face-track source mismatch: SHA-256 differs. "
                "Analyze this input again or pass --allow-source-mismatch explicitly."
            )
        return

    # Backward-compatible validation for v1 manifests written before source
    # fingerprints were added.
    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"OpenCV could not open video: {source_path}")
    width = int(round(capture.get(cv2.CAP_PROP_FRAME_WIDTH)))
    height = int(round(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    frames = int(max(0, capture.get(cv2.CAP_PROP_FRAME_COUNT)))
    capture.release()
    duration_ms = (frames / fps) * 1000.0 if fps > 0 else 0.0
    expected_dimensions = (metadata.display_width, metadata.display_height)
    if (width, height) != expected_dimensions:
        raise ValueError(
            "Face-track source mismatch: decoded dimensions differ "
            f"({width}x{height} != {expected_dimensions[0]}x{expected_dimensions[1]})."
        )
    tolerance_ms = max(500.0, metadata.duration_ms * 0.02)
    if metadata.duration_ms and abs(duration_ms - metadata.duration_ms) > tolerance_ms:
        raise ValueError("Face-track source mismatch: video duration differs.")


def analyze_video(
    source: str | Path,
    *,
    tracker: FaceTracker | None = None,
    config: ReframeConfig | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> FaceTrackManifest:
    """Analyze a source file and return a stable, source-timestamped face track."""

    source_path = Path(source).expanduser().resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"Input video not found: {source_path}")
    config = config or ReframeConfig()
    own_tracker = tracker is None
    if tracker is None:
        tracker = FaceTracker(
            model=default_model_path(),
            conf=config.detector_conf,
            iou=config.detector_iou,
            imgsz=config.detector_imgsz,
            max_det=config.detector_max_det,
            device=_resolved_device(config.device),
            show=False,
            show_boxes=False,
            verbose=False,
        )
    tracker.reset()

    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"OpenCV could not open video: {source_path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if not np.isfinite(fps) or fps <= 0:
        fps = 30.0
    reported_frames = int(max(0, capture.get(cv2.CAP_PROP_FRAME_COUNT)))
    rotation = _capture_rotation(capture)
    sample_step = max(1, int(round(fps / min(fps, config.sample_fps))))

    frames: list[_DetectionFrame] = []
    frame_index = 0
    decoded_frames = 0
    display_width = 0
    display_height = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        decoded_frames += 1
        display_height, display_width = frame.shape[:2]
        if frame_index % sample_step == 0:
            pts_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC))
            if not np.isfinite(pts_ms) or pts_ms < 0:
                pts_ms = (frame_index / fps) * 1000.0
            result = tracker.process(frame, timestamp_ms=pts_ms)
            normalized = [
                _normalize_face(face, display_width, display_height) for face in result.faces
            ]
            frames.append(_DetectionFrame(frame_idx=frame_index, t_ms=pts_ms, faces=normalized))
        frame_index += 1
        if progress and (frame_index % max(1, int(fps)) == 0 or frame_index == reported_frames):
            progress(frame_index, reported_frames)
    capture.release()

    if display_width <= 0 or display_height <= 0 or decoded_frames == 0:
        raise RuntimeError(f"No decodable video frames found in: {source_path}")

    primary_track_id = _dominant_track_id(frames, config.preferred_track_id)
    selected, switches = _lock_subject(
        frames,
        primary_track_id,
        config.continuity_threshold,
        config.max_hold_ms,
        config.subject_switch_delay_ms,
        config.switch_confirm_samples,
    )
    samples = _stabilize(frames, selected, config)
    gaps = _sample_gaps(frames, selected)
    detected_count = sum(face is not None for face in selected)
    coverage = detected_count / len(frames) if frames else 0.0
    duration_ms = ((decoded_frames - 1) / fps) * 1000.0 if decoded_frames > 1 else 0.0
    source_metadata = SourceMetadata(
        name=source_path.name,
        width=display_width,
        height=display_height,
        display_width=display_width,
        display_height=display_height,
        rotation_deg=rotation,
        fps=fps,
        duration_ms=duration_ms,
        frame_count=decoded_frames,
        file_size=source_path.stat().st_size,
        sha256=_sha256(source_path),
    )
    model_path = Path(tracker.model_path)

    # Releasing our own tracker quickly returns MPS/CUDA memory in batch jobs.
    if own_tracker:
        tracker.reset()

    return FaceTrackManifest(
        source=source_metadata,
        samples=samples,
        primary_track_id=primary_track_id,
        detector={
            "model": model_path.name,
            "model_sha256": _sha256(model_path),
            "conf": tracker.conf,
            "iou": tracker.iou,
            "imgsz": tracker.imgsz,
            "tracker": tracker.tracker,
            "device": tracker.device or "cpu",
            "sample_fps": round(fps / sample_step, 6),
        },
        framing_defaults={
            "anchor": list(config.fallback_center),
            "smoothing_ms": config.smoothing_ms,
            "zoom_smoothing_ms": config.zoom_smoothing_ms,
        },
        gaps=gaps,
        stats={
            "sample_count": len(frames),
            "detected_samples": detected_count,
            "detection_coverage": round(coverage, 6),
            "stitched_track_switches": switches,
            "fallback_samples": sum(sample.state == "fallback" for sample in samples),
        },
    )


def interpolate_sample(
    samples: Sequence[FaceTrackSample], t_ms: float
) -> FaceTrackSample | None:
    """Linearly interpolate stable track values at a source timestamp."""

    if not samples:
        return None
    if any(samples[index].t_ms > samples[index + 1].t_ms for index in range(len(samples) - 1)):
        samples = sorted(samples, key=lambda sample: sample.t_ms)
    times = [sample.t_ms for sample in samples]
    right = bisect.bisect_left(times, t_ms)
    if right <= 0:
        return samples[0]
    if right >= len(samples):
        return samples[-1]
    before, after = samples[right - 1], samples[right]
    duration = max(1e-9, after.t_ms - before.t_ms)
    progress = min(1.0, max(0.0, (t_ms - before.t_ms) / duration))

    def lerp_pair(left: Sequence[float], right_value: Sequence[float]) -> tuple[float, float]:
        return (
            float(left[0] + (right_value[0] - left[0]) * progress),
            float(left[1] + (right_value[1] - left[1]) * progress),
        )

    def lerp_bbox(
        left: Sequence[float] | None,
        right_value: Sequence[float] | None,
    ) -> tuple[float, float, float, float] | None:
        if left is None:
            return tuple(float(value) for value in right_value[:4]) if right_value is not None else None
        if right_value is None:
            return tuple(float(value) for value in left[:4])
        return tuple(
            float(left[index] + (right_value[index] - left[index]) * progress)
            for index in range(4)
        )

    center = lerp_pair(before.center_norm, after.center_norm)
    size = lerp_pair(before.face_size_norm, after.face_size_norm)
    return FaceTrackSample(
        frame_idx=round(before.frame_idx + (after.frame_idx - before.frame_idx) * progress),
        t_ms=t_ms,
        track_id=before.track_id if progress < 0.5 else after.track_id,
        bbox_norm=(
            center[0] - size[0] / 2,
            center[1] - size[1] / 2,
            center[0] + size[0] / 2,
            center[1] + size[1] / 2,
        ),
        center_norm=center,
        face_size_norm=size,
        keypoints_norm=before.keypoints_norm if progress < 0.5 else after.keypoints_norm,
        confidence=float(before.confidence + (after.confidence - before.confidence) * progress),
        state=before.state if progress < 0.5 else after.state,
        raw_bbox_norm=lerp_bbox(before.raw_bbox_norm, after.raw_bbox_norm),
        source_clipped=tuple(
            left or right for left, right in zip(before.source_clipped, after.source_clipped)
        ),
    )


def _smootherstep(value: float) -> float:
    progress = float(np.clip(value, 0.0, 1.0))
    return progress**3 * (progress * (progress * 6 - 15) + 10)


def _edge_padding_weight(
    *,
    clearance: float,
    clipped: bool,
    crop_size: float,
    face_size: float,
) -> float:
    if clipped:
        return 0.0
    seam_guard = max(crop_size * 0.03, face_size * 0.15)
    release_band = max(crop_size * 0.025, face_size * 0.1, 0.006)
    return _smootherstep((clearance - seam_guard) / release_band)


def resolve_crop(
    sample: FaceTrackSample | None,
    source: SourceMetadata,
    profile: FramingProfile,
) -> CropRect:
    """Resolve an aspect-correct source crop while preserving its dimensions at edges."""

    source_aspect = source.display_width / source.display_height
    target_aspect = profile.aspect_ratio
    maximum_height = min(1.0, source_aspect / target_aspect)
    maximum_width = target_aspect * maximum_height / source_aspect
    if sample is None:
        return CropRect(
            left=(1.0 - maximum_width) / 2,
            top=(1.0 - maximum_height) / 2,
            width=maximum_width,
            height=maximum_height,
        )

    face_width, face_height = sample.face_size_norm
    diameter_in_source_height = max(face_width * source_aspect, face_height)
    shortest_output_edge = min(target_aspect, 1.0)
    minimum_height = maximum_height / max(1.0, profile.max_zoom)
    crop_height = float(
        np.clip(
            diameter_in_source_height / max(1e-6, profile.face_fill * shortest_output_edge),
            minimum_height,
            maximum_height,
        )
    )
    crop_width = target_aspect * crop_height / source_aspect
    unclamped_left = sample.center_norm[0] - profile.anchor[0] * crop_width
    unclamped_top = sample.center_norm[1] - profile.anchor[1] * crop_height
    clamped_left = float(np.clip(unclamped_left, 0, 1 - crop_width))
    clamped_top = float(np.clip(unclamped_top, 0, 1 - crop_height))
    if profile.edge_mode == "blur":
        safety_bbox = sample.raw_bbox_norm or sample.bbox_norm
        safety_left, safety_top, safety_right, safety_bottom = safety_bbox
        safety_width = max(1e-6, safety_right - safety_left)
        safety_height = max(1e-6, safety_bottom - safety_top)
        clipped_left, clipped_top, clipped_right, clipped_bottom = sample.source_clipped
        horizontal_weight = 1.0
        if unclamped_left < 0:
            horizontal_weight = _edge_padding_weight(
                clearance=safety_left,
                clipped=clipped_left,
                crop_size=crop_width,
                face_size=safety_width,
            )
        elif unclamped_left + crop_width > 1:
            horizontal_weight = _edge_padding_weight(
                clearance=1 - safety_right,
                clipped=clipped_right,
                crop_size=crop_width,
                face_size=safety_width,
            )

        vertical_weight = 1.0
        if unclamped_top < 0:
            vertical_weight = _edge_padding_weight(
                clearance=safety_top,
                clipped=clipped_top,
                crop_size=crop_height,
                face_size=safety_height,
            )
        elif unclamped_top + crop_height > 1:
            vertical_weight = _edge_padding_weight(
                clearance=1 - safety_bottom,
                clipped=clipped_bottom,
                crop_size=crop_height,
                face_size=safety_height,
            )

        left = float(clamped_left + (unclamped_left - clamped_left) * horizontal_weight)
        top = float(clamped_top + (unclamped_top - clamped_top) * vertical_weight)
    else:
        left = clamped_left
        top = clamped_top
    return CropRect(left=left, top=top, width=crop_width, height=crop_height)


def _average_crops(crops: Sequence[CropRect], weights: Sequence[float]) -> CropRect:
    normalized_weights = np.asarray(weights, dtype=float)
    normalized_weights /= max(1e-9, float(normalized_weights.sum()))
    center_x = sum(
        (crop.left + crop.width / 2) * weight
        for crop, weight in zip(crops, normalized_weights)
    )
    center_y = sum(
        (crop.top + crop.height / 2) * weight
        for crop, weight in zip(crops, normalized_weights)
    )
    width = float(
        np.exp(
            sum(
                np.log(max(1e-9, crop.width)) * weight
                for crop, weight in zip(crops, normalized_weights)
            )
        )
    )
    height = float(
        np.exp(
            sum(
                np.log(max(1e-9, crop.height)) * weight
                for crop, weight in zip(crops, normalized_weights)
            )
        )
    )
    return CropRect(
        left=float(center_x - width / 2),
        top=float(center_y - height / 2),
        width=width,
        height=height,
    )


def _interpolate_crop(left: CropRect, right: CropRect, progress: float) -> CropRect:
    eased = _smootherstep(progress)
    left_center = (left.left + left.width / 2, left.top + left.height / 2)
    right_center = (right.left + right.width / 2, right.top + right.height / 2)
    width = float(
        np.exp(
            np.log(max(1e-9, left.width))
            + (np.log(max(1e-9, right.width)) - np.log(max(1e-9, left.width))) * eased
        )
    )
    height = float(
        np.exp(
            np.log(max(1e-9, left.height))
            + (np.log(max(1e-9, right.height)) - np.log(max(1e-9, left.height))) * eased
        )
    )
    center_x = left_center[0] + (right_center[0] - left_center[0]) * eased
    center_y = left_center[1] + (right_center[1] - left_center[1]) * eased
    return CropRect(
        left=float(center_x - width / 2),
        top=float(center_y - height / 2),
        width=width,
        height=height,
    )


def resolve_motion_crop(
    samples: Sequence[FaceTrackSample],
    t_ms: float,
    source: SourceMetadata,
    profile: FramingProfile,
    *,
    tracking_elapsed_ms: float | None = None,
    recenter_duration_ms: float = 650.0,
    smoothing_window_ms: float = 720.0,
    smoothing_samples: int = 13,
) -> CropRect:
    """Resolve a smooth offline camera crop with a neutral-to-face entry move."""

    count = max(1, int(round(smoothing_samples)))
    offsets = np.linspace(-max(0.0, smoothing_window_ms) / 2, max(0.0, smoothing_window_ms) / 2, count)
    crops: list[CropRect] = []
    weights: list[float] = []
    for index, offset in enumerate(offsets):
        fraction = 0.5 if count == 1 else index / (count - 1)
        distance = abs(fraction - 0.5) * 2
        weights.append(1 + (1 - distance) * 3)
        crops.append(resolve_crop(interpolate_sample(samples, t_ms + float(offset)), source, profile))
    tracked = _average_crops(crops, weights)
    if tracking_elapsed_ms is None:
        return tracked
    neutral = resolve_crop(None, source, profile)
    return _interpolate_crop(
        neutral,
        tracked,
        max(0.0, tracking_elapsed_ms) / max(1.0, recenter_duration_ms),
    )


def _hex_bgr(value: str) -> tuple[int, int, int]:
    normalized = value.lstrip("#")
    if len(normalized) != 6:
        raise ValueError(f"Expected #RRGGBB background, got {value!r}")
    red, green, blue = (int(normalized[index : index + 2], 16) for index in (0, 2, 4))
    return blue, green, red


def _apply_circle(frame: np.ndarray, background: str) -> np.ndarray:
    height, width = frame.shape[:2]
    canvas = np.full_like(frame, _hex_bgr(background))
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.circle(
        mask,
        (width // 2, height // 2),
        max(1, min(width, height) // 2 - 2),
        255,
        thickness=-1,
        lineType=cv2.LINE_AA,
    )
    cv2.copyTo(frame, mask, canvas)
    return canvas


def _resize_cover(frame: np.ndarray, width: int, height: int) -> np.ndarray:
    frame_height, frame_width = frame.shape[:2]
    scale = max(width / frame_width, height / frame_height)
    resized_width = max(width, int(math.ceil(frame_width * scale)))
    resized_height = max(height, int(math.ceil(frame_height * scale)))
    resized = cv2.resize(frame, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
    left = (resized_width - width) // 2
    top = (resized_height - height) // 2
    return resized[top : top + height, left : left + width]


def _crop_with_blurred_padding(
    frame: np.ndarray,
    left: int,
    top: int,
    width: int,
    height: int,
) -> np.ndarray:
    """Pad an out-of-bounds crop without reflecting a second copy of the face."""

    frame_height, frame_width = frame.shape[:2]
    background = _resize_cover(frame, width, height)
    small_width = max(48, width // 10)
    small_height = max(48, height // 10)
    background = cv2.resize(background, (small_width, small_height), interpolation=cv2.INTER_AREA)
    background = cv2.GaussianBlur(background, (0, 0), sigmaX=4.0, sigmaY=4.0)
    background = cv2.resize(background, (width, height), interpolation=cv2.INTER_LINEAR)
    background = cv2.convertScaleAbs(background, alpha=0.85, beta=0)

    source_left = max(0, left)
    source_top = max(0, top)
    source_right = min(frame_width, left + width)
    source_bottom = min(frame_height, top + height)
    if source_right <= source_left or source_bottom <= source_top:
        return background

    destination_left = source_left - left
    destination_top = source_top - top
    destination_right = destination_left + (source_right - source_left)
    destination_bottom = destination_top + (source_bottom - source_top)
    foreground = background.copy()
    foreground[destination_top:destination_bottom, destination_left:destination_right] = frame[
        source_top:source_bottom, source_left:source_right
    ]
    alpha = np.zeros((height, width), dtype=np.float32)
    alpha[destination_top:destination_bottom, destination_left:destination_right] = 1.0
    feather = max(12, int(round(min(width, height) * 0.03)))
    if destination_left > 0:
        end = min(destination_right, destination_left + feather)
        alpha[destination_top:destination_bottom, destination_left:end] *= np.linspace(
            0.0, 1.0, end - destination_left, dtype=np.float32
        )[None, :]
    if destination_right < width:
        start = max(destination_left, destination_right - feather)
        alpha[destination_top:destination_bottom, start:destination_right] *= np.linspace(
            1.0, 0.0, destination_right - start, dtype=np.float32
        )[None, :]
    if destination_top > 0:
        end = min(destination_bottom, destination_top + feather)
        alpha[destination_top:end, destination_left:destination_right] *= np.linspace(
            0.0, 1.0, end - destination_top, dtype=np.float32
        )[:, None]
    if destination_bottom < height:
        start = max(destination_top, destination_bottom - feather)
        alpha[start:destination_bottom, destination_left:destination_right] *= np.linspace(
            1.0, 0.0, destination_bottom - start, dtype=np.float32
        )[:, None]
    alpha = alpha[..., None]
    return np.clip(foreground * alpha + background * (1.0 - alpha), 0, 255).astype(np.uint8)


def render_reframed_video(
    source: str | Path,
    manifest: FaceTrackManifest | str | Path,
    output: str | Path,
    *,
    profile: FramingProfile | str = "portrait",
    max_seconds: float | None = None,
    allow_source_mismatch: bool = False,
) -> Path:
    """Render a centered preview and preserve source audio through FFmpeg when available."""

    source_path = Path(source).expanduser().resolve()
    if isinstance(manifest, (str, Path)):
        manifest = FaceTrackManifest.read_json(manifest)
    if isinstance(profile, str):
        try:
            profile = FRAMING_PRESETS[profile]
        except KeyError as exc:
            raise ValueError(f"Unknown framing preset: {profile}") from exc
    if not allow_source_mismatch:
        validate_manifest_source(source_path, manifest.source)

    output_path = Path(output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"OpenCV could not open video: {source_path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if not np.isfinite(fps) or fps <= 0:
        fps = manifest.source.fps or 30.0

    with tempfile.TemporaryDirectory(prefix="mooncut-face-track-") as temp_dir:
        silent_path = Path(temp_dir) / "silent.mp4"
        writer = cv2.VideoWriter(
            str(silent_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (profile.width, profile.height),
        )
        if not writer.isOpened():
            capture.release()
            raise RuntimeError("OpenCV could not initialize the MP4 writer")

        frame_index = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            pts_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC))
            if not np.isfinite(pts_ms) or pts_ms < 0:
                pts_ms = (frame_index / fps) * 1000.0
            if max_seconds is not None and pts_ms >= max_seconds * 1000:
                break
            crop = resolve_motion_crop(
                manifest.samples,
                pts_ms,
                manifest.source,
                profile,
                tracking_elapsed_ms=pts_ms,
            )
            frame_height, frame_width = frame.shape[:2]
            left = int(round(crop.left * frame_width))
            top = int(round(crop.top * frame_height))
            width = max(1, int(round(crop.width * frame_width)))
            height = max(1, int(round(crop.height * frame_height)))
            if profile.edge_mode == "blur" and (
                left < 0 or top < 0 or left + width > frame_width or top + height > frame_height
            ):
                cropped = _crop_with_blurred_padding(frame, left, top, width, height)
            else:
                left = min(max(0, left), max(0, frame_width - width))
                top = min(max(0, top), max(0, frame_height - height))
                cropped = frame[top : top + height, left : left + width]
            resized = cv2.resize(
                cropped,
                (profile.width, profile.height),
                interpolation=cv2.INTER_LANCZOS4,
            )
            if profile.shape == "circle":
                resized = _apply_circle(resized, profile.background)
            writer.write(resized)
            frame_index += 1
        writer.release()
        capture.release()

        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            command = [
                ffmpeg,
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(silent_path),
                "-i",
                str(source_path),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0?",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-shortest",
                str(output_path),
            ]
            completed = subprocess.run(command, check=False, capture_output=True, text=True)
            if completed.returncode != 0:
                raise RuntimeError(f"FFmpeg failed to finalize output: {completed.stderr.strip()}")
        else:
            silent_path.replace(output_path)

    return output_path
