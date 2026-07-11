/**
 * Resolve shared monochrome UI icons (public/ui-icons).
 * Pure resolve logic lives in ../lib/uiIconId.js (shipped + node-testable).
 */
import {isUiIconId, uiIconUrl as resolveUiIconUrl, UI_ICON_IDS} from "../lib/uiIconId.js";

export type UiIconId = (typeof UI_ICON_IDS)[number];

export {isUiIconId, UI_ICON_IDS};

export function uiIconUrl(id: UiIconId | string): string {
  const base = (import.meta.env.BASE_URL as string | undefined) || "./";
  return resolveUiIconUrl(id, base);
}
