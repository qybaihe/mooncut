import { type ComponentConfig, FPS, H, W } from "@/lib/customizer-config";

export const shaderWarpConfig: ComponentConfig = {
  componentName: "ShaderWarp",
  importPath: "@/components/remocn/shader-warp",
  controls: {
    speed: {
      type: "number",
      default: 1,
      min: 0.1,
      max: 4,
      step: 0.1,
      label: "Speed",
    },
    distortion: {
      type: "number",
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Distortion",
    },
    swirl: {
      type: "number",
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Swirl",
    },
    softness: {
      type: "number",
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Softness",
    },
    proportion: {
      type: "number",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Proportion",
    },
  },
  durationInFrames: 150,
  fps: FPS,
  compositionWidth: W,
  compositionHeight: H,
};
