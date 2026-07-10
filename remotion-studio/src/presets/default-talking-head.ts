import type {MacWindowTone} from '../extensions/community-motion/MacDesktop';

export type DesktopTalkingHeadVisual =
  | 'event'
  | 'release'
  | 'design'
  | 'pipeline'
  | 'editor'
  | 'beta';

/**
 * The visual contract for our default generated talking-head videos.
 *
 * It deliberately distinguishes desktop-shaped scenes from real footage,
 * phones, posters, and full-screen emphasis. This keeps generated videos from
 * mechanically putting every asset inside a fake operating-system window.
 */
export type TalkingHeadGenerationPreset = {
  id: string;
  label: string;
  version: 1;
  desktop: {
    applicationName: string;
    shade: number;
    showDock: boolean;
    showMenuBar: boolean;
  };
  windows: {
    appTone: MacWindowTone;
    browserTone: MacWindowTone;
    cameraTone: MacWindowTone;
    utilityTone: MacWindowTone;
  };
  rules: {
    desktopScenes: readonly DesktopTalkingHeadVisual[];
    keepUnframed: readonly ['phone', 'poster', 'real-footage', 'fullscreen-impact'];
  };
};

export const DEFAULT_TALKING_HEAD_GENERATION_PRESET: TalkingHeadGenerationPreset = {
  id: 'macos-sonoma-native',
  label: 'Sonoma Desktop · Native Apps',
  version: 1,
  desktop: {
    applicationName: 'Mooncut',
    shade: 0.4,
    showDock: false,
    showMenuBar: true,
  },
  windows: {
    appTone: 'dark',
    browserTone: 'light',
    cameraTone: 'dark',
    utilityTone: 'dark',
  },
  rules: {
    desktopScenes: ['event', 'release', 'design', 'pipeline', 'editor', 'beta'],
    keepUnframed: ['phone', 'poster', 'real-footage', 'fullscreen-impact'],
  },
};
