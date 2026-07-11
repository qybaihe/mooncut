import {execFile} from "node:child_process";
import {createHmac, randomUUID, timingSafeEqual} from "node:crypto";
import {existsSync} from "node:fs";
import {readFile, stat, unlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";
import {config, jobsRoot} from "./config.ts";
import type {EditJobRecord} from "./types.ts";

const execFileAsync = promisify(execFile);

const downloadSecret = () => config.mailDownloadSecret;

/** Signed token for mailed artifact links: jobId.artifact.exp.sig */
export const createArtifactDownloadToken = (
  jobId: string,
  artifact = "video",
  ttlHours = config.mailDownloadTtlHours,
) => {
  const secret = downloadSecret();
  if (!secret) throw new Error("MOONCUT_MAIL_DOWNLOAD_SECRET or MOONCUT_API_KEY is required for download links");
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, ttlHours) * 3600;
  const payload = `${jobId}.${artifact}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
};

export const verifyArtifactDownloadToken = (token: string, jobId: string, artifact = "video") => {
  const secret = downloadSecret();
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [tokenJobId, tokenArtifact, expRaw, sig] = parts;
  if (tokenJobId !== jobId || tokenArtifact !== artifact || !expRaw || !sig) return false;
  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const payload = `${tokenJobId}.${tokenArtifact}.${expRaw}`;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  try {
    const left = Buffer.from(sig);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
};

type CliEnvelope = {
  ok?: boolean;
  data?: Record<string, unknown>;
  error?: {message?: string};
};

type PendingMail = {
  id: string;
  jobId: string;
  recipient: string;
  args: string[];
  confirmationToken: string;
  summary: unknown;
  expiresAt: number;
};

const pending = new Map<string, PendingMail>();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const pendingPath = (jobId: string) => join(jobsRoot, jobId, "mail-pending.json");

const persistPending = async (record: PendingMail) => {
  await writeFile(pendingPath(record.jobId), `${JSON.stringify(record)}\n`, {mode: 0o600});
};

const readPersistedPending = async (jobId: string): Promise<PendingMail | undefined> => {
  const path = pendingPath(jobId);
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as PendingMail;
    if (value.jobId !== jobId || typeof value.id !== "string" || !Array.isArray(value.args)) return undefined;
    return value;
  } catch {
    return undefined;
  }
};

const removePending = async (record: PendingMail) => {
  pending.delete(record.id);
  const path = pendingPath(record.jobId);
  if (existsSync(path)) await unlink(path);
};

export const isEmail = (value: string) => value.length <= 254 && emailPattern.test(value);

export const parseCliEnvelope = (output: string): CliEnvelope => {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(output.trim() || "Agent Mail CLI returned no JSON");
  return JSON.parse(output.slice(start, end + 1)) as CliEnvelope;
};

const runCli = async (args: string[]) => {
  try {
    const {stdout, stderr} = await execFileAsync(config.mailCliPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return parseCliEnvelope(`${stdout}\n${stderr}`);
  } catch (error) {
    const value = error as Error & {stdout?: string; stderr?: string; code?: number | string};
    const combined = `${value.stdout ?? ""}\n${value.stderr ?? ""}`.trim();
    try {
      const envelope = parseCliEnvelope(combined);
      throw new Error(envelope.error?.message ?? combined);
    } catch (parseError) {
      if (parseError instanceof SyntaxError) throw new Error(combined || value.message);
      throw parseError;
    }
  }
};

export const downloadUrl = (job: EditJobRecord, baseUrl: string, options: {signed?: boolean} = {}) => {
  const root = `${baseUrl.replace(/\/$/u, "")}/v1/edit-jobs/${job.id}/artifacts/video`;
  const wantSigned = options.signed !== false && Boolean(downloadSecret());
  if (!wantSigned) return root;
  try {
    const token = createArtifactDownloadToken(job.id, "video");
    return `${root}?token=${encodeURIComponent(token)}`;
  } catch {
    return root;
  }
};

const notificationSummary = (summary: string | undefined) => {
  if (!summary) return "停顿、字幕节奏与画面已经处理完成。";
  const clean = summary
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/[#*`|>-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return `${clean.slice(0, 500)}${clean.length > 500 ? "…" : ""}`;
};

