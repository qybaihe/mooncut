import {createHash} from "node:crypto";
import {createReadStream, existsSync} from "node:fs";
import {copyFile, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {basename, extname, join} from "node:path";
import {analyzeContactSheet} from "./gateway.ts";
import {agentRoot, config, faceTrackerRoot, remotionRoot} from "./config.ts";
import {runProcess} from "./process.ts";
import type {FaceTrackManifest, SubtitleData, SubtitleSegment, VideoProbe} from "./types.ts";

type ProbePayload = {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
  }>;
  format?: {
    duration?: string;
    format_name?: string;
  };
};

const parseRate = (value: string | undefined) => {
  if (!value) return 0;
  const [numeratorText, denominatorText = "1"] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  return denominator > 0 && Number.isFinite(numerator) ? numerator / denominator : 0;
};

export const probeVideo = async (inputPath: string): Promise<VideoProbe> => {
  const result = await runProcess("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,width,height,avg_frame_rate,r_frame_rate:format=duration,format_name",
    "-of", "json",
    inputPath,
  ]);
  const payload = JSON.parse(result.stdout) as ProbePayload;
  const video = payload.streams?.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video.height) throw new Error("No video stream found");
  const duration = Number(payload.format?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid video duration");
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30;
  return {
    durationMs: Math.round(duration * 1000),
    fps,
    width: video.width,
    height: video.height,
    hasAudio: payload.streams?.some((stream) => stream.codec_type === "audio") ?? false,
    formatName: payload.format?.format_name ?? "unknown",
  };
};

export const makeContactSheet = async (
  inputPath: string,
  probe: VideoProbe,
  outputPath: string,
): Promise<string> => {
  await mkdir(join(outputPath, ".."), {recursive: true});
  const intervalSeconds = Math.max(0.5, probe.durationMs / 1000 / 6);
  await runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", inputPath,
    "-vf", `fps=1/${intervalSeconds.toFixed(4)},scale=480:-2,tile=3x2:padding=10:margin=10:color=0x111816`,
    "-frames:v", "1",
    "-q:v", "2",
    "-y", outputPath,
  ], {timeoutMs: 120_000});
  return outputPath;
};

export type MailPreviewResult = {
  path: string;
  bytes: number;
  /** True when the master was already small enough and was copied as-is. */
  copied: boolean;
  videoBitrate: number;
};

/**
 * Post-render only: build an email-safe preview (~target MB, typically 720p)
 * from the finished 1080p master. Never changes Remotion export resolution.
 */
export const encodeMailPreviewVideo = async (
  inputPath: string,
  outputPath: string,
  options: {targetBytes?: number; maxHeight?: number; maxBytes?: number} = {},
): Promise<MailPreviewResult> => {
  if (!existsSync(inputPath)) throw new Error(`Mail preview source missing: ${inputPath}`);
  const targetBytes = options.targetBytes ?? config.mailPreviewTargetBytes;
  const maxBytes = options.maxBytes ?? config.mailAttachMaxBytes;
  const maxHeight = options.maxHeight ?? config.mailPreviewMaxHeight;
  const inputInfo = await stat(inputPath);

  const probe = await probeVideo(inputPath);
  // Only skip re-encode when master is already small AND already at-or-below mail height
  // (do not email a full 1080p master just because it happens to be under 20MB).
  if (
    inputInfo.size > 0
    && inputInfo.size <= Math.min(targetBytes, maxBytes)
    && probe.height <= maxHeight
  ) {
    await copyFile(inputPath, outputPath);
    return {path: outputPath, bytes: inputInfo.size, copied: true, videoBitrate: 0};
  }

  const durationSec = Math.max(0.5, probe.durationMs / 1000);
  const audioBitrate = 96_000;
  // Leave muxing headroom; Base64 will grow ~33% later.
  const budgetBitsPerSec = (targetBytes * 8 * 0.9) / durationSec;
  let videoBitrate = Math.max(400_000, Math.floor(budgetBitsPerSec - audioBitrate));

  // Always scale 1080p master → mail maxHeight (default 720). Even dims for yuv420p.
  const scaleFilter = `scale=-2:'min(${maxHeight},ih)',scale=trunc(iw/2)*2:trunc(ih/2)*2`;

  const encodeOnce = async (bitrate: number) => {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", inputPath,
      "-vf", scaleFilter,
      "-c:v", "libx264",
      "-preset", "fast",
      "-profile:v", "main",
      "-pix_fmt", "yuv420p",
      "-b:v", String(bitrate),
      "-maxrate", String(Math.floor(bitrate * 1.2)),
      "-bufsize", String(Math.floor(bitrate * 2)),
      "-c:a", "aac",
      "-b:a", "96k",
      "-ac", "2",
      "-movflags", "+faststart",
      outputPath,
    ], {timeoutMs: 20 * 60_000});
  };

  await encodeOnce(videoBitrate);
  let outBytes = (await stat(outputPath)).size;

  // One retry if still over hard attachment cap.
  if (outBytes > maxBytes) {
    const scale = (maxBytes * 0.85) / outBytes;
    videoBitrate = Math.max(180_000, Math.floor(videoBitrate * scale));
    await encodeOnce(videoBitrate);
    outBytes = (await stat(outputPath)).size;
  }

  if (outBytes <= 0) throw new Error("Mail preview encode produced an empty file");
  if (outBytes > maxBytes) {
    throw new Error(
      `Mail preview still too large after encode (${Math.round(outBytes / 1024 / 1024)}MB > ${Math.round(maxBytes / 1024 / 1024)}MB cap)`,
    );
  }

  return {path: outputPath, bytes: outBytes, copied: false, videoBitrate};
};

