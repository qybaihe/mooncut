import {basename, dirname, resolve} from 'node:path';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const apiBase = process.env.SUBTITLE_API_URL ?? 'http://127.0.0.1:8765';
const apiKey = process.env.SUBTITLE_API_KEY ?? 'integration-test';
const inputPath = resolve(process.argv[2] ?? 'public/media/talking-head.mp4');
const outputPath = resolve(
  process.argv[3] ?? fileURLToPath(new URL('../src/generated-subtitles.json', import.meta.url)),
);

const request = async (path, options = {}) => {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {'X-API-Key': apiKey, ...(options.headers ?? {})},
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }

  return response.json();
};

const form = new FormData();
form.set('file', new Blob([await readFile(inputPath)]), basename(inputPath));
form.set('language', 'zh-CN');
form.set('glossary', '北京探月计划,Physical AI,黑客松,OpenAI,GPT-5.6,GLM 5.2,Sol,Terra,Luna,Codex');
form.set('formats', 'json,srt,vtt');
form.set('max_chars_per_line', '16');
form.set('max_lines', '2');

const job = await request('/v1/subtitle-jobs', {method: 'POST', body: form});
let status = job;

for (let attempt = 0; attempt < 120 && !['completed', 'failed'].includes(status.status); attempt += 1) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  status = await request(`/v1/subtitle-jobs/${job.id}`);
  process.stdout.write(`\rASR ${Math.round(status.progress * 100)}% - ${status.stage}`);
}

process.stdout.write('\n');

if (status.status !== 'completed') {
  throw new Error(status.error ?? `Subtitle job ended with status: ${status.status}`);
}

const result = await request(`/v1/subtitle-jobs/${job.id}/result`);
const renderData = {
  job_id: result.job_id,
  language: result.language,
  duration_ms: result.duration_ms,
  transcript: result.transcript,
  segments: result.segments,
  words: result.words,
  alignment: result.alignment,
  providers: result.providers,
};

await mkdir(dirname(outputPath), {recursive: true});
await writeFile(outputPath, `${JSON.stringify(renderData, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
