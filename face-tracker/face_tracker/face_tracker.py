# Ultralytics YOLO is licensed under AGPL-3.0 or an Ultralytics Enterprise license.

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

import cv2
import numpy as np
from ultralytics import YOLO
from ultralytics.utils.plotting import Annotator, colors


def default_model_path() -> Path:
    """Return the repository-bundled face model without depending on cwd."""

    return Path(__file__).resolve().parent / "weights" / "yolov8n-face.pt"


@dataclass
class FaceData:
    """One tracked face in pixel coordinates for a decoded frame."""

    track_id: int
    bbox: list[float]
    conf: float
    center: tuple[float, float]
    area: float
    is_new: bool = False
    cls: int = 0
    keypoints: list[list[float]] = field(default_factory=list)
    anchor: tuple[float, float] | None = None


@dataclass
class FaceTrackingResult:
    """Structured detector output for a single source-video timestamp."""

    faces: list[FaceData] = field(default_factory=list)
    primary_face: FaceData | None = None
    frame_idx: int = -1
    timestamp_ms: float | None = None
    frame_size: tuple[int, int] | None = None
    lost_ids: list[int] = field(default_factory=list)
    track_states: dict[int, str] = field(default_factory=dict)
    total_tracks: int = 0
    plot_im: np.ndarray | None = None
    speed: dict[str, float] = field(default_factory=dict)


