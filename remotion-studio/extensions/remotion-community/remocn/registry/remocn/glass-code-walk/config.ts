import { type ComponentConfig, FPS, H, W } from "@/lib/customizer-config";

export const glassCodeWalkConfig: ComponentConfig = {
  componentName: "GlassCodeWalk",
  importPath: "@/components/remocn/glass-code-walk",
  controls: {
    title: { type: "text", default: "scene.tsx", label: "Title" },
    zoom: {
      type: "number",
      default: 2.6,
      min: 1,
      max: 4,
      step: 0.1,
      label: "Zoom",
    },
    fontSize: {
      type: "number",
      default: 18,
      min: 10,
      max: 28,
      step: 1,
      label: "Font size",
    },
    staggerFrames: {
      type: "number",
      default: 10,
      min: 1,
      max: 30,
      step: 1,
      label: "Stagger frames",
    },
    width: {
      type: "number",
      default: 880,
      min: 300,
      max: 1100,
      step: 10,
      label: "Width",
    },
    height: {
      type: "number",
      default: 420,
      min: 200,
      max: 700,
      step: 10,
      label: "Height",
    },
  },
  durationInFrames: 150,
  fps: FPS,
  compositionWidth: W,
  compositionHeight: H,
  previewBackdrop: { type: "image", src: "/bg.jpg" },
};
