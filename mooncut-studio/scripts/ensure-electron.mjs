/**
 * Ensure Electron binary is fully installed (handles npm allowScripts skipping postinstall).
 */
import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, writeFileSync, rmSync, cpSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {createWriteStream} from "node:fs";
import {pipeline} from "node:stream/promises";
import {Readable} from "node:stream";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const root = new URL("..", import.meta.url).pathname;
const electronDir = join(root, "node_modules", "electron");
const pathTxt = join(electronDir, "path.txt");
const platformPath = process.platform === "darwin"
  ? "Electron.app/Contents/MacOS/Electron"
  : process.platform === "win32"
    ? "electron.exe"
    : "electron";

const framework = join(electronDir, "dist", "Electron.app", "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Electron Framework");
const needs = !existsSync(pathTxt) || (process.platform === "darwin" && !existsSync(framework));

if (!needs) {
  console.log("[ensure-electron] already installed");
  process.exit(0);
}

if (!existsSync(electronDir)) {
  console.error("[ensure-electron] electron package missing; run npm install first");
  process.exit(1);
}

const {version} = require(join(electronDir, "package.json"));
const arch = process.arch === "arm64" ? "arm64" : "x64";
const asset = process.platform === "darwin"
  ? `electron-v${version}-darwin-${arch}.zip`
  : process.platform === "win32"
    ? `electron-v${version}-win32-${arch}.zip`
    : `electron-v${version}-linux-${arch}.zip`;
const url = `https://github.com/electron/electron/releases/download/v${version}/${asset}`;
const zipPath = join(tmpdir(), asset);

console.log(`[ensure-electron] downloading ${url}`);
const response = await fetch(url);
if (!response.ok) {
  console.error(`[ensure-electron] download failed ${response.status}`);
  process.exit(1);
}
await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));

const dist = join(electronDir, "dist");
rmSync(dist, {recursive: true, force: true});
mkdirSync(dist, {recursive: true});
const unzip = spawnSync("unzip", ["-q", zipPath, "-d", dist], {stdio: "inherit"});
if (unzip.status !== 0) {
  console.error("[ensure-electron] unzip failed");
  process.exit(1);
}
writeFileSync(pathTxt, platformPath);
console.log("[ensure-electron] ready", version);
