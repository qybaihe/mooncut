import {randomUUID} from "node:crypto";
import {createReadStream, createWriteStream, existsSync} from "node:fs";
import {stat, unlink} from "node:fs/promises";
import {extname} from "node:path";
import {pipeline} from "node:stream/promises";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {assetsRoot, config} from "./config.ts";
import {listGatewayModels} from "./gateway.ts";
import {assetDataPath, jobManager, saveAssetMetadata, type StoredAsset} from "./jobs.ts";
import type {EditJobRequest} from "./types.ts";

const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
};

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
    (record.title === undefined || typeof record.title === "string")
  );
};

const contentType = (path: string) => {
  switch (extname(path).toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".json": return "application/json; charset=utf-8";
    case ".jsonl": return "application/x-ndjson; charset=utf-8";
    case ".txt":
    case ".log": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
};

const uploadAsset = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (contentLength > config.maxUploadBytes) {
    json(response, 413, {error: "Upload exceeds configured limit"});
    return;
  }
  const filename = url.searchParams.get("filename") ?? "upload.mp4";
  const id = randomUUID().replaceAll("-", "");
  const path = assetDataPath(id, filename);
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
  const asset: StoredAsset = {id, filename, path, bytes, createdAt: new Date().toISOString()};
  await saveAssetMetadata(asset);
  json(response, 201, {assetId: id, filename, bytes});
};

const streamArtifact = async (response: ServerResponse, path: string) => {
  const info = await stat(path);
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Content-Length": info.size,
    "Content-Type": contentType(path),
  });
  createReadStream(path).pipe(response);
};

export const startServer = async () => {
  await jobManager.recoverInterruptedJobs();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Origin": "*",
        });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        const models = await listGatewayModels();
        json(response, 200, {
          ok: true,
          service: "mooncut-pi-video-editor",
          plannerModel: config.plannerModel,
          visionModels: config.visionModels,
          gatewayReachable: models.includes(config.plannerModel),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/models") {
        json(response, 200, {
          available: await listGatewayModels(),
          routing: {planner: config.plannerModel, vision: config.visionModels},
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/assets") {
        await uploadAsset(request, response, url);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/edit-jobs") {
        const payload = await readJson(request);
        if (!isEditJobRequest(payload) || (!payload.assetId && !payload.inputPath)) {
          json(response, 400, {error: "Body requires assetId or inputPath"});
          return;
        }
        const job = await jobManager.create(payload);
        json(response, 202, {
          id: job.id,
          status: job.status,
          statusUrl: `/v1/edit-jobs/${job.id}`,
        });
        return;
      }
      const jobMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)$/u);
      if (request.method === "GET" && jobMatch) {
        json(response, 200, await jobManager.get(jobMatch[1]));
        return;
      }
      const artifactMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)\/artifacts\/([A-Za-z0-9_-]+)$/u);
      if (request.method === "GET" && artifactMatch) {
        const job = await jobManager.get(artifactMatch[1]);
        const path = job.result?.artifacts[artifactMatch[2]];
        if (!path) {
          json(response, 404, {error: "Artifact not found"});
          return;
        }
        await streamArtifact(response, path);
        return;
      }
      json(response, 404, {error: "Not found"});
    } catch (error) {
      json(response, 500, {error: error instanceof Error ? error.message : String(error)});
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolvePromise);
  });
  console.log(`MoonCut Pi editing agent listening on http://${config.host}:${config.port}`);
  console.log(`Asset store: ${assetsRoot}`);
  return server;
};
