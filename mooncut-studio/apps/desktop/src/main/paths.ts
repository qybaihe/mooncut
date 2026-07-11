import {app} from "electron";
import {join} from "node:path";
import {resolveRuntimeLayout, type RuntimeLayout} from "./runtime.js";

let cachedRuntime: RuntimeLayout | null = null;

/** Resolve monorepo or bundled runtime root (pi-agent + remotion + …). */
export function resolveWorkspaceRoot(): string {
  return getRuntimeLayout().workspaceRoot;
}

export function getRuntimeLayout(): RuntimeLayout {
  if (!cachedRuntime) cachedRuntime = resolveRuntimeLayout();
  return cachedRuntime;
}

export function refreshRuntimeLayout(): RuntimeLayout {
  cachedRuntime = resolveRuntimeLayout();
  return cachedRuntime;
}

export function userPaths() {
  const userData = app.getPath("userData");
  return {
    userData,
    settings: join(userData, "settings.json"),
    projectIndex: join(userData, "project-index.json"),
    providers: join(userData, "providers.json"),
    secrets: join(userData, "secrets.enc.json"),
    agentRuntime: join(userData, "agent-runtime"),
    agentLog: join(userData, "logs", "agent-host.log"),
    managedDeps: join(userData, "managed-deps"),
    cache: join(userData, "cache"),
    diagnostics: join(userData, "diagnostics"),
  };
}
