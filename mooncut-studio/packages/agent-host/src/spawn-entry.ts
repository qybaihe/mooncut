/**
 * Resolve how to spawn mooncut-pi-agent under Electron-as-Node / plain Node.
 *
 * Electron Node 22 strip-types cannot run many TS constructs (parameter
 * properties etc.). Studio always prefers a prebuilt `dist/cli.mjs` (or .js)
 * produced by `mooncut-pi-agent` build:studio / esbuild.
 */

import {existsSync} from "node:fs";
import {join} from "node:path";

export type AgentSpawnPlan = {
  executable: string;
  args: string[];
  /** Absolute path to the entry file used. */
  entryPath: string;
  /** Whether strip-types / compiled JS is used. */
  strategy: "dist-js" | "strip-types-ts" | "node-ts";
};

/**
 * Prefer prebuilt dist entry. Electron-as-Node **requires** dist-js.
 */
export function resolveAgentSpawnPlan(options: {
  agentRoot: string;
  nodeExecutable?: string;
  /** process.execPath when running inside Electron */
  preferElectronNode?: boolean;
  electronExecPath?: string;
}): AgentSpawnPlan {
  const agentRoot = options.agentRoot;
  const distMjs = join(agentRoot, "dist", "cli.mjs");
  const distJs = join(agentRoot, "dist", "cli.js");
  const srcTs = join(agentRoot, "src", "cli.ts");

  const preferElectron =
    options.preferElectronNode ??
    (Boolean(process.versions.electron) || process.env.MOONCUT_USE_ELECTRON_NODE === "1");

  const electronPath = options.electronExecPath ?? process.execPath;
  const nodePath =
    options.nodeExecutable ??
    (preferElectron ? electronPath : process.platform === "win32" ? "node.exe" : "node");

  // Prefer .mjs (esbuild studio entry) then .js
  if (existsSync(distMjs)) {
    return {executable: nodePath, args: [distMjs, "serve"], entryPath: distMjs, strategy: "dist-js"};
  }
  if (existsSync(distJs)) {
    return {executable: nodePath, args: [distJs, "serve"], entryPath: distJs, strategy: "dist-js"};
  }

  if (preferElectron) {
    throw new Error(
      `mooncut-pi-agent prebuilt entry missing (expected dist/cli.mjs under ${agentRoot}). ` +
        `Run: cd mooncut-pi-agent && npm run build:studio`,
    );
  }

  if (!existsSync(srcTs)) {
    throw new Error(`mooncut-pi-agent entry not found under ${agentRoot}`);
  }

  // System Node only (not Electron): strip-types may work for local debugging.
  return {
    executable: nodePath,
    args: ["--experimental-strip-types", srcTs, "serve"],
    entryPath: srcTs,
    strategy: "node-ts",
  };
}

/** Parse ready marker line emitted by Agent after listen. */
export function parseAgentReadyLine(text: string): {host: string; port: number} | null {
  const match = text.match(/MOONCUT_AGENT_READY host=(\S+) port=(\d+)/u);
  if (!match) return null;
  return {host: match[1]!, port: Number(match[2])};
}
