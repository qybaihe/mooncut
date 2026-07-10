import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type FullscreenImpactTextPlacement =
  | "top"
  | "center"
  | "bottom"
  | {
      /** Horizontal anchor as a percentage of the video width. */
      x?: number;
      /** Vertical anchor as a percentage of the video height. */
      y?: number;
    };

export type FullscreenImpactTextProps = {
  /** Keep this as one phrase. Chinese is deliberately never split on spaces. */
  text: string;
  /** Accent color used by the impact ring and underline. */
  accent?: string;
  /** Total lifetime in frames, including the short fade-out. */
  duration?: number;
  /** Where the phrase lands once it has filled the screen. */
  placement?: FullscreenImpactTextPlacement;
  /** Override the responsive type size when an art-directed size is needed. */
  fontSize?: number;
  /** Lets a composition tune how much the source video is dimmed. */
  backdropOpacity?: number;
  /** Local sequence frame where the restrained flash/ring pulse lands. */
  impactAtFrame?: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getPlacement = (placement: FullscreenImpactTextPlacement) => {
  if (typeof placement === "object") {
    return {
      left: `${clamp(placement.x ?? 50, 0, 100)}%`,
      top: `${clamp(placement.y ?? 50, 0, 100)}%`,
    };
  }

  if (placement === "top") {
    return { left: "50%", top: "29%" };
  }

  if (placement === "bottom") {
    return { left: "50%", top: "71%" };
  }

  return { left: "50%", top: "50%" };
};

/**
 * A frame-driven full-screen emphasis beat for talking-head edits.
 *
 * It is designed for one short Chinese phrase: the phrase resolves from a
 * little blur, lands large, then gets one restrained impact pulse. The white
 * flash peaks at 13% opacity for one beat rather than strobing the viewer.
 * Put it in a short <Sequence> and set duration to the same frame length.
 */
export const FullscreenImpactText: React.FC<FullscreenImpactTextProps> = ({
  text,
  accent = "#d9ff63",
  duration = 54,
  placement = "center",
  fontSize,
  backdropOpacity = 0.72,
  impactAtFrame,
}) => {
  const frame = useCurrentFrame();
  const { height, width } = useVideoConfig();
  const safeDuration = Math.max(12, Math.round(duration));
  const impactFrame = clamp(
    Math.round(impactAtFrame ?? safeDuration * 0.28),
    4,
    Math.max(4, safeDuration - 9),
  );
  const focusEnd = Math.max(2, impactFrame - 2);
  const focusWindowFrames = clamp(Math.round(safeDuration * 0.18), 12, 20);
  const focusStart = Math.max(0, focusEnd - focusWindowFrames);
  const exitFrames = Math.max(3, Math.round(safeDuration * 0.17));
  const exitStart = Math.min(
    safeDuration - 1,
    Math.max(impactFrame + 7, safeDuration - exitFrames),
  );

  const focus = interpolate(frame, [focusStart, focusEnd], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(frame, [exitStart, safeDuration], [1, 0], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const visibility = focus * exit;
  const impactEnvelope = interpolate(
    frame,
    [impactFrame - 1, impactFrame + 2, impactFrame + 8],
    [0, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const flash = interpolate(
    frame,
    [impactFrame - 1, impactFrame + 1, impactFrame + 5],
    [0, 0.13, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const ringProgress = interpolate(frame, [impactFrame, impactFrame + 12], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ringOpacity = (1 - ringProgress) * 0.62 * exit;
  const shake =
    Math.sin((frame - impactFrame) * Math.PI * 1.7) * impactEnvelope * 3.2;
  const scale = 0.72 + focus * 0.29 + impactEnvelope * 0.075;
  const blur = (1 - focus) * 16;
  const glyphCount = Math.max(
    1,
    ...text.split("\n").map((line) => Array.from(line).length),
  );
  const responsiveFontSize = Math.round(
    Math.max(
      52,
      Math.min(
        Math.min(width * 0.17, height * 0.34),
        (width * 0.8) / (glyphCount * 1.08),
      ),
    ),
  );
  const anchor = getPlacement(placement);

  if (!text.trim()) {
    return null;
  }

  return (
    <AbsoluteFill
      aria-label={text}
      style={{
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 30,
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at center, rgba(11, 15, 17, 0.28), rgba(4, 7, 10, 0.92))",
          opacity: visibility * clamp(backdropOpacity, 0, 1),
        }}
      />
      <AbsoluteFill
        style={{
          background: "#fff",
          opacity: flash * exit,
        }}
      />

      <div
        style={{
          background: `radial-gradient(circle, ${accent} 0%, transparent 68%)`,
          border: `2px solid ${accent}`,
          borderRadius: "50%",
          height: Math.min(width, height) * 0.58,
          left: anchor.left,
          opacity: ringOpacity,
          position: "absolute",
          top: anchor.top,
          transform: `translate(-50%, -50%) scale(${0.56 + ringProgress * 0.95})`,
          width: Math.min(width, height) * 0.58,
        }}
      />

      <div
        style={{
          left: anchor.left,
          maxWidth: "88%",
          position: "absolute",
          textAlign: "center",
          top: anchor.top,
          transform: "translate(-50%, -50%)",
          width: "max-content",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            filter: `blur(${blur}px)`,
            opacity: visibility,
            transform: `translate(${shake}px, ${shake * 0.34}px) scale(${scale})`,
            transformOrigin: "center center",
          }}
        >
          <div
            style={{
              background: accent,
              boxShadow: `0 0 ${18 + impactEnvelope * 22}px ${accent}`,
              height: 5,
              marginBottom: Math.max(14, (fontSize ?? responsiveFontSize) * 0.12),
              transform: `scaleX(${0.46 + focus * 0.54 + impactEnvelope * 0.16})`,
              transformOrigin: "center",
              width: "min(180px, 22vw)",
            }}
          />
          <div
            style={{
              color: "#fbfcf6",
              fontFamily:
                '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Inter, sans-serif',
              fontSize: fontSize ?? responsiveFontSize,
              fontWeight: 900,
              letterSpacing: "0.025em",
              lineHeight: 1.14,
              maxWidth: "88vw",
              overflowWrap: "anywhere",
              textShadow: `0 10px 30px rgba(0, 0, 0, 0.38), 0 0 ${impactEnvelope * 18}px ${accent}`,
              whiteSpace: "pre-wrap",
              wordBreak: "keep-all",
            }}
          >
            {text}
          </div>
          <div
            style={{
              background: accent,
              boxShadow: `0 0 ${12 + impactEnvelope * 18}px ${accent}`,
              height: 3,
              marginTop: Math.max(16, (fontSize ?? responsiveFontSize) * 0.14),
              opacity: 0.58 + impactEnvelope * 0.42,
              transform: `scaleX(${0.58 + focus * 0.42 + impactEnvelope * 0.12})`,
              transformOrigin: "center",
              width: "min(420px, 56vw)",
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
