import {execFileSync} from 'node:child_process';
import {access, readFile} from 'node:fs/promises';
import {dirname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  assertFinalTalkingHeadSpec,
  validateFinalTalkingHeadSpec,
} from '../src/finalTalkingHeadSpec.ts';
import {resolveAudioVisualCues} from '../src/audioVisualCues.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const studioDir = resolve(scriptDir, '..');
const publicDir = resolve(studioDir, 'public');
const specPath = resolve(process.argv[2] ?? 'src/data/763e8d-perfect-edit-spec.json');

const raw = JSON.parse(await readFile(specPath, 'utf8'));
const issues = validateFinalTalkingHeadSpec(raw).map(({message, path}) => `${path}: ${message}`);

if (issues.length === 0) {
  const spec = assertFinalTalkingHeadSpec(raw);
  const requiredFiles = [
    ['source.src', spec.source.src],
    ...spec.assets.map((asset) => [`assets.${asset.id}.src`, asset.src] as const),
    ...spec.beats.flatMap((beat) => (beat.tools ?? [])
      .map((tool) => [`beats.${beat.id}.tools.${tool.label}.iconSrc`, tool.iconSrc] as const)),
    ...(spec.audio.bgm ? [['audio.bgm.src', spec.audio.bgm.src] as const] : []),
    ...resolveAudioVisualCues({beats: spec.beats, cues: spec.audio.cues, fps: spec.fps})
      .map((cue) => [`audio.cues.${cue.id}`, cue.asset.src] as const),
  ];

  for (const [field, file] of requiredFiles) {
    const absolutePath = resolve(publicDir, file);
    if (!absolutePath.startsWith(`${publicDir}${sep}`)) {
      issues.push(`${field}: must resolve below public/, received ${file}`);
      continue;
    }
    try {
      await access(absolutePath);
    } catch {
      issues.push(`${field}: file not found: ${relative(publicDir, absolutePath)}`);
    }
  }

  if (issues.length === 0) {
    const sourcePath = resolve(publicDir, spec.source.src);
    const durationSeconds = Number(execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', sourcePath],
      {encoding: 'utf8'},
    ).trim());
    const actualDurationMs = durationSeconds * 1000;
    const toleranceMs = 1000 / spec.fps + 1;
    if (!Number.isFinite(actualDurationMs) || Math.abs(actualDurationMs - spec.source.durationMs) > toleranceMs) {
      issues.push(`source.durationMs: spec=${spec.source.durationMs}ms, file=${actualDurationMs.toFixed(1)}ms`);
    }
  }
}

if (issues.length > 0) {
  console.error(`Final talking-head preflight failed for ${specPath}:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
  process.exit(1);
}

const spec = assertFinalTalkingHeadSpec(raw);
console.log(JSON.stringify({
  ok: true,
  schemaVersion: spec.schemaVersion,
  durationMs: spec.source.durationMs,
  beats: spec.beats.length,
  subtitles: spec.subtitles.length,
  cues: spec.audio.cues.length,
  output: `${spec.width}x${spec.height}@${spec.fps} ${spec.output.videoCodec}/${spec.output.audioCodec}`,
}, null, 2));
