/**
 * Download Agent HTTP artifacts into a local project folder for preview/reveal.
 */

import {existsSync} from "node:fs";
import {extname, join} from "node:path";
import type {AgentClient} from "./client.js";

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

function artifactFileName(name: string, remoteHint: string): string {
  const fromHint = extname(remoteHint.split("?")[0] ?? "");
  if (fromHint && fromHint.length <= 8) return `${name}${fromHint}`;
  if (name === "video") return `${name}.mp4`;
  if (name === "subtitles" || name.endsWith("json") || name.includes("Review") || name.includes("Spec")) {
    return `${name}.json`;
  }
  if (name.includes("Sheet") || name.includes("jpg") || name.includes("image")) return `${name}.jpg`;
  return `${name}.bin`;
}

/**
 * For each named artifact, download via authenticated Agent client into
 * `projectRoot/exports/<jobId>/` and return local absolute paths.
 * Already-local non-HTTP paths that exist are kept as-is.
 */
export async function materializeJobArtifacts(options: {
  client: AgentClient;
  projectRoot: string;
  jobId: string;
  artifacts: Record<string, string> | undefined;
}): Promise<Record<string, string>> {
  const {client, projectRoot, jobId, artifacts} = options;
  if (!artifacts || Object.keys(artifacts).length === 0) return {};
  const out: Record<string, string> = {};
  for (const [name, remote] of Object.entries(artifacts)) {
    if (!remote) continue;
    if (!isHttpUrl(remote) && existsSync(remote)) {
      out[name] = remote;
      continue;
    }
    const dest = join(projectRoot, "exports", jobId, artifactFileName(name, remote));
    await client.downloadArtifact(jobId, name, dest);
    out[name] = dest;
  }
  return out;
}
