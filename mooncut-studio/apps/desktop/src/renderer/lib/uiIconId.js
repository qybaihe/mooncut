/**
 * Shared monochrome UI icon ids and URL resolve (shipped helper).
 * Used by renderer composable and node:test — keep free of Vite-only APIs
 * except optional basePrefix passed by the caller.
 */

export const UI_ICON_IDS = Object.freeze([
  "library",
  "workbench",
  "settings",
  "plus",
  "refresh",
  "folder",
  "trash",
  "back",
  "camera",
  "upload",
  "download",
  "check",
  "sun",
  "moon",
  "diamond",
  "empty",
  "search",
  "sparkles",
  "media",
  "agent",
  "shield",
  "palette",
  "open",
  "harddrive",
  "chevron-right",
  "layers",
  "chat",
]);

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isUiIconId(value) {
  return UI_ICON_IDS.includes(value);
}

/**
 * Resolve public path for a UI icon SVG.
 * Unknown ids fall back to "sparkles" so missing names still render a glyph.
 *
 * @param {string} id
 * @param {string} [basePrefix="./"]
 * @returns {string}
 */
export function uiIconUrl(id, basePrefix = "./") {
  const base = basePrefix || "./";
  const name = isUiIconId(id) ? id : "sparkles";
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return `${normalized}ui-icons/${name}.svg`;
}
