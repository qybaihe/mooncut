import React from "react";
import { StaggeredMotion, useViewportRect, randomFloat, hold } from "remotion-bits";

export const metadata = {
  name: "Fracture Reassemble",
  description:
    "Grid of tiles shatters into 3D space and reassembles with abstract symbol accents",
  tags: ["motion", "staggered-motion", "fracture", "3d", "transition"],
  duration: 180,
  width: 1080,
  height: 1080,
  registry: {
    name: "bit-fracture-reassemble",
    title: "Fracture Reassemble",
    description:
      "Grid of tiles shatters into 3D space and reassembles with abstract symbol accents",
    type: "bit" as const,
    add: "when-needed" as const,
    registryDependencies: ["staggered-motion", "use-viewport-rect"],
    dependencies: [],
    files: [
      {
        path: "docs/src/bits/examples/staggered-motion/FractureReassemble.tsx",
      },
    ],
  },
};

export const Component: React.FC = () => {
  const tileImage = (seed: number, size: number) =>
    `https://picsum.photos/seed/${seed}/${size}/${size}`;

  const ROWS = 5;
  const COLS = 5;
  const CENTER_ROW = 2;
  const SYMBOLS = ["◈", "◉", "◎", "◍", "◌"];

  const rect = useViewportRect();
  const vmin = rect.vmin;

  const gap = vmin * 1.2;
  const tileSize = vmin * 14;
  const gridWidth = COLS * tileSize + (COLS - 1) * gap;
  const gridHeight = ROWS * tileSize + (ROWS - 1) * gap;

  const tiles = Array.from({ length: ROWS * COLS }, (_, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;

    const dx = randomFloat(`frac-x-${i}`, -vmin * 80, vmin * 80);
    const dy = randomFloat(`frac-y-${i}`, -vmin * 80, vmin * 80);
    const dz = randomFloat(`frac-z-${i}`, -vmin * 120, vmin * 20);
    const rotX = randomFloat(`frac-rx-${i}`, -180, 180);
    const rotY = randomFloat(`frac-ry-${i}`, -180, 180);
    const rotZ = randomFloat(`frac-rz-${i}`, -90, 90);

    const distFromCenter = Math.abs(row - 2) + Math.abs(col - 2);
    const staggerDelay = distFromCenter * 4;

    const x = col * (tileSize + gap);
    const y = row * (tileSize + gap);
    const imgSize = Math.round(tileSize);
    const symbol = row === CENTER_ROW ? SYMBOLS[col] : null;

    return (
      <StaggeredMotion
        key={i}
        transition={{
          x: [dx, 0, hold(60), dx],
          y: [dy, 0, hold(60), dy],
          z: [dz, 0, hold(60), dz],
          rotateX: [rotX, 0, hold(60), rotX],
          rotateY: [rotY, 0, hold(60), rotY],
          rotateZ: [rotZ, 0, hold(60), rotZ],
          opacity: [0, 1, hold(60), 0],
          frames: [0, 170],
          duration: 170,
          delay: staggerDelay,
          easing: "easeInOutCubic",
        }}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: tileSize,
          height: tileSize,
          perspective: `${vmin * 100}px`,
          transformStyle: "preserve-3d",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: vmin * 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            boxShadow: `0 0 0 ${vmin * 0.25}px var(--color-border-dark)`,
          }}
        >
          <img
            src={tileImage(i + 1, imgSize)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              position: "absolute",
              inset: 0,
            }}
          />
          {symbol && (
            <span
              style={{
                fontSize: tileSize * 0.55,
                fontWeight: 900,
                color: "white",
                textShadow: `0 0 5px black`,
                lineHeight: 1,
                position: "relative",
              }}
            >
              {symbol}
            </span>
          )}
        </div>
      </StaggeredMotion>
    );
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "var(--color-background-dark)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <StaggeredMotion
        transition={{
          frames: [0, 1],
          stagger: 0,
        }}
        style={{
          position: "relative",
          width: gridWidth,
          height: gridHeight,
          transformStyle: "preserve-3d",
        }}
      >
        {tiles}
      </StaggeredMotion>
    </div>
  );
};
