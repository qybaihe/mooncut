import assert from 'node:assert/strict';
import test from 'node:test';
import {
  centeredCoverCrop,
  resolveFaceCrop,
  resolveFaceCropMotion,
  type FaceFramingProfile,
  type FaceTrackSample,
  type InterpolatedFaceSample,
} from '../src/components/faceCropMotion.ts';

const circle: FaceFramingProfile = {
  aspectRatio: 1,
  faceFill: 0.68,
  anchor: [0.5, 0.45],
  shape: 'circle',
  maxZoom: 4,
  edgeMode: 'pad',
};

test('edge safety changes crop continuously instead of toggling clamp/pad', () => {
  const crops = Array.from({length: 101}, (_, index) => {
    const right = 0.9 + index / 1000;
    const face: InterpolatedFaceSample = {
      center_norm: [right - 0.18, 0.5],
      face_size_norm: [0.36, 0.3],
      raw_bbox_norm: [right - 0.36, 0.32, right, 0.68],
      source_clipped: {left: false, top: false, right: false, bottom: false},
    };
    return resolveFaceCrop({face, framing: circle, sourceAspectRatio: 9 / 16});
  });
  const largestStep = Math.max(...crops.slice(1).map((crop, index) =>
    Math.abs(crop.left - crops[index].left),
  ));
  assert.ok(largestStep < 0.01, `largest crop step was ${largestStep}`);
});

test('tracked circle eases from neutral crop and settles without a first-frame jump', () => {
  const samples: FaceTrackSample[] = [
    {
      t_ms: 0,
      center_norm: [0.76, 0.46],
      face_size_norm: [0.24, 0.28],
      raw_bbox_norm: [0.64, 0.32, 0.88, 0.6],
    },
    {
      t_ms: 1000,
      center_norm: [0.76, 0.46],
      face_size_norm: [0.24, 0.28],
      raw_bbox_norm: [0.64, 0.32, 0.88, 0.6],
    },
  ];
  const neutral = centeredCoverCrop(16 / 9, 1);
  const start = resolveFaceCropMotion({
    framing: circle,
    samples,
    sourceAspectRatio: 16 / 9,
    sourceTimeMs: 500,
    trackingElapsedMs: 0,
  });
  const middle = resolveFaceCropMotion({
    framing: circle,
    samples,
    sourceAspectRatio: 16 / 9,
    sourceTimeMs: 500,
    trackingElapsedMs: 325,
  });
  const settled = resolveFaceCropMotion({
    framing: circle,
    samples,
    sourceAspectRatio: 16 / 9,
    sourceTimeMs: 500,
    trackingElapsedMs: 650,
  });
  assert.deepEqual(start, neutral);
  assert.ok(middle.left > start.left && middle.left < settled.left);
  assert.ok(middle.width < start.width && middle.width > settled.width);
});

test('offline crop motion spreads a tracker discontinuity over multiple frames', () => {
  const samples: FaceTrackSample[] = [
    {t_ms: 0, center_norm: [0.24, 0.48], face_size_norm: [0.22, 0.26]},
    {t_ms: 450, center_norm: [0.24, 0.48], face_size_norm: [0.22, 0.26]},
    {t_ms: 550, center_norm: [0.76, 0.48], face_size_norm: [0.22, 0.26]},
    {t_ms: 1000, center_norm: [0.76, 0.48], face_size_norm: [0.22, 0.26]},
  ];
  const crops = Array.from({length: 31}, (_, index) => resolveFaceCropMotion({
    framing: circle,
    samples,
    sourceAspectRatio: 16 / 9,
    sourceTimeMs: index * (1000 / 30),
  }));
  const largestStep = Math.max(...crops.slice(1).map((crop, index) =>
    Math.abs(crop.left - crops[index].left),
  ));
  assert.ok(largestStep < 0.04, `largest smoothed step was ${largestStep}`);
});
