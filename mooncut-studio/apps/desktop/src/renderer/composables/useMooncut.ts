/**
 * Safe access to the preload bridge. Surfaces a clear error if preload failed.
 */

import type {MooncutDesktopApi} from "../../preload/index";

export function getMooncut(): MooncutDesktopApi {
  const api = window.mooncut;
  if (!api) {
    throw new Error(
      "桌面桥接未就绪（window.mooncut 不可用）。请重新安装/打包应用，或运行 npm run dev。",
    );
  }
  return api;
}

export function hasMooncut(): boolean {
  return Boolean(window.mooncut);
}
