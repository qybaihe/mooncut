# macOS desktop visual rule

Use this rule whenever a video scene represents a computer workflow, website,
editor, dashboard, status panel, or generated evidence.

The production default is
[`default-talking-head.ts`](../../presets/default-talking-head.ts). New
talking-head compositions should receive that preset explicitly (or use its
default), rather than recreating this visual language scene by scene.

1. The full canvas is one `MacDesktop` (currently the selected Sonoma image),
   never a raw screenshot stretched as a background.
2. Every desktop-native surface uses `MacWindow`: the shared traffic lights,
   frosted title bar, hairline border, rounded corners, and restrained shadow
   are mandatory.
3. Talking-head side feeds and PiPs use `MacFloatingVideoWindow`, so they read
   as a Camera/FaceTime window rather than a decorative rectangle.
4. Keep actual webpage, document, and editor content opaque inside the window.
   Blur and translucency belong only to the desktop and window chrome.
5. Do not force physical phones, real full-screen footage, posters, or the
   intentional full-screen keyword impact into a desktop window.

Recommended window entrance: 10–14 frames, ease-out, scale `0.96 → 1`,
translateY `18px → 0`, opacity `0 → 1`. Keep it to one opening motion per
scene; the desktop should remain stable underneath.
