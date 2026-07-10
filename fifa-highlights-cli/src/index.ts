#!/usr/bin/env node

import {
  CATALOG_URL,
  FifaWorldCup26Client,
  FifaWorldCup26Error,
  type FindMode
} from "./client.js";
import { BaiduSportsClient, BaiduSportsError } from "./baidu.js";
import { downloadHighlight, type DownloadOptions } from "./downloader.js";
import {
  CliPayload,
  SearchResult,
  type ChineseMatchPage,
  type ChineseMatchView
} from "./models.js";
import {
  ChineseScreenshotError,
  screenshotChineseMatch,
  type ChineseScreenshotOptions,
  type ChineseScreenshotResult
} from "./screenshot.js";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface MainDependencies {
  clientFactory?: () => Pick<FifaWorldCup26Client, "find">;
  opener?: (url: string) => unknown;
  write?: (message: string) => void;
  error?: (message: string) => void;
  downloader?: (videoId: string, options: DownloadOptions) => Promise<string>;
  cnClientFactory?: () => Pick<BaiduSportsClient, "findMatch">;
  screenshotter?: (
    page: ChineseMatchPage,
    options: ChineseScreenshotOptions
  ) => Promise<ChineseScreenshotResult>;
}

interface ParsedArgs {
  command: "highlight" | "team" | "match" | "download";
  query: string;
  limit: number;
  json: boolean;
  open: boolean;
  download: boolean;
  out: string | null;
  force: boolean;
  cn: boolean;
  openCn: boolean;
  screenshot: string | null;
  view: ChineseMatchView;
}

interface CommandError {
  code: string;
  message: string;
  exitCode: number;
}

type CommandPayload = CliPayload & {
  download?: { status: "completed" | "failed"; path?: string; error?: string };
  screenshot?: {
    status: "completed" | "failed";
    path?: string;
    url?: string;
    view: ChineseMatchView;
    width?: number;
    height?: number;
    error?: string;
  };
  error?: CommandError;
  help?: string;
};

function usage(): string {
  return [
    "用法：",
    '  wc26 highlight "阿根廷 vs 埃及" [--limit 5] [--json] [--open] [--download] [--out 路径]',
    "  wc26 team 阿根廷 [--limit 5] [--json] [--open] [--download] [--out 路径]",
    "  wc26 match M95 [--json] [--open] [--download] [--out 路径]",
    '  wc26 download "阿根廷 vs 埃及" [--out 路径] [--force]',
    "  wc26 match M95 --cn [--open-cn] [--view ratings|match|chat]",
    "  wc26 match M95 --screenshot 截图.png [--view ratings|match|chat] [--force]",
    "",
    "也可简写：wc26 \"阿根廷 vs 埃及\"",
    "",
    "下载选项：",
    "  --download  在解析到官方集锦后，用无头浏览器 + ffmpeg 下载视频",
    "  --out PATH  指定输出文件或目录（默认当前目录，自动命名）",
    "  --force     允许覆盖已存在的输出文件（默认拒绝覆盖）",
    "  --cn        查找百度体育中文比赛详情页",
    "  --open-cn   在浏览器打开中文比赛页（默认球员评分）",
    "  --screenshot PATH  截取中文比赛页主体为 PNG（无左右白边）",
    "  --view VIEW  中文页面视图：ratings（默认）、match、chat",
    "  注意：下载依赖 Playwright 与 ffmpeg，首次使用需：",
    "        npm install playwright && npx playwright install chromium"
  ].join("\n");
}

function safeFileName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w一-龥- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-")
    .slice(0, 120) || "fifa-highlight";
}

function defaultOutName(result: SearchResult): string {
  const match = result.match;
  const stagePart = match.stage ? ` ${match.stage}` : "";
  const numberPart = match.number !== null ? ` M${match.number}` : "";
  return `${safeFileName(`${match.home} vs ${match.away}${stagePart}${numberPart}`)}.mp4`;
}

function defaultScreenshotName(result: SearchResult, view: ChineseMatchView): string {
  const numberPart = result.match.number !== null ? ` M${result.match.number}` : "";
  return `${safeFileName(`${result.match.home} vs ${result.match.away}${numberPart} ${view}`)}.png`;
}

