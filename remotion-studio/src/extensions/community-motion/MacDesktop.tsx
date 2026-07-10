import React from 'react';
import {AbsoluteFill} from 'remotion';
import {MacDefaultBackground} from './MacDefaultBackground';
import './macos-desktop.css';

export type MacWindowKind = 'app' | 'browser' | 'utility';
export type MacWindowTone = 'dark' | 'light';

export type MacDesktopProps = {
  applicationName?: string;
  /** Optional scene-local clock text; defaults to the original demo value. */
  clockText?: string;
  /** The shared wallpaper stays visible, while the value keeps foreground copy legible. */
  shade?: number;
  showDock?: boolean;
  showMenuBar?: boolean;
};

/**
 * The shared desktop context for desktop-native video scenes.
 *
 * Use this for browser, editor, dashboard, and evidence scenes. Do not force it
 * behind full-screen people, phone captures, or intentional full-screen impact text.
 */
export const MacDesktop: React.FC<MacDesktopProps> = ({
  applicationName = 'Mooncut',
  clockText = '10:41',
  shade = 0.4,
  showDock = false,
  showMenuBar = true,
}) => {
  return (
    <AbsoluteFill aria-label="macOS desktop" className="macos-desktop-scene" style={{zIndex: 0}}>
      <MacDefaultBackground shade={shade} />
      {showMenuBar ? (
        <div aria-hidden className="macos-menubar">
          <div className="macos-menubar__left">
            <span className="macos-menubar__apple"></span>
            <b>{applicationName}</b><span>File</span><span>Edit</span><span>Window</span><span>Help</span>
          </div>
          <div className="macos-menubar__right"><span>◉</span><span>⌁</span><span>{clockText}</span></div>
        </div>
      ) : null}
      {showDock ? (
        <div aria-hidden className="macos-dock">
          <i className="macos-dock__finder">⌘</i><i className="macos-dock__safari">◉</i><i className="macos-dock__notes">▤</i><i className="macos-dock__cut">✦</i>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

type MacWindowProps = {
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  kind?: MacWindowKind;
  style?: React.CSSProperties;
  toolbar?: React.ReactNode;
  title: string;
  tone?: MacWindowTone;
};

/**
 * One native-window skeleton for all desktop-shaped content in a composition.
 * Content remains supplied by the scene; this component owns only macOS chrome.
 */
export const MacWindow: React.FC<MacWindowProps> = ({
  children,
  className = '',
  bodyClassName = '',
  kind = 'app',
  style,
  title,
  toolbar,
  tone = 'dark',
}) => {
  const toneClass = tone === 'light' ? 'macos-app-window--mist' : 'macos-app-window--graphite';
  return (
    <section
      aria-label={title}
      className={`macos-app-window macos-app-window--${kind} ${toneClass} ${className}`}
      style={style}
    >
      <header className="macos-app-window__titlebar">
        <div aria-hidden className="macos-traffic-lights">
          <i className="macos-traffic-light macos-traffic-light--close" />
          <i className="macos-traffic-light macos-traffic-light--minimize" />
          <i className="macos-traffic-light macos-traffic-light--zoom" />
        </div>
        <div className="macos-app-window__title"><span className={`macos-app-window__app-dot macos-app-window__app-dot--${kind}`} />{title}</div>
        <div className="macos-app-window__right-slot">{toolbar}</div>
      </header>
      <div className={`macos-app-window__content ${bodyClassName}`}>{children}</div>
    </section>
  );
};

/** A Camera/FaceTime-shaped variant with the same chrome and window behavior. */
export const MacFloatingVideoWindow: React.FC<MacWindowProps> = ({
  bodyClassName = '',
  children,
  ...props
}) => (
  <MacWindow
    {...props}
    bodyClassName={`macos-floating-video-window__body ${bodyClassName}`}
    kind="app"
  >
    {children}
  </MacWindow>
);

// These aliases preserve the descriptive API for new compositions while the
// established Horizontal composition uses the shorter names above.
export const MacDesktopScene = MacDesktop;
export const MacAppWindow = MacWindow;
