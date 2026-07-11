/**
 * Local dependency detection for MoonCut Studio.
 * Detects bundled runtime (install package) first, then monorepo / PATH.
 */

import {createHash} from "node:crypto";
import {access, constants, readFile, stat} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import type {DependencyInfo} from "@mooncut/studio-shared";

export type BootstrapContext = {
  platform: NodeJS.Platform;
  arch: string;
  /** Repo / bundled runtime root that may contain sibling tools. */
  workspaceRoot: string;
  /** App-managed install root for optional downloads. */
  managedRoot: string;
  /** Optional explicit ffmpeg/ffprobe paths from the app bundle. */
  ffmpegPath?: string | null;
  ffprobePath?: string | null;
};

const exists = async (path: string) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const runCapture = (
  command: string,
  args: string[],
  timeoutMs = 8_000,
  env?: NodeJS.ProcessEnv,
): Promise<{code: number; stdout: string; stderr: string}> =>
  new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: env ? {...process.env, ...env} : process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolvePromise({code: -1, stdout, stderr: stderr || "timeout"});
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({code: -1, stdout, stderr: error.message});
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({code: code ?? -1, stdout, stderr});
    });
  });

export async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

export async function verifySha256(path: string, expected: string): Promise<boolean> {
  const actual = await sha256File(path);
  return actual.toLowerCase() === expected.toLowerCase();
}

