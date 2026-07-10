import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { AnimatedBarChart } from "../../../extensions/remotion-community/remocn/registry/remocn/animated-bar-chart";
import { FocusBlurResolve } from "../../../extensions/remotion-community/remocn/registry/remocn/focus-blur-resolve";
import { SimulatedCursor } from "../../../extensions/remotion-community/remocn/registry/remocn/simulated-cursor";
import { BitsAnimatedText } from "./adapters/BitsAnimatedText";
import "./community-motion.css";

const REMOCN_DURATION = 120;
const BITS_DURATION = 120;
const ONDA_DURATION = 132;

const BITS_PARTICLES = Array.from({ length: 52 }, (_, index) => ({
  drift: 0.35 + random(`bits-drift-${index}`) * 0.85,
  phase: random(`bits-phase-${index}`) * 240,
  size: 3 + random(`bits-size-${index}`) * 12,
  x: random(`bits-x-${index}`) * 100,
  y: random(`bits-y-${index}`) * 100,
}));

const sceneOpacity = (frame: number, durationInFrames: number, exit = true) => {
  if (!exit) {
    return interpolate(frame, [0, 14], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
  }

  return interpolate(
    frame,
    [0, 12, durationInFrames - 16, durationInFrames],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    },
  );
};

const LibraryChip: React.FC<{ index: string; label: string; note: string }> = ({
  index,
  label,
  note,
}) => (
  <div className="lab-library-chip">
    <span>{index}</span>
    <strong>{label}</strong>
    <i>{note}</i>
  </div>
);

