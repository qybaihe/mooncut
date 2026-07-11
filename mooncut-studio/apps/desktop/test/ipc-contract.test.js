import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {IPC_CHANNELS} from "@mooncut/studio-shared";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("preload and main reference the same IPC channels", async () => {
  const preload = await readFile(join(root, "src/preload/index.ts"), "utf8");
  const mainIpc = await readFile(join(root, "src/main/ipc.ts"), "utf8");
  assert.ok(preload.includes("contextBridge.exposeInMainWorld"));
  // Preload inlines channel strings for sandbox CJS bundle (no package import).
  assert.ok(preload.includes("studio:settings:get"));
  assert.ok(preload.includes(IPC_CHANNELS.settingsGet));
  assert.ok(mainIpc.includes("ipcMain.handle"));
  const main = await readFile(join(root, "src/main/index.ts"), "utf8");
  assert.ok(main.includes("contextIsolation: true"));
  assert.ok(main.includes("nodeIntegration: false"));
  assert.ok(main.includes("sandbox: true"));
  assert.ok(main.includes("index.cjs"));
});

test("no login routes in renderer shell", async () => {
  const appVue = await readFile(join(root, "src/renderer/App.vue"), "utf8");
  assert.equal(/login|register|邮箱|Cookie/iu.test(appVue), false);
});
