/**
 * Typed HTTP client for Studio → Agent Host (mock or real).
 * Always uses loopback + bearer token. Never logs the token.
 */

import {createWriteStream} from "node:fs";
import {mkdir} from "node:fs/promises";
import {dirname} from "node:path";
import {pipeline} from "node:stream/promises";
import {Readable} from "node:stream";
import {redactSecrets} from "@mooncut/studio-shared";

export type AgentClientOptions = {
  baseUrl: string;
  token: string;
  /** Optional project allow-list for inputPath validation on the caller side. */
  fetchImpl?: typeof fetch;
};

export type AgentJobView = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  originalName?: string;
  request?: Record<string, unknown>;
  error?: string;
  result?: {
    summary?: string;
    artifacts?: Record<string, string>;
    probe?: Record<string, unknown>;
  };
};

export class AgentClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      ...extra,
    };
  }

  async healthz(): Promise<{ok: boolean; mode?: string; gatewayReachable?: boolean}> {
    const response = await this.fetchImpl(`${this.baseUrl}/healthz`);
    if (!response.ok) throw new Error(`healthz failed (${response.status})`);
    return response.json() as Promise<{ok: boolean; mode?: string; gatewayReachable?: boolean}>;
  }

  async createJob(body: {
    assetId?: string;
    inputPath?: string;
    prompt?: string;
    title?: string;
    imageGeneration?: "auto" | "off";
  }): Promise<{id: string; status: string}> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/edit-jobs`, {
      method: "POST",
      headers: this.headers({"Content-Type": "application/json"}),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as {id?: string; status?: string; error?: string} : {};
    if (!response.ok) {
      throw new Error(redactSecrets(data.error ?? `create job failed (${response.status})`));
    }
    if (!data.id) throw new Error("Agent returned job without id");
    return {id: data.id, status: data.status ?? "queued"};
  }

  async getJob(id: string): Promise<AgentJobView> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/edit-jobs/${id}`, {
      headers: this.headers(),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as AgentJobView & {error?: string} : null;
    if (!response.ok || !data) {
      throw new Error(redactSecrets(data?.error ?? `get job failed (${response.status})`));
    }
    if (data.error) data.error = redactSecrets(data.error);
    return data;
  }

  async cancelJob(id: string): Promise<AgentJobView> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/edit-jobs/${id}/cancel`, {
      method: "POST",
      headers: this.headers(),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as AgentJobView & {error?: string} : null;
    if (!response.ok || !data) {
      throw new Error(redactSecrets(data?.error ?? `cancel failed (${response.status})`));
    }
    return data;
  }

  async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
      method: "POST",
      headers: this.headers({"Content-Type": "application/json"}),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as T & {error?: string} : ({} as T & {error?: string});
    if (!response.ok) {
      throw new Error(redactSecrets((data as {error?: string}).error ?? `request failed (${response.status})`));
    }
    return data;
  }

  async downloadArtifact(jobId: string, name: string, destination: string): Promise<string> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/edit-jobs/${jobId}/artifacts/${encodeURIComponent(name)}`,
      {headers: this.headers()},
    );
    if (!response.ok || !response.body) {
      throw new Error(`artifact download failed (${response.status})`);
    }
    await mkdir(dirname(destination), {recursive: true});
    const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
    await pipeline(nodeStream, createWriteStream(destination));
    return destination;
  }

  async testOpenAiCompatible(
    baseUrl: string,
    apiKey: string | undefined,
    timeoutMs: number,
  ): Promise<{ok: boolean; latencyMs?: number; error?: string; modelsSample?: string[]}> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${baseUrl.replace(/\/$/u, "")}/models`;
      const response = await this.fetchImpl(url, {
        headers: apiKey ? {Authorization: `Bearer ${apiKey}`} : {},
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        return {
          ok: false,
          latencyMs,
          error: redactSecrets(`HTTP ${response.status}`),
        };
      }
      const payload = await response.json() as {data?: Array<{id?: string}>};
      const modelsSample = (payload.data ?? []).map((item) => item.id).filter(Boolean).slice(0, 5) as string[];
      return {ok: true, latencyMs, modelsSample};
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: redactSecrets(error instanceof Error ? error.message : String(error)),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
