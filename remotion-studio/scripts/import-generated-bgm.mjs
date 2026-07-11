import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const studioDir = resolve(scriptDir, '..');

const loadDotEnv = async () => {
  try {
    const contents = await readFile(resolve(studioDir, '.env'), 'utf8');
    for (const rawLine of contents.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const requireEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Put it in the ignored remotion-studio/.env or the process environment.`);
  return value;
};

const readPositiveInteger = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const requestJson = async (url, headers) => {
  const response = await fetch(url, {headers, signal: AbortSignal.timeout(30_000)});
  const text = await response.text();
  if (!response.ok) throw new Error(`BGM service request failed (${response.status}): ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('BGM service returned invalid JSON');
  }
};

await loadDotEnv();
const jobId = process.argv[2];
if (!/^[a-z0-9-]{8,128}$/iu.test(jobId ?? '')) {
  throw new Error('Usage: npm run bgm:import-generated -- <SUCCEEDED_JOB_ID>');
}

const serviceUrl = requireEnv('BGM_SERVICE_URL').replace(/\/+$/u, '');
const apiKey = requireEnv('BGM_SERVICE_API_KEY');
const headers = {Authorization: `Bearer ${apiKey}`};
const job = await requestJson(`${serviceUrl}/api/v1/bgm/jobs/${encodeURIComponent(jobId)}`, headers);
if (job.status !== 'SUCCEEDED' || typeof job.result?.audioUrl !== 'string') {
  throw new Error(`Job ${jobId} is not ready for import (status: ${job.status ?? 'unknown'})`);
}

const audioUrl = new URL(job.result.audioUrl, `${serviceUrl}/`).toString();
// The job artifact URL carries its own short-lived download token. Never
// forward the service bearer credential to this second URL.
const audioResponse = await fetch(audioUrl, {signal: AbortSignal.timeout(90_000)});
if (!audioResponse.ok) throw new Error(`Generated BGM download failed (${audioResponse.status})`);
const maxBytes = readPositiveInteger('BGM_MAX_IMPORT_BYTES', 50 * 1024 * 1024);
const declaredSize = Number(audioResponse.headers.get('content-length'));
if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error(`Generated BGM exceeds ${maxBytes} byte import limit`);
const bytes = new Uint8Array(await audioResponse.arrayBuffer());
if (bytes.byteLength > maxBytes) throw new Error(`Generated BGM exceeds ${maxBytes} byte import limit`);

const relativeAssetPath = `audio/bgm/generated/${jobId}.mp3`;
const outputPath = resolve(studioDir, 'public', relativeAssetPath);
await mkdir(dirname(outputPath), {recursive: true});
const temporaryPath = `${outputPath}.tmp`;
await writeFile(temporaryPath, bytes);
await rename(temporaryPath, outputPath);

const plan = job.plan && typeof job.plan === 'object' ? job.plan : {};
const specBgm = {
  kind: 'generated',
  src: relativeAssetPath,
  title: typeof plan.title === 'string' && plan.title.trim() ? plan.title.trim() : 'AI Generated Voiceover BGM',
  gainDb: -22,
  duckDb: -6,
  fadeInMs: 900,
  fadeOutMs: 1400,
  crossfadeLoopMs: 900,
  generated: {
    provider: 'yunwu-suno',
    jobId,
    plan: {
      mood: typeof plan.mood === 'string' ? plan.mood : 'unspecified',
      tags: typeof plan.tags === 'string' ? plan.tags : 'instrumental, background music for voice-over',
      bpm: Number.isFinite(plan.bpm) ? plan.bpm : 92,
      source: plan.source === 'ai' ? 'ai' : 'rules',
    },
    assetSha256: createHash('sha256').update(bytes).digest('hex'),
    importedAt: new Date().toISOString(),
    usageRights: 'provider-terms-pending',
  },
};

console.log(JSON.stringify({
  imported: relativeAssetPath,
  bytes: bytes.byteLength,
  specBgm,
  nextStep: 'Review the provider terms, then set generated.usageRights to commercial-use-confirmed only when confirmed.',
}, null, 2));
