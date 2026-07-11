import { common } from '@kit.AbilityKit';
import { settings } from '@kit.BasicServicesKit';

export function motionScalesRequestReduced(animator: string, transition: string, windowScale: string): boolean {
  return Number(animator) === 0 || Number(transition) === 0 || Number(windowScale) === 0;
}

/** Mirrors iOS accessibilityReduceMotion using HarmonyOS system animation scales. */
export class SystemMotionPreference {
  static isReduced(context: common.UIAbilityContext): boolean {
    const animator = settings.getValueSync(context, settings.display.ANIMATOR_DURATION_SCALE, '1');
    const transition = settings.getValueSync(context, settings.display.TRANSITION_ANIMATION_SCALE, '1');
    const windowScale = settings.getValueSync(context, settings.display.WINDOW_ANIMATION_SCALE, '1');
    return motionScalesRequestReduced(animator, transition, windowScale);
  }
}
