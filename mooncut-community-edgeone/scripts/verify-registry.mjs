import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
const loadJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const catalogPath = join(root, 'registry/v1/catalog.json');
const catalog = await loadJson(catalogPath);

if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.packages) || !catalog.packages.length) throw new Error('catalog must contain published packages');
for (const item of catalog.packages) {
  const files = item.release?.files;
  if (!files || !item.slug || !item.release?.version) throw new Error('catalog entry is incomplete');
  const dir = join(root, 'registry/v1/packages', item.slug, item.release.version);
  const manifestHash = await sha256(join(root, files.manifest));
  const packageHash = await sha256(join(root, files.package));
  if (manifestHash !== item.release.integrity?.manifestSha256) throw new Error(`${item.slug}: manifest SHA-256 mismatch`);
  if (packageHash !== item.release.integrity?.packageSha256) throw new Error(`${item.slug}: package SHA-256 mismatch`);
  const bundle = await loadJson(join(root, files.package));
  const skillHash = await sha256(join(root, files.skill));
  const connectorHash = await sha256(join(root, files.connector));
  if (bundle.integrity?.skillSha256 !== skillHash) throw new Error(`${item.slug}: skill SHA-256 mismatch`);
  if (bundle.integrity?.connectorSha256 !== connectorHash) throw new Error(`${item.slug}: connector SHA-256 mismatch`);
  if (bundle.install?.neverExecuteDownloadedCode !== true) throw new Error(`${item.slug}: package must forbid downloaded code execution`);
  if (!(await loadJson(join(dir, 'connector.json'))).security?.requiresLocalAdapter) throw new Error(`${item.slug}: connector must require local adapter`);
}
console.log(`verified ${catalog.packages.length} EdgeOne registry package(s)`);
