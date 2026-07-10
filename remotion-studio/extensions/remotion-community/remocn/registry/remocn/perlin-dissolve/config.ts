import { perlinDissolveExampleCode } from "@/components/docs/examples/perlin-dissolve-example";
import { type ComponentConfig, FPS, H, W } from "@/lib/customizer-config";

export const perlinDissolveConfig: ComponentConfig = {
  componentName: "perlinDissolve",
  importPath: "@/components/remocn/perlin-dissolve",
  controls: {
    colorFront: { type: "color", default: "#8f88ae", label: "Ink" },
    colorBack: { type: "color", default: "#141318", label: "Background" },
    softness: {
      type: "number",
      default: 0.1,
      min: 0,
      max: 1,
      step: 0.05,
      label: "Softness",
    },
  },
  durationInFrames: 116,
  fps: FPS,
  compositionWidth: W,
  compositionHeight: H,
  previewBackdrop: { type: "color", value: "#141318" },
  snippet: perlinDissolveExampleCode,
};
