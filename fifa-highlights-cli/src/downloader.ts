import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { Response as PlaywrightResponse } from "playwright";
import {
  FifaWorldCup26Error,
  FIFA_CONTENT_API,
  FIFA_WATCH_BASE,
  type FetchLike
} from "./client.js";

/**
 * FIFA serves match highlights through THEOplayer on a Verizon/Uplynk CDN.
 * The watch page only exposes a public HLS *master* playlist; the actual
 * variant/segment URLs are authorised per browser session by THEOplayer's
 * Verizon-Media integration and return HTTP 403 to plain HTTP clients.
 *
 * To download we therefore (1) load the official watch page in a headless
 * browser so THEOplayer resolves an authorised manifest, (2) capture that
 * manifest URL, and (3) hand it to ffmpeg for a clean, stream-copy download.
 */

/** FIFA's Verizon Media owner id (stable; used to build the public master URL). */
export const FIFA_VERIZON_OWNER_ID = "5d8e9ef63a204d0b8cb71b50093bde7d";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface ResolvedStream {
  videoId: string;
  externalVerizonAssetId: string;
  /** Public HLS master playlist. Useful for manual players; children may 403. */
  masterUrl: string;
}

/**
 * Pure-HTTP resolution of the public HLS master playlist for a highlight.
 * Returns the `ext` master URL; the authorised variant is resolved at
 * download time inside the browser. Never downloads anything.
 */
