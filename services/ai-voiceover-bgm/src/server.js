import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";

const MAX_BODY_BYTES = 1024 * 1024;

function json(response, statusCode, body) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
  });
  response.end(data);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AppError("请求体不能超过 1 MB", { statusCode: 413, code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new AppError("请求体必须是有效 JSON", { statusCode: 400, code: "INVALID_JSON" });
  }
}

function validateInput(body) {
  if (!body || typeof body.script !== "string" || !body.script.trim()) {
    throw new AppError("script（口播文案）不能为空", { statusCode: 400, code: "INVALID_INPUT" });
  }
  const script = body.script.trim();
  if (script.length > 50000) throw new AppError("script 最长 50000 字符", { statusCode: 400, code: "INVALID_INPUT" });
  const durationSeconds = Number(body.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) {
    throw new AppError("durationSeconds 必须在 1 到 3600 之间", { statusCode: 400, code: "INVALID_INPUT" });
  }
  const volumeDb = body.volumeDb == null ? undefined : Number(body.volumeDb);
  if (volumeDb != null && (!Number.isFinite(volumeDb) || volumeDb < -40 || volumeDb > 0)) {
    throw new AppError("volumeDb 必须在 -40 到 0 之间", { statusCode: 400, code: "INVALID_INPUT" });
  }
  return {
    script,
    durationSeconds,
    title: typeof body.title === "string" ? body.title.trim().slice(0, 80) : "",
    styleHint: typeof body.styleHint === "string" ? body.styleHint.trim().slice(0, 200) : "",
    moodHint: typeof body.moodHint === "string" ? body.moodHint.trim().slice(0, 120) : "",
    volumeDb,
    metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {},
  };
}

function authorized(request, apiKey) {
  const received = request.headers.authorization;
  const expected = `Bearer ${apiKey}`;
  if (typeof received !== "string") return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

export function createServer({ config, service, store }) {
  return http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json(response, 200, { ok: true, yunwuConfigured: Boolean(config.yunwu.apiKey) });
      }
      const fileMatch = url.pathname.match(/^\/api\/v1\/bgm\/files\/([a-f0-9-]+)\/(bgm\.mp3)$/i);
      if (request.method === "GET" && fileMatch) {
        const job = store.get(fileMatch[1]);
        const tokenAuthorized = Boolean(job?.result?.downloadToken) && url.searchParams.get("token") === job.result.downloadToken;
        if (!tokenAuthorized && !authorized(request, config.serviceApiKey)) {
          return json(response, 401, { error: { code: "UNAUTHORIZED", message: "缺少或无效的音频下载令牌" } });
        }
        const filePath = path.resolve(config.audioDir, fileMatch[1], fileMatch[2]);
        const root = `${path.resolve(config.audioDir)}${path.sep}`;
        if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
          return json(response, 404, { error: { code: "NOT_FOUND", message: "音频文件不存在" } });
        }
        const stat = fs.statSync(filePath);
        response.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": stat.size,
          "Content-Disposition": `inline; filename="bgm-${fileMatch[1]}.mp3"`,
          "Cache-Control": "private, max-age=86400",
        });
        fs.createReadStream(filePath).pipe(response);
        return;
      }
      if (!authorized(request, config.serviceApiKey)) {
        return json(response, 401, { error: { code: "UNAUTHORIZED", message: "缺少或无效的服务访问令牌" } });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/bgm/plan") {
        const input = validateInput(await readJson(request));
        return json(response, 200, { plan: await service.previewPlan(input) });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/bgm/jobs") {
        const input = validateInput(await readJson(request));
        const job = await service.createJob(input);
        return json(response, 202, {
          jobId: job.id,
          status: job.status,
          statusUrl: `/api/v1/bgm/jobs/${job.id}`,
        });
      }

      const jobMatch = url.pathname.match(/^\/api\/v1\/bgm\/jobs\/([a-f0-9-]+)$/i);
      if (request.method === "GET" && jobMatch) {
        const job = store.get(jobMatch[1]);
        if (!job) return json(response, 404, { error: { code: "NOT_FOUND", message: "任务不存在" } });
        return json(response, 200, job);
      }

      const recoverMatch = url.pathname.match(/^\/api\/v1\/bgm\/jobs\/([a-f0-9-]+)\/recover$/i);
      if (request.method === "POST" && recoverMatch) {
        const job = await service.recoverJob(recoverMatch[1]);
        return json(response, 202, {
          jobId: job.id,
          status: job.status,
          statusUrl: `/api/v1/bgm/jobs/${job.id}`,
        });
      }

      return json(response, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return json(response, statusCode, {
        error: {
          code: error.code || "INTERNAL_ERROR",
          message: statusCode >= 500 && !error.code ? "服务内部错误" : error.message,
          details: error.details,
        },
      });
    }
  });
}
