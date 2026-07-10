import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import {extname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const studioDir = join(scriptDir, '..');
const specPath = join(studioDir, 'src/data/material-library-spec.json');
const outDir = join(studioDir, 'public/assets/material-library');
const brandDir = join(outDir, 'brands');
const photoDir = join(outDir, 'photos');
const symbolDir = join(outDir, 'symbols/finance');
const generalSymbolDir = join(outDir, 'symbols/general');
const manifestPath = join(outDir, 'manifest.json');
const refresh = process.argv.includes('--refresh');
const spec = JSON.parse(await readFile(specPath, 'utf8'));
const userAgent = 'MoonCutMaterialCollector/1.0 (local video asset library; contact: local-project)';

await mkdir(brandDir, {recursive: true});
await mkdir(photoDir, {recursive: true});
await mkdir(symbolDir, {recursive: true});
await mkdir(generalSymbolDir, {recursive: true});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stripHtml = (value = '') => value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const unique = (items) => [...new Set(items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const publicPath = (absolutePath) => relative(join(studioDir, 'public'), absolutePath).split('\\').join('/');

const fetchWithRetry = async (url, options = {}, attempts = 8) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        ...options,
        headers: {'User-Agent': userAgent, ...(options.headers || {})},
      });
      if (response.ok) return response;
      if (response.status !== 429 && response.status < 500) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      lastError = new Error(`${response.status} ${response.statusText}: ${url}`);
      const retryAfter = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) await sleep(Math.min(retryAfter * 1000, 15_000));
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.min(1_200 * attempt, 8_000));
  }
  throw lastError;
};

const download = async (url, destination, attempts = 5) => {
  if (!refresh) {
    try {
      const existing = await readFile(destination);
      if (existing.length > 100) return existing;
    } catch {}
  }
  const response = await fetchWithRetry(url, {}, attempts);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 100) throw new Error(`Downloaded file is unexpectedly small: ${url}`);
  await writeFile(destination, buffer);
  return buffer;
};

const parseSvgSize = (buffer) => {
  const source = buffer.toString('utf8');
  const viewBox = source.match(/viewBox=["']([^"']+)["']/i)?.[1]?.split(/\s+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) return {width: viewBox[2], height: viewBox[3]};
  return {width: 24, height: 24};
};

const baseAsset = ({id, titleZh, titleEn, aliases, file, mimeType, width, height, buffer, category, source, tagsZh, tagsEn, useWhenZh, usageNoteZh}) => ({
  id,
  titleZh,
  titleEn,
  aliases: unique(aliases),
  category,
  file,
  remotionSrc: file,
  mimeType,
  width,
  height,
  aspectRatio: Number((width / height).toFixed(4)),
  sha256: sha256(buffer),
  tagsZh: unique(tagsZh),
  tagsEn: unique(tagsEn),
  spokenTriggersZh: unique([titleZh, ...(aliases || []), ...(tagsZh || [])]),
  useWhenZh,
  usageNoteZh,
  source,
});

const simpleIconsUrl = `https://cdn.jsdelivr.net/npm/simple-icons@${spec.brandIconVersion}`;
const simpleIconsMetadata = await (await fetchWithRetry(`${simpleIconsUrl}/data/simple-icons.json`)).json();
const simpleIconBySlug = new Map(simpleIconsMetadata.map((icon) => [icon.slug, icon]));
const assets = [];

for (const requested of spec.brandIcons) {
  const metadata = simpleIconBySlug.get(requested.slug);
  if (!metadata) throw new Error(`Simple Icons slug not found: ${requested.slug}`);
  const destination = join(brandDir, `${requested.slug}.svg`);
  const buffer = await download(`${simpleIconsUrl}/icons/${requested.slug}.svg`, destination);
  const {width, height} = parseSvgSize(buffer);
  assets.push(baseAsset({
    id: `brand-${requested.slug}`,
    titleZh: requested.titleZh,
    titleEn: metadata.title,
    aliases: requested.aliases,
    file: publicPath(destination),
    mimeType: 'image/svg+xml',
    width,
    height,
    buffer,
    category: 'brand-logo',
    tagsZh: ['品牌标识', 'Logo', ...requested.aliases],
    tagsEn: ['brand', 'logo', metadata.title],
    useWhenZh: `口播直接提到“${requested.titleZh}”或其产品、平台时。`,
    usageNoteZh: '保持原始比例和颜色；仅作识别性引用，不暗示品牌方背书。',
    source: {
      provider: 'Simple Icons',
      sourcePage: metadata.source,
      downloadUrl: `${simpleIconsUrl}/icons/${requested.slug}.svg`,
      collectionLicense: 'CC0-1.0',
      iconLicense: metadata.license?.type || null,
      iconLicenseUrl: metadata.license?.url || null,
      trademark: true,
    },
  }));
}