function resolveOutPath(out: string | null, defaultName: string): string {
  let target: string;
  if (!out) {
    target = defaultName;
  } else if (
    out.endsWith("/") ||
    out.endsWith("\\") ||
    (!existsSync(out) && extname(out) === "")
  ) {
    target = join(out, defaultName);
  } else {
    target = out;
  }
  try {
    if (out && existsSync(out) && statSync(out).isDirectory()) target = join(out, defaultName);
  } catch {
    /* fall through and treat as file path */
  }
  const absolute = resolve(target);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

function resolveScreenshotPath(input: string, defaultName: string): string {
  let target = input;
  if (input.endsWith("/") || input.endsWith("\\")) {
    target = join(input, defaultName);
  } else if (existsSync(input) && statSync(input).isDirectory()) {
    target = join(input, defaultName);
  } else if (extname(input) === "") {
    target = `${input}.png`;
  } else if (extname(input).toLocaleLowerCase() !== ".png") {
    throw new Error("截图路径必须使用 .png 扩展名");
  }
  const absolute = resolve(target);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

function parseArgs(input: readonly string[]): ParsedArgs | { help: true; error?: string } {
  const args = [...input];
  if (!args.length || args.includes("-h") || args.includes("--help")) return { help: true };

  const commands = new Set(["highlight", "team", "match", "download"]);
  if (!commands.has(args[0])) args.unshift("highlight");
  const command = args.shift() as ParsedArgs["command"];
  const positionals: string[] = [];
  let json = false;
  let open = false;
  let download = false;
  let out: string | null = null;
  let force = false;
  let cn = false;
  let openCn = false;
  let screenshot: string | null = null;
  let view: ChineseMatchView = "ratings";
  let viewSpecified = false;
  let limit = 5;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
    } else if (argument === "--open") {
      open = true;
    } else if (argument === "--download") {
      download = true;
    } else if (argument === "--force") {
      force = true;
    } else if (argument === "--cn") {
      cn = true;
    } else if (argument === "--open-cn") {
      openCn = true;
      cn = true;
    } else if (argument === "--screenshot") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        return { help: true, error: "--screenshot 需要指定 PNG 路径" };
      }
      screenshot = value;
      cn = true;
      index += 1;
    } else if (argument === "--view") {
      const value = args[index + 1] as ChineseMatchView | undefined;
      if (!value || !(["ratings", "match", "chat"] as string[]).includes(value)) {
        return { help: true, error: "--view 必须是 ratings、match 或 chat" };
      }
      view = value;
      viewSpecified = true;
      index += 1;
    } else if (argument === "--out") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) return { help: true, error: "--out 需要指定路径" };
      out = value;
      index += 1;
    } else if (argument === "--limit") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1) return { help: true, error: "--limit 必须是正整数" };
      limit = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      return { help: true, error: `未知选项：${argument}` };
    } else {
      positionals.push(argument);
    }
  }
  if (command === "download") download = true;
  if (viewSpecified && !cn) {
    return { help: true, error: "--view 需要与 --cn、--open-cn 或 --screenshot 一起使用" };
  }
  if (!positionals.length) return { help: true, error: "缺少比赛或球队查询" };
  return {
    command,
    query: positionals.join(" "),
    limit,
    json,
    open,
    download,
    out,
    force,
    cn,
    openCn,
    screenshot,
    view
  };
}

function score(result: SearchResult): string | null {
  const { homeScore, awayScore } = result.match;
  return homeScore === null || awayScore === null ? null : `${homeScore}-${awayScore}`;
}

function payload(query: string, results: readonly SearchResult[]): CliPayload {
  return {
    query,
    provider: "FIFA",
    catalogUrl: CATALOG_URL,
    results: results.map((result) => ({
      match: { ...result.match, score: score(result) },
      video: result.highlight,
      availability: result.highlight ? "available" : "not_published",
      fallbackUrl: result.fallbackUrl
    }))
  };
}

function addError(
  output: CommandPayload,
  code: string,
  message: string,
  exitCode: number
): CommandPayload {
  output.error = { code, message, exitCode };
  return output;
}

function printJson(output: CommandPayload, write: (message: string) => void): void {
  write(JSON.stringify(output, null, 2));
}

function formatDate(iso: string | null): string {
  if (!iso) return "时间待定";
  return `${iso.replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC")}`;
}

function printResults(results: readonly SearchResult[], write: (message: string) => void): void {
  for (const [index, result] of results.entries()) {
    const matchScore = score(result);
    const stage = result.match.stage ? ` · ${result.match.stage}` : "";
    const scorePart = matchScore ? ` · ${matchScore}` : "";
    write(`${index + 1}. ${result.match.home} vs ${result.match.away}${scorePart}${stage}`);
    write(`   M${result.match.number ?? "?"} · ${formatDate(result.match.kickoff)} · ${result.match.status}`);
    if (result.highlight) {
      const duration = result.highlight.durationSeconds === null ? "" : ` · ${Math.round(result.highlight.durationSeconds)}s`;
      write(`   官方 FIFA 集锦${duration}: ${result.highlight.url}`);
    } else {
      write("   官方集锦尚未发布或暂未被目录收录。");
      write(`   官方集锦目录: ${result.fallbackUrl}`);
    }
  }
}