const jobMailContent = (job: EditJobRecord, requestBaseUrl: string, options: {attached: boolean; previewAttached?: boolean} = {attached: false}) => {
  const title = job.request.title?.trim() || job.originalName;
  const membershipUrl = config.mailMembershipUrl || "https://mooncut.me";
  const lines = [
    `你好，${config.mailSenderName} 已经完成了「${title}」的智能剪辑。`,
    "",
    `处理摘要：${notificationSummary(job.result?.summary)}`,
    "",
  ];
  if (options.attached && options.previewAttached) {
    lines.push(
      "附件是适合邮箱投递的「分享预览版」（约 20MB，画质已压缩）。",
      "本机已保留完整高清成片。",
      "",
      `开通 MoonCut 会员可下载更高清原片、长期保存任务产物：${membershipUrl}`,
      "",
      `高清下载（链接有限期，内测可用）：${downloadUrl(job, requestBaseUrl)}`,
      "",
    );
  } else if (options.attached) {
    lines.push("成片 MP4 已作为附件随本邮件发送，请查收。", "");
    lines.push(`开通会员获取更高清与更多权益：${membershipUrl}`, "");
  } else {
    lines.push(`下载成片：${downloadUrl(job, requestBaseUrl)}`, "");
    lines.push(`开通 MoonCut 会员可下载更高清原片：${membershipUrl}`, "");
    lines.push("链接有限期；若已过期，请登录剪辑台重新获取。");
  }
  return {
    subject: `MoonCut 成片已完成｜${title}`,
    body: lines.join("\n"),
  };
};

/** Prefer the ~20MB mail preview for attachment; fall back to full master if it already fits. */
export const resolveMailAttachmentPath = (job: EditJobRecord): {path: string; filename: string; isPreview: boolean} | undefined => {
  const preview = job.result?.artifacts.videoMail;
  if (preview && existsSync(preview)) {
    return {path: preview, filename: "mooncut-preview.mp4", isPreview: true};
  }
  const master = job.result?.artifacts.video;
  if (master && existsSync(master)) {
    return {path: master, filename: "final.mp4", isPreview: false};
  }
  return undefined;
};

export const buildResendPayload = (
  job: EditJobRecord,
  fromAddress: string,
  baseUrl: string,
  options: {
    attachVideo?: boolean;
    attachmentContentBase64?: string;
    attachmentFilename?: string;
    previewAttached?: boolean;
  } = {},
) => {
  if (!job.mail) throw new Error("Job notification email is required");
  const attachVideo = options.attachVideo ?? false;
  const hasAttachment = attachVideo && Boolean(options.attachmentContentBase64);
  const content = jobMailContent(job, baseUrl, {
    attached: hasAttachment,
    previewAttached: hasAttachment && (options.previewAttached ?? true),
  });
  const payload: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    attachments?: Array<{filename: string; content: string}>;
  } = {
    from: fromAddress.includes("<") ? fromAddress : `${config.mailSenderName} <${fromAddress}>`,
    to: [job.mail.recipient],
    subject: content.subject,
    text: content.body,
  };
  if (hasAttachment && options.attachmentContentBase64) {
    payload.attachments = [{
      filename: options.attachmentFilename ?? "mooncut-preview.mp4",
      content: options.attachmentContentBase64,
    }];
  }
  return payload;
};

export const buildJobMailArgs = (
  job: EditJobRecord,
  recipient: string,
  requestBaseUrl: string,
  options: {attachVideo?: boolean} = {},
) => {
  const attachVideo = options.attachVideo ?? config.mailAttachVideo;
  const attachment = attachVideo ? resolveMailAttachmentPath(job) : undefined;
  const canAttach = Boolean(attachment);
  const {subject, body} = jobMailContent(job, config.publicBaseUrl || requestBaseUrl, {
    attached: canAttach,
    previewAttached: attachment?.isPreview,
  });
  const args = ["message", "+send", "--to", recipient, "--subject", subject, "--body", body];
  // agently-cli requires attachment paths relative to the process cwd (job dir).
  if (canAttach && attachment) {
    const relative = attachment.isPreview ? "final-mail.mp4" : "final.mp4";
    args.push("--attachment", relative);
  }
  return args;
};

