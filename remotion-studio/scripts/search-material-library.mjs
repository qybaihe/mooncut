import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const manifestPath = join(scriptDir, '../public/assets/material-library/manifest.json');
const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Usage: node scripts/search-material-library.mjs <口播关键词>');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const normalize = (value) => String(value || '').toLowerCase().replace(/[\s_\-/，。、“”‘’：:；;（）()]+/g, '');
const queryText = normalize(query);
const queryTokens = [...new Set([
  queryText,
  ...query.toLowerCase().split(/[\s,，。/]+/).map(normalize).filter((token) => token.length > 1),
])];

const scoreAsset = (asset) => {
  const weighted = [
    [asset.titleZh, 12],
    [asset.titleEn, 10],
    [asset.aliases, 9],
    [asset.spokenTriggersZh, 8],
    [asset.tagsZh, 7],
    [asset.tagsEn, 5],
    [asset.useWhenZh, 3],
    [asset.category, 2],
  ];
  let score = 0;
  for (const [field, weight] of weighted) {
    const values = Array.isArray(field) ? field : [field];
    for (const value of values) {
      const text = normalize(value);
      for (const token of queryTokens) {
        if (!token) continue;
        if (text === token) score += weight * 3;
        else if (text.length >= 2 && token.length >= 2 && (text.includes(token) || token.includes(text))) score += weight;
      }
    }
  }
  return score;
};

const results = manifest.assets
  .map((asset) => ({asset, score: scoreAsset(asset)}))
  .filter((result) => result.score > 0)
  .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id))
  .slice(0, 8)
  .map(({asset, score}) => ({
    score,
    id: asset.id,
    title: asset.titleZh,
    category: asset.category,
    src: asset.remotionSrc,
    creditLine: asset.source.attributionRequired ? asset.source.creditLine : null,
  }));

console.log(JSON.stringify({query, results}, null, 2));
