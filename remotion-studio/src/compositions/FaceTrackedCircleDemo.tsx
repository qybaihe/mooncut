import React from 'react';
import {AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {
  FaceTrackedVideo,
  type FaceFramingProfile,
  type FaceTrackManifest,
} from '../components/FaceTrackedVideo';

export type FaceTrackedCircleDemoProps = {
  talkingHeadSrc: string;
  faceTrack: FaceTrackManifest | null;
  sourceAspectRatio?: number;
};

const circleProfile: FaceFramingProfile = {
  aspectRatio: 1,
  faceFill: 0.68,
  anchor: [0.5, 0.49],
  shape: 'circle',
  maxZoom: 5,
  edgeMode: 'pad',
};

export const FaceTrackedCircleDemo: React.FC<FaceTrackedCircleDemoProps> = ({
  faceTrack,
  sourceAspectRatio = 9 / 16,
  talkingHeadSrc,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const sourceTimeMs = (frame / fps) * 1000;

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(circle at 50% 42%, rgba(92, 217, 180, 0.2), transparent 34%), #0b1110',
        color: '#f5f7f3',
        fontFamily: 'Arial, "PingFang SC", sans-serif',
      }}
    >
      <div
        style={{
          width: 620,
          height: 620,
          padding: 12,
          borderRadius: '50%',
          background: 'linear-gradient(145deg, #75dfc0, #f0c66d)',
          boxShadow: '0 38px 100px rgba(0, 0, 0, 0.48)',
        }}
      >
        <FaceTrackedVideo
          faceTrack={faceTrack}
          framing={circleProfile}
          sourceAspectRatio={sourceAspectRatio}
          sourceTimeMs={sourceTimeMs}
          src={staticFile(talkingHeadSrc)}
          style={{width: '100%', height: '100%'}}
          trackingElapsedMs={sourceTimeMs}
        />
      </div>
      <div style={{marginTop: 44, textAlign: 'center'}}>
        <div style={{fontSize: 22, fontWeight: 800, letterSpacing: 3, color: '#75dfc0'}}>
          MOONCUT · FACE TRACK
        </div>
        <div style={{fontSize: 38, fontWeight: 800, marginTop: 12}}>圆形头像始终跟住人脸</div>
        <div style={{fontSize: 20, marginTop: 10, color: 'rgba(245,247,243,.62)'}}>
          {faceTrack ? 'mooncut.face-track.v1 · 动态居中' : '未传跟踪数据 · 使用居中回退'}
        </div>
      </div>
    </AbsoluteFill>
  );
};
