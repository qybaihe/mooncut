import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..');
const catalogPath = join(projectRoot, 'src/data/bgm-library.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const failures = [];

for (const track of catalog.tracks) {
  const audioPath = join(projectRoot, 'public', track.file);
  let bytes;
  try {
    bytes = readFileSync(audioPath);
  } catch (error) {
    failures.push(`${track.id}: missing file (${error.message})`);
    continue;
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== track.integrity.localSha256) {
    failures.push(`${track.id}: SHA-256 mismatch`);
  }

  try {
    const probe = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration',
      '-of', 'json',
      audioPath,
    ], {encoding: 'utf8'}));
    const stream = probe.streams?.[0];
    const durationMs = Number(probe.format?.duration) * 1000;

    if (stream?.codec_name !== 'mp3') failures.push(`${track.id}: expected MP3 codec`);
    if (Number(stream?.sample_rate) !== catalog.processing.sampleRateHz) failures.push(`${track.id}: unexpected sample rate`);
    if (stream?.channels !== catalog.processing.channels) failures.push(`${track.id}: unexpected channel count`);
    if (Math.abs(durationMs - track.analysis.durationMs) > 150) failures.push(`${track.id}: duration differs from catalog`);
  } catch (error) {
    failures.push(`${track.id}: ffprobe failed (${error.message})`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

const licenseIds = [...new Set(catalog.tracks.map((track) => track.licenseId))];
console.log(`Verified ${catalog.tracks.length} BGM tracks (${licenseIds.join(', ')}).`);
