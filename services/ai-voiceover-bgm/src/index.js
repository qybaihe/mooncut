import fs from "node:fs/promises";
import { loadConfig } from "./config.js";
import { PromptAnalyzer } from "./prompt-analyzer.js";
import { YunwuClient } from "./yunwu-client.js";
import { AudioProcessor } from "./audio-processor.js";
import { JobStore } from "./job-store.js";
import { MusicService } from "./music-service.js";
import { createServer } from "./server.js";

const config = loadConfig();
await fs.mkdir(config.audioDir, { recursive: true });

const store = new JobStore(config.jobsFile);
await store.init();
const analyzer = new PromptAnalyzer(config);
const client = new YunwuClient(config);
const audioProcessor = new AudioProcessor(config);
const service = new MusicService({ config, store, analyzer, client, audioProcessor });
const server = createServer({ config, service, store });

server.listen(config.port, config.host, () => {
  console.log(`AI 口播配乐服务已启动：http://${config.host}:${config.port}`);
  if (!config.yunwu.apiKey) console.warn("警告：尚未设置 YUNWU_API_KEY，生成接口会失败。健康检查仍可使用。");
  if (!config.serviceApiKey) console.warn("警告：尚未设置 SERVICE_API_KEY，请勿直接暴露到公网。");
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
