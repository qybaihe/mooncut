import {Composition} from 'remotion';
import {TalkingHeadDemo} from './compositions/TalkingHeadDemo';
import {ArgentinaEgyptAnalysis} from './compositions/ArgentinaEgyptAnalysis';
import {HorizontalLaunchVideo} from './compositions/HorizontalLaunchVideo';
import {CommunityMotionDemo} from './extensions/community-motion/CommunityMotionDemo';
import {ARGENTINA_EGYPT_DURATION_IN_FRAMES} from './argentina-egypt-timeline';
import {horizontalTimeline} from './horizontal-timeline';
import {demoTimeline} from './timeline';

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
        defaultProps={{timeline: demoTimeline, talkingHeadSrc: 'media/talking-head.mp4'}}
      />
      <Composition
        id="HorizontalLaunchVideo"
        component={HorizontalLaunchVideo}
        durationInFrames={horizontalTimeline.durationInFrames}
        fps={horizontalTimeline.fps}
        width={1920}
        height={1080}
        defaultProps={{talkingHeadSrc: 'media/talking-head-horizontal.mp4'}}
      />
      <Composition
        id="HorizontalLaunchVideoEffectsLab"
        component={HorizontalLaunchVideo}
        durationInFrames={horizontalTimeline.durationInFrames}
        fps={horizontalTimeline.fps}
        width={1920}
        height={1080}
        defaultProps={{talkingHeadSrc: 'media/talking-head-horizontal.mp4', motionMode: 'effects-lab'}}
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
    </>
  );
};
