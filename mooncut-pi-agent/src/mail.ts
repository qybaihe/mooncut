import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {readFile, unlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";
import {config, jobsRoot} from "./config.ts";
import type {EditJobRecord} from "./types.ts";

const execFileAsync = promisify(execFile);

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

const downloadUrl = (job: EditJobRecord, baseUrl: string) =>
  `${baseUrl.replace(/\/$/u, "")}/v1/edit-jobs/${job.id}/artifacts/video`;

const notificationSummary = (summary: string | undefined) => {
  if (!summary) return "停顿、字幕节奏与画面已经处理完成。";
  const clean = summary
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/[#*`|>-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return `${clean.slice(0, 500)}${clean.length > 500 ? "…" : ""}`;
};

const jobMailContent = (job: EditJobRecord, requestBaseUrl: string) => {
  const title = job.request.title?.trim() || job.originalName;
  return {
    subject: `MoonCut 成片已完成｜${title}`,
    body: [
      `你好，${config.mailSenderName} 已经完成了「${title}」的智能剪辑。`,
      "",
      `处理摘要：${notificationSummary(job.result?.summary)}`,
      "",
      `下载成片：${downloadUrl(job, requestBaseUrl)}`,
      "",
      "链接由 MoonCut 任务服务生成；若已过期，请回到剪辑台重新获取。",
    ].join("\n"),
  };
};

export const buildJobMailArgs = (job: EditJobRecord, recipient: string, requestBaseUrl: string) => {
  const {subject, body} = jobMailContent(job, config.publicBaseUrl || requestBaseUrl);
  return ["message", "+send", "--to", recipient, "--subject", subject, "--body", body];
};

export const mailAccountStatus = async () => {
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

export const sendJobMailAutomatically = async (job: EditJobRecord) => {
  if (config.mailTransport !== "webhook") throw new Error("Automatic mail transport is not configured");
  if (!config.mailWebhookUrl || !config.mailWebhookToken || !config.mailFromAddress) {
    throw new Error("MOONCUT_MAIL_WEBHOOK_URL, TOKEN and FROM_ADDRESS are required");
  }
  if (!job.mail || !isEmail(job.mail.recipient)) throw new Error("Job notification email is invalid");
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