const TransitionCurtain: React.FC<{
  accent: string;
  from: number;
  label: string;
}> = ({ accent, from, label }) => {
  const frame = useCurrentFrame();
  const localFrame = frame - from;
  const opacity = interpolate(localFrame, [0, 10, 15, 24], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const labelOpacity = interpolate(localFrame, [5, 10, 16, 22], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(localFrame, [5, 12, 22], [14, 0, -12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  return (
    <AbsoluteFill className="lab-transition-curtain" style={{ opacity }}>
      <div
        className="lab-transition-mark"
        style={{ opacity: labelOpacity, transform: `translateY(${y}px)` }}
      >
        <span style={{ color: accent }}>NEXT</span>
        <b>{label}</b>
      </div>
    </AbsoluteFill>
  );
};

const BrowserChrome = () => (
  <div className="lab-browser-chrome">
    <span />
    <span />
    <span />
    <div>moonbot / motion-lab</div>
    <b>LIVE</b>
  </div>
);

const RemocnStage: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const panelEnter = spring({
    fps,
    frame: Math.max(0, frame - 10),
    config: { damping: 18, stiffness: 92 },
  });
  const copyOpacity = interpolate(frame, [24, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      className="lab-stage lab-remocn"
      style={{ opacity: sceneOpacity(frame, REMOCN_DURATION) }}
    >
      <div className="lab-remocn-grid" />
      <LibraryChip index="01" label="REMOCN" note="Kinetic type · UI motion" />

      <div className="lab-remocn-copy">
        <div className="lab-kicker">COPY-PASTE PRIMITIVES</div>
        <div className="lab-remocn-headline">
          <FocusBlurResolve
            color="#f4f3ef"
            fontSize={82}
            fontWeight={760}
            text="把镜头语言变成组件"
          />
        </div>
        <p style={{ opacity: copyOpacity }}>
          Focus blur
          resolve、模拟鼠标、数据图表——适合产品讲解和口播中的重点镜头。
        </p>
      </div>

      <div
        className="lab-browser-shell"
        style={{
          opacity: panelEnter,
          transform: `translateY(${(1 - panelEnter) * 44}px) rotateY(${(1 - panelEnter) * -5}deg) scale(${0.94 + panelEnter * 0.06})`,
        }}
      >
        <BrowserChrome />
        <div className="lab-browser-screen">
          <aside className="lab-browser-nav">
            <b>MOONBOT</b>
            <span className="lab-nav-active">Motion lab</span>
            <span>Captions</span>
            <span>Compositions</span>
            <span>Export</span>
          </aside>
          <main className="lab-browser-main">
            <div className="lab-browser-heading">
              <div>
                <small>PERFORMANCE STORY</small>
                <h3>每个关键帧都有意义</h3>
              </div>
              <button>Render clip</button>
            </div>
            <div className="lab-browser-panels">
              <section className="lab-idea-panel">
                <span>HEADLINE</span>
                <strong>
                  从信息
                  <br />
                  到镜头
                </strong>
                <div className="lab-stat-row">
                  <b>04</b>
                  <small>reusable scenes</small>
                </div>
              </section>
              <section className="lab-chart-host">
                <AnimatedBarChart
                  barColor="#b7ff52"
                  data={[18, 31, 28, 47, 54, 71]}
                  gap={13}
                  height={244}
                  labels={["S", "M", "T", "W", "T", "F"]}
                  staggerFrames={5}
                  width={378}
                />
              </section>
            </div>
            <div className="lab-browser-footer">
              <span>+42%</span>
              <b>watch-through</b>
              <i>scene-ready</i>
            </div>
          </main>
          <SimulatedCursor
            color="#c8ff6a"
            points={[
              { x: 540, y: 148, hold: 8 },
              { x: 665, y: 118, hold: 18, click: true },
              { x: 708, y: 352, hold: 12 },
            ]}
            size={38}
          />
        </div>
      </div>

      <div className="lab-footnote lab-remocn-footnote">
        REAL UPSTREAM COMPONENTS · no runtime package added
      </div>
    </AbsoluteFill>
  );
};

const BitsParticleField: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div className="lab-bits-particles">
      {BITS_PARTICLES.map((particle, index) => {
        const progress =
          ((frame * particle.drift + particle.phase) % 240) / 240;
        const wobble = Math.sin((frame + particle.phase) * 0.06) * 2.4;
        const opacity = Math.sin(progress * Math.PI) * 0.76;
        return (
          <span
            key={index}
            style={{
              height: particle.size,
              left: `${particle.x + wobble}%`,
              opacity,
              top: `${(particle.y + progress * 16) % 104}%`,
              transform: `scale(${0.55 + opacity * 0.7})`,
              width: particle.size,
            }}
          />
        );
      })}
    </div>
  );
};

const BitsStage: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = spring({
    fps,
    frame: Math.max(0, frame - 24),
    config: { damping: 15, stiffness: 118 },
  });
  const orbit = interpolate(frame, [0, BITS_DURATION], [-12, 18], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.sin),
  });
  const chipOpacity = interpolate(frame, [50, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      className="lab-stage lab-bits"
      style={{ opacity: sceneOpacity(frame, BITS_DURATION) }}
    >
      <div className="lab-bits-grid" />
      <BitsParticleField />
      <LibraryChip
        index="02"
        label="REMOTION BITS"
        note="Particles · stagger · CSS 3D"
      />

      <div className="lab-bits-copy">
        <div className="lab-kicker">FRAME-DRIVEN BUILDING BLOCKS</div>
        <h2>
          <BitsAnimatedText
            delay={6}
            duration={18}
            fromBlur={12}
            fromY={42}
            stagger={1.4}
          >
            让数据有呼吸感
          </BitsAnimatedText>
        </h2>
        <p>
          逐字落版、受控粒子和 CSS 3D 卡片，适合把抽象信息做成可被记住的画面。
        </p>
      </div>

      <div
        className="lab-bits-stage-card"
        style={{
          transform: `translateY(${(1 - card) * 48}px) rotateX(${orbit * 0.18}deg) rotateY(${orbit}deg) scale(${0.88 + card * 0.12})`,
          opacity: card,
        }}
      >
        <div className="lab-bits-card-top">
          <span>LIVE COMPOSITION</span>
          <b>30 FPS</b>
        </div>
        <div className="lab-bits-visual">
          <svg viewBox="0 0 620 270" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="bits-line" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#8cffd0" stopOpacity="0.2" />
                <stop offset="1" stopColor="#c6ff57" />
              </linearGradient>
            </defs>
            <path
              d="M0 220 C82 204 100 92 178 152 C242 201 258 65 338 110 C406 148 422 39 511 73 C565 94 581 42 620 21"
              fill="none"
              stroke="url(#bits-line)"
              strokeWidth="8"
            />
            {[0, 178, 338, 511, 620].map((x) => (
              <circle
                key={x}
                cx={x}
                cy={
                  x === 0
                    ? 220
                    : x === 178
                      ? 152
                      : x === 338
                        ? 110
                        : x === 511
                          ? 73
                          : 21
                }
                fill="#dcff92"
                r="8"
              />
            ))}
          </svg>
          <div
            className="lab-bits-orb lab-bits-orb-a"
            style={{
              transform: `translate(${Math.sin(frame * 0.1) * 18}px, ${Math.cos(frame * 0.08) * 14}px)`,
            }}
          />
          <div
            className="lab-bits-orb lab-bits-orb-b"
            style={{
              transform: `translate(${Math.sin(frame * 0.07 + 2) * 18}px, ${Math.cos(frame * 0.1 + 1) * 14}px)`,
            }}
          />
        </div>
        <div className="lab-bits-chip-row" style={{ opacity: chipOpacity }}>
          <span>STAGGER</span>
          <span>PARTICLES</span>
          <span>CAMERA</span>
        </div>
      </div>

      <div className="lab-footnote lab-bits-footnote">
        UPSTREAM AnimatedText · lightweight particle adapter inspired by
        ParticleSystem
      </div>
    </AbsoluteFill>
  );
};

