import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { AppError } from "./errors.js";
import { clamp, sanitizeFilePart } from "./utils.js";

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-2000) || `${command} exited with ${code}`));
    });
  });
}

export class AudioProcessor {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async prepare(jobId, track, durationSeconds, volumeDb) {
    const directory = path.join(this.config.audioDir, sanitizeFilePart(jobId));
    await fs.mkdir(directory, { recursive: true });
    const sourcePath = path.join(directory, "source.mp3");
    const outputPath = path.join(directory, "bgm.mp3");
    await this.#download(track.audioUrl, sourcePath);

    const duration = clamp(Number(durationSeconds) || track.durationSeconds || 60, 1, 3600);
    const fade = Math.min(this.config.fadeSeconds, duration / 3);
    const fadeOutStart = Math.max(0, duration - fade);
    const requestedDb = volumeDb == null ? this.config.bgmVolumeDb : Number(volumeDb);
    const db = clamp(Number.isFinite(requestedDb) ? requestedDb : this.config.bgmVolumeDb, -40, 0);
    const filter = [
      `volume=${db}dB`,
      fade > 0 ? `afade=t=in:st=0:d=${fade.toFixed(2)}` : "",
      fade > 0 ? `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fade.toFixed(2)}` : "",
    ].filter(Boolean).join(",");

    try {
      await run(this.config.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-stream_loop", "-1", "-i", sourcePath,
        "-t", duration.toFixed(3), "-vn", "-af", filter,
        "-codec:a", "libmp3lame", "-b:a", "192k", outputPath,
      ]);
      return { path: outputPath, filename: "bgm.mp3", processed: true, durationSeconds: duration, volumeDb: db };
    } catch (error) {
      if (this.config.audioProcessingRequired) {
        throw new AppError("FFmpeg 配乐后处理失败", { code: "AUDIO_PROCESSING_FAILED", details: error.message });
      }
      await fs.copyFile(sourcePath, outputPath);
      return {
        path: outputPath,
        filename: "bgm.mp3",
        processed: false,
        durationSeconds: track.durationSeconds,
        volumeDb: null,
        warning: `未找到或无法运行 FFmpeg，已保留原始音频：${error.message}`,
      };
    }
  }

  async #download(url, outputPath) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppError("云雾返回了无效的音频地址", { code: "INVALID_AUDIO_URL" });
    }
    if (parsed.protocol !== "https:") {
      throw new AppError("只允许下载 HTTPS 音频地址", { code: "INVALID_AUDIO_URL" });
    }
    const response = await this.fetch(parsed, { signal: AbortSignal.timeout(this.config.downloadTimeoutMs) });
    if (!response.ok) throw new AppError(`下载生成音乐失败 (${response.status})`, { code: "AUDIO_DOWNLOAD_FAILED" });
    const declared = Number(response.headers.get("content-length"));
    if (declared > this.config.maxAudioBytes) throw new AppError("生成音乐文件过大", { code: "AUDIO_TOO_LARGE" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.config.maxAudioBytes) throw new AppError("生成音乐文件过大", { code: "AUDIO_TOO_LARGE" });
    await fs.writeFile(outputPath, bytes);
  }
}
