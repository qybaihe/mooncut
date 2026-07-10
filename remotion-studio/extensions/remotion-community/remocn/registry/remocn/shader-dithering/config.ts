import { type ComponentConfig, FPS, H, W } from "@/lib/customizer-config";

export const shaderDitheringConfig: ComponentConfig = {
  componentName: "ShaderDithering",
  importPath: "@/components/remocn/shader-dithering",
  controls: {
    speed: {
      type: "number",
      default: 1,
      min: 0.1,
      max: 4,
      step: 0.1,
      label: "Speed",
    },
    size: {
      type: "number",
      default: 2,
      min: 1,
      max: 8,
      step: 1,
      label: "Dot Size",
    },
    colorBack: { type: "color", default: "#12121a", label: "Background" },
    colorFront: { type: "color", default: "#6a6a85", label: "Front" },
  },
  durationInFrames: 150,
  fps: FPS,
  compositionWidth: W,
  compositionHeight: H,
};