const runCliInDir = async (args: string[], cwd: string) => {
  try {
    const {stdout, stderr} = await execFileAsync(config.mailCliPath, args, {
      cwd,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseCliEnvelope(`${stdout}\n${stderr}`);
  } catch (error) {
    const value = error as Error & {stdout?: string; stderr?: string};
    const combined = `${value.stdout ?? ""}\n${value.stderr ?? ""}`.trim();
    try {
      const envelope = parseCliEnvelope(combined);
      throw new Error(envelope.error?.message ?? combined);
    } catch (parseError) {
      if (parseError instanceof SyntaxError) throw new Error(combined || value.message);
      throw parseError;
    }
  }
};

export const mailAccountStatus = async () => {
  if (config.mailTransport === "resend") {
    const from = config.mailFromAddress.trim();
    const authorized = Boolean(config.resendApiKey && from && config.publicBaseUrl);
    return {
      authorized,
      aliases: from ? [{email: from.replace(/^.*<([^>]+)>.*$/u, "$1"), name: config.mailSenderName, is_primary: true}] : [],
      transport: "resend" as const,
      automatic: true,
      requiresConfirmation: false,
      attachVideo: config.mailAttachVideo,
      publicBaseUrl: config.publicBaseUrl || null,
      unavailableReason: authorized
        ? undefined
        : [
          !config.resendApiKey ? "MOONCUT_RESEND_API_KEY missing" : "",
          !from ? "MOONCUT_MAIL_FROM_ADDRESS missing" : "",
          !config.publicBaseUrl ? "MOONCUT_PUBLIC_BASE_URL missing (download links)" : "",
        ].filter(Boolean).join("; ") || undefined,
    };
  }
  if (config.mailTransport === "webhook") {
    return {
      authorized: Boolean(config.mailWebhookUrl && config.mailWebhookToken && config.mailFromAddress),
      aliases: config.mailFromAddress ? [{email: config.mailFromAddress, name: config.mailSenderName, is_primary: true}] : [],
      transport: "webhook" as const,
      automatic: true,
      requiresConfirmation: false,
    };
  }
  if (!existsSync(config.mailCliPath)) {
    return {
      authorized: false,
      aliases: [],
      transport: "agently-cli" as const,
      automatic: false,
      requiresConfirmation: true,
      unavailableReason: "Agent Mail CLI is not installed on this server",
    };
  }
  let envelope: CliEnvelope;
  try {
    envelope = await runCli(["+me"]);
  } catch {
    return {
      authorized: false,
      aliases: [],
      transport: "agently-cli" as const,
      automatic: false,
      requiresConfirmation: true,
      unavailableReason: "Agent Mail CLI is unavailable or not authorized",
    };
  }
  const aliases = Array.isArray(envelope.data?.aliases)
    ? envelope.data.aliases.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const alias = value as Record<string, unknown>;
      if (typeof alias.email !== "string") return [];
      return [{
        email: alias.email,
        name: typeof alias.name === "string" ? alias.name : "",
        is_primary: alias.is_primary === true,
      }];
    })
    : [];
  return {
    authorized: envelope.ok === true,
    aliases,
    transport: "agently-cli" as const,
    automatic: false,
    requiresConfirmation: true,
  };
};

export const buildJobWebhookPayload = (job: EditJobRecord, fromAddress: string, baseUrl: string) => {
  if (!job.mail) throw new Error("Job notification email is required");
  const content = jobMailContent(job, baseUrl);
  return {
    from: {email: fromAddress, name: config.mailSenderName},
    to: [{email: job.mail.recipient}],
    subject: content.subject,
    text: content.body,
    metadata: {jobId: job.id, kind: "mooncut-edit-completed"},
  };
};

/**
 * Deliver the finished cut to the user without a browser confirmation step.
 * - resend: Resend API — attach ~20MB mail preview when available; full master stays local
 * - webhook: JSON notify (no binary attachment)
 * - agently-cli: prepare + confirm, optionally attach preview from the job dir
 */
