import { randomUUID } from "node:crypto";
import { link, mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { type ChineseMatchPage, type ChineseMatchView } from "./models.js";

const VIEW_LABELS: Readonly<Record<ChineseMatchView, string>> = {
  ratings: "球员评分",
  match: "赛况",
  chat: "聊天"
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface ChineseScreenshotOptions {
  outPath: string;
  view?: ChineseMatchView;
  overwrite?: boolean;
  timeoutMs?: number;
  headless?: boolean;
  log?: (message: string) => void;
}

export interface ChineseScreenshotResult {
  path: string;
  url: string;
  view: ChineseMatchView;
  width: number;
  height: number;
}

export interface ChineseScreenshotRuntime {
  capture?: (
    url: string,
    temporaryPath: string,
    view: ChineseMatchView,
    options: ChineseScreenshotOptions
  ) => Promise<{ width: number; height: number }>;
}

export class ChineseScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChineseScreenshotError";
  }
}

async function pathExists(path: string): Promise<boolean> {
  return Boolean(await stat(path).catch(() => null));
}

function temporaryPath(outPath: string): string {
  const extension = extname(outPath) || ".png";
  const stem = basename(outPath, extname(outPath)) || "wc26-match";
  return join(dirname(outPath), `.${stem}.part-${process.pid}-${randomUUID()}${extension}`);
}

async function publish(temporary: string, final: string, overwrite: boolean): Promise<void> {
  if (overwrite) {
    await rename(temporary, final);
    return;
  }
  try {
    await link(temporary, final);
    await unlink(temporary).catch(() => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ChineseScreenshotError(`截图文件已存在：${final}`);
    }
    throw error;
  }
}

export async function screenshotChineseMatch(
  page: ChineseMatchPage,
  options: ChineseScreenshotOptions,
  runtime: ChineseScreenshotRuntime = {}
): Promise<ChineseScreenshotResult> {
  const view = options.view ?? "ratings";
  const url = page.views[view];
  if (!url) throw new ChineseScreenshotError(`中文页面不支持视图：${view}`);
  if (!options.overwrite && (await pathExists(options.outPath))) {
    throw new ChineseScreenshotError(`截图文件已存在：${options.outPath}`);
  }
  await mkdir(dirname(options.outPath), { recursive: true });

  const temporary = temporaryPath(options.outPath);
  let published = false;
  try {
    options.log?.(`正在生成百度体育${VIEW_LABELS[view]}截图…`);
    const dimensions = await (runtime.capture ?? capturePage)(url, temporary, view, options);
    const file = await stat(temporary).catch(() => null);
    if (!file || file.size <= 0) throw new ChineseScreenshotError("截图输出为空");
    await publish(temporary, options.outPath, options.overwrite ?? false);
    published = true;
    return { path: options.outPath, url, view, ...dimensions };
  } finally {
    if (!published) await unlink(temporary).catch(() => {});
  }
}

async function capturePage(
  url: string,
  temporaryPath: string,
  view: ChineseMatchView,
  options: ChineseScreenshotOptions
): Promise<{ width: number; height: number }> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new ChineseScreenshotError(
      "截图功能需要 Playwright。请先运行 npm install && npx playwright install chromium"
    );
  }

  const timeout = options.timeoutMs ?? 30_000;
  const browser = await playwright.chromium.launch({ headless: options.headless ?? true });
  try {
    // Load the desktop page first, then crop its 890px content column. This
    // preserves Baidu's desktop player-rating layout without white sidebars.
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, userAgent: UA });
    await page.goto(url, { waitUntil: "load", timeout });

    const main = page.locator("main");
    await main.waitFor({ state: "visible", timeout });
    const tab = page.getByRole("tab", { name: VIEW_LABELS[view], exact: true });
    if ((await tab.count()) !== 1) {
      throw new ChineseScreenshotError(`百度体育未提供${VIEW_LABELS[view]}标签`);
    }
    if ((await tab.getAttribute("aria-selected")) !== "true") {
      await tab.click();
    }
    if (view === "ratings") {
      await page
        .waitForFunction(
          () => document.querySelector("main")?.textContent?.includes("人已评分"),
          undefined,
          { timeout: Math.min(timeout, 8_000) }
        )
        .catch(() => {
          throw new ChineseScreenshotError("该场比赛的球员评分尚未发布");
        });
    }
    await page.evaluate(async () => {
      await document.fonts?.ready;
      window.scrollTo(0, 0);
    });

    const box = await main.boundingBox();
    if (!box || box.width < 600) {
      throw new ChineseScreenshotError("无法识别百度体育桌面页面主体");
    }
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const clip = {
      x: Math.max(0, Math.round(box.x)),
      y: 0,
      width: Math.min(Math.round(box.width), 1280 - Math.max(0, Math.round(box.x))),
      height: Math.min(720, Math.max(1, Math.round(documentHeight)))
    };
    await page.screenshot({ path: temporaryPath, type: "png", clip });
    return { width: clip.width, height: clip.height };
  } catch (error) {
    if (error instanceof ChineseScreenshotError) throw error;
    throw new ChineseScreenshotError(`百度体育页面截图失败：${String(error)}`);
  } finally {
    await browser.close();
  }
}
