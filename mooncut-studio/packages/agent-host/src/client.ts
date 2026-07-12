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
    probe?: {durationMs?: number; width?: number; height?: number; hasAudio?: boolean};
    models?: {planner?: string; vision?: string; image?: string};
    visuals?: {
      mode?: "off" | "none" | "generated" | "unavailable";
      reason?: string;
      maxImages?: number;
      requestedCount?: number;
      providerConfigured?: boolean;
      assets?: Array<{id: string; label: string; model: string}>;
      errors?: string[];
    };
    quality?: {ok: boolean};
  };
  subtitleRepair?: {
    parentJobId: string;
    rootJobId: string;
    feedback: {instruction: string; atMs?: number; replacementText?: string};
    analysis?: {
      summary: string;
      model: string;
      changes: Array<{segmentIndex: number; before: string; after: string; startMs: number; endMs: number; reason: string}>;
    };
  };
};

export type RenderQueueItem = {
  name: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  queuePosition?: number;
  mine: boolean;
};

export type RenderQueueSnapshot = {
  updatedAt: string;
  summary: {running: number; queued: number; completedToday: number};
  active: RenderQueueItem[];
  recent: RenderQueueItem[];
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

  /** P0: GET /v1/render-queue — global render queue snapshot. */
  async getRenderQueue(): Promise<RenderQueueSnapshot> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/render-queue`, {
      headers: this.headers(),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as RenderQueueSnapshot & {error?: string} : null;
    if (!response.ok || !data) {
      throw new Error(redactSecrets(data?.error ?? `render queue failed (${response.status})`));
    }
    return data;
  }

  /** P3: POST /v1/edit-jobs/:id/subtitle-repairs — create a subtitle repair job. */
  async createSubtitleRepair(
    jobId: string,
    payload: {instruction: string; atMs?: number; replacementText?: string},
  ): Promise<{id: string; status: string; parentJobId: string}> {
    return this.postJson(`/v1/edit-jobs/${jobId}/subtitle-repairs`, payload);
  }

  /** P3: GET /v1/edit-jobs/:id/subtitle-repairs — list repair versions. */
  async listSubtitleRepairs(jobId: string): Promise<{rootJobId: string; items: AgentJobView[]}> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/edit-jobs/${jobId}/subtitle-repairs`, {
      headers: this.headers(),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as {rootJobId: string; items: AgentJobView[]; error?: string} : null;
    if (!response.ok || !data) {
      throw new Error(redactSecrets(data?.error ?? `list repairs failed (${response.status})`));
    }
    return data;
  }

  /** P4: GET /v1/asr/status — check local ASR availability. */
  async getAsrStatus(): Promise<{configured: boolean; provider: string; model: string; language: string; mode: string; note?: string}> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/asr/status`, {
      headers: this.headers(),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as {configured: boolean; provider: string; model: string; language: string; mode: string; note?: string; error?: string} : null;
    if (!response.ok || !data) {
      throw new Error(redactSecrets(data?.error ?? `asr status failed (${response.status})`));
    }
    return data;
  }

  /** P4: POST /v1/asr/transcribe — transcribe an audio chunk via local Whisper. */
  async transcribeAudioChunk(
    audio: ArrayBuffer,
    options?: {contentType?: string; encoding?: string; sampleRate?: number; language?: string; model?: string},
  ): Promise<{transcript: string; confidence: number | null; duration: number | null; provider: string; model: string; language: string}> {
    const params = new URLSearchParams();
    if (options?.encoding) params.set("encoding", options.encoding);
    if (options?.sampleRate) params.set("sample_rate", String(options.sampleRate));
    if (options?.language) params.set("language", options.language);
    if (options?.model) params.set("model", options.model);
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await this.fetchImpl(`${this.baseUrl}/v1/asr/transcribe${query}`, {
      method: "POST",
      headers: this.headers({"Content-Type": options?.contentType ?? "application/octet-stream"}),
      body: audio,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as {transcript: string; confidence: number | null; duration: number | null; provider: string; model: string; language: string; error?: string} : null;
    if (!response.ok || !data) {
      throw new Error(redactSecrets(data?.error ?? `transcribe failed (${response.status})`));
    }
    return data;
  }
}