class FaceTracker:
    """YOLO face detection and persistent tracking for spoken-word videos.

    This is deliberately a small wrapper around ``YOLO.track``. Selection,
    gap filling, stabilization, and crop planning live in ``reframing.py`` so
    the raw detector can remain useful to other consumers.
    """

    def __init__(
        self,
        model: str | Path | None = None,
        *,
        primary_select: str = "area",
        min_face_area: int = 1000,
        tracker: str = "botsort.yaml",
        conf: float = 0.25,
        iou: float = 0.5,
        imgsz: int = 640,
        device: str | None = None,
        max_det: int = 20,
        classes: list[int] | None = None,
        face_class: list[int] | None = None,
        show: bool = False,
        show_boxes: bool = True,
        show_labels: bool = True,
        show_conf: bool = True,
        line_width: int = 2,
        verbose: bool = False,
        track_retention_frames: int = 30,
        keypoint_conf: float = 0.2,
        **track_args: Any,
    ) -> None:
        if primary_select not in {"area", "conf"}:
            raise ValueError("primary_select must be 'area' or 'conf'")
        if min_face_area < 0:
            raise ValueError("min_face_area must be non-negative")

        resolved_model = Path(model).expanduser() if model is not None else default_model_path()
        if not resolved_model.exists():
            raise FileNotFoundError(
                f"Face model not found: {resolved_model}. "
                "Pass model=... explicitly or restore face_tracker/weights/yolov8n-face.pt."
            )

        self.model_path = resolved_model.resolve()
        self.model = YOLO(str(self.model_path))
        self.primary_select = primary_select
        self.min_face_area = min_face_area
        self.tracker = tracker
        self.conf = conf
        self.iou = iou
        self.imgsz = imgsz
        self.device = device
        self.max_det = max_det
        self.classes = face_class if face_class is not None else classes
        self.show = show
        self.show_boxes = show_boxes
        self.show_labels = show_labels
        self.show_conf = show_conf
        self.line_width = line_width
        self.verbose = verbose
        self.track_retention_frames = max(1, track_retention_frames)
        self.keypoint_conf = keypoint_conf
        self.track_args = dict(track_args)

        # Kept for compatibility with the originally contributed API.
        self.CFG = {
            "model": str(self.model_path),
            "tracker": tracker,
            "conf": conf,
            "iou": iou,
            "imgsz": imgsz,
            "device": device,
            "max_det": max_det,
            "classes": self.classes,
            "show": show,
            "show_boxes": show_boxes,
            "show_labels": show_labels,
            "show_conf": show_conf,
            "line_width": line_width,
            "verbose": verbose,
        }

        self.active_ids: set[int] = set()
        self.prev_ids: set[int] = set()
        self.track_state_map: dict[int, str] = {}
        self._missing_ages: dict[int, int] = {}
        self._frame_idx = -1

    def _track_kwargs(self, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "persist": True,
            "verbose": self.verbose,
            "tracker": self.tracker,
            "conf": self.conf,
            "iou": self.iou,
            "imgsz": self.imgsz,
            "max_det": self.max_det,
        }
        if self.device is not None:
            kwargs["device"] = self.device
        if self.classes is not None:
            kwargs["classes"] = self.classes
        kwargs.update(self.track_args)
        if overrides:
            kwargs.update(overrides)
        return kwargs

    def _select_primary(self, faces: list[FaceData]) -> FaceData | None:
        if not faces:
            return None
        key = (lambda face: face.conf) if self.primary_select == "conf" else (lambda face: face.area)
        return max(faces, key=key)

    def _facial_anchor(
        self,
        bbox_center: tuple[float, float],
        keypoints: list[list[float]],
    ) -> tuple[float, float]:
        valid = [point for point in keypoints if len(point) >= 3 and point[2] >= self.keypoint_conf]
        if len(valid) < 2:
            return bbox_center

        # The model exposes eyes, nose, and mouth corners. Their median is much
        # less sensitive to a single loose bbox edge than the raw bbox center.
        return (
            float(np.median([point[0] for point in valid])),
            float(np.median([point[1] for point in valid])),
        )

    def _build_face_data(
        self,
        box: Any,
        track_id: int,
        conf: float,
        cls: int,
        keypoints: list[list[float]] | None = None,
    ) -> FaceData | None:
        values = box.tolist() if hasattr(box, "tolist") else list(box)
        x1, y1, x2, y2 = (float(value) for value in values[:4])
        width, height = x2 - x1, y2 - y1
        area = width * height
        if width <= 0 or height <= 0 or area < self.min_face_area:
            return None

        center = ((x1 + x2) / 2, (y1 + y2) / 2)
        normalized_keypoints = [
            [float(point[0]), float(point[1]), float(point[2]) if len(point) > 2 else 1.0]
            for point in (keypoints or [])
        ]
        return FaceData(
            track_id=track_id,
            bbox=[x1, y1, x2, y2],
            conf=float(conf),
            center=center,
            area=area,
            cls=int(cls),
            keypoints=normalized_keypoints,
            anchor=self._facial_anchor(center, normalized_keypoints),
        )

    def _update_track_states(self, current_ids: set[int]) -> None:
        previously_known = set(self.track_state_map)

        for track_id in current_ids:
            was_visible = track_id in self.prev_ids
            was_known = track_id in previously_known and self.track_state_map.get(track_id) != "removed"
            self.track_state_map[track_id] = "tracked" if was_visible or was_known else "new"
            self._missing_ages[track_id] = 0

        for track_id in previously_known - current_ids:
            age = self._missing_ages.get(track_id, 0) + 1
            self._missing_ages[track_id] = age
            if age <= self.track_retention_frames:
                self.track_state_map[track_id] = "lost"
            elif age == self.track_retention_frames + 1:
                self.track_state_map[track_id] = "removed"
            else:
                self.track_state_map.pop(track_id, None)
                self._missing_ages.pop(track_id, None)

    @staticmethod
    def _result_keypoints(raw_result: Any) -> list[list[list[float]]]:
        keypoints = getattr(raw_result, "keypoints", None)
        data = getattr(keypoints, "data", None)
        if data is None:
            return []
        return data.detach().cpu().tolist()

    def _raw_to_result(
        self,
        raw_result: Any,
        *,
        timestamp_ms: float | None = None,
    ) -> FaceTrackingResult:
        self._frame_idx += 1
        faces: list[FaceData] = []
        current_ids: set[int] = set()
        boxes = getattr(raw_result, "boxes", None)
        all_keypoints = self._result_keypoints(raw_result)

        if boxes is not None and len(boxes) > 0:
            xyxy = boxes.xyxy.detach().cpu().tolist()
            confidences = boxes.conf.detach().cpu().tolist()
            class_ids = boxes.cls.int().detach().cpu().tolist()
            if boxes.id is not None:
                track_ids = boxes.id.int().detach().cpu().tolist()
            else:
                # Detection-only fallback. Negative IDs cannot collide with
                # normal tracker IDs and are intentionally treated as unstable.
                track_ids = [-(index + 1) for index in range(len(xyxy))]

            for index, (box, track_id, confidence, class_id) in enumerate(
                zip(xyxy, track_ids, confidences, class_ids)
            ):
                if self.classes is not None and int(class_id) not in self.classes:
                    continue
                face = self._build_face_data(
                    box,
                    int(track_id),
                    float(confidence),
                    int(class_id),
                    all_keypoints[index] if index < len(all_keypoints) else None,
                )
                if face is None:
                    continue
                face.is_new = face.track_id not in self.prev_ids
                faces.append(face)
                current_ids.add(face.track_id)

        lost_ids = sorted(self.prev_ids - current_ids)
        self._update_track_states(current_ids)
        self.active_ids = current_ids
        self.prev_ids = current_ids
        primary = self._select_primary(faces)

        original = getattr(raw_result, "orig_img", None)
        plot_im = original.copy() if original is not None else None
        if plot_im is not None and self.show_boxes:
            annotator = Annotator(plot_im, line_width=self.line_width)
            for face in faces:
                color = (0, 255, 0) if primary and face.track_id == primary.track_id else colors(face.cls, True)
                label: str | None = None
                if self.show_labels:
                    label = f"ID:{face.track_id}"
                    if self.show_conf:
                        label += f" {face.conf:.2f}"
                annotator.box_label(face.bbox, label=label, color=color)
            plot_im = annotator.result()

        if self.show and plot_im is not None:
            cv2.imshow("MoonCut Face Tracker", plot_im)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                cv2.destroyWindow("MoonCut Face Tracker")

        height, width = original.shape[:2] if original is not None else (0, 0)
        return FaceTrackingResult(
            faces=faces,
            primary_face=primary,
            frame_idx=self._frame_idx,
            timestamp_ms=timestamp_ms,
            frame_size=(width, height) if width and height else None,
            lost_ids=lost_ids,
            track_states=dict(self.track_state_map),
            total_tracks=len(faces),
            plot_im=plot_im,
            speed=dict(getattr(raw_result, "speed", {}) or {}),
        )

    def process(
        self,
        im0: np.ndarray,
        *,
        timestamp_ms: float | None = None,
        **track_overrides: Any,
    ) -> FaceTrackingResult:
        """Track faces in one BGR frame without modifying the caller's frame."""

        if not isinstance(im0, np.ndarray) or im0.ndim != 3:
            raise ValueError("im0 must be a BGR image shaped (height, width, channels)")
        raw_result = self.model.track(source=im0, **self._track_kwargs(track_overrides))[0]
        return self._raw_to_result(raw_result, timestamp_ms=timestamp_ms)

    __call__ = process

    def track_video(
        self,
        source: str | Path,
        stream: bool = True,
        *,
        reset: bool = True,
        **kwargs: Any,
    ) -> Iterator[FaceTrackingResult] | list[FaceTrackingResult]:
        """Track an entire file or stream and preserve source timestamps."""

        if reset:
            self.reset()

        source_value = str(source)
        capture = cv2.VideoCapture(source_value)
        if not capture.isOpened():
            raise RuntimeError(f"OpenCV could not open video: {source_value}")
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        if not np.isfinite(fps) or fps <= 0:
            fps = 30.0

        def convert() -> Iterator[FaceTrackingResult]:
            frame_index = 0
            try:
                while True:
                    ok, frame = capture.read()
                    if not ok:
                        break
                    timestamp_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC))
                    if not np.isfinite(timestamp_ms) or timestamp_ms < 0:
                        timestamp_ms = (frame_index / fps) * 1000.0
                    yield self.process(frame, timestamp_ms=timestamp_ms, **kwargs)
                    frame_index += 1
            finally:
                capture.release()

        if stream:
            return convert()
        return list(convert())

    def set_primary_strategy(self, strategy: str) -> None:
        if strategy not in {"area", "conf"}:
            raise ValueError(f"Invalid strategy '{strategy}'. Use 'area' or 'conf'.")
        self.primary_select = strategy

    def reset(self) -> None:
        """Clear MoonCut and Ultralytics tracker state before a new source/cut."""

        self.active_ids.clear()
        self.prev_ids.clear()
        self.track_state_map.clear()
        self._missing_ages.clear()
        self._frame_idx = -1

        predictor = getattr(self.model, "predictor", None)
        trackers = getattr(predictor, "trackers", None)
        reset_succeeded = False
        if trackers:
            for tracker in trackers:
                reset_method = getattr(tracker, "reset", None)
                if callable(reset_method):
                    reset_method()
                    reset_succeeded = True
        if predictor is not None and not reset_succeeded:
            # Rebuilding the predictor is slower, but guarantees no ID leakage
            # for tracker versions that do not expose reset().
            self.model.predictor = None
