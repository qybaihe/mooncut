import { type ComponentConfig, FPS, H, W } from "@/lib/customizer-config";

export const shaderMeshGradientConfig: ComponentConfig = {
  componentName: "ShaderMeshGradient",
  importPath: "@/components/remocn/shader-mesh-gradient",
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
      default: 0.6,
      min: 0,
      max: 1.5,
      step: 0.05,
      label: "Distortion",
    },
    swirl: {
      type: "number",
      default: 0.1,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Swirl",
    },
  },
  durationInFrames: 150,
  fps: FPS,
  compositionWidth: W,
  compositionHeight: H,
};
