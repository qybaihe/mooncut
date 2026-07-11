import {randomUUID} from "node:crypto";
import {lookup} from "node:dns/promises";
import {existsSync} from "node:fs";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {isIP} from "node:net";
import {basename, dirname, extname, join} from "node:path";
import {config} from "./config.ts";
import {sha256File} from "./media.ts";
import {runProcess} from "./process.ts";
import type {EvidenceAsset, RunContext} from "./types.ts";

const slug = (value: string) => value
  .normalize("NFKC")
  .replace(/[^\p{L}\p{N}]+/gu, "-")
  .replace(/^-|-$/gu, "")
  .toLowerCase()
  .slice(0, 48) || "evidence";

type AddressLookup = (hostname: string, options: {all: true; verbatim: true}) => Promise<Array<{address: string}>>;

const isPrivateIpv4 = (address: string) => {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
};

const isPrivateIp = (address: string) => {
  const normalized = address.toLowerCase().replace(/^::ffff:/u, "");
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fc") || normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") || normalized.startsWith("ff");
};

export const validatePublicResearchUrl = async (
  value: string,
  resolveAddresses: AddressLookup = lookup,
) => {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:") {
    throw new Error("Only public HTTPS pages can be captured");
  }
  if (parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
    throw new Error("Research URLs must not include credentials or non-standard ports");
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") ||
    (isIP(hostname) !== 0 && isPrivateIp(hostname))) {
    throw new Error("Private, loopback, and link-local addresses cannot be captured");
  }
  const addresses = await resolveAddresses(hostname, {all: true, verbatim: true});
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("Research URL must resolve only to public addresses");
  }
  return parsed.toString();
};

const assertTrustedXUrl = (value: string) => {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  const trusted = hostname === "x.com" || hostname === "www.x.com" ||
    hostname === "twitter.com" || hostname === "www.twitter.com";
  if (parsed.protocol !== "https:" || !trusted || parsed.username || parsed.password || parsed.port) {
    throw new Error("X evidence URLs must be canonical HTTPS x.com or twitter.com links");
  }
  return parsed.toString();
};

export const isBrowserChallenge = (snapshot: string) =>
  /验证您是真人|请稍候|verify.{0,20}(you are|human)|checking your browser|just a moment|captcha|cloudflare.{0,20}(challenge|验证)|HTTP status:\s*[45]\d\d/iu.test(snapshot);

const researchDirectory = async (context: RunContext, category: string) => {
  const output = join(context.jobDir, "research", category);
  await mkdir(output, {recursive: true});
  return output;
};

export const publishEvidence = async (
  context: RunContext,
  sourcePath: string,
  evidencePath: string,
  metadata: Omit<EvidenceAsset, "src" | "localPath" | "evidencePath">,
) => {
  const publicDirectory = join(dirname(context.publicMediaPath), "evidence");
  await mkdir(publicDirectory, {recursive: true});
  const filename = `${metadata.id}${extname(sourcePath) || ".png"}`;
  const publicPath = join(publicDirectory, filename);
  await copyFile(sourcePath, publicPath);
  const asset: EvidenceAsset = {
    ...metadata,
    src: `${dirname(context.publicMediaSrc)}/evidence/${filename}`,
    localPath: sourcePath,
    evidencePath,
  };
  context.evidenceAssets.push(asset);
  return asset;
};

type XEvidencePayload = {
  source_url?: string;
  query?: string;
  post?: {text?: string; account?: {handle?: string}};
  screenshot?: {sha256?: string; width?: number; height?: number};
  trust?: {passed?: boolean; reasons?: string[]};
};