const OndaMeshGradient: React.FC = () => {
  const frame = useCurrentFrame();
  const colors = [
    "rgba(114, 255, 213, .38)",
    "rgba(157, 133, 255, .32)",
    "rgba(255, 176, 102, .24)",
  ];
  const layers = colors.map((color, index) => {
    const phase = random(`onda-gradient-${index}`) * Math.PI * 2;
    const x = 22 + index * 28 + Math.sin(frame * 0.013 + phase) * 10;
    const y = 38 + Math.cos(frame * 0.01 + phase) * 17;
    return `radial-gradient(circle at ${x}% ${y}%, ${color} 0%, transparent 44%)`;
  });

  return (
    <AbsoluteFill
      className="lab-onda-gradient"
      style={{ backgroundImage: layers.join(", ") }}
    />
  );
};

const OndaDevicePullback: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pullback = spring({
    fps,
    frame: Math.max(0, frame - 44),
    config: { damping: 22, stiffness: 72 },
  });
  const scale = interpolate(pullback, [0, 1], [1.55, 0.8]);
  const y = interpolate(pullback, [0, 1], [118, 8]);
  const radius = interpolate(pullback, [0, 1], [18, 64]);
  const bezel = interpolate(pullback, [0, 1], [0, 24]);
  const callout = interpolate(frame, [82, 103], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      <div
        className="lab-onda-device-wrap"
        style={{ transform: `translateY(${y}px) scale(${scale})` }}
      >
        <div
          className="lab-onda-phone"
          style={{ borderRadius: radius + bezel, padding: bezel }}
        >
          {bezel > 2 && <div className="lab-onda-notch" />}
          <div
            className="lab-onda-phone-screen"
            style={{ borderRadius: radius }}
          >
            <div className="lab-onda-phone-top">
              <span>9:41</span>
              <i />
              <i />
            </div>
            <div className="lab-onda-phone-title">
              <small>MOONBOT</small>
              <strong>你的镜头系统</strong>
            </div>
            <div className="lab-onda-phone-story">
              <span className="lab-story-dot lab-story-dot-active" />
              <span className="lab-story-dot" />
              <span className="lab-story-dot" />
            </div>
            <div className="lab-onda-phone-card">
              <em>01</em>
              <b>
                焦点
                <br />
                建立
              </b>
              <i>→</i>
            </div>
            <div className="lab-onda-phone-card lab-onda-phone-card-alt">
              <em>02</em>
              <b>
                信息
                <br />
                收束
              </b>
              <i>↗</i>
            </div>
            <div className="lab-onda-phone-nav">
              <span>●</span>
              <span>□</span>
              <span>△</span>
            </div>
          </div>
        </div>
      </div>
      <div
        className="lab-onda-callout"
        style={{
          opacity: callout,
          transform: `translateY(${(1 - callout) * 20}px)`,
        }}
      >
        <span>DEVICE PULLBACK</span>
        <b>屏幕退成设备，叙事才有空间。</b>
      </div>
    </>
  );
};

const OndaStage: React.FC = () => {
  const frame = useCurrentFrame();
  const copy = interpolate(frame, [8, 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      className="lab-stage lab-onda"
      style={{ opacity: sceneOpacity(frame, ONDA_DURATION, false) }}
    >
      <OndaMeshGradient />
      <div className="lab-onda-noise" />
      <LibraryChip
        index="03"
        label="ONDA"
        note="Calm motion · device framing"
      />
      <div
        className="lab-onda-copy"
        style={{ opacity: copy, transform: `translateY(${(1 - copy) * 24}px)` }}
      >
        <div className="lab-kicker">ONE MOTION LANGUAGE</div>
        <h2>
          克制，
          <br />
          但不无聊。
        </h2>
        <p>
          Onda
          最好的地方不是单一效果，而是设备、字幕、光和转场共享同一套安静的运动语言。
        </p>
      </div>
      <OndaDevicePullback />
      <div className="lab-footnote lab-onda-footnote">
        dependency-free DeviceFrame / MeshGradient adaptation · source stays in
        extensions
      </div>
    </AbsoluteFill>
  );
};

/**
 * Community Motion Lab
 *
 * An isolated showcase for three MIT-licensed upstream libraries stored in
 * `extensions/remotion-community/`. It imports only the dependency-free
 * Remocn and Remotion Bits primitives; Onda's internal schemas/layout helpers
 * are represented by minimal frame-driven adapters below, so this host keeps
 * its existing package graph unchanged.
 */
export const CommunityMotionDemo: React.FC = () => (
  <AbsoluteFill className="community-motion-lab">
    <Sequence durationInFrames={REMOCN_DURATION} from={0} layout="none">
      <RemocnStage />
    </Sequence>
    <Sequence durationInFrames={BITS_DURATION} from={120} layout="none">
      <BitsStage />
    </Sequence>
    <Sequence durationInFrames={ONDA_DURATION} from={240} layout="none">
      <OndaStage />
    </Sequence>
    <TransitionCurtain accent="#caff72" from={108} label="REMOTION BITS" />
    <TransitionCurtain accent="#bd9cff" from={228} label="ONDA" />
  </AbsoluteFill>
);
