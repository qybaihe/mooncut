import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

type BitsAnimatedTextProps = {
  children: string;
  delay?: number;
  duration?: number;
  fromBlur?: number;
  fromY?: number;
  stagger?: number;
};

/**
 * Dependency-free adapter for the Remotion Bits AnimatedText pattern.
 *
 * The upstream component exposes a wider keyframe API, but importing it into
 * this host also pulls optional `three` and `culori` utilities. This focused
 * adapter keeps the character-stagger behavior needed by the motion lab while
 * preserving a clean host dependency graph.
 */
export const BitsAnimatedText: React.FC<BitsAnimatedTextProps> = ({
  children,
  delay = 0,
  duration = 18,
  fromBlur = 10,
  fromY = 36,
  stagger = 1.25,
}) => {
  const frame = useCurrentFrame();
  const easing = Easing.out(Easing.cubic);

  return (
    <span aria-label={children}>
      {Array.from(children).map((character, index) => {
        const localFrame = frame - delay - index * stagger;
        const progress = interpolate(localFrame, [0, duration], [0, 1], {
          easing,
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const y = interpolate(progress, [0, 1], [fromY, 0]);
        const blur = interpolate(progress, [0, 1], [fromBlur, 0]);

        return (
          <span
            key={`${character}-${index}`}
            style={{
              display: "inline-block",
              filter: `blur(${blur}px)`,
              opacity: progress,
              transform: `translateY(${y}px)`,
              whiteSpace: "pre",
            }}
          >
            {character}
          </span>
        );
      })}
    </span>
  );
};