export const captureXPost = async (
  context: RunContext,
  request: {
    topic?: string;
    url?: string;
    trustedAccounts: string[];
    officialDomains: string[];
  },
) => {
  if (!request.topic && !request.url) throw new Error("topic or url is required");
  if (request.topic && request.url) throw new Error("Use topic or url, not both");
  if (!existsSync(config.xPostCaptureScript)) {
    throw new Error(`x-post-screenshot script not found: ${config.xPostCaptureScript}`);
  }
  const sourceLabel = request.topic ?? request.url ?? "x-post";
  const outputDirectory = await researchDirectory(context, `x-${slug(sourceLabel)}`);
  const args = [config.xPostCaptureScript];
  if (request.topic) args.push("--topic", request.topic);
  if (request.url) args.push("--url", assertTrustedXUrl(request.url));
  for (const account of request.trustedAccounts) args.push("--trusted-account", account);
  for (const domain of request.officialDomains) args.push("--official-domain", domain);
  args.push("--output-dir", outputDirectory);
  await runProcess("python3", args, {timeoutMs: 8 * 60_000});

  const screenshotPath = join(outputDirectory, "original-x-post.png");
  const evidencePath = join(outputDirectory, "evidence.json");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as XEvidencePayload;
  const id = `x-${slug(sourceLabel)}-${randomUUID().slice(0, 6)}`;
  const asset = await publishEvidence(context, screenshotPath, evidencePath, {
    id,
    kind: "x-post",
    label: request.topic ?? `@${request.trustedAccounts[0]} · X 原帖`,
    url: evidence.source_url ?? request.url ?? "https://x.com/",
  });
  return {asset, evidence};
};

export const captureWebPage = async (
  context: RunContext,
  request: {url: string; label: string; fullPage: boolean},
) => {
  const url = await validatePublicResearchUrl(request.url);
  if (!existsSync(config.playwrightCli)) {
    throw new Error(`Playwright CLI wrapper not found: ${config.playwrightCli}`);
  }
  const id = `web-${slug(request.label)}-${randomUUID().slice(0, 6)}`;
  const outputDirectory = await researchDirectory(context, id);
  const screenshotPath = join(outputDirectory, "page.png");
  const snapshotPath = join(outputDirectory, "snapshot.txt");
  const evidencePath = join(outputDirectory, "evidence.json");
  const session = `mooncut-${context.job.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;

  try {
    await runProcess(config.playwrightCli, ["--session", session, "open", url], {
      cwd: outputDirectory,
      timeoutMs: 90_000,
    });
    await runProcess(config.playwrightCli, ["--session", session, "resize", "1440", "1000"], {
      cwd: outputDirectory,
      timeoutMs: 60_000,
    });
    const screenshotCode = [
      "async (page) => {",
      'await page.waitForLoadState("domcontentloaded", {timeout: 20000}).catch(() => undefined);',
      'await page.evaluate(() => document.fonts.ready);',
      'await page.waitForTimeout(1800);',
      `await page.screenshot({path: ${JSON.stringify(screenshotPath)}, fullPage: ${request.fullPage ? "true" : "false"}});`,
      "return {title: await page.title(), url: page.url()};",
      "}",
    ].join(" ");
    await runProcess(config.playwrightCli, ["--session", session, "run-code", screenshotCode], {
      cwd: outputDirectory,
      timeoutMs: 90_000,
    });
    const snapshot = await runProcess(config.playwrightCli, ["--session", session, "snapshot"], {
      cwd: outputDirectory,
      timeoutMs: 60_000,
    });
    await writeFile(snapshotPath, snapshot.stdout);
    if (isBrowserChallenge(snapshot.stdout)) {
      throw new Error("Browser capture hit a human-verification or Cloudflare challenge. Choose another official public URL; do not use or bypass the challenge page.");
    }
  } finally {
    await runProcess(config.playwrightCli, ["--session", session, "close"], {
      cwd: outputDirectory,
      timeoutMs: 30_000,
    }).catch(() => undefined);
  }

  const evidence = {
    schemaVersion: "mooncut.browser-evidence.v1",
    capturedAt: new Date().toISOString(),
    label: request.label,
    url,
    fullPage: request.fullPage,
    screenshot: {
      path: screenshotPath,
      bytes: (await readFile(screenshotPath)).byteLength,
      sha256: `sha256:${await sha256File(screenshotPath)}`,
      transformations: [],
    },
    snapshotPath,
    observation: "Public web page rendered in a real Playwright browser at capture time.",
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  const asset = await publishEvidence(context, screenshotPath, evidencePath, {
    id,
    kind: "webpage",
    label: request.label,
    url,
  });
  return {asset, evidence};
};