export const inspectVideo = async (
  inputPath: string,
  contactSheetPath: string,
): Promise<{probe: VideoProbe; analysis: string; visionModel: string}> => {
  const probe = await probeVideo(inputPath);
  await makeContactSheet(inputPath, probe, contactSheetPath);
  const vision = await analyzeContactSheet(contactSheetPath);
  return {probe, analysis: vision.analysis, visionModel: vision.model};
};

export const sha256File = async (path: string) => {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolvePromise);
    stream.once("error", reject);
  });
  return hash.digest("hex");
};

const knownSubtitleSources = new Map<string, string>([
  ["42281c087dbeb4ae046c6b055e589ab129650ac8850bc1afa7e1900207034f25", join(remotionRoot, "src/generated-horizontal-subtitles.json")],
  ["79a783926ae1c4c97c10d08d41dc3aebb2a943011784a5e4f0ebbfca89fe7a74", join(remotionRoot, "src/generated-subtitles.json")],
]);

type RawSubtitlePayload = {
  duration_ms?: number;
  transcript?: string;
  segments?: SubtitleSegment[];
  words?: SubtitleData["words"];
  providers?: {text_provider?: string; timestamp_provider?: string};
};

const normalizeSubtitles = (payload: RawSubtitlePayload, fallbackDurationMs: number, provider: string): SubtitleData => ({
  duration_ms: payload.duration_ms ?? fallbackDurationMs,
  transcript: payload.transcript ?? "",
  segments: (payload.segments ?? []).map((segment, index) => ({
    index: segment.index ?? index + 1,
    text: segment.text.replace(/\s*\n\s*/gu, ""),
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
  })),
  words: payload.words,
  provider,
});

const fetchWithTimeout = (url: string, init: RequestInit = {}, timeoutMs = 5_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {...init, signal: controller.signal}).finally(() => clearTimeout(timeout));
};

const subtitleServiceCandidates = () => {
  const urls = new Set([config.subtitleApiUrl]);
  if (config.subtitleApiUrl.endsWith(":8765")) urls.add(config.subtitleApiUrl.replace(/:8765$/u, ":8000"));
  return [...urls];
};

