import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const renderPath = process.argv[2];
const specPath = process.argv[3] ?? 'src/data/763e8d-perfect-edit-spec.json';
if (!renderPath) {
  console.error('Usage: node scripts/verify-rendered-final-audio.mjs <render.mp4> [spec.json]');
  process.exit(1);
}

const spec = JSON.parse(await readFile(resolve(specPath), 'utf8'));
const target = spec.audio?.mastering;
if (!target) throw new Error('Spec does not define audio.mastering');

const measurement = spawnSync(
  'ffmpeg',
  ['-nostdin', '-hide_banner', '-nostats', '-i', resolve(renderPath), '-map', '0:a:0', '-filter:a', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
  {encoding: 'utf8'},
);
if (measurement.error || measurement.status !== 0) {
  throw measurement.error ?? new Error(measurement.stderr || 'ffmpeg loudness measurement failed');
}
const json = measurement.stderr.match(/\{\s*"input_i"[\s\S]*?\n\}/u)?.[0];
if (!json) throw new Error('Could not read loudnorm metrics from ffmpeg output');
const metrics = JSON.parse(json);
const integratedLufs = Number(metrics.input_i);
const truePeakDbtp = Number(metrics.input_tp);
const errors = [];
if (Math.abs(integratedLufs - target.programmeTargetLufs) > target.programmeToleranceLufs) {
  errors.push(`integrated loudness ${integratedLufs} LUFS is outside ${target.programmeTargetLufs} ± ${target.programmeToleranceLufs}`);
}
if (truePeakDbtp > target.maxTruePeakDbtp) {
  errors.push(`true peak ${truePeakDbtp} dBTP exceeds ${target.maxTruePeakDbtp} dBTP`);
}

if (errors.length > 0) {
  console.error(`Rendered-audio QA failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  integratedLufs,
  truePeakDbtp,
  target,
}, null, 2));
