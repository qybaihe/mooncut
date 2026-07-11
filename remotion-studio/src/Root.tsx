import {Composition} from 'remotion';
import {assertFaceTrackManifest} from './components/FaceTrackedVideo';
import {TalkingHeadDemo} from './compositions/TalkingHeadDemo';
import {FaceTrackedCircleDemo} from './compositions/FaceTrackedCircleDemo';
import {ArgentinaEgyptAnalysis} from './compositions/ArgentinaEgyptAnalysis';
import {HorizontalLaunchVideo} from './compositions/HorizontalLaunchVideo';
import {
  MoonCutOutro,
  MOONCUT_OUTRO_DURATION_IN_FRAMES,
} from './compositions/MoonCutOutro';
import {
  AgentTalkingHeadVideo,
  DEFAULT_AGENT_EDIT_SPEC,
} from './compositions/AgentTalkingHeadVideo';
import {
  PerfectTalkingHeadVideo,
  type PerfectTalkingHeadSpec,
} from './compositions/PerfectTalkingHeadVideo';
import {CommunityMotionDemo} from './extensions/community-motion/CommunityMotionDemo';
import {ARGENTINA_EGYPT_DURATION_IN_FRAMES} from './argentina-egypt-timeline';
import {horizontalTimeline} from './horizontal-timeline';
import {DEFAULT_TALKING_HEAD_GENERATION_PRESET} from './presets/default-talking-head';
import talkingHeadFaceTrackData from './data/talking-head-face-track.json';
import perfectTalkingHeadFaceTrackData from './data/763e8d-face-track.json';
import perfectTalkingHeadSpecData from './data/763e8d-perfect-edit-spec.json';
import {demoTimeline} from './timeline';