export async function resolveStreamUrl(
  videoId: string,
  fetchImpl: FetchLike = fetch
): Promise<ResolvedStream> {
  const endpoint = new URL(`videoPlayerData/${encodeURIComponent(videoId)}`, FIFA_CONTENT_API);
  endpoint.searchParams.set("locale", "en");
  let res: Response | null = null;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      res = await fetchImpl(endpoint.toString(), {
        headers: {
          "user-agent": UA,
          accept: "application/json",
          referer: `${FIFA_WATCH_BASE}/en/watch/${encodeURIComponent(videoId)}`
        }
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(200 * (attempt + 1));
    }
  }
  if (!res) throw new FifaWorldCup26Error(`无法读取 FIFA 视频源信息：${String(lastError)}`);
  if (!res.ok) {
    throw new FifaWorldCup26Error(`FIFA 视频源接口返回 HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    externalVerizonAssetId?: string;
    preplayParameters?: { queryStr?: string };
  };
  const externalVerizonAssetId = data.externalVerizonAssetId;
  if (!externalVerizonAssetId) {
    throw new FifaWorldCup26Error("FIFA 未返回可下载的视频标识");
  }
  const queryStr = data.preplayParameters?.queryStr ?? "";
  const masterUrl =
    `https://content.uplynk.com/ext/${FIFA_VERIZON_OWNER_ID}/` +
    `${encodeURIComponent(externalVerizonAssetId)}.m3u8?${queryStr}`;
  return { videoId, externalVerizonAssetId, masterUrl };
}

export interface DownloadOptions {
  /** Destination file path for the downloaded video (e.g. `/tmp/foo.mp4`). */
  outPath: string;
  /** Browser/network timeout in milliseconds (default 30000). */
  timeoutMs?: number;
  /** Run Chromium headed (useful for debugging). Default headless. */
  headless?: boolean;
  /** Override ffmpeg binary path. */
  ffmpegPath?: string;
  /** Override ffprobe binary path used for output validation. */
  ffprobePath?: string;
  /** Expected video duration; output shorter than 95% is rejected and retried once. */
  expectedDurationSeconds?: number | null;
  /** Allow replacing an existing output file. Default false. */
  overwrite?: boolean;
  /** Override the watch page base (advanced; e.g. behind a proxy). */
  watchUrl?: string;
  /** Progress/log sink. */
  log?: (message: string) => void;
}

export interface OutputValidation {
  durationSeconds: number;
  expectedDurationSeconds: number | null;
  durationRatio: number | null;
}

/** Injectable process hooks used by embedders and deterministic tests. */
export interface DownloadRuntime {
  captureManifest?: (videoId: string, options: DownloadOptions) => Promise<string>;
  runFfmpeg?: (
    manifestUrl: string,
    outPath: string,
    ffmpegPath: string | undefined,
    overwrite: boolean,
    log: (message: string) => void
  ) => Promise<void>;
  validateOutput?: (
    outPath: string,
    ffprobePath: string | undefined,
    expectedDurationSeconds: number | null
  ) => Promise<OutputValidation | void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Download a highlight to `outPath` by resolving an authorised manifest in a
 * headless browser and streaming it through ffmpeg.
 */
export async function downloadHighlight(
  videoId: string,
  options: DownloadOptions,
  runtime: DownloadRuntime = {}
): Promise<string> {
  const log = options.log ?? (() => {});
  const overwrite = options.overwrite ?? false;
  if (!overwrite && (await pathExists(options.outPath))) {
    throw new FifaWorldCup26Error(`输出文件已存在：${options.outPath}`);
  }

  await mkdir(dirname(options.outPath), { recursive: true });
  const maximumAttempts = 2;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const temporaryPath = temporaryOutputPath(options.outPath, "part");
    let published = false;
    try {
      log(
        attempt === 1
          ? "正在通过浏览器解析 FIFA 授权播放地址…"
          : `正在重新获取 FIFA 授权播放地址（第 ${attempt}/${maximumAttempts} 次）…`
      );
      const manifestUrl = await (runtime.captureManifest ?? captureAuthorizedManifest)(
        videoId,
        options
      );
      log(`已获取授权播放地址，开始用 ffmpeg 下载到 ${options.outPath} …`);
      await (runtime.runFfmpeg ?? runFfmpeg)(
        manifestUrl,
        temporaryPath,
        options.ffmpegPath,
        false,
        log
      );
      const validation = await (runtime.validateOutput ?? validateOutput)(
        temporaryPath,
        options.ffprobePath,
        options.expectedDurationSeconds ?? null
      );
      if (
        validation &&
        validation.durationRatio !== null &&
        validation.durationRatio < 0.99
      ) {
        log(
          `提示：输出时长为 FIFA 元数据的 ${(validation.durationRatio * 100).toFixed(1)}%；` +
          "媒体已通过兼容性校验，差异通常来自 HLS 时间轴不连续。"
        );
      }
      await publishOutput(temporaryPath, options.outPath, overwrite);
      published = true;
      return options.outPath;
    } catch (caught) {
      if (attempt < maximumAttempts && isRetryableDownloadError(caught)) {
        log(`下载完整性校验未通过，将重新下载：${errorMessage(caught)}`);
        continue;
      }
      throw caught;
    } finally {
      if (!published) await unlink(temporaryPath).catch(() => {});
    }
  }
  throw new FifaWorldCup26Error("下载重试次数已用尽");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableDownloadError(error: unknown): boolean {
  const message = errorMessage(error);
  return /下载文件不完整|ffmpeg 退出码/.test(message);
}

async function pathExists(path: string): Promise<boolean> {
  return Boolean(await stat(path).catch(() => null));
}

function temporaryOutputPath(outPath: string, role: "part" | "backup"): string {
  const extension = extname(outPath) || ".mp4";
  const stem = basename(outPath, extname(outPath)) || "fifa-highlight";
  return join(
    dirname(outPath),
    `.${stem}.${role}-${process.pid}-${randomUUID()}${extension}`
  );
}

async function publishOutput(
  temporaryPath: string,
  outPath: string,
  overwrite: boolean
): Promise<void> {
  if (!overwrite) {
    try {
      // Creating the final hard link is atomic and fails rather than replacing
      // a file that appeared while the download was running.
      await link(temporaryPath, outPath);
      await unlink(temporaryPath).catch(() => {});
      return;
    } catch (caught) {
      const code = (caught as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        throw new FifaWorldCup26Error(`输出文件已存在：${outPath}`);
      }
      throw new FifaWorldCup26Error(`无法发布下载文件：${String(caught)}`);
    }
  }

  try {
    // POSIX rename atomically replaces the old file only after the temporary
    // download has passed ffprobe validation.
    await rename(temporaryPath, outPath);
    return;
  } catch (caught) {
    if (!(await pathExists(outPath))) throw caught;

    // Windows may reject rename-over-existing. Preserve the old good file in
    // a sibling backup until the validated replacement is in place.
    const backupPath = temporaryOutputPath(outPath, "backup");
    await rename(outPath, backupPath);
    try {
      await rename(temporaryPath, outPath);
      await unlink(backupPath).catch(() => {});
    } catch (replacementError) {
      await rename(backupPath, outPath).catch(() => {});
      throw replacementError;
    }
  }
}

async function captureAuthorizedManifest(videoId: string, options: DownloadOptions): Promise<string> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new FifaWorldCup26Error(
      "下载功能需要 Playwright。请先安装：npm install playwright && npx playwright install chromium"
    );
  }

  const timeout = options.timeoutMs ?? 30000;
  const browser = await playwright.chromium.launch({ headless: options.headless ?? true });
  try {
    const page = await browser.newPage({ userAgent: UA });
    const watchUrl = options.watchUrl ?? `${FIFA_WATCH_BASE}/en/watch/${encodeURIComponent(videoId)}`;

    let captured: string | null = null;
    const onResponse = async (response: PlaywrightResponse): Promise<void> => {
      if (captured) return;
      const url = response.url();
      if (/uplynk\.(com|net)\/.*\.m3u8(\?|$)/.test(url) && response.ok()) {
        const parsed = new URL(url);
        // Uplynk's authorised media playlists have a short rendition name and
        // a session-bound `pbs` query. Capturing by shape avoids relying on a
        // response body that the player may already have consumed.
        if (parsed.searchParams.has("pbs") && /\/[a-z]\.m3u8$/i.test(parsed.pathname)) {
          captured = url;
          return;
        }
        try {
          const body = await response.text();
          // A media (variant) playlist contains #EXTINF; the master only has
          // #EXT-X-STREAM-INF. We want the authorised variant manifest.
          if (/#EXTINF/.test(body)) captured = url;
        } catch {
          /* response body already consumed elsewhere; ignore */
        }
      }
    };
    page.on("response", onResponse);

    await page.goto(watchUrl, { waitUntil: "domcontentloaded", timeout });

    // OneTrust blocks the player until a consent choice is made on a fresh
    // browser profile. Accepting only affects this disposable local context.
    const consent = page
      .getByRole("button", {
        name: /我同意|accept all|i agree|tout accepter|aceptar todo|alle akzeptieren/i
      })
      .first();
    await consent
      .waitFor({ state: "visible", timeout: Math.min(5000, timeout) })
      .then(() => consent.click())
      .catch(() => {});

    const waitForManifest = async (waitMs: number): Promise<void> => {
      const deadline = Date.now() + waitMs;
      while (!captured && Date.now() < deadline) await sleep(250);
    };
    await waitForManifest(Math.min(6000, timeout));

    if (!captured) {
      // THEOplayer may defer loading the source until playback starts.
      await page
        .evaluate(() => {
          const video = document.querySelector("video");
          const player = video as unknown as { play?: () => Promise<void> } | null;
          player?.play?.().catch(() => {});
        })
        .catch(() => {});
      // Give the explicit playback attempt its own wait window. The old code
      // reused an already-expired deadline and therefore never actually waited.
      await waitForManifest(timeout);
    }

    if (!captured) {
      throw new FifaWorldCup26Error("无法在浏览器会话中解析授权播放地址（超时）");
    }
    return captured;
  } finally {
    await browser.close();
  }
}

function runFfmpeg(
  manifestUrl: string,
  outPath: string,
  ffmpegPath: string | undefined,
  overwrite: boolean,
  log: (message: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const binary = ffmpegPath ?? "ffmpeg";
    const args = [
      overwrite ? "-y" : "-n",
      "-loglevel",
      "error",
      "-user_agent",
      UA,
      "-referer",
      "https://www.fifa.com/",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      "-rw_timeout",
      "15000000",
      // We know the captured manifest is HLS; force the demuxer so ffmpeg
      // never has to probe (probing can mis-score short/clipped manifests).
      "-f",
      "hls",
      "-i",
      manifestUrl,
      "-c",
      "copy",
      "-bsf:a",
      "aac_adtstoasc",
      outPath
    ];
    // ffmpeg inherits the parent env. When the captured manifest lives on a
    // loopback address (e.g. a local mock during testing) we must bypass any
    // HTTP(S) proxy so ffmpeg can open it directly; normal hosts keep using
    // whatever proxy the user configured.
    const env = { ...process.env };
    const existingNoProxy = (env.NO_PROXY ?? env.no_proxy ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const loopback = ["127.0.0.1", "localhost", "[::1]"];
    const noProxy = [...new Set([...existingNoProxy, ...loopback])].join(",");
    env.NO_PROXY = noProxy;
    env.no_proxy = noProxy;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, { env });
    } catch (error) {
      reject(
        new FifaWorldCup26Error(
          `无法启动 ffmpeg（${binary}）。请安装 ffmpeg 后重试：${String(error)}`
        )
      );
      return;
    }
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      // Buffer complete stderr so a signed URL split across chunks can never
      // evade redaction. ffmpeg runs at error level, so this remains small.
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) =>
      reject(new FifaWorldCup26Error(`ffmpeg 启动失败：${error.message}`))
    );
    child.on("close", (code) => {
      const sanitized = stderr
        .trim()
        .replace(/https?:\/\/\S+/g, "[FIFA media URL redacted]");
      if (sanitized) log(sanitized);
      if (code === 0) resolve();
      else reject(new FifaWorldCup26Error(`ffmpeg 退出码 ${code}；下载未完成`));
    });
  });
}

