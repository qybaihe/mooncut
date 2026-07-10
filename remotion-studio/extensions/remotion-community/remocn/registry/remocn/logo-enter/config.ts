import { type ComponentConfig, FPS, H, W } from "@/lib/customizer-config";

export const logoEnterConfig: ComponentConfig = {
  componentName: "LogoEnter",
  importPath: "@/components/remocn/logo-enter",
  controls: {
    diameter: {
      type: "number-input",
      default: 118,
      min: 48,
      max: 280,
      step: 1,
      label: "Diameter",
    },
    overlap: {
      type: "number-input",
      default: 38,
      min: 0,
      max: 160,
      step: 1,
      label: "Overlap",
    },
    ringColor: { type: "color", default: "#fff", label: "Ring" },
    orientation: {
      type: "select",
      default: "horizontal",
      options: ["horizontal", "vertical"],
      label: "Orientation",
    },
    stagger: {
      type: "number-input",
      default: 7,
      min: 0,
      max: 30,
      step: 1,
      label: "Stagger",
    },
  },
  durationInFrames: 90,
  fps: FPS,
  compositionWidth: W,
  compositionHeight: H,
  previewBackdrop: { type: "color", value: "#ffffff" },
};