async function detectFfmpeg(ctx: BootstrapContext): Promise<DependencyInfo> {
  const candidates = [
    ctx.ffmpegPath,
    join(ctx.workspaceRoot, "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    join(ctx.managedRoot, "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (!(await exists(path))) continue;
    const result = await runCapture(path, ["-version"]);
    if (result.code === 0) {
      return {
        id: "ffmpeg",
        name: "FFmpeg",
        status: "ready",
        version: result.stdout.split("\n")[0]?.trim(),
        path,
        required: true,
        detail: "已随 MoonCut Studio 安装包内置，无需额外配置。",
        platform: ["darwin", "win32", "linux"],
        license: "LGPL/GPL (upstream FFmpeg)",
      };
    }
  }

  const pathResult = await runCapture("ffmpeg", ["-version"]);
  if (pathResult.code === 0) {
    return {
      id: "ffmpeg",
      name: "FFmpeg",
      status: "ready",
      version: pathResult.stdout.split("\n")[0]?.trim(),
      required: true,
      detail: "使用系统 PATH 中的 FFmpeg。",
      platform: ["darwin", "win32", "linux"],
      license: "LGPL/GPL (upstream FFmpeg)",
    };
  }

  return {
    id: "ffmpeg",
    name: "FFmpeg",
    status: "missing",
    required: true,
    detail: "未找到 FFmpeg。请重新安装 Studio 完整包，或将 ffmpeg 加入 PATH。",
    platform: ["darwin", "win32", "linux"],
    license: "LGPL/GPL (upstream FFmpeg)",
  };
}

async function detectNode(): Promise<DependencyInfo> {
  return {
    id: "node-runtime",
    name: "Node / Electron runtime",
    status: "ready",
    version: process.version,
    required: true,
    detail: "Studio 使用 Electron 内嵌运行时托管 Main Process 与 Agent Host。已内置，无需安装 Node。",
    platform: ["darwin", "win32", "linux"],
    license: "MIT (Node.js / Electron)",
  };
}

async function detectPiAgent(ctx: BootstrapContext): Promise<DependencyInfo> {
  const agentRoot = join(ctx.workspaceRoot, "mooncut-pi-agent");
  if (await exists(join(agentRoot, "package.json"))) {
    const hasModules = await exists(join(agentRoot, "node_modules"));
    return {
      id: "pi-agent",
      name: "MoonCut Pi Agent",
      status: hasModules ? "ready" : "degraded",
      path: agentRoot,
      required: true,
      detail: hasModules
        ? "已随安装包内置，Studio 将自动以本地模式启动，无需手动配置端口或 .env。"
        : "Agent 源码已附带，但 node_modules 不完整。请使用完整安装包或在 monorepo 中 npm install。",
      platform: ["darwin", "win32", "linux"],
      license: "UNLICENSED (MoonCut)",
    };
  }
  return {
    id: "pi-agent",
    name: "MoonCut Pi Agent",
    status: "missing",
    required: true,
    detail: "安装包中缺少 Pi Agent。请重新下载完整版 MoonCut Studio。",
    platform: ["darwin", "win32", "linux"],
  };
}

async function detectRemotion(ctx: BootstrapContext): Promise<DependencyInfo> {
  const remotion = join(ctx.workspaceRoot, "remotion-studio");
  if (await exists(join(remotion, "package.json"))) {
    const hasModules = await exists(join(remotion, "node_modules", "remotion"));
    return {
      id: "remotion",
      name: "Remotion Studio",
      status: hasModules ? "ready" : "degraded",
      path: remotion,
      required: false,
      detail: hasModules
        ? "已随安装包内置，真实渲染链路可用（无需单独安装）。"
        : "Remotion 目录存在但依赖不完整。",
      platform: ["darwin", "win32", "linux"],
      license: "Remotion License (company) + project deps",
    };
  }
  return {
    id: "remotion",
    name: "Remotion Studio",
    status: "unavailable",
    required: false,
    detail: "安装包中未包含 Remotion。mock Agent 仍可演示任务流。",
    platform: ["darwin", "win32", "linux"],
  };
}

async function detectFaceTracker(ctx: BootstrapContext): Promise<DependencyInfo> {
  const root = join(ctx.workspaceRoot, "face-tracker");
  if (!(await exists(join(root, "pyproject.toml")))) {
    return {
      id: "face-tracker",
      name: "Face Tracker",
      status: "unavailable",
      required: false,
      detail: "安装包中未包含人脸跟踪组件。",
      platform: ["darwin", "win32", "linux"],
      license: "Project + ultralytics YOLO weights terms",
    };
  }
  const venvPython =
    process.platform === "win32"
      ? join(root, ".venv", "Scripts", "python.exe")
      : join(root, ".venv", "bin", "python");
  const hasWeights =
    (await exists(join(root, "face_tracker", "weights", "yolov8n-face.pt"))) ||
    (await exists(join(root, "weights", "yolov8n-face.pt")));
  if (await exists(venvPython)) {
    return {
      id: "face-tracker",
      name: "Face Tracker",
      status: hasWeights ? "ready" : "degraded",
      path: root,
      required: false,
      detail: hasWeights
        ? "已随安装包内置 Python 环境与模型权重，跟脸阶段可直接使用。"
        : "环境已就绪，但权重文件缺失。",
      platform: ["darwin", "win32", "linux"],
      license: "Project + ultralytics YOLO weights terms",
    };
  }
  return {
    id: "face-tracker",
    name: "Face Tracker",
    status: "degraded",
    path: root,
    required: false,
    detail: "源码已附带，但内置 Python venv 不完整。完整安装包应包含 .venv。",
    platform: ["darwin", "win32", "linux"],
    license: "Project + ultralytics YOLO weights terms",
  };
}

async function detectSubtitleService(ctx: BootstrapContext): Promise<DependencyInfo> {
  const root = join(ctx.workspaceRoot, "hybrid-subtitle-service");
  if (!(await exists(join(root, "pyproject.toml")))) {
    return {
      id: "hybrid-subtitle",
      name: "Hybrid Subtitle Service",
      status: "unavailable",
      required: false,
      detail: "未包含混合字幕服务；Agent 可使用内置转写路径。",
      platform: ["darwin", "win32", "linux"],
    };
  }
  const venv =
    process.platform === "win32"
      ? join(root, ".venv", "Scripts", "python.exe")
      : join(root, ".venv", "bin", "python");
  if (await exists(venv)) {
    return {
      id: "hybrid-subtitle",
      name: "Hybrid Subtitle Service",
      status: "ready",
      path: root,
      required: false,
      detail: "已随安装包内置。完整混合 ASR 仍可按需配置远程 Key；本地能力已就绪。",
      platform: ["darwin", "win32", "linux"],
    };
  }
  return {
    id: "hybrid-subtitle",
    name: "Hybrid Subtitle Service",
    status: "degraded",
    path: root,
    required: false,
    detail: "源码已附带；完整 venv 未打包时会降级到 Agent 内置转写。",
    platform: ["darwin", "win32", "linux"],
  };
}

async function detectDiskSpace(workspaceRoot: string): Promise<DependencyInfo> {
  if (process.platform === "win32") {
    return {
      id: "disk",
      name: "Disk space",
      status: "ready",
      required: true,
      detail: "请确保工作目录所在磁盘至少保留 5 GB 可用空间。",
      platform: ["win32"],
    };
  }
  const result = await runCapture("df", ["-k", workspaceRoot || homedir()]);
  if (result.code === 0) {
    const lines = result.stdout.trim().split("\n");
    const parts = lines[lines.length - 1]?.split(/\s+/u) ?? [];
    const availKb = Number(parts[3]);
    if (Number.isFinite(availKb)) {
      const availBytes = availKb * 1024;
      const ready = availBytes > 5 * 1024 * 1024 * 1024;
      return {
        id: "disk",
        name: "Disk space",
        status: ready ? "ready" : "degraded",
        sizeBytes: availBytes,
        required: true,
        detail: ready
          ? `可用约 ${(availBytes / 1024 ** 3).toFixed(1)} GB。`
          : `可用空间不足 5 GB（约 ${(availBytes / 1024 ** 3).toFixed(1)} GB）。`,
        platform: ["darwin", "linux"],
      };
    }
  }
  return {
    id: "disk",
    name: "Disk space",
    status: "degraded",
    required: true,
    detail: "无法探测磁盘空间。",
    platform: ["darwin", "win32", "linux"],
  };
}

export async function probeDependencies(ctx: BootstrapContext): Promise<DependencyInfo[]> {
  return Promise.all([
    detectNode(),
    detectFfmpeg(ctx),
    detectPiAgent(ctx),
    detectRemotion(ctx),
    detectFaceTracker(ctx),
    detectSubtitleService(ctx),
    detectDiskSpace(ctx.workspaceRoot || ctx.managedRoot || homedir()),
  ]);
}

export function summarizeReadiness(deps: DependencyInfo[]): {
  canOpenProjects: boolean;
  canRunMockAgent: boolean;
  canRunRealAgent: boolean;
  blockers: string[];
} {
  const byId = new Map(deps.map((item) => [item.id, item]));
  const blockers: string[] = [];
  const ffmpeg = byId.get("ffmpeg");
  const agent = byId.get("pi-agent");
  if (agent?.status === "missing") blockers.push("Pi Agent 未安装");
  if (ffmpeg?.status === "missing") blockers.push("FFmpeg 未安装");
  return {
    canOpenProjects: true,
    canRunMockAgent: true,
    canRunRealAgent: agent?.status === "ready" && ffmpeg?.status === "ready",
    blockers,
  };
}

export function isBundledRuntime(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, "MANIFEST.json")) && existsSync(join(workspaceRoot, "mooncut-pi-agent", "package.json"));
}
