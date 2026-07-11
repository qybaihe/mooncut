import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobMailArgs,
  buildJobWebhookPayload,
  buildResendPayload,
  createArtifactDownloadToken,
  isEmail,
  parseCliEnvelope,
  verifyArtifactDownloadToken,
} from "../src/mail.ts";
import type {EditJobRecord} from "../src/types.ts";

test("parses Agent Mail JSON even when the CLI prints a tip first", () => {
  const parsed = parseCliEnvelope('tip: agently-cli message +list\n{"ok":true,"data":{"aliases":[]}}\n');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data?.aliases, []);
});

test("validates notification email addresses before creating a job", () => {
  assert.equal(isEmail("creator@example.com"), true);
  assert.equal(isEmail("not-an-email"), false);
  assert.equal(isEmail("a b@example.com"), false);
});

test("builds an exact completion email with the stable artifact URL", () => {
  const job = {
    id: "abc123",
    status: "completed",
    stage: "completed",
    progress: 1,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    inputPath: "/tmp/talk.mp4",
    originalName: "talk.mp4",
    request: {title: "产品介绍"},
    result: {
      summary: "已优化停顿和字幕节奏",
      artifacts: {video: "/tmp/final.mp4"},
      probe: {durationMs: 1000, fps: 30, width: 1080, height: 1920, hasAudio: true, formatName: "mp4"},
      models: {planner: "glm-5.2", vision: "minimax-m3"},
    },
  } satisfies EditJobRecord;
  const args = buildJobMailArgs(job, "creator@example.com", "https://mooncut.example");
  assert.deepEqual(args.slice(0, 4), ["message", "+send", "--to", "creator@example.com"]);
  assert.ok(args.includes("MoonCut 成片已完成｜产品介绍"));
  assert.ok(args.some((value) => value.includes("/v1/edit-jobs/abc123/artifacts/video")));
});

test("builds a pre-authorized automatic webhook payload without exposing local paths", () => {
  const job = {
    id: "webhook123",
    status: "completed",
    stage: "completed",
    progress: 1,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    inputPath: "/private/source.mp4",
    originalName: "source.mp4",
    request: {title: "自动通知"},
    mail: {recipient: "recipient@example.com", status: "ready", updatedAt: "2026-07-11T00:00:00.000Z"},
    result: {
      summary: "质量检查通过",
      artifacts: {video: "/private/final.mp4"},
      probe: {durationMs: 1000, fps: 30, width: 1920, height: 1080, hasAudio: true, formatName: "mp4"},
      models: {planner: "glm-5.2", vision: "minimax-m3"},
    },
  } satisfies EditJobRecord;
  const payload = buildJobWebhookPayload(job, "sender@example.com", "https://agent.example.com");
  assert.equal(payload.to[0].email, "recipient@example.com");
  assert.equal(payload.metadata.jobId, "webhook123");
  assert.match(payload.text, /https:\/\/agent\.example\.com\/v1\/edit-jobs\/webhook123\/artifacts\/video/u);
  assert.doesNotMatch(payload.text, /\/private\//u);
});

test("builds a Resend payload with signed download link and no local paths", () => {
  const job = {
    id: "resend123",
    status: "completed",
    stage: "completed",
    progress: 1,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    inputPath: "/private/source.mp4",
    originalName: "source.mp4",
    request: {title: "Resend 通知"},
    mail: {recipient: "recipient@example.com", status: "ready", updatedAt: "2026-07-11T00:00:00.000Z"},
    result: {
      summary: "质量检查通过",
      artifacts: {video: "/private/final.mp4"},
      probe: {durationMs: 1000, fps: 30, width: 1920, height: 1080, hasAudio: true, formatName: "mp4"},
      models: {planner: "glm-5.2", vision: "minimax-m3"},
    },
  } satisfies EditJobRecord;
  const payload = buildResendPayload(job, "MoonCut 小月 <onboarding@resend.dev>", "https://agent.example.com");
  assert.equal(payload.to[0], "recipient@example.com");
  assert.match(payload.from, /onboarding@resend\.dev/u);
  assert.match(payload.text, /https:\/\/agent\.example\.com\/v1\/edit-jobs\/resend123\/artifacts\/video/u);
  assert.match(payload.text, /会员/u);
  assert.doesNotMatch(payload.text, /\/private\//u);
  assert.equal(payload.attachments, undefined);
});

test("Resend payload with preview attachment uses membership copy", () => {
  const job = {
    id: "preview123",
    status: "completed",
    stage: "completed",
    progress: 1,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    inputPath: "/private/source.mp4",
    originalName: "source.mp4",
    request: {title: "预览附件"},
    mail: {recipient: "recipient@example.com", status: "ready", updatedAt: "2026-07-11T00:00:00.000Z"},
    result: {
      summary: "质量检查通过",
      artifacts: {video: "/private/final.mp4", videoMail: "/private/final-mail.mp4"},
      probe: {durationMs: 1000, fps: 30, width: 1920, height: 1080, hasAudio: true, formatName: "mp4"},
      models: {planner: "glm-5.2", vision: "minimax-m3"},
    },
  } satisfies EditJobRecord;
  const payload = buildResendPayload(job, "MoonCut 小月 <noreply@mooncut.me>", "https://agent.example.com", {
    attachVideo: true,
    attachmentContentBase64: Buffer.from("fake-mp4").toString("base64"),
    attachmentFilename: "mooncut-preview.mp4",
    previewAttached: true,
  });
  assert.match(payload.text, /分享预览版/u);
  assert.match(payload.text, /更高清/u);
  assert.equal(payload.attachments?.[0]?.filename, "mooncut-preview.mp4");
});

test("signs and verifies artifact download tokens", () => {
  const token = createArtifactDownloadToken("jobabc", "video", 24);
  assert.equal(verifyArtifactDownloadToken(token, "jobabc", "video"), true);
  assert.equal(verifyArtifactDownloadToken(token, "other", "video"), false);
  assert.equal(verifyArtifactDownloadToken("tampered." + token, "jobabc", "video"), false);
});