const talkingHeadFaceTrack = assertFaceTrackManifest(talkingHeadFaceTrackData);
const perfectTalkingHeadFaceTrack = assertFaceTrackManifest(perfectTalkingHeadFaceTrackData);
// Keep legacy demo data from blocking unrelated compositions at bundle time.
// Its schema is validated by its own render workflow when that composition is selected.
const perfectTalkingHeadSpec = perfectTalkingHeadSpecData as unknown as PerfectTalkingHeadSpec;

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="TalkingHeadDemo"
        component={TalkingHeadDemo}
        durationInFrames={demoTimeline.durationInFrames}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          timeline: demoTimeline,
          talkingHeadSrc: 'media/talking-head.mp4',
          faceTrack: talkingHeadFaceTrack,
          sourceAspectRatio: 9 / 16,
          sourceSegments: [],
          bgmTrackId: 'demo-tech-house-vibes',
          bgmGainOffsetDb: 0,
        }}
      />
      <Composition
        id="TalkingHeadDemoGroove"
        component={TalkingHeadDemo}
        durationInFrames={demoTimeline.durationInFrames}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          timeline: demoTimeline,
          talkingHeadSrc: 'media/talking-head.mp4',
          faceTrack: talkingHeadFaceTrack,
          sourceAspectRatio: 9 / 16,
          sourceSegments: [],
          bgmTrackId: 'demo-gimme-that-groove',
          bgmGainOffsetDb: 0,
        }}
      />
      <Composition
        id="TalkingHeadDemoEmotional"
        component={TalkingHeadDemo}
        durationInFrames={demoTimeline.durationInFrames}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          timeline: demoTimeline,
          talkingHeadSrc: 'media/talking-head.mp4',
          faceTrack: talkingHeadFaceTrack,
          sourceAspectRatio: 9 / 16,
          sourceSegments: [],
          bgmTrackId: 'demo-well-be-okay',
          bgmGainOffsetDb: 0,
        }}
      />
      <Composition
        id="FaceTrackedCircleDemo"
        component={FaceTrackedCircleDemo}
        durationInFrames={demoTimeline.durationInFrames}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{
          talkingHeadSrc: 'media/talking-head.mp4',
          faceTrack: talkingHeadFaceTrack,
          sourceAspectRatio: 9 / 16,
        }}
      />
      <Composition
        id="HorizontalLaunchVideo"
        component={HorizontalLaunchVideo}
        durationInFrames={horizontalTimeline.durationInFrames}
        fps={horizontalTimeline.fps}
        width={1920}
        height={1080}
        defaultProps={{
          talkingHeadSrc: 'media/talking-head-horizontal.mp4',
          generationPreset: DEFAULT_TALKING_HEAD_GENERATION_PRESET,
        }}
      />
      <Composition
        id="HorizontalLaunchVideoEffectsLab"
        component={HorizontalLaunchVideo}
        durationInFrames={horizontalTimeline.durationInFrames}
        fps={horizontalTimeline.fps}
        width={1920}
        height={1080}
        defaultProps={{
          talkingHeadSrc: 'media/talking-head-horizontal.mp4',
          motionMode: 'effects-lab',
          generationPreset: DEFAULT_TALKING_HEAD_GENERATION_PRESET,
        }}
      />
      <Composition
        id="MoonCutOutro16x9"
        component={MoonCutOutro}
        durationInFrames={MOONCUT_OUTRO_DURATION_IN_FRAMES}
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{format: 'landscape'}}
      />
      <Composition
        id="MoonCutOutro9x16"
        component={MoonCutOutro}
        durationInFrames={MOONCUT_OUTRO_DURATION_IN_FRAMES}
        fps={24}
        width={1080}
        height={1920}
        defaultProps={{format: 'portrait'}}
      />
      <Composition
        id="MoonCutOutro1x1"
        component={MoonCutOutro}
        durationInFrames={MOONCUT_OUTRO_DURATION_IN_FRAMES}
        fps={24}
        width={1080}
        height={1080}
        defaultProps={{format: 'square'}}
      />
      <Composition
        id="ArgentinaEgyptAnalysis"
        component={ArgentinaEgyptAnalysis}
        durationInFrames={ARGENTINA_EGYPT_DURATION_IN_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="ArgentinaEgyptAnalysisV2"
        component={ArgentinaEgyptAnalysis}
        durationInFrames={ARGENTINA_EGYPT_DURATION_IN_FRAMES}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{version: 'official-highlights'}}
      />
      <Composition
        id="CommunityMotionDemo"
        component={CommunityMotionDemo}
        durationInFrames={372}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="AgentTalkingHeadVideo"
        component={AgentTalkingHeadVideo}
        durationInFrames={DEFAULT_AGENT_EDIT_SPEC.durationInFrames}
        fps={DEFAULT_AGENT_EDIT_SPEC.fps}
        width={DEFAULT_AGENT_EDIT_SPEC.width}
        height={DEFAULT_AGENT_EDIT_SPEC.height}
        defaultProps={{
          spec: DEFAULT_AGENT_EDIT_SPEC,
          faceTrack: null,
        }}
        calculateMetadata={({props}) => ({
          durationInFrames: props.spec.durationInFrames,
          fps: props.spec.fps,
          width: props.spec.width,
          height: props.spec.height,
        })}
      />
      <Composition
        id="PerfectTalkingHead763e8d"
        component={PerfectTalkingHeadVideo}
        durationInFrames={perfectTalkingHeadSpec.durationInFrames}
        fps={perfectTalkingHeadSpec.fps}
        width={perfectTalkingHeadSpec.width}
        height={perfectTalkingHeadSpec.height}
        defaultProps={{
          spec: perfectTalkingHeadSpec,
          faceTrack: perfectTalkingHeadFaceTrack,
        }}
        calculateMetadata={({props}) => ({
          durationInFrames: props.spec.durationInFrames,
          fps: props.spec.fps,
          width: props.spec.width,
          height: props.spec.height,
        })}
      />
      <Composition
        id="FinalTalkingHeadV2"
        component={PerfectTalkingHeadVideo}
        durationInFrames={perfectTalkingHeadSpec.durationInFrames}
        fps={perfectTalkingHeadSpec.fps}
        width={perfectTalkingHeadSpec.width}
        height={perfectTalkingHeadSpec.height}
        defaultProps={{
          spec: perfectTalkingHeadSpec,
          faceTrack: perfectTalkingHeadFaceTrack,
        }}
        calculateMetadata={({props}) => ({
          durationInFrames: props.spec.durationInFrames,
          fps: props.spec.fps,
          width: props.spec.width,
          height: props.spec.height,
        })}
      />
    </>
  );
};
