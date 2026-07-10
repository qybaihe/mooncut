import React from "react";
import { Particles, Spawner, Behavior, useViewportRect, StaggeredMotion } from "remotion-bits";

export const metadata = {
  name: "Fireflies",
  description: "Wandering particles with glow effect simulating fireflies",
  tags: ["particles", "nature", "ambient", "animation"],
  duration: 300,
  registry: {
    name: "bit-fireflies",
    title: "Fireflies",
    description: "Wandering particles with glow effect simulating fireflies",
    type: "bit" as const,
    add: "when-needed" as const,
    registryDependencies: ["particle-system", "use-viewport-rect"],
    dependencies: [],
    files: [
      {
        path: "docs/src/bits/examples/particle-system/Fireflies.tsx",
      },
    ],
  },
};

export const Component: React.FC = () => {
  const rect = useViewportRect();

  return (
    <Particles>
      <Spawner
        rate={0.2}
        max={200}
        area={{ width: rect.width, height: rect.height }}
        position={{ x: rect.width / 2, y: rect.height / 2 }}
        lifespan={100}
        velocity={{ x: 0.5, y: 0.5, varianceX: 1, varianceY: 1 }}
      >
        <StaggeredMotion
          transition={{
            opacity: [0, 1, 0],
          }}
        >
          <div
            style={{
              width: rect.vmin,
              height: rect.vmin,
              borderRadius: "50%",
              backgroundColor: "#ccff00",
              boxShadow: `0 0 ${rect.vmin * 2}px ${rect.vmin * 1}px #ccff0099`,
            }}
          />
        </StaggeredMotion>
      </Spawner>

      <Behavior
        wiggle={{ magnitude: 2, frequency: 0.1 }}
        wiggleVariance={1}
      />
    </Particles>
  );
};
