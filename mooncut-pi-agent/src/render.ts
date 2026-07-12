import {join} from "node:path";
import {config, remotionRoot} from "./config.ts";

export type RemotionRenderOptions = {
  entry?: string;
  composition: string;
  outputPath: string;
  propsPath?: string;
  /** Inclusive frame range e.g. "0-29" for smoke tests. */
  frames?: string;
  concurrency?: number;
  gl?: typeof config.renderGl;
  browserExecutable?: string;
  codec?: string;
  crf?: number;
  overwrite?: boolean;
};

/**
 * Shared Remotion CLI args for every agent path (reliable / pi / grok / codex / CLI tool).
 * Chromium compositing and VideoToolbox encoding are controlled only here so
 * every production export follows the same verified acceleration contract.
 */
export const buildRemotionRenderArgs = (options: RemotionRenderOptions): string[] => {
  const concurrency = Math.max(1, options.concurrency ?? config.renderConcurrency);
  const gl = options.gl === undefined ? config.renderGl : options.gl;
  const codec = options.codec ?? "h264";
  const args = [
    "render",
    options.entry ?? "src/index.ts",
    options.composition,
    options.outputPath,
    `--codec=${codec}`,
    `--concurrency=${concurrency}`,
  ];
  if (options.propsPath) args.push(`--props=${options.propsPath}`);
  if (options.frames) args.push(`--frames=${options.frames}`);
  if (typeof options.crf === "number") args.push(`--crf=${options.crf}`);
  if (gl) args.push(`--gl=${gl}`);
  // Remotion defaults hardware acceleration to "disable" even on Apple
  // Silicon. Require it for the standard H.264/H.265/ProRes path so an
  // unavailable VideoToolbox encoder fails visibly instead of silently falling
  // back to libx264. CRF is incompatible with Remotion's hardware encoders;
  // explicit CRF renders intentionally preserve their software quality path.
  const supportsHardwareEncoding = codec === "h264" || codec === "h265" || codec === "prores";
  if (config.renderHardwareAcceleration && supportsHardwareEncoding && options.crf === undefined) {
    args.push("--hardware-acceleration=required");
  }
  const browser = options.browserExecutable ?? config.browserExecutable;
  if (browser) args.push(`--browser-executable=${browser}`);
  if (options.overwrite !== false) args.push("--overwrite");
  return args;
};

export const remotionCliPath = () => join(remotionRoot, "node_modules/.bin/remotion");

export const describeRenderGpuConfig = () => ({
  platform: process.platform,
  gl: config.renderGl,
  concurrency: config.renderConcurrency,
  hardwareAcceleration: config.renderHardwareAcceleration,
  hardwareAccelerationMode: config.renderHardwareAcceleration ? "required" : "disable",
  remotionRoot,
});
