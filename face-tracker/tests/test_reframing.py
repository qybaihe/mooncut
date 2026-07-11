from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from face_tracker import (
    FRAMING_PRESETS,
    FaceTrackManifest,
    FaceTrackSample,
    SourceMetadata,
    interpolate_sample,
    resolve_crop,
    resolve_motion_crop,
    validate_manifest_source,
)
from face_tracker.face_tracker import FaceTracker
from face_tracker.reframing import (
    ReframeConfig,
    _DetectionFrame,
    _NormalizedFace,
    _dominant_track_id,
    _lock_subject,
    _smooth_zero_phase,
    _stabilize,
)


def make_face(
    track_id: int,
    *,
    center: tuple[float, float] = (0.5, 0.45),
    size: tuple[float, float] = (0.2, 0.2),
) -> _NormalizedFace:
    center_array = np.array(center, dtype=float)
    size_array = np.array(size, dtype=float)
    half = size_array / 2
    return _NormalizedFace(
        track_id=track_id,
        bbox=np.concatenate([center_array - half, center_array + half]),
        center=center_array,
        size=size_array,
        keypoints=(),
        confidence=0.9,
    )


def source_metadata() -> SourceMetadata:
    return SourceMetadata(
        name="fixture.mp4",
        width=1080,
        height=1920,
        display_width=1080,
        display_height=1920,
        rotation_deg=0,
        fps=30,
        duration_ms=1000,
        frame_count=30,
    )


def sample(
    t_ms: float,
    center: tuple[float, float] = (0.5, 0.5),
    size: tuple[float, float] = (0.2, 0.2),
    source_clipped: tuple[bool, bool, bool, bool] = (False, False, False, False),
    raw_bbox_norm: tuple[float, float, float, float] | None = None,
) -> FaceTrackSample:
    return FaceTrackSample(
        frame_idx=round(t_ms / 1000 * 30),
        t_ms=t_ms,
        track_id=1,
        bbox_norm=(
            center[0] - size[0] / 2,
            center[1] - size[1] / 2,
            center[0] + size[0] / 2,
            center[1] + size[1] / 2,
        ),
        center_norm=center,
        face_size_norm=size,
        keypoints_norm=(),
        confidence=0.9,
        state="detected",
        raw_bbox_norm=raw_bbox_norm,
        source_clipped=source_clipped,
    )