for (const requested of spec.officialAssets) {
  const destination = join(brandDir, `${requested.id.replace(/^brand-/, '')}.${requested.extension}`);
  const buffer = await download(requested.url, destination);
  const {width, height} = requested.extension === 'svg' ? parseSvgSize(buffer) : {width: 1024, height: 1024};
  assets.push(baseAsset({
    id: requested.id,
    titleZh: requested.titleZh,
    titleEn: requested.titleEn,
    aliases: requested.aliases,
    file: publicPath(destination),
    mimeType: requested.extension === 'svg' ? 'image/svg+xml' : `image/${requested.extension}`,
    width,
    height,
    buffer,
    category: 'brand-logo',
    tagsZh: ['人工智能', 'AI', '品牌标识', 'Logo', ...requested.aliases],
    tagsEn: ['AI', 'brand', 'logo', 'OpenAI', 'Codex', 'ChatGPT'],
    useWhenZh: '口播直接提到 OpenAI、ChatGPT、GPT 或 Codex 时。',
    usageNoteZh: requested.usageNoteZh,
    source: {
      provider: 'Official brand asset',
      sourcePage: requested.sourcePage,
      downloadUrl: requested.url,
      license: requested.license,
      trademark: true,
    },
  }));
}

const lucideBaseUrl = `https://cdn.jsdelivr.net/npm/lucide-static@${spec.lucideVersion}/icons`;
const collectLucideSymbols = async (requestedSymbols, destinationDir, defaultCategory) => {
for (const requested of requestedSymbols) {
  const destination = join(destinationDir, `${requested.slug}.svg`);
  const url = `${lucideBaseUrl}/${requested.slug}.svg`;
  const buffer = await download(url, destination);
  const {width, height} = parseSvgSize(buffer);
  assets.push(baseAsset({
    id: `${requested.category || defaultCategory}-${requested.slug}`,
    titleZh: requested.titleZh,
    titleEn: requested.slug.replaceAll('-', ' '),
    aliases: requested.tagsZh,
    file: publicPath(destination),
    mimeType: 'image/svg+xml',
    width,
    height,
    buffer,
    category: requested.category || defaultCategory,
    tagsZh: [defaultCategory === 'finance-symbol' ? '金融' : '通用元素', '透明底', ...requested.tagsZh],
    tagsEn: [defaultCategory === 'finance-symbol' ? 'finance' : 'general', 'outline icon', ...requested.slug.split('-')],
    useWhenZh: `口播提到${requested.tagsZh.join('、')}等概念，需要简洁透明底示意元素时。`,
    usageNoteZh: '中性线性 SVG，可改描边颜色和线宽；适合人物旁挂件、关键词强调和数据转场。',
    source: {
      provider: 'Lucide',
      sourcePage: `https://lucide.dev/icons/${requested.slug}`,
      downloadUrl: url,
      license: 'ISC',
      licenseUrl: 'https://lucide.dev/license',
      attributionRequired: false,
    },
  }));
}
};
await collectLucideSymbols(spec.financeSymbols, symbolDir, 'finance-symbol');
await collectLucideSymbols(spec.generalSymbols, generalSymbolDir, 'common-symbol');

const allowedLicenses = /public domain|cc0|pdm|cc by|creative commons attribution/i;
const blockedTitle = /\b(flag|coat of arms|stamp|signature|portrait|museum label|scam|fraud)\b/i;
const usedPageIds = new Set();

const commonsCandidates = async (topic) => {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '24',
    gsrsearch: `${topic.query} filetype:bitmap`,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime|sha1',
    iiurlwidth: String(spec.targetWidth),
  });
  const response = await fetchWithRetry(`https://commons.wikimedia.org/w/api.php?${params}`);
  const data = await response.json();
  return (data.query?.pages || []).filter((page) => {
    const info = page.imageinfo?.[0];
    const license = info?.extmetadata?.LicenseShortName?.value || info?.extmetadata?.UsageTerms?.value || '';
    return info &&
      !usedPageIds.has(page.pageid) &&
      !blockedTitle.test(page.title) &&
      allowedLicenses.test(license) &&
      /^image\/(jpeg|png|webp)$/i.test(info.mime || '') &&
      Math.max(info.width || 0, info.height || 0) >= 800 &&
      info.thumburl;
  });
};

