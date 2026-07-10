# Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .solutions import BaseSolution, SolutionAnnotator, SolutionResults
from ultralytics.utils.plotting import colors


@dataclass
class FaceData:
    """Container for a tracked face in a single frame.

    Attributes:
        track_id (int): Unique tracking identifier, consistent across frames for the same person.
        bbox (list[float]): Bounding box coordinates [x1, y1, x2, y2] in pixel coordinates.
        conf (float): Detection confidence score (0.0 to 1.0).
        center (tuple[float, float]): Center point (cx, cy) of the bounding box.
        area (float): Area of the bounding box (width * height).
        is_new (bool): Whether this face appeared for the first time in this frame.
        cls (int): Class index of the detection.
    """

    track_id: int
    bbox: list[float]
    conf: float
    center: tuple[float, float]
    area: float
    is_new: bool = False
    cls: int = 0


@dataclass
class FaceTrackingResult(SolutionResults):
    """Extended result container for face tracking per frame.

    Attributes:
        faces (list[FaceData]): All tracked faces in the current frame.
        primary_face (FaceData | None): The primary face (largest area), typically the main speaker.
        frame_idx (int): Index of the current frame (0-based).
        lost_ids (list[int]): Track IDs that were present in previous frames but lost in this frame.
        track_states (dict[int, str]): Map of track_id to state ("new", "tracked", "lost", "removed").
        total_tracks (int): Total tracked faces in this frame.
        plot_im: Annotated frame image.
    """

    faces: list[FaceData] = field(default_factory=list)
    primary_face: FaceData | None = None
    frame_idx: int = -1
    lost_ids: list[int] = field(default_factory=list)
    track_states: dict[int, str] = field(default_factory=dict)
    total_tracks: int = 0
    plot_im: Any = None