function printChinesePage(
  page: ChineseMatchPage,
  view: ChineseMatchView,
  write: (message: string) => void
): void {
  const scorePart = page.score ? ` · ${page.score}` : "";
  const summaryPart = page.summary ? ` · ${page.summary}` : "";
  write(`   中文赛况：${page.home} vs ${page.away}（百度体育${scorePart}）${summaryPart}`);
  write(`   ${page.views[view]}`);
}

function defaultOpener(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, (error) => (error ? reject(error) : resolvePromise()));
  });
}

async function openFirst(
  results: readonly SearchResult[],
  opener: (url: string) => unknown
): Promise<boolean> {
  const highlight = results.find((result) => result.highlight)?.highlight;
  if (!highlight) return false;
  const parsed = new URL(highlight.url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.fifa.com") return false;
  await opener(highlight.url);
  return true;
}

export async function main(
  argv = process.argv.slice(2),
  dependencies: MainDependencies = {}
): Promise<number> {
  const write = dependencies.write ?? console.log;
  const error = dependencies.error ?? console.error;
  const jsonRequested = argv.includes("--json");
  const parsed = parseArgs(argv);
  if ("help" in parsed) {
    if (parsed.error) error(parsed.error);
    if (jsonRequested) {
      const output: CommandPayload = { ...payload(argv.join(" ").trim(), []), help: usage() };
      if (parsed.error) addError(output, "invalid_arguments", parsed.error, 2);
      printJson(output, write);
    } else {
      write(usage());
    }
    return parsed.error ? 2 : 0;
  }

  const client = (dependencies.clientFactory ?? (() => new FifaWorldCup26Client()))();
  let results: SearchResult[];
  try {
    const mode: FindMode = parsed.command === "download" ? "highlight" : parsed.command;
    results = await client.find(parsed.query, parsed.limit, mode);
  } catch (caught) {
    const message = caught instanceof FifaWorldCup26Error ? caught.message : String(caught);
    error(`无法读取 FIFA 官方数据：${message}`);
    if (parsed.json) {
      printJson(addError(payload(parsed.query, []), "fifa_request_failed", message, 1), write);
    }
    return 1;
  }

  if (!results.length) {
    const message = `未能识别查询：${parsed.query}`;
    error(message);
    if (parsed.json) {
      printJson(addError(payload(parsed.query, []), "no_results", message, 2), write);
    } else {
      write('示例：wc26 highlight "阿根廷 vs 埃及"  或  wc26 team 阿根廷');
    }
    return 2;
  }

  const output: CommandPayload = payload(parsed.query, results);
  if (!parsed.json) printResults(results, write);

  let chinesePages: Array<ChineseMatchPage | null> = [];
  let firstChinesePage: ChineseMatchPage | null = null;
  if (parsed.cn) {
    const cnClient = (dependencies.cnClientFactory ?? (() => new BaiduSportsClient()))();
    const settled = await Promise.allSettled(
      results.map((result) => cnClient.findMatch(result.match))
    );
    const requestErrors = settled
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    chinesePages = settled.map((result) =>
      result.status === "fulfilled" ? result.value : null
    );
    for (const [index, page] of chinesePages.entries()) {
      output.results[index].chinesePage = page;
      if (page && !parsed.json) printChinesePage(page, parsed.view, write);
    }
    firstChinesePage = chinesePages.find((page): page is ChineseMatchPage => Boolean(page)) ?? null;
    if (!firstChinesePage) {
      const requestError = requestErrors[0];
      const message = requestError
        ? `无法读取百度体育中文比赛页：${
            requestError instanceof BaiduSportsError ? requestError.message : String(requestError)
          }`
        : "未找到对应的百度体育中文比赛页。";
      error(message);
      if (parsed.json) {
        printJson(
          addError(output, requestError ? "cn_request_failed" : "cn_not_found", message, requestError ? 1 : 2),
          write
        );
      }
      return requestError ? 1 : 2;
    }
  }

  if (parsed.open) {
    try {
      if (!(await openFirst(results, dependencies.opener ?? defaultOpener)) && !parsed.json) {
        write("没有可打开的官方集锦；可查看上方 FIFA 官方目录。");
      }
    } catch (caught) {
      const message = `无法打开浏览器：${String(caught)}`;
      error(message);
      if (parsed.json) printJson(addError(output, "open_failed", message, 1), write);
      return 1;
    }
  }

  if (parsed.openCn && firstChinesePage) {
    try {
      const url = new URL(firstChinesePage.views[parsed.view]);
      if (url.protocol !== "https:" || url.hostname !== "tiyu.baidu.com") {
        throw new Error(`不可信的中文比赛页面：${url.toString()}`);
      }
      await (dependencies.opener ?? defaultOpener)(url.toString());
    } catch (caught) {
      const message = `无法打开中文比赛页：${String(caught)}`;
      error(message);
      if (parsed.json) printJson(addError(output, "open_cn_failed", message, 1), write);
      return 1;
    }
  }

  if (parsed.screenshot && firstChinesePage) {
    let screenshotPath: string;
    try {
      const targetResult = results[chinesePages.indexOf(firstChinesePage)] ?? results[0];
      screenshotPath = resolveScreenshotPath(
        parsed.screenshot,
        defaultScreenshotName(targetResult, parsed.view)
      );
    } catch (caught) {
      const message = `无法创建截图路径：${String(caught)}`;
      error(message);
      if (parsed.json) {
        output.screenshot = { status: "failed", view: parsed.view, error: message };
        printJson(addError(output, "screenshot_path_failed", message, 1), write);
      }
      return 1;
    }
    if (existsSync(screenshotPath) && !parsed.force) {
      const message = `截图文件已存在：${screenshotPath}（使用 --force 才会覆盖）`;
      error(message);
      if (parsed.json) {
        output.screenshot = {
          status: "failed",
          path: screenshotPath,
          url: firstChinesePage.views[parsed.view],
          view: parsed.view,
          error: message
        };
        printJson(addError(output, "screenshot_exists", message, 2), write);
      }
      return 2;
    }
    try {
      const progress = parsed.json ? error : write;
      const result = await (dependencies.screenshotter ?? screenshotChineseMatch)(
        firstChinesePage,
        {
          outPath: screenshotPath,
          view: parsed.view,
          overwrite: parsed.force,
          log: progress
        }
      );
      output.screenshot = { status: "completed", ...result };
      if (!parsed.json) write(`已保存中文比赛截图：${result.path}`);
    } catch (caught) {
      const message =
        caught instanceof ChineseScreenshotError ? caught.message : String(caught);
      error(`截图失败：${message}`);
      if (parsed.json) {
        output.screenshot = {
          status: "failed",
          path: screenshotPath,
          url: firstChinesePage.views[parsed.view],
          view: parsed.view,
          error: message
        };
        printJson(addError(output, "screenshot_failed", message, 1), write);
      }
      return 1;
    }
  }

  if (parsed.download) {
    const target = results.find((result) => result.highlight);
    if (!target || !target.highlight) {
      const message = "没有可用于下载的官方集锦。";
      error(message);
      if (parsed.json) {
        output.download = { status: "failed", error: message };
        printJson(addError(output, "highlight_unavailable", message, 2), write);
      }
      return 2;
    }
    let outPath: string;
    try {
      outPath = resolveOutPath(parsed.out, defaultOutName(target));
    } catch (caught) {
      const message = `无法创建输出路径：${String(caught)}`;
      error(message);
      if (parsed.json) {
        output.download = {
          status: "failed",
          ...(parsed.out ? { path: resolve(parsed.out) } : {}),
          error: message
        };
        printJson(addError(output, "output_path_failed", message, 1), write);
      }
      return 1;
    }
    if (existsSync(outPath) && !parsed.force) {
      const message = `输出文件已存在：${outPath}（使用 --force 才会覆盖）`;
      error(message);
      if (parsed.json) {
        output.download = { status: "failed", path: outPath, error: message };
        printJson(addError(output, "output_exists", message, 2), write);
      }
      return 2;
    }
    try {
      const progress = parsed.json ? error : write;
      await (dependencies.downloader ?? downloadHighlight)(target.highlight.videoId, {
        outPath,
        overwrite: parsed.force,
        expectedDurationSeconds: target.highlight.durationSeconds,
        log: progress
      });
      output.download = { status: "completed", path: outPath };
      if (!parsed.json) write(`已下载：${outPath}`);
    } catch (caught) {
      const message = caught instanceof FifaWorldCup26Error ? caught.message : String(caught);
      error(`下载失败：${message}`);
      if (parsed.json) {
        output.download = { status: "failed", path: outPath, error: message };
        printJson(addError(output, "download_failed", message, 1), write);
      }
      return 1;
    }
  }
  if (parsed.json) printJson(output, write);
  return 0;
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    // Global npm installs expose `wc26` through a symlink. Comparing real
    // paths keeps the entry point working both through that symlink and when
    // invoked directly with Node/tsx.
    return realpathSync(process.argv[1]) === realpathSync(modulePath);
  } catch {
    return resolve(process.argv[1]) === resolve(modulePath);
  }
}

if (isDirectExecution()) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
