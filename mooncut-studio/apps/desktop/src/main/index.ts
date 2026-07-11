/**
 * MoonCut Studio — Electron Main Process
 * Security: contextIsolation, no nodeIntegration, sandbox, loopback-only agent.
 */

import {app, BrowserWindow, Menu, net, protocol, session, shell} from "electron";
import {existsSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL, fileURLToPath} from "node:url";
import {bootstrapAgent, collectMediaAllowlist, createServices, registerIpc} from "./ipc.js";
import {isPathAllowed, shouldGrantPermission} from "./media-access.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged && process.env.MOONCUT_STUDIO_DEV === "1";

// Must register before app ready — enables local project video playback in renderer.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "mooncut-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
const services = createServices();

/** Brand app icon for window / dock (packaged + dev). */
const resolveAppIcon = (): string | undefined => {
  const candidates = [
    // Packaged: extraResources → Resources/icon.png
    process.resourcesPath ? join(process.resourcesPath, "icon.png") : "",
    // Dev / asar: apps/desktop/build/icon.png next to dist-electron
    join(__dirname, "../../build/icon.png"),
    join(app.getAppPath(), "build/icon.png"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
};

const createWindow = async () => {
  const icon = resolveAppIcon();
  if (icon && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(icon);
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "MoonCut Studio",
    backgroundColor: "#ffffff",
    show: false,
    ...(icon ? {icon} : {}),
    webPreferences: {
      // CJS single-file bundle — required for reliable sandbox preload (no ESM package imports).
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      void shell.openExternal(url);
    }
    return {action: "deny"};
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev
      ? url.startsWith("http://127.0.0.1:5178")
      : url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });

  // Strict CSP for renderer
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          isDev
            ? "default-src 'self' http://127.0.0.1:5178; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' http://127.0.0.1:5178; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: file: mooncut-media:; connect-src 'self' http://127.0.0.1:5178 ws://127.0.0.1:5178; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
            : "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: file: mooncut-media:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        ],
      },
    });
  });

  if (isDev) {
    await mainWindow.loadURL("http://127.0.0.1:5178/");
    mainWindow.webContents.openDevTools({mode: "detach"});
  } else {
    await mainWindow.loadFile(join(__dirname, "../../dist/index.html"));
  }
};

const installMenu = () => {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "MoonCut Studio",
      submenu: [
        {role: "about"},
        {type: "separator"},
        {role: "services"},
        {type: "separator"},
        {role: "hide"},
        {role: "hideOthers"},
        {role: "unhide"},
        {type: "separator"},
        {role: "quit"},
      ],
    },
    {
      label: "文件",
      submenu: [
        {
          label: "打开工作目录…",
          accelerator: "CmdOrCtrl+O",
          click: () => mainWindow?.webContents.send("studio:menu", "open-workspace"),
        },
        {type: "separator"},
        {role: "close"},
      ],
    },
    {
      label: "编辑",
      submenu: [
        {role: "undo"},
        {role: "redo"},
        {type: "separator"},
        {role: "cut"},
        {role: "copy"},
        {role: "paste"},
        {role: "selectAll"},
      ],
    },
    {
      label: "视图",
      submenu: [
        {role: "reload"},
        {role: "toggleDevTools"},
        {type: "separator"},
        {role: "resetZoom"},
        {role: "zoomIn"},
        {role: "zoomOut"},
        {type: "separator"},
        {role: "togglefullscreen"},
      ],
    },
    {
      label: "窗口",
      submenu: [{role: "minimize"}, {role: "zoom"}, {role: "front"}],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

app.whenReady().then(async () => {
  // Serve local media only when path is under Studio allowlist (same roots as IPC preview).
  protocol.handle("mooncut-media", async (request) => {
    try {
      const url = new URL(request.url);
      // mooncut-media://local/<base64url absolute path>
      const encoded = url.pathname.replace(/^\//u, "");
      const filePath = Buffer.from(encoded, "base64url").toString("utf8");
      const resolved = resolve(filePath);
      if (!existsSync(resolved)) {
        return new Response("Not found", {status: 404});
      }
      const roots = await collectMediaAllowlist(services.paths, services.runtime);
      if (!isPathAllowed(resolved, roots)) {
        return new Response("Forbidden", {status: 403});
      }
      return net.fetch(pathToFileURL(resolved).href);
    } catch {
      return new Response("Bad request", {status: 400});
    }
  });

  registerIpc(services);
  installMenu();
  await createWindow();
  await bootstrapAgent(services);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void services.supervisor.stop();
});

// Camera/mic/display only for our own renderer pages (teleprompter/record); never blanket-allow.
app.on("web-contents-created", (_event, contents) => {
  contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(shouldGrantPermission(permission, webContents.getURL()));
  });
});