const findSubtitleService = async () => {
  for (const baseUrl of subtitleServiceCandidates()) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/healthz`);
      const health = await response.json().catch(() => null) as {status?: string; providers_configured?: boolean} | null;
      if (response.ok && (health?.status === undefined || health.status === "ok") && health?.providers_configured !== false) return baseUrl;
    } catch {
      // Try the next local endpoint.
    }
  }
  return null;
};

const requestSubtitleService = async (
  baseUrl: string,
  inputPath: string,
  durationMs: number,
): Promise<SubtitleData> => {
  const form = new FormData();
  const input = await readFile(inputPath);
  form.set("file", new Blob([input]), basename(inputPath));
  form.set("language", "zh-CN");
  form.set("glossary", "MoonCut,Remotion,Codex,OpenAI,MiniMax,MiMo,GLM");
  form.set("formats", "json,srt,vtt");
  const headers = {"X-API-Key": config.subtitleApiKey};
  const createResponse = await fetch(`${baseUrl}/v1/subtitle-jobs`, {method: "POST", headers, body: form});
  if (!createResponse.ok) throw new Error(`${createResponse.status} ${await createResponse.text()}`);
  const created = (await createResponse.json()) as {id: string};

  const deadline = Date.now() + config.subtitleJobTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, config.subtitlePollIntervalMs));
    const statusResponse = await fetch(`${baseUrl}/v1/subtitle-jobs/${created.id}`, {headers});
    if (!statusResponse.ok) throw new Error(`${statusResponse.status} ${await statusResponse.text()}`);
    const status = (await statusResponse.json()) as {status: string; error?: string};
    if (status.status === "failed") throw new Error(status.error ?? "Subtitle job failed");
    if (status.status !== "completed") continue;
    const resultResponse = await fetch(`${baseUrl}/v1/subtitle-jobs/${created.id}/result`, {headers});
    if (!resultResponse.ok) throw new Error(`${resultResponse.status} ${await resultResponse.text()}`);
    const result = (await resultResponse.json()) as RawSubtitlePayload;
    const provider = [result.providers?.text_provider, result.providers?.timestamp_provider].filter(Boolean).join(" + ");
    return normalizeSubtitles(result, durationMs, provider || "hybrid-subtitle-service");
  }
  throw new Error(`Subtitle service timed out after ${Math.round(config.subtitleJobTimeoutMs / 60_000)} minutes`);
};

const requestLocalTranscription = async (inputPath: string, durationMs: number): Promise<SubtitleData | null> => {
  const script = join(agentRoot, "scripts/transcribe_faster_whisper.py");
  if (!existsSync(config.transcribePython) || !existsSync(script)) return null;
  try {
    const result = await runProcess(config.transcribePython, [
      script,
      inputPath,
      "--model", config.whisperModel,
      "--language", config.whisperLanguage,
      "--duration-ms", String(durationMs),
    ], {cwd: agentRoot, timeoutMs: 30 * 60_000});
    const payload = JSON.parse(result.stdout) as RawSubtitlePayload;
    return normalizeSubtitles(payload, durationMs, `faster-whisper:${config.whisperModel}`);
  } catch {
    return null;
  }
};

export const transcribeVideo = async (inputPath: string, durationMs: number): Promise<SubtitleData> => {
  if (config.allowKnownSubtitleFixtures) {
    const hash = await sha256File(inputPath);
    const knownPath = knownSubtitleSources.get(hash);
    if (knownPath && existsSync(knownPath)) {
      const payload = JSON.parse(await readFile(knownPath, "utf8")) as RawSubtitlePayload;
      return normalizeSubtitles(payload, durationMs, `hash-match:${basename(knownPath)}`);
    }
  }

  const service = await findSubtitleService();
  if (service) {
    try {
      return await requestSubtitleService(service, inputPath, durationMs);
    } catch (error) {
      if (config.requireSubtitleService) throw error;
      // Preserve availability during a provider outage; the local model remains
      // an explicitly lower-accuracy fallback rather than failing the edit.
    }
  }
  if (config.requireSubtitleService) throw new Error("Hybrid subtitle service is unavailable");
  return await requestLocalTranscription(inputPath, durationMs) ??
    {duration_ms: durationMs, transcript: "", segments: [], provider: "unavailable"};
};

export const trackFace = async (
  inputPath: string,
  outputPath: string,
): Promise<FaceTrackManifest | null> => {
  const python = join(faceTrackerRoot, ".venv/bin/python");
  if (!existsSync(python)) return null;
  try {
    await runProcess(python, [
      "-m", "face_tracker", "analyze", inputPath,
      "--output", outputPath,
      "--device", "auto",
      "--sample-fps", "8",
      "--imgsz", "512",
    ], {cwd: faceTrackerRoot, timeoutMs: 20 * 60_000});
    return JSON.parse(await readFile(outputPath, "utf8")) as FaceTrackManifest;
  } catch (error) {
    await writeFile(`${outputPath}.error.txt`, error instanceof Error ? error.message : String(error));
    return null;
  }
};

export const copySourceIntoRemotion = async (
  inputPath: string,
  jobId: string,
): Promise<{path: string; src: string}> => {
  const extension = extname(inputPath).toLowerCase() || ".mp4";
  const publicDir = join(remotionRoot, "public", "agent-jobs", jobId);
  await mkdir(publicDir, {recursive: true});
  const output = join(publicDir, `source${extension}`);
  await copyFile(inputPath, output);
  return {path: output, src: `agent-jobs/${jobId}/source${extension}`};
};

/** Publish a non-destructive local derivative alongside the original source. */
export const copyDerivedVideoIntoRemotion = async (
  inputPath: string,
  jobId: string,
  name: string,
): Promise<{path: string; src: string}> => {
  const extension = extname(inputPath).toLowerCase() || ".mp4";
  const safeName = name.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[-.]+|[-.]+$/gu, "") || "derived";
  const publicDir = join(remotionRoot, "public", "agent-jobs", jobId);
  await mkdir(publicDir, {recursive: true});
  const filename = `${safeName}${extension}`;
  const output = join(publicDir, filename);
  await copyFile(inputPath, output);
  return {path: output, src: `agent-jobs/${jobId}/${filename}`};
};
