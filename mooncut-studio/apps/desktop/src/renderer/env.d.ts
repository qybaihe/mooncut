/// <reference types="vite/client" />

import type {MooncutDesktopApi} from "../preload/index";

declare global {
  interface Window {
    mooncut?: MooncutDesktopApi;
  }
}

export {};
