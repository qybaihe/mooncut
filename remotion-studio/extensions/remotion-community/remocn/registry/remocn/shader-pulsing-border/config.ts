import { type ComponentConfig, FPS, H, W } from "@/lib/customizer-config";

export const shaderPulsingBorderConfig: ComponentConfig = {
  componentName: "ShaderPulsingBorder",
  importPath: "@/components/remocn/shader-pulsing-border",
  controls: {
    speed: {
      type: "number",
      default: 1,
      min: 0.1,
      max: 4,
      step: 0.1,
      label: "Speed",
    },
    thickness: {
      type: "number",
      default: 0.1,
      min: 0.02,
      max: 0.5,
      step: 0.02,
      label: "Thickness",
    },
    roundness: {
      type: "number",
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Roundness",
    },
    intensity: {
      type: "number",
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Intensity",
    },
    colorBack: { type: "color", default: "#12121a", label: "Background" },
  },
  durationInFrames: 150,
  fps: FPS,
  compositionWidth: W,
  compositionHeight: H,
};
