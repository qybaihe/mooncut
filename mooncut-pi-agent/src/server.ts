import {randomUUID, timingSafeEqual} from "node:crypto";
import {createReadStream, createWriteStream, existsSync} from "node:fs";
import {mkdir, stat, unlink} from "node:fs/promises";
import {extname, join} from "node:path";
import {pipeline} from "node:stream/promises";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {runCoachAdvice, runScriptAssistant, type CoachAdviceRequest, type ScriptAssistantRequest} from "./assistant.ts";
import {
  capabilityStore,
  CapabilityStoreError,
  type CapabilityInstallation,
  type CapabilityInvocation,
  type CapabilityInvocationRequest,
} from "./capabilities.ts";
import {agentRoot, assetsRoot, config} from "./config.ts";
import {authStore, AuthError, clearSessionCookie, parseSessionCookie, sessionCookie, type AuthUser} from "./auth.ts";
import {communityStore, CommunityStoreError, type CommunityPost, type PublishCommunityPostInput} from "./community.ts";
import {listGatewayModels} from "./gateway.ts";
import {assetDataPath, friendlyJobName, jobManager, saveAssetMetadata, type StoredAsset} from "./jobs.ts";
import {confirmJobMail, isEmail, mailAccountStatus, prepareJobMail, verifyArtifactDownloadToken} from "./mail.ts";
import type {EditJobRecord, EditJobRequest, SubtitleRepairFeedback} from "./types.ts";

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const isAuthorized = (authorization: string | undefined, apiKeys = config.apiKeys) => {
  // An empty key list must never become an implicit allow-all. Local browser
  // sessions are handled separately below; service-to-service calls require a key.
  if (apiKeys.length === 0) return false;
  const match = authorization?.match(/^Bearer\s+([^\s]{16,256})$/u);
  return Boolean(match && apiKeys.some((key) => safeEqual(match[1], key)));
};

const isServiceAuthorized = (authorization: string | undefined) =>
  config.apiKeys.length > 0 && isAuthorized(authorization, config.apiKeys);

type RequestPrincipal = {kind: "service"} | {kind: "user"; user: AuthUser};

/** User jobs always deliver to their authenticated owner, never client input. */
export const notificationEmailForPrincipal = (
  principal: RequestPrincipal | undefined,
  requested: string | undefined,
) => principal?.kind === "user" ? principal.user.email : requested;

export const canAccessOwnedResource = (ownerUserId: string | undefined, principal: RequestPrincipal) =>
  principal.kind === "service" || (Boolean(ownerUserId) && ownerUserId === principal.user.id);

export class RequestRateLimiter {
  private readonly entries = new Map<string, number[]>();

  allow(key: string, limit: number, windowMs: number, time = Date.now()) {
    const recent = (this.entries.get(key) ?? []).filter((timestamp) => timestamp > time - windowMs);
    if (recent.length >= limit) {
      this.entries.set(key, recent);
      return false;
    }
    recent.push(time);
    this.entries.set(key, recent);
    return true;
  }

  reset(key: string) {
    this.entries.delete(key);
  }
}

const authRateLimiter = new RequestRateLimiter();

const isLoopbackHost = (host: string) =>
  host === "127.0.0.1" || host === "::1" || host === "localhost";

/** Fail closed when an Agent is intentionally deployed beyond the local desktop. */
export const assertSecureDeploymentConfiguration = () => {
  const publicDeployment = config.publicDeployment || !isLoopbackHost(config.host) ||
    config.publicBaseUrl.startsWith("https://");
  if (!publicDeployment) return;
  if (!config.edgeAuthOnly) {
    throw new Error("MOONCUT_EDGE_AUTH_ONLY=true is required for a public Agent deployment");
  }
  if (config.apiKeys.length === 0) {
    throw new Error("MOONCUT_API_KEY or MOONCUT_API_KEYS is required for a public Agent deployment");
  }
  if (!config.cookieSecure) {
    throw new Error("MOONCUT_COOKIE_SECURE=true is required for a public Agent deployment");
  }
  if (!config.publicBaseUrl.startsWith("https://")) {
    throw new Error("MOONCUT_PUBLIC_BASE_URL must be an HTTPS URL for a public Agent deployment");
  }
  if (!config.mailDownloadSecret) {
    throw new Error("MOONCUT_MAIL_DOWNLOAD_SECRET is required for a public Agent deployment");
  }
  if (config.allowLocalInputPath) {
    throw new Error("MOONCUT_ALLOW_INPUT_PATH must stay disabled for a public Agent deployment");
  }
  if (config.capabilitySigningKey === "mooncut-development-capability-signing-key") {
    throw new Error("MOONCUT_CAPABILITY_SIGNING_KEY must be replaced for a public Agent deployment");
  }
};

const json = (response: ServerResponse, status: number, value: unknown) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
};

const publicBaseUrl = (request: IncomingMessage) => {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  const host = request.headers["x-forwarded-host"] ?? request.headers.host ?? `${config.host}:${config.port}`;
  return `${protocol}://${host}`;
};
const publicCommunityPost = (post: CommunityPost, baseUrl: string) => ({
  id: post.id,
  authorName: post.authorName,
  title: post.title,
  caption: post.caption,
  durationMs: post.durationMs,
  width: post.width,
  height: post.height,
  createdAt: post.createdAt,
  videoUrl: `${baseUrl}/v1/community/posts/${post.id}/video`,
  ...(post.posterPath ? {posterUrl: `${baseUrl}/v1/community/posts/${post.id}/poster`} : {}),
});