class FaceTracker(BaseSolution):
    """Face detection and tracking for 口播 (spoken-word) video systems.

    Detects faces in video frames, assigns consistent track IDs across frames, and identifies the primary speaker's face
    (largest face in frame). Built on ultralytics tracking infrastructure (BoT-SORT / ByteTrack / TrackTrack).

    Attributes:
        primary_select (str): Strategy for primary face selection: "area" (default, largest face) or "conf"
            (highest confidence).
        min_face_area (int): Minimum face bounding box area in pixels to consider. Smaller detections are ignored.
        track_history (defaultdict): Per-track positional history for smoothing / interpolation.
        active_ids (set[int]): Set of track IDs currently visible.
        prev_ids (set[int]): Track IDs from the previous frame (used to detect lost tracks).
        track_state_map (dict[int, str]): Per-track lifecycle state.

    Methods:
        process: Process a single frame and return face tracking results.
        track_video: Process an entire video file or stream and yield per-frame results.
        set_primary_strategy: Switch between "area" and "conf" primary face selection.

    Examples:
        >>> from face_tracker import FaceTracker
        >>> tracker = FaceTracker(model="yolov8n-face.pt")
        >>>
        >>> # Per-frame processing
        >>> import cv2
        >>> cap = cv2.VideoCapture("video.mp4")
        >>> while cap.isOpened():
        ...     ret, frame = cap.read()
        ...     if not ret:
        ...         break
        ...     result = tracker.process(frame)
        ...     for face in result.faces:
        ...         print(f"ID={face.track_id} bbox={face.bbox} conf={face.conf:.2f}")
        ...     if result.primary_face:
        ...         print(f"Speaker: ID={result.primary_face.track_id}")
        >>>
        >>> # Full video processing (generator)
        >>> for result in tracker.track_video("video.mp4"):
        ...     print(
        ...         f"Frame {result.frame_idx}: {len(result.faces)} faces, "
        ...         f"primary={result.primary_face.track_id if result.primary_face else None}"
        ...     )
    """

    def __init__(self, **kwargs: Any) -> None:
        """Initialize the FaceTracker with face-specific configuration.

        Args:
            **kwargs (Any): Configuration keyword arguments. Inherits all BaseSolution / SolutionConfig args plus:
                - model (str): Path to YOLO face detection model. Use a face-specific model (e.g. "yolov8n-face.pt").
                  Falls back to "yolo26n.pt" with classes=[0] (person) if no face model is available.
                - primary_select (str): "area" (default) or "conf".
                - min_face_area (int): Minimum face area in pixels (default 1000).
                - tracker (str): Tracking config, e.g. "botsort.yaml" (default).
                - conf (float): Detection confidence threshold (default 0.25).
        """
        # Pop face-specific kwargs before they hit SolutionConfig validation
        self.primary_select = kwargs.pop("primary_select", "area")
        self.min_face_area = kwargs.pop("min_face_area", 1000)

        super().__init__(**kwargs)

        self.active_ids: set[int] = set()
        self.prev_ids: set[int] = set()
        self.track_state_map: dict[int, str] = {}
        self._frame_idx = -1
        self._face_class = self.CFG["face_class"]

        # Propagate face_class to BaseSolution's class filter so model.track only returns face detections
        if self._face_class is not None and self.CFG["classes"] is None:
            self.classes = self._face_class

    def _select_primary(self, faces: list[FaceData]) -> FaceData | None:
        """Select the primary face based on the configured strategy.

        Args:
            faces (list[FaceData]): List of detected faces.

        Returns:
            (FaceData | None): The selected primary face, or None if no faces are detected.
        """
        if not faces:
            return None
        if self.primary_select == "conf":
            return max(faces, key=lambda f: f.conf)
        return max(faces, key=lambda f: f.area)

    def _build_face_data(self, box, track_id: int, conf: float, cls: int) -> FaceData | None:
        """Build a FaceData object from raw tracking output, filtering invalid detections.

        Args:
            box: Bounding box tensor or array.
            track_id (int): Track identifier.
            conf (float): Confidence score.
            cls (int): Class index.

        Returns:
            (FaceData | None): FaceData if the detection passes filters, otherwise None.
        """
        box = box.tolist() if hasattr(box, "tolist") else list(box)
        x1, y1, x2, y2 = float(box[0]), float(box[1]), float(box[2]), float(box[3])
        w, h = x2 - x1, y2 - y1
        area = w * h

        if area < self.min_face_area:
            return None

        center = ((x1 + x2) / 2, (y1 + y2) / 2)
        return FaceData(
            track_id=track_id,
            bbox=[x1, y1, x2, y2],
            conf=float(conf),
            center=center,
            area=area,
            cls=int(cls),
        )

    def _update_track_states(self, current_ids: set[int]) -> None:
        """Update per-track lifecycle states based on presence in consecutive frames.

        Args:
            current_ids (set[int]): Track IDs present in the current frame.
        """
        prev_states = dict(self.track_state_map)

        for tid in current_ids - self.prev_ids:
            self.track_state_map[tid] = "new"

        for tid in current_ids & self.prev_ids:
            if self.track_state_map.get(tid) == "new":
                self.track_state_map[tid] = "tracked"
            elif tid not in self.track_state_map:
                self.track_state_map[tid] = "tracked"

        for tid in self.prev_ids - current_ids:
            self.track_state_map[tid] = "lost"

        for tid, state in prev_states.items():
            if tid not in current_ids and state == "lost":
                self.track_state_map[tid] = "removed"

    def process(self, im0: np.ndarray) -> FaceTrackingResult:
        """Process a single frame for face detection and tracking.

        Args:
            im0 (np.ndarray): The input image frame in BGR format.

        Returns:
            (FaceTrackingResult): Structured result containing all tracked faces, primary face selection, track states,
                and the annotated frame.
        """
        self._frame_idx += 1
        self.extract_tracks(im0)

        faces: list[FaceData] = []
        current_ids: set[int] = set()

        if self.track_data and self.track_data.is_track:
            for box, track_id, conf, cls in zip(self.boxes, self.track_ids, self.confs, self.clss):
                if self._face_class is not None and int(cls) not in self._face_class:
                    continue
                face = self._build_face_data(box, int(track_id), float(conf), int(cls))
                if face is None:
                    continue
                if int(track_id) not in self.prev_ids and int(track_id) not in current_ids:
                    face.is_new = True
                faces.append(face)
                current_ids.add(int(track_id))

        self._update_track_states(current_ids)
        lost_ids = sorted(self.prev_ids - current_ids)

        self.active_ids = current_ids
        self.prev_ids = current_ids

        primary = self._select_primary(faces)

        # Annotate the frame with bounding boxes and track IDs
        annotator = SolutionAnnotator(im0, self.line_width)
        for face in faces:
            color = colors(int(face.cls), True)
            if primary and face.track_id == primary.track_id:
                color = (0, 255, 0)  # Green for primary face
            annotator.box_label(face.bbox, label=f"ID:{face.track_id} {face.conf:.2f}", color=color)
        plot_im = annotator.result()

        self.display_output(plot_im)
        return FaceTrackingResult(
            plot_im=plot_im,
            faces=faces,
            primary_face=primary,
            frame_idx=self._frame_idx,
            lost_ids=lost_ids,
            track_states=dict(self.track_state_map),
            total_tracks=len(faces),
        )

    def track_video(self, source: str, stream: bool = True, **kwargs: Any):
        """Process an entire video file or stream, yielding per-frame FaceTrackingResult.

        This is a convenience wrapper that calls `model.track()` with optimized settings for face tracking, then
        converts raw ultralytics Results objects into FaceTrackingResult.

        Args:
            source (str): Path to video file, webcam index, or stream URL.
            stream (bool): Yield results as a generator (default True). Set to False to return all results as a list.
            **kwargs (Any): Additional arguments passed to `model.track()` (e.g. `imgsz`, `classes`, `conf`).

        Yields:
            (FaceTrackingResult): Per-frame face tracking results (when stream=True).

        Returns:
            (list[FaceTrackingResult]): All frame results as a list (when stream=False).
        """
        track_kwargs = {
            "persist": True,
            "verbose": self.CFG["verbose"],
            "tracker": self.CFG["tracker"],
            "conf": self.CFG["conf"],
            "iou": self.CFG["iou"],
            "imgsz": self.CFG["imgsz"],
            "device": self.CFG["device"],
            "max_det": self.CFG["max_det"],
        }
        if self._face_class is not None:
            track_kwargs["classes"] = self._face_class
        track_kwargs.update(kwargs)

        results = self.model.track(source=source, stream=stream, **track_kwargs)

        def convert_generator(raw_gen):
            for r in raw_gen:
                yield self._raw_to_result(r)

        if stream:
            return convert_generator(results)
        return [self._raw_to_result(r) for r in results]

    def _raw_to_result(self, r) -> FaceTrackingResult:
        """Convert a single ultralytics Results object to a FaceTrackingResult.

        Args:
            r: Raw ultralytics Results object from model.track().

        Returns:
            (FaceTrackingResult): Structured face tracking result.
        """
        faces = []
        current_ids: set[int] = set()
        if r.boxes is not None and r.boxes.is_track:
            boxes = r.boxes.xyxy.cpu().tolist()
            track_ids = r.boxes.id.int().cpu().tolist()
            confs = r.boxes.conf.cpu().tolist()
            classes = r.boxes.cls.int().cpu().tolist()
            for box, tid, conf, cls in zip(boxes, track_ids, confs, classes):
                if self._face_class is not None and int(cls) not in self._face_class:
                    continue
                face = self._build_face_data(box, int(tid), float(conf), int(cls))
                if face is None:
                    continue
                if int(tid) not in self.prev_ids and int(tid) not in current_ids:
                    face.is_new = True
                faces.append(face)
                current_ids.add(int(tid))

        self._update_track_states(current_ids)
        lost_ids = sorted(self.prev_ids - current_ids)
        self.prev_ids = current_ids
        self._frame_idx += 1

        primary = self._select_primary(faces)

        # Annotate if original image is available
        plot_im = None
        if hasattr(r, "orig_img") and r.orig_img is not None:
            annotator = SolutionAnnotator(r.orig_img.copy(), self.line_width)
            for face in faces:
                color = colors(int(face.cls), True)
                if primary and face.track_id == primary.track_id:
                    color = (0, 255, 0)
                annotator.box_label(face.bbox, label=f"ID:{face.track_id} {face.conf:.2f}", color=color)
            plot_im = annotator.result()

        return FaceTrackingResult(
            faces=faces,
            primary_face=primary,
            frame_idx=self._frame_idx,
            lost_ids=lost_ids,
            track_states=dict(self.track_state_map),
            total_tracks=len(faces),
            plot_im=plot_im,
        )

    def set_primary_strategy(self, strategy: str) -> None:
        """Set the primary face selection strategy.
        Args:
            strategy (str): "area" to select the largest face, or "conf" to select the highest-confidence face.
        """
        if strategy not in {"area", "conf"}:
            raise ValueError(f"Invalid strategy '{strategy}'. Use 'area' or 'conf'.")
        self.primary_select = strategy