const photoTopics = spec.photoTopics.slice(0, spec.maxPhotoTopics ?? spec.photoTopics.length);
for (const [topicIndex, topic] of photoTopics.entries()) {
  const candidates = await commonsCandidates(topic);
  let selectedCount = 0;
  for (const page of candidates) {
    if (selectedCount >= spec.assetsPerTopic) break;
    const info = page.imageinfo[0];
    const metadata = info.extmetadata || {};
    const assetId = `photo-${topic.id}-${selectedCount + 1}`;
    if (spec.excludedPhotoIds.includes(assetId)) {
      usedPageIds.add(page.pageid);
      selectedCount += 1;
      continue;
    }
    const ext = extname(new URL(info.thumburl).pathname).replace(/[^.a-z0-9]/gi, '').toLowerCase() || '.jpg';
    const filename = `${topic.id}-${selectedCount + 1}-${page.pageid}${ext}`;
    const destination = join(photoDir, topic.category, filename);
    await mkdir(join(photoDir, topic.category), {recursive: true});
    let buffer;
    try {
      buffer = await download(info.thumburl, destination, 1);
    } catch (error) {
      console.warn(`[warn] download skipped ${page.pageid}: ${error.message}`);
      continue;
    }
    const scale = Math.min(1, spec.targetWidth / info.width);
    const width = Math.max(1, Math.round(info.width * scale));
    const height = Math.max(1, Math.round(info.height * scale));
    const license = stripHtml(metadata.LicenseShortName?.value || metadata.UsageTerms?.value || '');
    const creator = stripHtml(metadata.Artist?.value || metadata.Credit?.value || 'Unknown');
    usedPageIds.add(page.pageid);
    assets.push(baseAsset({
      id: assetId,
      titleZh: `${topic.titleZh} ${selectedCount + 1}`,
      titleEn: page.title.replace(/^File:/, '').replace(/\.[^.]+$/, ''),
      aliases: topic.tagsZh,
      file: publicPath(destination),
      mimeType: info.mime,
      width,
      height,
      buffer,
      category: topic.category,
      tagsZh: topic.tagsZh,
      tagsEn: unique(topic.query.split(/\s+/).filter((word) => word.length > 2)),
      useWhenZh: `口播提到${topic.titleZh}、${topic.tagsZh.slice(0, 3).join('、')}等内容，并需要真实题材画面时。`,
      usageNoteZh: '优先用作全屏切镜、画中画或背景图；保留画面主体，避免拉伸。',
      source: {
        provider: 'Wikimedia Commons',
        pageId: page.pageid,
        sourcePage: info.descriptionurl,
        downloadUrl: info.thumburl,
        originalUrl: info.url,
        creator,
        license,
        licenseUrl: metadata.LicenseUrl?.value || null,
        attributionRequired: !/public domain|cc0|pdm/i.test(license),
        creditLine: `${creator} / Wikimedia Commons / ${license}`,
      },
    }));
    selectedCount += 1;
    await sleep(220);
  }
  if (selectedCount < spec.assetsPerTopic) {
    console.warn(`[warn] ${topic.id}: wanted ${spec.assetsPerTopic}, found ${selectedCount}`);
  }
  console.log(`[${topicIndex + 1}/${photoTopics.length}] ${topic.id}: ${selectedCount}`);
  await sleep(500);
}

assets.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
const countsByCategory = Object.fromEntries([...new Set(assets.map((asset) => asset.category))].map((category) => [category, assets.filter((asset) => asset.category === category).length]));
const manifest = {
  schemaVersion: '1.0',
  generatedAt: new Date().toISOString(),
  totalAssets: assets.length,
  publicRoot: 'assets/material-library',
  searchFields: ['titleZh', 'titleEn', 'aliases', 'tagsZh', 'tagsEn', 'spokenTriggersZh', 'useWhenZh'],
  countsByCategory,
  attributionRuleZh: 'source.attributionRequired 为 true 时，在片尾或说明区输出 source.creditLine。品牌标识还须遵守各品牌商标规范。',
  assets,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

let bytes = 0;
for (const asset of assets) bytes += (await stat(join(studioDir, 'public', asset.file))).size;
console.log(`Material library ready: ${assets.length} assets, ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
console.log(manifestPath);
