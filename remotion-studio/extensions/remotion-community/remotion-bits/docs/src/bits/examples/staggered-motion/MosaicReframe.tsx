import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { StaggeredMotion, hold, useViewportRect } from "remotion-bits";

export const metadata = {
  name: "Mosaic Reframe",
  description:
    "Twelve image tiles transition from a grid to a feature mosaic, then into a diagonal cascade",
  tags: ["motion", "staggered-motion", "mosaic", "grid", "layout"],
  duration: 270,
  width: 1080,
  height: 1080,
  registry: {
    name: "bit-mosaic-reframe",
    title: "Mosaic Reframe",
    description:
      "Twelve image tiles transition from a grid to a feature mosaic, then into a diagonal cascade",
    type: "bit" as const,
    add: "when-needed" as const,
    registryDependencies: ["staggered-motion", "use-viewport-rect"],
    dependencies: [],
    files: [
      {
        path: "docs/src/bits/examples/staggered-motion/MosaicReframe.tsx",
      },
    ],
  },
};

export const Component: React.FC = () => {
  const rect = useViewportRect();
  const frame = useCurrentFrame();
  const vmin = rect.vmin;

  const containerSize = vmin * 75;
  const gap = vmin * 1.5;

  const tileImage = (seed: number, w: number, h: number) =>
    `https://picsum.photos/seed/${seed}/${Math.round(w)}/${Math.round(h)}`;

  const TILE_COUNT = 12;

  interface TileConfig {
    x: number;
    y: number;
    w: number;
    h: number;
    rotate: number;
  }

  function buildConfigA(size: number, gap: number): TileConfig[] {
    const cols = 4;
    const rows = 3;
    const tileW = (size - (cols - 1) * gap) / cols;
    const tileH = (size - (rows - 1) * gap) / rows;
    const configs: TileConfig[] = [];
    for (let i = 0; i < TILE_COUNT; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      configs.push({
        x: col * (tileW + gap),
        y: row * (tileH + gap),
        w: tileW,
        h: tileH,
        rotate: 0,
      });
    }
    return configs;
  }

  function buildConfigB(size: number, gap: number): TileConfig[] {
    const configs: TileConfig[] = [];
    const cols = 4;
    const rows = 3;
    const cellW = (size - (cols - 1) * gap) / cols;
    const cellH = (size - (rows - 1) * gap) / rows;

    const featureW = cellW * 2 + gap;
    const featureH = cellH * 2 + gap;
    configs.push({ x: 0, y: 0, w: featureW, h: featureH, rotate: 0 });

    const rightX = featureW + gap;
    const rightW = (size - rightX - gap) / 2;
    configs.push({ x: rightX, y: 0, w: rightW, h: cellH, rotate: 0 });
    configs.push({ x: rightX + rightW + gap, y: 0, w: rightW, h: cellH, rotate: 0 });
    configs.push({ x: rightX, y: cellH + gap, w: rightW, h: cellH, rotate: 0 });
    configs.push({ x: rightX + rightW + gap, y: cellH + gap, w: rightW, h: cellH, rotate: 0 });

    const bottomY = featureH + gap;
    const bottomH = size - bottomY;
    const bottomCount = 7;
    const bottomTileW = (size - (bottomCount - 1) * gap) / bottomCount;
    for (let i = 0; i < bottomCount; i++) {
      configs.push({
        x: i * (bottomTileW + gap),
        y: bottomY,
        w: bottomTileW,
        h: bottomH,
        rotate: 0,
      });
    }

    return configs;
  }

  function buildConfigC(size: number): TileConfig[] {
    const configs: TileConfig[] = [];
    const tileSize = size * 0.2;
    const step = (size - tileSize) / (TILE_COUNT - 1);

    for (let i = 0; i < TILE_COUNT; i++) {
      configs.push({
        x: step * i,
        y: step * i,
        w: tileSize,
        h: tileSize,
        rotate: -15 + i * 3,
      });
    }
    return configs;
  }

  const configA = buildConfigA(containerSize, gap);
  const configB = buildConfigB(containerSize, gap);
  const configC = buildConfigC(containerSize);

  const tileConfigs = Array.from({ length: TILE_COUNT }, (_, i) => {
    const a = configA[i];
    const b = configB[i];
    const c = configC[i];

    const maxW = Math.max(configA[i].w, configB[i].w, configC[i].w);
    const maxH = Math.max(configA[i].h, configB[i].h, configC[i].h);
    return {
      index: i,
      a,
      b,
      c,
      maxW,
      maxH,
      depth: (i - (TILE_COUNT - 1) / 2) * vmin * 1.2,
    };
  });

  const opacity = interpolate(frame, [0, 20, 255, 270], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#09090b",
      }}
    >
      <div
        style={{
          width: containerSize,
          height: containerSize,
          position: "relative",
          opacity,
          perspective: `${vmin * 120}px`,
          transformStyle: "preserve-3d",
        }}
      >
        {tileConfigs.map((tile) => (
          (() => {
            const desiredW = interpolate(
              frame,
              [90 + tile.index * 2, 135 + tile.index * 2, 195 + tile.index * 2, 240 + tile.index * 2],
              [tile.a.w, tile.b.w, tile.b.w, tile.c.w],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: (t) => t * t * (3 - 2 * t),
              }
            );

            const desiredH = interpolate(
              frame,
              [90 + tile.index * 2, 135 + tile.index * 2, 195 + tile.index * 2, 240 + tile.index * 2],
              [tile.a.h, tile.b.h, tile.b.h, tile.c.h],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: (t) => t * t * (3 - 2 * t),
              }
            );

            return (
              <StaggeredMotion
                key={tile.index}
                transition={{
                  x: [tile.a.x, tile.b.x, hold(60), tile.c.x],
                  y: [tile.a.y, tile.b.y, hold(60), tile.c.y],
                  rotate: [tile.a.rotate, tile.b.rotate, hold(60), tile.c.rotate],
                  z: [0, 0, hold(60), tile.depth],
                  rotateX: [0, 0, hold(60), -8],
                  frames: [90, 240],
                  duration: 150,
                  delay: tile.index * 2,
                  easing: "easeInOutCubic",
                }}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 0,
                  height: 0,
                  willChange: "transform",
                }}
              >
                <div
                  style={{
                    width: tile.maxW,
                    height: tile.maxH,
                    borderRadius: vmin * 1.2,
                    overflow: "hidden",
                    clipPath: `inset(0px ${tile.maxW - desiredW}px ${tile.maxH - desiredH}px 0px round ${vmin * 1.2}px)`,
                    boxShadow: `0 ${vmin * 0.4}px ${vmin * 1.5}px rgba(0,0,0,0.4)`,
                    willChange: "clip-path",
                    backfaceVisibility: "hidden",
                  }}
                >
                  <img
                    src={tileImage(tile.index + 1, tile.maxW * 2, tile.maxH * 2)}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      backfaceVisibility: "hidden",
                      transform: "translateZ(0)",
                    }}
                  />
                </div>
              </StaggeredMotion>
            );
          })()
        ))}
      </div>
    </div>
  );
};
