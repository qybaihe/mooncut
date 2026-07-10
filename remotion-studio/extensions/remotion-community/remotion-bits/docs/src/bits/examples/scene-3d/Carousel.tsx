import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Scene3D, Element3D, Step, useViewportRect } from "remotion-bits";

export const metadata = {
  name: "3D Carousel",
  description: "Rotating carousel of cards in 3D space",
  tags: ["3d", "carousel", "gallery", "animation"],
  duration: 300,
  registry: {
    name: "bit-carousel-3d",
    title: "3D Carousel",
    description: "Rotating carousel of cards in 3D space",
    type: "bit" as const,
    add: "when-needed" as const,
    registryDependencies: ["scene-3d", "use-viewport-rect"],
    dependencies: [],
    files: [
      {
        path: "docs/src/bits/examples/scene-3d/Carousel.tsx",
      },
    ],
  },
};

export const Component: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rect = useViewportRect();

  const radius = rect.vmin * 60;
  const count = 8;
  const cardWidth = rect.vmin * 40;
  const cardHeight = rect.vmin * 40;

  // Rotate 360 degrees over duration
  const rotationSpeed = 360 / (fps * 10); // 5 seconds per full rotation
  const baseRotation = frame * rotationSpeed;

  const items = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => ({
      id: i,
      angle: (i * (360 / count)) + baseRotation
    }));
  }, [count, baseRotation]);

  const Card = ({ index }: { index: number }) => (
    <div
      style={{
        width: cardWidth,
        height: cardHeight,
        backgroundColor: `var(--color-primary-hover)`,
        borderRadius: rect.vmin,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontSize: rect.vmin * 4,
        fontWeight: "bold",
        boxShadow: `0 ${rect.vmin}px ${rect.vmin * 10}px rgba(0,0,0,0.5)`,
      }}
    >
      {index + 1}
    </div>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#111" }}>
      <Scene3D
        perspective={1000}
        stepDuration={30}
      >
        <Step
          id="0"
        />
        <Step
          id="1"
          z={-rect.vmin * 100}
          rotateZ={180}
        />
        <Step
          id="3"
        />

        {items.map((item) => {
          const angleRad = (item.angle * Math.PI) / 180;
          const x = Math.sin(angleRad) * radius;
          const z = Math.cos(angleRad) * radius;

          return (
            <Element3D
              key={item.id}
              x={x}
              y={0}
              z={z}
              rotateY={item.angle}
              centered
            >
              <Card index={item.id} />
            </Element3D>
          );
        })}
      </Scene3D>
    </AbsoluteFill>
  );
};
