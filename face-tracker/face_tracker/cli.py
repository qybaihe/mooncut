from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

from .face_tracker import FaceTracker
from .reframing import (
    FRAMING_PRESETS,
    FaceTrackManifest,
    FramingProfile,
    ReframeConfig,
    analyze_video,
    render_reframed_video,
)


def _size(value: str) -> tuple[int, int]:
    try:
        width, height = value.lower().split("x", maxsplit=1)
        parsed = int(width), int(height)
    except (ValueError, AttributeError) as exc:
        raise argparse.ArgumentTypeError("size must look like 1080x1920") from exc
    if parsed[0] <= 0 or parsed[1] <= 0:
        raise argparse.ArgumentTypeError("size dimensions must be positive")
    return parsed


def _add_detector_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--model", type=Path, help="YOLO face model; defaults to bundled weights")
    parser.add_argument("--device", default="auto", help="auto, cpu, mps, or CUDA device such as 0")
    parser.add_argument("--sample-fps", type=float, default=15.0, help="detector sampling rate")
    parser.add_argument("--conf", type=float, default=0.3, help="minimum detection confidence")
    parser.add_argument("--iou", type=float, default=0.5, help="tracking IoU threshold")
    parser.add_argument("--imgsz", type=int, default=640, help="YOLO inference image size")
    parser.add_argument("--smoothing-ms", type=float, default=420.0)
    parser.add_argument("--zoom-smoothing-ms", type=float, default=700.0)
    parser.add_argument("--preferred-track-id", type=int)


def _add_render_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--preset",
        choices=sorted(FRAMING_PRESETS),
        default="portrait",
        help="output framing preset",
    )
    parser.add_argument("--size", type=_size, help="override output size, e.g. 720x720")
    parser.add_argument("--face-fill", type=float, help="face fraction of output's shortest edge")
    parser.add_argument("--anchor-x", type=float, help="desired normalized horizontal face position")
    parser.add_argument("--anchor-y", type=float, help="desired normalized vertical face position")
    parser.add_argument("--background", default=None, help="circle background in #RRGGBB format")
    parser.add_argument("--max-seconds", type=float, help="render only the beginning for a quick preview")
    parser.add_argument(
        "--allow-source-mismatch",
        action="store_true",
        help="render even if the track fingerprint belongs to another input",
    )


def _config(args: argparse.Namespace) -> ReframeConfig:
    return ReframeConfig(
        sample_fps=args.sample_fps,
        smoothing_ms=args.smoothing_ms,
        zoom_smoothing_ms=args.zoom_smoothing_ms,
        preferred_track_id=args.preferred_track_id,
        detector_conf=args.conf,
        detector_iou=args.iou,
        detector_imgsz=args.imgsz,
        device=args.device,
    )


def _tracker(args: argparse.Namespace, config: ReframeConfig) -> FaceTracker:
    device = None if config.device == "auto" else config.device
    if config.device == "auto":
        try:
            import torch

            if torch.backends.mps.is_available():
                device = "mps"
            elif torch.cuda.is_available():
                device = "0"
        except Exception:
            pass
    return FaceTracker(
        model=args.model,
        device=device,
        conf=config.detector_conf,
        iou=config.detector_iou,
        imgsz=config.detector_imgsz,
        max_det=config.detector_max_det,
        show=False,
        show_boxes=False,
        verbose=False,
    )


def _profile(args: argparse.Namespace) -> FramingProfile:
    profile = FRAMING_PRESETS[args.preset]
    width, height = args.size or (profile.width, profile.height)
    anchor = (
        args.anchor_x if args.anchor_x is not None else profile.anchor[0],
        args.anchor_y if args.anchor_y is not None else profile.anchor[1],
    )
    return replace(
        profile,
        width=width,
        height=height,
        face_fill=args.face_fill if args.face_fill is not None else profile.face_fill,
        anchor=anchor,
        background=args.background or profile.background,
    )


def _progress(done: int, total: int) -> None:
    if total > 0:
        print(f"\r分析进度 {min(100, done * 100 // total):3d}%", end="", file=sys.stderr)
    else:
        print(f"\r已解码 {done} 帧", end="", file=sys.stderr)


def _analyze(args: argparse.Namespace) -> FaceTrackManifest:
    config = _config(args)
    tracker = _tracker(args, config)
    manifest = analyze_video(args.input, tracker=tracker, config=config, progress=_progress)
    print(file=sys.stderr)
    manifest.write_json(args.output if args.command == "analyze" else args.track_output)
    return manifest


def _summary(manifest: FaceTrackManifest, **extra: object) -> None:
    print(
        json.dumps(
            {
                "schema_version": manifest.schema_version,
                "primary_track_id": manifest.primary_track_id,
                **manifest.stats,
                **extra,
            },
            ensure_ascii=False,
        )
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mooncut-face-track",
        description="Stable YOLO face tracking and reframing for MoonCut talking-head videos",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze_parser = subparsers.add_parser("analyze", help="analyze video and write track JSON")
    analyze_parser.add_argument("input", type=Path)
    analyze_parser.add_argument("--output", type=Path, required=True)
    _add_detector_options(analyze_parser)

    render_parser = subparsers.add_parser("render", help="render from an existing track JSON")
    render_parser.add_argument("input", type=Path)
    render_parser.add_argument("--track", type=Path, required=True)
    render_parser.add_argument("--output", type=Path, required=True)
    _add_render_options(render_parser)

    run_parser = subparsers.add_parser("run", help="analyze and render in one command")
    run_parser.add_argument("input", type=Path)
    run_parser.add_argument("--track-output", type=Path, required=True)
    run_parser.add_argument("--output", type=Path, required=True)
    _add_detector_options(run_parser)
    _add_render_options(run_parser)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "analyze":
            manifest = _analyze(args)
            _summary(manifest, track=str(args.output.resolve()))
            return 0

        if args.command == "render":
            manifest = FaceTrackManifest.read_json(args.track)
            output = render_reframed_video(
                args.input,
                manifest,
                args.output,
                profile=_profile(args),
                max_seconds=args.max_seconds,
                allow_source_mismatch=args.allow_source_mismatch,
            )
            _summary(manifest, output=str(output))
            return 0

        manifest = _analyze(args)
        output = render_reframed_video(
            args.input,
            manifest,
            args.output,
            profile=_profile(args),
            max_seconds=args.max_seconds,
            allow_source_mismatch=args.allow_source_mismatch,
        )
        _summary(
            manifest,
            track=str(args.track_output.resolve()),
            output=str(output),
        )
        return 0
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
