import {createHash} from 'node:crypto';
import {readdir, readFile, stat} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const studioDir = join(scriptDir, '..');
const publicDir = join(studioDir, 'public');
const libraryDir = join(publicDir, 'assets/material-library');
const manifest = JSON.parse(await readFile(join(libraryDir, 'manifest.json'), 'utf8'));
const errors = [];
const ids = new Set();
const paths = new Set();
const hashes = new Set();
const counts = {};

const walk = async (directory) => {
  const entries = await readdir(directory, {withFileTypes: true});
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
};

for (const asset of manifest.assets) {
  if (ids.has(asset.id)) errors.push(`duplicate id: ${asset.id}`);
  if (paths.has(asset.file)) errors.push(`duplicate file: ${asset.file}`);
  if (hashes.has(asset.sha256)) errors.push(`duplicate hash: ${asset.sha256}`);
  ids.add(asset.id);
  paths.add(asset.file);
  hashes.add(asset.sha256);
  counts[asset.category] = (counts[asset.category] || 0) + 1;

  for (const field of ['id', 'titleZh', 'titleEn', 'category', 'file', 'mimeType', 'sha256', 'useWhenZh']) {
    if (!asset[field]) errors.push(`${asset.id}: missing ${field}`);
  }
  if (!asset.tagsZh?.length || !asset.spokenTriggersZh?.length) errors.push(`${asset.id}: missing semantic tags`);
  if (!asset.source?.provider || !asset.source?.sourcePage) errors.push(`${asset.id}: incomplete source metadata`);
  if (!(asset.width > 0) || !(asset.height > 0) || !(asset.aspectRatio > 0)) errors.push(`${asset.id}: invalid dimensions`);

  const absolutePath = join(publicDir, asset.file);
  let buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch {
    errors.push(`${asset.id}: file not found: ${asset.file}`);
    continue;
  }
  const digest = createHash('sha256').update(buffer).digest('hex');
  if (digest !== asset.sha256) errors.push(`${asset.id}: sha256 mismatch`);
  if ((await stat(absolutePath)).size < 100) errors.push(`${asset.id}: file too small`);
  if (asset.mimeType === 'image/svg+xml' && !buffer.toString('utf8', 0, 500).includes('<svg')) errors.push(`${asset.id}: invalid SVG header`);
  if (asset.mimeType === 'image/jpeg' && !(buffer[0] === 0xff && buffer[1] === 0xd8)) errors.push(`${asset.id}: invalid JPEG header`);
  if (asset.mimeType === 'image/png' && buffer.subarray(1, 4).toString() !== 'PNG') errors.push(`${asset.id}: invalid PNG header`);
  if (asset.source.provider === 'Wikimedia Commons' && !asset.source.license) errors.push(`${asset.id}: missing Commons license`);
}

if (manifest.totalAssets !== manifest.assets.length) errors.push('totalAssets does not match assets.length');
if (JSON.stringify(counts) !== JSON.stringify(manifest.countsByCategory)) errors.push('countsByCategory does not match assets');
if (manifest.totalAssets < 100 || manifest.totalAssets > 200) errors.push(`asset count ${manifest.totalAssets} is outside the 100–200 target`);

const trackedAbsolutePaths = new Set([...paths].map((file) => resolve(publicDir, file)));
const mediaFiles = (await walk(libraryDir)).filter((file) => /\.(svg|png|jpe?g|webp)$/i.test(file));
for (const file of mediaFiles) {
  if (!trackedAbsolutePaths.has(resolve(file))) errors.push(`untracked media file: ${relative(libraryDir, file)}`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  totalAssets: manifest.totalAssets,
  countsByCategory: manifest.countsByCategory,
  mediaFiles: mediaFiles.length,
}, null, 2));