const publicCapabilityInstallation = (installation: CapabilityInstallation) => ({
  id: installation.installationId,
  packageId: installation.packageId,
  releaseId: installation.releaseId,
  slug: installation.slug,
  version: installation.version,
  manifestHash: installation.manifestHash,
  status: installation.status,
  installedAt: installation.installedAt,
  updatedAt: installation.updatedAt,
  permissions: installation.manifest.permissions,
  tasks: installation.manifest.compatibility.tasks,
  name: installation.manifest.display.name,
  tagline: installation.manifest.display.tagline,
  category: installation.manifest.display.category,
});

const publicCapabilityInvocation = (invocation: CapabilityInvocation, baseUrl: string) => ({
  ...invocation,
  artifacts: invocation.artifacts.map((artifact) => ({
    ...artifact,
    url: `${baseUrl}/v1/capability-invocations/${invocation.id}/artifacts/${artifact.id}`,
  })),
});

export const redactInternalPaths = (value: string) => value.replace(
  /\/(?:opt|home|Users|var|tmp)\/[^\s`|)\]}]+/gu,
  "[internal path]",
);

const publicJobRecord = (job: EditJobRecord, baseUrl: string) => ({
  id: job.id,
  status: job.status,
  stage: job.stage,
  progress: job.progress,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  originalName: job.originalName,
  request: {
    assetId: job.request.assetId,
    title: job.request.title,
    prompt: job.request.prompt,
    notificationEmail: job.request.notificationEmail,
    imageGeneration: job.request.imageGeneration ?? "auto",
    capabilityInstallIds: job.capabilitySnapshot?.map((snapshot) => snapshot.installationId) ?? [],
  },
  ...(job.capabilitySnapshot?.length ? {capabilities: job.capabilitySnapshot.map(({installationId, slug, version, manifestHash}) => ({installationId, slug, version, manifestHash}))} : {}),
  ...(job.error ? {error: redactInternalPaths(job.error.split("\n", 1)[0])} : {}),
  ...(job.mail ? {mail: job.mail} : {}),
  ...(job.subtitleRepair ? {subtitleRepair: job.subtitleRepair} : {}),
  ...(job.result ? {
    result: {
      summary: redactInternalPaths(job.result.summary),
      probe: job.result.probe,
      models: job.result.models,
      visuals: job.result.visuals,
      quality: job.result.quality ? {
        ...job.result.quality,
        qaAssets: Object.keys(job.result.quality.qaAssets),
      } : undefined,
      artifacts: Object.fromEntries(Object.keys(job.result.artifacts).map((name) => [
        name,
        `${baseUrl}/v1/edit-jobs/${job.id}/artifacts/${name}`,
      ])),
    },
  } : {}),
});

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 2 * 1024 * 1024) throw new Error("JSON body exceeds 2 MB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const isEditJobRequest = (value: unknown): value is EditJobRequest => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.assetId === undefined || typeof record.assetId === "string") &&
    (record.inputPath === undefined || typeof record.inputPath === "string") &&
    (record.prompt === undefined || typeof record.prompt === "string") &&
    (record.title === undefined || typeof record.title === "string") &&
    (record.notificationEmail === undefined || typeof record.notificationEmail === "string") &&
    (record.imageGeneration === undefined || record.imageGeneration === "auto" || record.imageGeneration === "off") &&
    (record.capabilityInstallIds === undefined || Array.isArray(record.capabilityInstallIds) && record.capabilityInstallIds.length <= 4 && record.capabilityInstallIds.every((id) => typeof id === "string" && /^[a-f0-9]{32}$/u.test(id))) &&
    (record.capabilityRequests === undefined || Array.isArray(record.capabilityRequests) && record.capabilityRequests.length <= 1 && record.capabilityRequests.every((request) => {
      if (!request || typeof request !== "object") return false;
      const item = request as Record<string, unknown>;
      if (typeof item.installationId !== "string" || !/^[a-f0-9]{32}$/u.test(item.installationId)) return false;
      const {installationId: _installationId, ...capabilityRequest} = item;
      return isCapabilityInvocationRequest(capabilityRequest);
    }))
  );
};

const isSubtitleRepairRequest = (value: unknown): value is SubtitleRepairFeedback => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.instruction === "string" && record.instruction.trim().length >= 2 && record.instruction.trim().length <= 2_000 &&
    (record.atMs === undefined || typeof record.atMs === "number" && Number.isFinite(record.atMs) && record.atMs >= 0) &&
    (record.replacementText === undefined || typeof record.replacementText === "string" && record.replacementText.trim().length >= 1 && record.replacementText.trim().length <= 160);
};

const isScriptAssistantRequest = (value: unknown): value is ScriptAssistantRequest => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.messages) && record.messages.every((message) => {
    if (!message || typeof message !== "object") return false;
    const item = message as Record<string, unknown>;
    return (item.role === "assistant" || item.role === "user") && typeof item.content === "string";
  });
};

const isCoachAdviceRequest = (value: unknown): value is CoachAdviceRequest => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const metrics = record.metrics;
  return typeof record.transcript === "string" &&
    typeof record.currentScript === "string" &&
    typeof record.currentSentence === "string" &&
    !!metrics && typeof metrics === "object" &&
    ["pace", "wordCount", "volume", "pauseCount", "elapsedSeconds"].every(
      (key) => typeof (metrics as Record<string, unknown>)[key] === "number",
    );
};

const isCommunityPublishRequest = (value: unknown): value is PublishCommunityPostInput & {jobId: string} => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.jobId === "string" && /^[a-f0-9]{32}$/u.test(record.jobId) &&
    (record.authorName === undefined || typeof record.authorName === "string") &&
    (record.title === undefined || typeof record.title === "string") &&
    (record.caption === undefined || typeof record.caption === "string");
};

const isInstallationStatusPatch = (value: unknown): value is {status: "enabled" | "disabled"} => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && (record.status === "enabled" || record.status === "disabled");
};

const isCapabilityInvocationRequest = (value: unknown): value is CapabilityInvocationRequest => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.tool === "fifa_find_highlights") {
    return !!record.input && typeof record.input === "object" &&
      typeof (record.input as Record<string, unknown>).query === "string";
  }
  if (record.tool === "fifa_match_context") {
    if (!record.input || typeof record.input !== "object") return false;
    const input = record.input as Record<string, unknown>;
    return typeof input.matchId === "string" &&
      (input.includeChineseContext === undefined || typeof input.includeChineseContext === "boolean") &&
      (input.screenshotView === undefined || input.screenshotView === "ratings" || input.screenshotView === "match" || input.screenshotView === "chat") &&
      (record.confirmedArtifact === undefined || typeof record.confirmedArtifact === "boolean");
  }
  return false;
};

const isCapabilityPackageRequest = (value: unknown): value is {slug: string; trustLevel?: "official" | "verified"} => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.slug === "string" &&
    (record.trustLevel === undefined || record.trustLevel === "official" || record.trustLevel === "verified");
};

const isCapabilityReleaseRequest = (value: unknown): value is {manifest: unknown} =>
  Boolean(value && typeof value === "object" && "manifest" in value);

const contentType = (path: string) => {
  switch (extname(path).toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".json": return "application/json; charset=utf-8";
    case ".jsonl": return "application/x-ndjson; charset=utf-8";
    case ".txt":
    case ".log": return "text/plain; charset=utf-8";
    case ".yaml":
    case ".yml": return "application/yaml; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    default: return "application/octet-stream";
  }
};

const storeUploadedAsset = async (request: IncomingMessage, url: URL, ownerUserId?: string) => {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (contentLength > config.maxUploadBytes) {
    throw new HttpError(413, "Upload exceeds configured limit");
  }
  const filename = url.searchParams.get("filename") ?? "upload.mp4";
  if (!new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]).has(extname(filename).toLowerCase())) {
    throw new HttpError(415, "Supported video extensions: mp4, mov, m4v, webm, mkv");
  }
  const id = randomUUID().replaceAll("-", "");
  const path = assetDataPath(id, filename);
  await mkdir(assetsRoot, {recursive: true});
  let bytes = 0;
  request.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > config.maxUploadBytes) request.destroy(new Error("Upload exceeds configured limit"));
  });
  try {
    await pipeline(request, createWriteStream(path, {flags: "wx"}));
  } catch (error) {
    if (existsSync(path)) await unlink(path);
    throw error;
  }
  if (bytes === 0) {
    await unlink(path);
    throw new HttpError(400, "Uploaded video is empty");
  }
  const asset: StoredAsset = {id, ...(ownerUserId ? {ownerUserId} : {}), filename, path, bytes, createdAt: new Date().toISOString()};
  await saveAssetMetadata(asset);
  return asset;
};

const uploadAsset = async (request: IncomingMessage, response: ServerResponse, url: URL, ownerUserId?: string) => {
  const asset = await storeUploadedAsset(request, url, ownerUserId);
  json(response, 201, {assetId: asset.id, filename: asset.filename, bytes: asset.bytes});
};

const streamArtifact = async (request: IncomingMessage, response: ServerResponse, path: string) => {
  const info = await stat(path);
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/u);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(info.size - 1, Number(range[2])) : info.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) {
      response.writeHead(416, {"Content-Range": `bytes */${info.size}`});
      response.end();
      return;
    }
    response.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${info.size}`,
      "Content-Type": contentType(path),
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(path, {start, end}).pipe(response);
    return;
  }
  response.writeHead(200, {
    "Accept-Ranges": "bytes",
    "Content-Length": info.size,
    "Content-Type": contentType(path),
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(path).pipe(response);
};

export const startServer = async () => {
  assertSecureDeploymentConfiguration();
  await jobManager.recoverInterruptedJobs();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const requestOrigin = request.headers.origin?.replace(/\/$/u, "");
      if (requestOrigin) {
        if (!config.corsOrigins.includes(requestOrigin)) {
          json(response, 403, {error: "Origin is not allowed"});
          return;
        } else {
          response.setHeader("Access-Control-Allow-Origin", requestOrigin);
          response.setHeader("Access-Control-Allow-Credentials", "true");
          response.setHeader("Vary", "Origin");
        }
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/openapi.yaml") {
        await streamArtifact(request, response, join(agentRoot, "openapi.yaml"));
        return;
      }
      if (request.method === "GET" && (url.pathname === "/docs" || url.pathname === "/docs/")) {
        await streamArtifact(request, response, join(agentRoot, "docs/index.html"));
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        // Studio injects MOONCUT_PROBE_GATEWAY_ON_HEALTH=false so Agent can be
        // healthy without a configured gateway key (provider may be set later).
        const probeGateway = process.env.MOONCUT_PROBE_GATEWAY_ON_HEALTH !== "false";
        let gatewayReachable = false;
        if (probeGateway && config.gatewayApiKey) {
          try {
            const models = await listGatewayModels();
            gatewayReachable = models.includes(config.plannerModel);
          } catch {
            gatewayReachable = false;
          }
        }
        json(response, 200, {
          ok: true,
          service: "mooncut-pi-video-editor",
          plannerModel: config.plannerModel,
          visionModels: config.visionModels,
          imageGenerationConfigured: Boolean(config.imageGenerationBaseUrl && config.imageGenerationApiKey && config.imageGenerationModel),
          communityPosts: communityStore.count(),
          gatewayReachable,
        });
        return;
      }
      // Mailed download links: signed token grants read-only access to one artifact.
      // Runs before session/service auth so recipients can open links without logging in.
      const mailedArtifactMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)\/artifacts\/([A-Za-z0-9_-]+)$/u);
      if (request.method === "GET" && mailedArtifactMatch) {
        const token = url.searchParams.get("token") ?? "";
        if (token && verifyArtifactDownloadToken(token, mailedArtifactMatch[1], mailedArtifactMatch[2])) {
          let job: EditJobRecord;
          try {
            job = await jobManager.get(mailedArtifactMatch[1]);
          } catch {
            json(response, 404, {error: "Edit job not found"});
            return;
          }
          if (job.status !== "completed") {
            json(response, 409, {error: "The edited video is not ready yet"});
            return;
          }
          const path = job.result?.artifacts[mailedArtifactMatch[2]];
          if (!path || !existsSync(path)) {
            json(response, 404, {error: "Artifact not found"});
            return;
          }
          await streamArtifact(request, response, path);
          return;
        }
      }
      // Cloudflare Pages often cannot reach private/regional LLM gateways.
      // Edge assistants call this service-key-only relay; the agent forwards to
      // MOONCUT_GATEWAY_* and does not use browser sessions.
      if (request.method === "POST" && url.pathname === "/v1/edge-relay/chat/completions") {
        if (!isServiceAuthorized(request.headers.authorization)) {
          json(response, 401, {error: "Service key required", code: "AUTH_REQUIRED"});
          return;
        }
        if (!config.gatewayApiKey) {
          json(response, 503, {error: "MOONCUT_GATEWAY_API_KEY is not configured on the agent"});
          return;
        }
        const payload = await readJson(request);
        const upstream = await fetch(`${config.gatewayBaseUrl}/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(90_000),
          headers: {
            Authorization: `Bearer ${config.gatewayApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload ?? {}),
        });
        const text = await upstream.text();
        response.writeHead(upstream.status, {
          "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(text);
        return;
      }
      const sessionToken = parseSessionCookie(request.headers.cookie);
      // Phase 1: browser auth lives on Cloudflare (D1). Local agent only accepts
      // service-key calls for the video pipeline when edgeAuthOnly is enabled.
      if (config.edgeAuthOnly && url.pathname.startsWith("/v1/auth/")) {
        json(response, 404, {
          error: "浏览器登录请使用 Cloudflare 边缘 API（/api/v1/auth/*）",
          code: "EDGE_AUTH_ONLY",
        });
        return;
      }
      if (request.method === "POST" && (url.pathname === "/v1/auth/register" || url.pathname === "/v1/auth/login")) {
        const payload = await readJson(request) as {email?: unknown; password?: unknown};
        const ip = String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "unknown").split(",", 1)[0].trim();
        const emailKey = typeof payload?.email === "string" ? payload.email.trim().toLowerCase().slice(0, 254) : "invalid";
        const action = url.pathname.endsWith("register") ? "register" : "login";
        const limit = action === "register" ? 5 : 10;
        const windowMs = action === "register" ? 60 * 60_000 : 15 * 60_000;
        const rateKey = `${action}:${ip}:${emailKey}`;
        if (!authRateLimiter.allow(rateKey, limit, windowMs)) {
          throw new AuthError(429, "RATE_LIMITED", "尝试次数过多，请稍后再试");
        }
        const result = action === "register"
          ? await authStore.register(payload?.email, payload?.password)
          : await authStore.login(payload?.email, payload?.password);
        authRateLimiter.reset(rateKey);
        response.setHeader("Set-Cookie", sessionCookie(result.sessionToken));
        json(response, action === "register" ? 201 : 200, {user: result.user});
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
        authStore.deleteSession(sessionToken);
        response.setHeader("Set-Cookie", clearSessionCookie());
        json(response, 200, {ok: true});
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/auth/me") {
        const user = authStore.getUserBySession(sessionToken);
        if (!user) throw new AuthError(401, "AUTH_REQUIRED", "请先登录");
        json(response, 200, {user});
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/auth/session") {
        json(response, 200, {user: authStore.getUserBySession(sessionToken) ?? null});
        return;
      }
      // Discovery is public. A session only adds the caller's installation
      // state; no private install, invocation or artifact data is exposed.
      const catalogUser = authStore.getUserBySession(sessionToken);
      if (request.method === "GET" && url.pathname === "/v1/capabilities") {
        json(response, 200, {items: capabilityStore.listCatalog(catalogUser?.id, url.searchParams.get("query") ?? undefined)});
        return;
      }
      const capabilityDetailMatch = url.pathname.match(/^\/v1\/capabilities\/([a-z0-9-]{3,80})$/u);
      if (request.method === "GET" && capabilityDetailMatch) {
        json(response, 200, capabilityStore.getCatalog(capabilityDetailMatch[1], catalogUser?.id));
        return;
      }
      let principal: RequestPrincipal | undefined;
      const serviceOk = isServiceAuthorized(request.headers.authorization);
      const edgeUserIdHeader = request.headers["x-mooncut-user-id"];
      const edgeUserId = typeof edgeUserIdHeader === "string" ? edgeUserIdHeader.trim() : "";
      const edgeUserEmailHeader = request.headers["x-mooncut-user-email"];
      const edgeUserEmail = typeof edgeUserEmailHeader === "string" ? edgeUserEmailHeader.trim() : "";
      // Phase 1 edge mode: Cloudflare authenticates the browser, then calls the
      // agent with a service key + X-MoonCut-User-Id. Treat that as a user principal
      // so jobs stay owned by the edge user id.
      if (serviceOk && edgeUserId && /^[a-f0-9]{16,64}$/iu.test(edgeUserId)) {
        principal = {
          kind: "user",
          user: {
            id: edgeUserId,
            email: edgeUserEmail && edgeUserEmail.includes("@") ? edgeUserEmail : `${edgeUserId}@edge.mooncut`,
            createdAt: new Date(0).toISOString(),
          },
        };
      } else if (serviceOk) {
        principal = {kind: "service"};
      } else if (!config.edgeAuthOnly) {
        const user = authStore.getUserBySession(sessionToken);
        if (user) principal = {kind: "user", user};
      }
      if (url.pathname.startsWith("/v1/") && !principal) {
        response.setHeader("WWW-Authenticate", 'Bearer realm="MoonCut API"');
        json(response, 401, {error: "请先登录", code: "AUTH_REQUIRED"});
        return;
      }
      const ownerUserId = principal?.kind === "user" ? principal.user.id : undefined;
      const requireUser = () => {
        if (principal?.kind !== "user") throw new HttpError(403, "A signed-in user session is required for capability management");
        return principal.user;
      };
      const requireService = () => {
        if (principal?.kind !== "service") throw new HttpError(403, "A service API key is required for capability publishing");
      };
      if (request.method === "POST" && url.pathname === "/v1/admin/capability-packages") {
        requireService();
        const payload = await readJson(request);
        if (!isCapabilityPackageRequest(payload)) throw new HttpError(400, "Body requires a lowercase slug and optional trustLevel");
        const created = capabilityStore.createPackage(payload.slug, payload.trustLevel);
        json(response, created.created ? 201 : 200, created);
        return;
      }
      const capabilityReleasePublishMatch = url.pathname.match(/^\/v1\/admin\/capability-packages\/([A-Za-z0-9_-]{3,120})\/releases$/u);
      if (request.method === "POST" && capabilityReleasePublishMatch) {
        requireService();
        const payload = await readJson(request);
        if (!isCapabilityReleaseRequest(payload)) throw new HttpError(400, "Body requires a capability manifest");
        json(response, 201, capabilityStore.publishRelease(capabilityReleasePublishMatch[1], payload.manifest));
        return;
      }
      const capabilityYankMatch = url.pathname.match(/^\/v1\/admin\/capability-releases\/([a-f0-9]{32})\/yank$/u);
      if (request.method === "POST" && capabilityYankMatch) {
        requireService();
        capabilityStore.yankRelease(capabilityYankMatch[1]);
        json(response, 200, {ok: true});
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/me/capability-installations") {
        const user = requireUser();
        json(response, 200, {items: capabilityStore.listInstallations(user.id).map(publicCapabilityInstallation)});
        return;
      }
      const capabilityInstallMatch = url.pathname.match(/^\/v1\/capabilities\/([a-z0-9-]{3,80})\/install$/u);
      if (request.method === "POST" && capabilityInstallMatch) {
        const user = requireUser();
        const installed = capabilityStore.install(user.id, capabilityInstallMatch[1]);
        json(response, installed.created ? 201 : 200, {created: installed.created, installation: publicCapabilityInstallation(installed.installation)});
        return;
      }
      const capabilityInstallationMatch = url.pathname.match(/^\/v1\/me\/capability-installations\/([a-f0-9]{32})$/u);
      if (capabilityInstallationMatch && request.method === "PATCH") {
        const user = requireUser();
        const payload = await readJson(request);
        if (!isInstallationStatusPatch(payload)) throw new HttpError(400, "Body requires status enabled or disabled");
        json(response, 200, {installation: publicCapabilityInstallation(capabilityStore.setStatus(user.id, capabilityInstallationMatch[1], payload.status))});
        return;
      }
      if (capabilityInstallationMatch && request.method === "DELETE") {
        const user = requireUser();
        capabilityStore.uninstall(user.id, capabilityInstallationMatch[1]);
        json(response, 200, {ok: true});
        return;
      }
      const capabilityReconfirmMatch = url.pathname.match(/^\/v1\/me\/capability-installations\/([a-f0-9]{32})\/reconfirm$/u);
      if (capabilityReconfirmMatch && request.method === "POST") {
        const user = requireUser();
        json(response, 200, {installation: publicCapabilityInstallation(capabilityStore.reconfirm(user.id, capabilityReconfirmMatch[1]))});
        return;
      }
      const capabilityPreflightMatch = url.pathname.match(/^\/v1\/me\/capability-installations\/([a-f0-9]{32})\/preflight$/u);
      if (capabilityPreflightMatch && request.method === "POST") {
        const user = requireUser();
        json(response, 200, await capabilityStore.preflight(user.id, capabilityPreflightMatch[1]));
        return;
      }
      const capabilityInvokeMatch = url.pathname.match(/^\/v1\/me\/capability-installations\/([a-f0-9]{32})\/invoke$/u);
      if (capabilityInvokeMatch && request.method === "POST") {
        const user = requireUser();
        const payload = await readJson(request);
        if (!isCapabilityInvocationRequest(payload)) throw new HttpError(400, "Body requires a supported capability tool and valid input");
        const invocation = await capabilityStore.invoke(user.id, capabilityInvokeMatch[1], payload);
        json(response, 200, publicCapabilityInvocation(invocation, publicBaseUrl(request)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/capability-invocations") {
        const user = requireUser();
        const installationId = url.searchParams.get("installationId") ?? undefined;
        if (installationId && !/^[a-f0-9]{32}$/u.test(installationId)) throw new HttpError(400, "installationId is invalid");
        json(response, 200, {items: capabilityStore.listInvocations(user.id, installationId).map((invocation) => publicCapabilityInvocation(invocation, publicBaseUrl(request)))});
        return;
      }
      const capabilityArtifactMatch = url.pathname.match(/^\/v1\/capability-invocations\/([a-f0-9]{32})\/artifacts\/([a-f0-9]{32})$/u);
      if (capabilityArtifactMatch && request.method === "GET") {
        const user = requireUser();
        const artifact = capabilityStore.getArtifact(user.id, capabilityArtifactMatch[1], capabilityArtifactMatch[2]);
        await streamArtifact(request, response, artifact.path);
        return;
      }
      const getAccessibleJob = async (id: string) => {
        let job: EditJobRecord;
        try {
          job = await jobManager.get(id);
        } catch {
          throw new HttpError(404, "Edit job not found");
        }
        if (!principal || !canAccessOwnedResource(job.ownerUserId, principal)) {
          throw new HttpError(404, "Edit job not found");
        }
        return job;
      };
      if (request.method === "GET" && url.pathname === "/v1/render-queue") {
        const jobs = await jobManager.list(200);
        const queued = jobs.filter((job) => job.status === "queued").sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        const queuePosition = new Map(queued.map((job, index) => [job.id, index + 1]));
        const active = jobs
          .filter((job) => job.status === "running" || job.status === "queued")
          .sort((left, right) => {
            if (left.status !== right.status) return left.status === "running" ? -1 : 1;
            return left.createdAt.localeCompare(right.createdAt);
          });
        const recent = jobs
          .filter((job) => job.status === "completed" || job.status === "failed")
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, 8);
        const shanghaiDate = (value: string | Date) => new Intl.DateTimeFormat("en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          timeZone: "Asia/Shanghai",
        }).format(typeof value === "string" ? new Date(value) : value);
        const today = shanghaiDate(new Date());
        const queueItem = (job: EditJobRecord) => ({
          name: job.displayName ?? friendlyJobName(job.id, job.createdAt),
          status: job.status,
          stage: job.stage,
          progress: job.progress,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          ...(job.status === "queued" ? {queuePosition: queuePosition.get(job.id)} : {}),
          mine: principal?.kind === "user" && job.ownerUserId === principal.user.id,
        });
        json(response, 200, {
          updatedAt: new Date().toISOString(),
          summary: {
            running: active.filter((job) => job.status === "running").length,
            queued: queued.length,
            completedToday: jobs.filter((job) => job.status === "completed" && shanghaiDate(job.updatedAt) === today).length,
          },
          active: active.map(queueItem),
          recent: recent.map(queueItem),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/models") {
        json(response, 200, {
          available: await listGatewayModels(),
          routing: {
            planner: config.plannerModel,
            script: config.scriptModel,
            coach: config.coachModel,
            vision: config.visionModels,
            image: {
              configured: Boolean(config.imageGenerationBaseUrl && config.imageGenerationApiKey && config.imageGenerationModel),
              model: config.imageGenerationModel || null,
              maxImages: config.imageGenerationMaxImages,
            },
          },
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/assistant/script") {
        const payload = await readJson(request);
        if (!isScriptAssistantRequest(payload)) {
          json(response, 400, {error: "Body requires a valid messages array"});
          return;
        }
        json(response, 200, await runScriptAssistant(payload));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/assistant/coach") {
        const payload = await readJson(request);
        if (!isCoachAdviceRequest(payload)) {
          json(response, 400, {error: "Body requires transcript, script, currentSentence and numeric metrics"});
          return;
        }
        json(response, 200, await runCoachAdvice(payload));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/mail/status") {
        json(response, 200, await mailAccountStatus());
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/community/posts") {
        const payload = await readJson(request);
        if (!isCommunityPublishRequest(payload)) throw new HttpError(400, "Body requires jobId and optional authorName, title, caption");
        const job = await getAccessibleJob(payload.jobId);
        const defaultAuthor = principal?.kind === "user" ? principal.user.email.split("@", 1)[0] : undefined;
        const published = communityStore.publish(job, {...payload, authorName: payload.authorName || defaultAuthor}, ownerUserId);
        json(response, published.created ? 201 : 200, {
          created: published.created,
          post: publicCommunityPost(published.post, publicBaseUrl(request)),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/assets") {
        await uploadAsset(request, response, url, ownerUserId);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/edits") {
        if (!jobManager.canAccept()) throw new HttpError(429, "Editing queue is full; retry later");
        const requestedNotificationEmail = url.searchParams.get("notificationEmail")?.trim() || undefined;
        if (requestedNotificationEmail && !isEmail(requestedNotificationEmail)) {
          throw new HttpError(400, "notificationEmail is invalid");
        }
        // A user-created job may only notify the authenticated owner. Service
        // callers retain explicit control for operator-managed automation.
        const notificationEmail = notificationEmailForPrincipal(principal, requestedNotificationEmail);
        if (config.edgeAuthOnly && !notificationEmail) {
          throw new HttpError(400, "notificationEmail is required so the finished video can be emailed from this machine");
        }
        const prompt = url.searchParams.get("prompt")?.slice(0, 8000) || undefined;
        const title = url.searchParams.get("title")?.slice(0, 120) || undefined;
        const imageGenerationParam = url.searchParams.get("imageGeneration");
        if (imageGenerationParam && imageGenerationParam !== "auto" && imageGenerationParam !== "off") {
          throw new HttpError(400, "imageGeneration must be auto or off");
        }
        const imageGeneration = imageGenerationParam === "off" ? "off" as const : "auto" as const;
        const asset = await storeUploadedAsset(request, url, ownerUserId);
        const job = await jobManager.create({assetId: asset.id, prompt, title, notificationEmail, imageGeneration}, ownerUserId);
        const baseUrl = publicBaseUrl(request);
        json(response, 202, {
          id: job.id,
          status: job.status,
          assetId: asset.id,
          statusUrl: `${baseUrl}/v1/edit-jobs/${job.id}`,
          videoUrl: `${baseUrl}/v1/edit-jobs/${job.id}/artifacts/video`,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/edit-jobs") {
        const payload = await readJson(request);
        if (!isEditJobRequest(payload) || (!payload.assetId && !payload.inputPath)) {
          json(response, 400, {error: "Body requires assetId or inputPath"});
          return;
        }
        if (payload.inputPath && !config.allowLocalInputPath) {
          json(response, 403, {error: "inputPath jobs are disabled on this server; upload an asset instead"});
          return;
        }
        if (payload.notificationEmail && !isEmail(payload.notificationEmail)) {
          json(response, 400, {error: "notificationEmail is invalid"});
          return;
        }
        if (principal?.kind === "user") {
          // Do not let a browser turn the render service into an arbitrary
          // recipient mailer. The verified session identity is authoritative.
          payload.notificationEmail = notificationEmailForPrincipal(principal, payload.notificationEmail);
        }
        if (config.edgeAuthOnly && !payload.notificationEmail) {
          json(response, 400, {error: "notificationEmail is required so the finished video can be emailed from this machine"});
          return;
        }
        if ((payload.capabilityInstallIds?.length || payload.capabilityRequests?.length) && !ownerUserId) {
          throw new HttpError(403, "Capability-backed editing requires a signed-in user session");
        }
        const selectedInstallations = payload.capabilityInstallIds ?? [];
        if (payload.capabilityRequests?.some((capability) => !selectedInstallations.includes(capability.installationId))) {
          throw new HttpError(400, "Every capability request must be included in capabilityInstallIds");
        }
        const capabilitySnapshot = ownerUserId
          ? capabilityStore.resolveSnapshots(ownerUserId, selectedInstallations, "video-edit")
          : [];
        const job = await jobManager.create(payload, ownerUserId, capabilitySnapshot);
        const baseUrl = publicBaseUrl(request);
        json(response, 202, {
          id: job.id,
          status: job.status,
          statusUrl: `${baseUrl}/v1/edit-jobs/${job.id}`,
        });
        return;
      }
      const cancelMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)\/cancel$/u);
      if (request.method === "POST" && cancelMatch) {
        const job = await getAccessibleJob(cancelMatch[1]!);
        const cancelled = await jobManager.cancel(job.id);
        json(response, 200, publicJobRecord(cancelled, publicBaseUrl(request)));
        return;
      }
      const subtitleRepairMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)\/subtitle-repairs$/u);
      if (subtitleRepairMatch && request.method === "POST") {
        const parent = await getAccessibleJob(subtitleRepairMatch[1]);
        const payload = await readJson(request);
        if (!isSubtitleRepairRequest(payload)) {
          throw new HttpError(400, "Body requires instruction (2-2000 characters), optional atMs and replacementText");
        }
        if (parent.status !== "completed") {
          throw new HttpError(409, "Only a completed version can receive subtitle repair feedback");
        }
        const feedback: SubtitleRepairFeedback = {
          instruction: payload.instruction.trim(),
          ...(Number.isFinite(payload.atMs) ? {atMs: Math.round(payload.atMs!)} : {}),
          ...(payload.replacementText?.trim() ? {replacementText: payload.replacementText.trim()} : {}),
        };
        const repair = await jobManager.createSubtitleRepair(parent, feedback, ownerUserId);
        const baseUrl = publicBaseUrl(request);
        json(response, 202, {
          id: repair.id,
          status: repair.status,
          statusUrl: `${baseUrl}/v1/edit-jobs/${repair.id}`,
          parentJobId: parent.id,
        });
        return;
      }
      if (subtitleRepairMatch && request.method === "GET") {
        const selected = await getAccessibleJob(subtitleRepairMatch[1]);
        const repairs = (await jobManager.listSubtitleRepairs(selected))
          .filter((repair) => principal && canAccessOwnedResource(repair.ownerUserId, principal));
        const baseUrl = publicBaseUrl(request);
        json(response, 200, {
          rootJobId: selected.subtitleRepair?.rootJobId ?? selected.id,
          items: repairs.map((repair) => publicJobRecord(repair, baseUrl)),
        });
        return;
      }
      const prepareMailMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)\/mail\/prepare$/u);
      if (request.method === "POST" && prepareMailMatch) {
        const job = await getAccessibleJob(prepareMailMatch[1]);
        if (!job.mail) {
          json(response, 400, {error: "This job has no notification email"});
          return;
        }
        const prepared = await prepareJobMail(job, job.mail.recipient, url.origin);
        await jobManager.updateMail(job.id, {status: "awaiting-confirmation", error: undefined});
        json(response, 200, prepared);
        return;
      }
      const confirmMailMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)\/mail\/([a-f0-9]+)\/confirm$/u);
      if (request.method === "POST" && confirmMailMatch) {
        await getAccessibleJob(confirmMailMatch[1]);
        let sent;
        try {
          sent = await confirmJobMail(confirmMailMatch[1], confirmMailMatch[2]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/mail confirmation|unknown mail confirmation/iu.test(message)) {
            await jobManager.updateMail(confirmMailMatch[1], {status: "ready", error: message});
            throw new HttpError(409, message);
          }
          throw error;
        }
        await jobManager.updateMail(confirmMailMatch[1], {
          status: "sent",
          sentAt: new Date().toISOString(),
          error: undefined,
        });
        json(response, 200, {ok: true, ...sent});
        return;
      }
      const jobMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)$/u);
      if (request.method === "GET" && jobMatch) {
        json(response, 200, publicJobRecord(await getAccessibleJob(jobMatch[1]), publicBaseUrl(request)));
        return;
      }
      const artifactMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)\/artifacts\/([A-Za-z0-9_-]+)$/u);
      if (request.method === "GET" && artifactMatch) {
        const job = await getAccessibleJob(artifactMatch[1]);
        const path = job.result?.artifacts[artifactMatch[2]];
        if (!path) {
          json(response, 404, {error: "Artifact not found"});
          return;
        }
        await streamArtifact(request, response, path);
        return;
      }
      json(response, 404, {error: "Not found"});
    } catch (error) {
      const requestId = randomUUID();
      console.error(`[http] ${request.method ?? "?"} ${request.url ?? "/"}:`, error);
      if (error instanceof HttpError || error instanceof CommunityStoreError || error instanceof CapabilityStoreError || error instanceof AuthError) {
        json(response, error.status, {error: error.message, ...(error instanceof AuthError || error instanceof CapabilityStoreError ? {code: error.code} : {}), requestId});
      } else if (error instanceof Error && /asset access denied/iu.test(error.message)) {
        json(response, 404, {error: "Asset not found", requestId});
      } else if (error instanceof Error && error.message.startsWith("Job queue is full")) {
        json(response, 429, {error: error.message, requestId});
      } else {
        json(response, 500, {error: "Internal server error", requestId});
      }
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolvePromise);
  });
  const bound = server.address();
  const boundPort = typeof bound === "object" && bound ? bound.port : config.port;
  console.log(`MoonCut Pi editing agent listening on http://${config.host}:${boundPort}`);
  // Studio Supervisor waits for this exact marker (stdout/stderr).
  console.log(`MOONCUT_AGENT_READY host=${config.host} port=${boundPort}`);
  console.log(`Asset store: ${assetsRoot}`);
  console.log(`Data root: ${config.databasePath}`);
  return server;
};
