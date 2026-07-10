import { type ComponentConfig, FPS, H, W } from "@/lib/customizer-config";

export const shaderGrainGradientConfig: ComponentConfig = {
  componentName: "ShaderGrainGradient",
  importPath: "@/components/remocn/shader-grain-gradient",
  controls: {
    speed: {
      type: "number",
      default: 1,
      min: 0.1,
      max: 4,
      step: 0.1,
      label: "Speed",
    },
    softness: {
      type: "number",
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Softness",
    },
    intensity: {
      type: "number",
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Intensity",
    },
    noise: {
      type: "number",
      default: 0.15,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Noise",
    },
    colorBack: { type: "color", default: "#12121a", label: "Background" },
  },
  durationInFrames: 150,
  fps: FPS,
  compositionWidth: W,
  compositionHeight: H,
};