async function validateOutput(
  outPath: string,
  ffprobePath: string | undefined,
  expectedDurationSeconds: number | null
): Promise<OutputValidation> {
  const file = await stat(outPath).catch(() => null);
  if (!file || file.size <= 0) {
    throw new FifaWorldCup26Error("下载结束但输出文件为空");
  }

  const duration = await new Promise<number>((resolve, reject) => {
    const child = spawn(ffprobePath ?? "ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      outPath
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error: Error) =>
      reject(new FifaWorldCup26Error(`ffprobe 启动失败：${error.message}`))
    );
    child.on("close", (code) => {
      let payload: {
        format?: { duration?: string };
        streams?: Array<{ codec_type?: string }>;
      } = {};
      try {
        payload = JSON.parse(stdout) as typeof payload;
      } catch {
        /* handled by the validation error below */
      }
      const parsedDuration = Number(payload.format?.duration);
      if (code !== 0 || !Number.isFinite(parsedDuration) || parsedDuration <= 0) {
        reject(
          new FifaWorldCup26Error(
            `下载文件校验失败${stderr.trim() ? `：${stderr.trim()}` : ""}`
          )
        );
      } else if (!payload.streams?.some((stream) => stream.codec_type === "video")) {
        reject(new FifaWorldCup26Error("下载文件校验失败：未检测到视频流"));
      } else {
        resolve(parsedDuration);
      }
    });
  });

  const durationRatio = expectedDurationSeconds ? duration / expectedDurationSeconds : null;
  if (
    expectedDurationSeconds !== null &&
    durationRatio !== null &&
    durationRatio < 0.95
  ) {
    throw new FifaWorldCup26Error(
      `下载文件不完整：实际 ${duration.toFixed(1)} 秒，预期约 ${expectedDurationSeconds.toFixed(1)} 秒`
    );
  }
  return { durationSeconds: duration, expectedDurationSeconds, durationRatio };
}