class ReframingTests(unittest.TestCase):
    def test_dominant_track_stays_locked_when_face_sizes_alternate(self) -> None:
        frames = []
        for index in range(10):
            speaker_size = (0.20, 0.20) if index % 2 == 0 else (0.19, 0.19)
            challenger_size = (0.19, 0.19) if index % 2 == 0 else (0.21, 0.21)
            frames.append(
                _DetectionFrame(
                    frame_idx=index,
                    t_ms=index * 66.0,
                    faces=[
                        make_face(1, center=(0.5, 0.44), size=speaker_size),
                        make_face(2, center=(0.82, 0.44), size=challenger_size),
                    ],
                )
            )

        dominant = _dominant_track_id(frames)
        selected, switches = _lock_subject(frames, dominant, continuity_threshold=0.58)

        self.assertEqual(dominant, 1)
        self.assertEqual([face.track_id for face in selected if face], [1] * 10)
        self.assertEqual(switches, 0)

    def test_short_dropout_is_interpolated_and_stabilized(self) -> None:
        frames = [
            _DetectionFrame(index, index * 100.0, [make_face(1, center=(0.4 + index * 0.02, 0.5))])
            for index in range(5)
        ]
        selected = [frames[0].faces[0], frames[1].faces[0], None, frames[3].faces[0], frames[4].faces[0]]

        samples = _stabilize(frames, selected, ReframeConfig(smoothing_ms=0, zoom_smoothing_ms=0))

        self.assertEqual(samples[2].state, "interpolated")
        self.assertAlmostEqual(samples[2].center_norm[0], 0.44, places=6)

    def test_short_dropout_does_not_switch_to_a_bystander(self) -> None:
        speaker = make_face(1, center=(0.5, 0.45), size=(0.2, 0.2))
        bystander = make_face(2, center=(0.51, 0.45), size=(0.21, 0.21))
        frames = [
            _DetectionFrame(0, 0, [speaker, bystander]),
            _DetectionFrame(1, 100, [bystander]),
            _DetectionFrame(2, 200, [bystander]),
            _DetectionFrame(3, 300, [bystander]),
            _DetectionFrame(4, 400, [speaker, bystander]),
        ]

        selected, switches = _lock_subject(frames, 1, continuity_threshold=0.58)

        self.assertEqual([face.track_id if face else None for face in selected], [1, None, None, None, 1])
        self.assertEqual(switches, 0)

    def test_switch_confirmation_requires_consecutive_observations(self) -> None:
        speaker = make_face(1)
        bystander = make_face(2, center=(0.51, 0.45))
        frames = [
            _DetectionFrame(0, 0, [speaker]),
            _DetectionFrame(1, 600, [bystander]),
            _DetectionFrame(2, 700, []),
            _DetectionFrame(3, 800, [bystander]),
            _DetectionFrame(4, 900, []),
            _DetectionFrame(5, 1000, [bystander]),
        ]

        selected, switches = _lock_subject(frames, 1, continuity_threshold=0.58)

        self.assertEqual([face.track_id if face else None for face in selected], [1, None, None, None, None, None])
        self.assertEqual(switches, 0)

    def test_long_dropout_stitches_opening_and_reacquired_track_ids(self) -> None:
        opening = make_face(1)
        reacquired = make_face(2, center=(0.505, 0.45))
        frames = [
            _DetectionFrame(0, 0, [opening]),
            _DetectionFrame(1, 100, [opening]),
            _DetectionFrame(2, 1000, []),
            _DetectionFrame(3, 2000, []),
            _DetectionFrame(4, 3000, []),
            _DetectionFrame(5, 4000, [reacquired]),
            _DetectionFrame(6, 4100, [reacquired]),
            _DetectionFrame(7, 4200, [reacquired]),
        ]

        selected, switches = _lock_subject(frames, 2, continuity_threshold=0.58)

        self.assertEqual(
            [face.track_id if face else None for face in selected],
            [1, 1, None, None, None, None, None, 2],
        )
        self.assertEqual(switches, 1)

    def test_zero_phase_smoothing_reduces_detector_jitter(self) -> None:
        times = np.arange(20, dtype=float) * 66.0
        values = np.array([[0.5 + (0.02 if index % 2 else -0.02), 0.45] for index in range(20)])

        smoothed = _smooth_zero_phase(values, times, 420.0)

        self.assertLess(float(np.std(smoothed[:, 0])), float(np.std(values[:, 0])) / 2)

    def test_stabilization_caps_lag_during_fast_detected_motion(self) -> None:
        raw_centers = [(0.2, 0.45), (0.8, 0.45), (0.2, 0.45), (0.8, 0.45)]
        frames = [
            _DetectionFrame(index, index * 66.0, [make_face(1, center=center)])
            for index, center in enumerate(raw_centers)
        ]
        selected = [frame.faces[0] for frame in frames]

        samples = _stabilize(
            frames,
            selected,
            ReframeConfig(smoothing_ms=2_000, zoom_smoothing_ms=0),
        )

        for item, raw in zip(samples, raw_centers):
            self.assertLessEqual(abs(item.center_norm[0] - raw[0]), 0.010001)

    def test_circle_crop_keeps_edge_face_at_requested_anchor(self) -> None:
        edge_sample = sample(0, center=(0.08, 0.5), size=(0.1, 0.1))
        profile = FRAMING_PRESETS["circle"]

        crop = resolve_crop(edge_sample, source_metadata(), profile)
        mapped_x = (edge_sample.center_norm[0] - crop.left) / crop.width
        mapped_y = (edge_sample.center_norm[1] - crop.top) / crop.height

        self.assertLess(crop.left, 0)
        self.assertAlmostEqual(mapped_x, profile.anchor[0], places=6)
        self.assertAlmostEqual(mapped_y, profile.anchor[1], places=6)
        self.assertAlmostEqual(
            crop.width * source_metadata().display_width,
            crop.height * source_metadata().display_height,
            places=4,
        )

    def test_circle_crop_clamps_when_source_already_clips_face(self) -> None:
        clipped = sample(
            0,
            center=(0.03, 0.5),
            size=(0.2, 0.2),
            source_clipped=(True, False, False, False),
        )
        crop = resolve_crop(clipped, source_metadata(), FRAMING_PRESETS["circle"])

        self.assertEqual(crop.left, 0)

    def test_edge_padding_safety_changes_crop_continuously(self) -> None:
        crops = []
        for index in range(101):
            right = 0.9 + index / 1000
            item = sample(
                index,
                center=(right - 0.18, 0.5),
                size=(0.36, 0.3),
                raw_bbox_norm=(right - 0.36, 0.32, right, 0.68),
            )
            crops.append(resolve_crop(item, source_metadata(), FRAMING_PRESETS["circle"]))

        largest_step = max(
            abs(current.left - previous.left)
            for previous, current in zip(crops, crops[1:])
        )
        self.assertLess(largest_step, 0.01)

    def test_motion_crop_eases_from_neutral_to_tracked_crop(self) -> None:
        samples = [
            sample(0, center=(0.76, 0.46), size=(0.24, 0.28)),
            sample(1000, center=(0.76, 0.46), size=(0.24, 0.28)),
        ]
        neutral = resolve_crop(None, source_metadata(), FRAMING_PRESETS["circle"])
        start = resolve_motion_crop(
            samples,
            500,
            source_metadata(),
            FRAMING_PRESETS["circle"],
            tracking_elapsed_ms=0,
        )
        middle = resolve_motion_crop(
            samples,
            500,
            source_metadata(),
            FRAMING_PRESETS["circle"],
            tracking_elapsed_ms=325,
        )
        settled = resolve_motion_crop(
            samples,
            500,
            source_metadata(),
            FRAMING_PRESETS["circle"],
            tracking_elapsed_ms=650,
        )

        self.assertEqual(start, neutral)
        self.assertGreater(middle.left, start.left)
        self.assertLess(middle.left, settled.left)
        self.assertLess(middle.width, start.width)
        self.assertGreater(middle.width, settled.width)

    def test_interpolation_uses_source_timestamps(self) -> None:
        resolved = interpolate_sample(
            [sample(0, center=(0.2, 0.4)), sample(1000, center=(0.8, 0.6))],
            250,
        )

        self.assertIsNotNone(resolved)
        assert resolved is not None
        self.assertAlmostEqual(resolved.center_norm[0], 0.35)
        self.assertAlmostEqual(resolved.center_norm[1], 0.45)

    def test_interpolation_blends_raw_bbox_without_midpoint_step(self) -> None:
        resolved = interpolate_sample(
            [
                sample(0, raw_bbox_norm=(0.1, 0.2, 0.3, 0.4)),
                sample(1000, raw_bbox_norm=(0.3, 0.4, 0.5, 0.6)),
            ],
            250,
        )

        self.assertIsNotNone(resolved)
        assert resolved is not None
        self.assertEqual(resolved.raw_bbox_norm, (0.15, 0.25, 0.35, 0.45))

    def test_interpolation_normalizes_unsorted_samples(self) -> None:
        resolved = interpolate_sample(
            [sample(1000, center=(0.8, 0.6)), sample(0, center=(0.2, 0.4))],
            250,
        )

        self.assertIsNotNone(resolved)
        assert resolved is not None
        self.assertAlmostEqual(resolved.center_norm[0], 0.35)

    def test_manifest_round_trip_is_remotion_compatible(self) -> None:
        manifest = FaceTrackManifest(
            source=source_metadata(),
            samples=[sample(0), sample(100)],
            primary_track_id=1,
            stats={"detection_coverage": 1.0},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            path = manifest.write_json(Path(temp_dir) / "track.json")
            raw = json.loads(path.read_text(encoding="utf-8"))
            restored = FaceTrackManifest.read_json(path)

        self.assertEqual(raw["schema_version"], "mooncut.face-track.v1")
        self.assertEqual(raw["samples"][0]["center_norm"], [0.5, 0.5])
        self.assertEqual(restored.primary_track_id, 1)
        self.assertEqual(len(restored.samples), 2)

    def test_landmark_anchor_uses_valid_keypoint_median(self) -> None:
        tracker = object.__new__(FaceTracker)
        tracker.keypoint_conf = 0.2
        anchor = tracker._facial_anchor(
            (100.0, 100.0),
            [
                [80.0, 80.0, 0.9],
                [120.0, 80.0, 0.9],
                [100.0, 100.0, 0.9],
                [85.0, 120.0, 0.9],
                [115.0, 120.0, 0.9],
            ],
        )
        self.assertEqual(anchor, (100.0, 100.0))

    def test_source_fingerprint_rejects_another_asset(self) -> None:
        metadata = source_metadata()
        metadata = SourceMetadata(
            **{**metadata.__dict__, "file_size": 99, "sha256": "deadbeef"}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "other.mp4"
            path.write_bytes(b"not-the-source")
            with self.assertRaisesRegex(ValueError, "source mismatch"):
                validate_manifest_source(path, metadata)


if __name__ == "__main__":
    unittest.main()