export const sendJobMailAutomatically = async (job: EditJobRecord) => {
  if (!job.mail || !isEmail(job.mail.recipient)) throw new Error("Job notification email is invalid");
  if (job.status !== "completed" || !job.result?.artifacts.video) {
    throw new Error("The edited video is not ready yet");
  }

  if (config.mailTransport === "resend") {
    if (!config.resendApiKey) throw new Error("MOONCUT_RESEND_API_KEY is required");
    if (!config.mailFromAddress) throw new Error("MOONCUT_MAIL_FROM_ADDRESS is required (verified domain or onboarding@resend.dev)");
    if (!config.publicBaseUrl) throw new Error("MOONCUT_PUBLIC_BASE_URL is required for download links in Resend mail");
    if (!downloadSecret()) throw new Error("MOONCUT_MAIL_DOWNLOAD_SECRET or MOONCUT_API_KEY is required for signed download links");

    const attachment = resolveMailAttachmentPath(job);
    let attachmentContentBase64: string | undefined;
    let attached = false;
    let previewAttached = false;
    if (config.mailAttachVideo && attachment) {
      const info = await stat(attachment.path);
      // Base64 expands ~4/3; keep under Resend's 40MB message limit.
      if (info.size > 0 && info.size <= config.mailAttachMaxBytes) {
        attachmentContentBase64 = (await readFile(attachment.path)).toString("base64");
        attached = true;
        previewAttached = attachment.isPreview;
      }
    }

    const payload = buildResendPayload(job, config.mailFromAddress, config.publicBaseUrl, {
      attachVideo: attached,
      attachmentContentBase64,
      attachmentFilename: attachment?.filename ?? "mooncut-preview.mp4",
      previewAttached,
    });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(120_000),
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Resend failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json().catch(() => ({})) as {id?: string};
    return {
      transport: "resend" as const,
      recipient: job.mail.recipient,
      attached,
      previewAttached,
      attachmentBytes: attached && attachment ? (await stat(attachment.path)).size : 0,
      id: data.id,
    };
  }

  if (config.mailTransport === "webhook") {
    if (!config.mailWebhookUrl || !config.mailWebhookToken || !config.mailFromAddress) {
      throw new Error("MOONCUT_MAIL_WEBHOOK_URL, TOKEN and FROM_ADDRESS are required");
    }
    if (!config.publicBaseUrl) throw new Error("MOONCUT_PUBLIC_BASE_URL is required for automatic completion mail");
    const payload = buildJobWebhookPayload(job, config.mailFromAddress, config.publicBaseUrl);
    const response = await fetch(config.mailWebhookUrl, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${config.mailWebhookToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Mail webhook failed: ${response.status} ${await response.text()}`);
    return {transport: "webhook" as const, recipient: job.mail.recipient};
  }

  if (!existsSync(config.mailCliPath)) {
    throw new Error(`Agent Mail CLI not found: ${config.mailCliPath}`);
  }
  const jobDir = join(jobsRoot, job.id);
  const args = buildJobMailArgs(job, job.mail.recipient, config.publicBaseUrl || "https://mooncut.me", {
    attachVideo: config.mailAttachVideo,
  });
  const prepared = await runCliInDir(args, jobDir);
  const confirmationToken = prepared.data?.confirmation_token;
  if (typeof confirmationToken !== "string") {
    throw new Error(prepared.error?.message ?? "Agent Mail did not return a confirmation token");
  }
  const confirmed = await runCliInDir([...args, "--confirmation-token", confirmationToken], jobDir);
  if (confirmed.ok !== true) {
    throw new Error(confirmed.error?.message ?? "Agent Mail send failed");
  }
  return {
    transport: "agently-cli" as const,
    recipient: job.mail.recipient,
    attached: args.includes("--attachment"),
    data: confirmed.data,
  };
};

export const prepareJobMail = async (job: EditJobRecord, recipient: string, requestBaseUrl: string) => {
  if (config.mailTransport !== "agently-cli") throw new Error("This mail transport sends automatically");
  if (job.status !== "completed" || !job.result?.artifacts.video) {
    throw new Error("The edited video is not ready yet");
  }
  if (!isEmail(recipient)) throw new Error("Invalid notification email");
  const args = buildJobMailArgs(job, recipient, requestBaseUrl);
  const envelope = await runCli(args);
  const confirmationToken = envelope.data?.confirmation_token;
  if (typeof confirmationToken !== "string") {
    throw new Error(envelope.error?.message ?? "Agent Mail did not return a confirmation token");
  }
  const record: PendingMail = {
    id: randomUUID().replaceAll("-", ""),
    jobId: job.id,
    recipient,
    args,
    confirmationToken,
    summary: envelope.data?.summary ?? envelope.data,
    expiresAt: Date.now() + 5 * 60_000,
  };
  pending.set(record.id, record);
  await persistPending(record);
  return {pendingId: record.id, recipient, summary: record.summary, expiresAt: new Date(record.expiresAt).toISOString()};
};

export const confirmJobMail = async (jobId: string, pendingId: string) => {
  const record = pending.get(pendingId) ?? await readPersistedPending(jobId);
  if (!record || record.jobId !== jobId) throw new Error("Unknown mail confirmation");
  if (record.id !== pendingId) throw new Error("Unknown mail confirmation");
  if (Date.now() >= record.expiresAt) {
    await removePending(record);
    throw new Error("Mail confirmation expired; prepare it again");
  }
  const envelope = await runCli([...record.args, "--confirmation-token", record.confirmationToken]);
  if (envelope.ok !== true) throw new Error(envelope.error?.message ?? "Agent Mail send failed");
  await removePending(record);
  return {recipient: record.recipient, data: envelope.data};
};
