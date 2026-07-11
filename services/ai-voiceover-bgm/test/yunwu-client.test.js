import test from "node:test";
import assert from "node:assert/strict";
import { extractTaskId, normalizeTask } from "../src/yunwu-client.js";

test("兼容云雾常见的任务 ID 返回结构", () => {
  assert.equal(extractTaskId({ code: "success", data: "task-1" }), "task-1");
  assert.equal(extractTaskId({ data: { task_id: "task-2" } }), "task-2");
  assert.equal(extractTaskId({ taskId: "task-3" }), "task-3");
});

test("归一化成功任务和音频字段", () => {
  const result = normalizeTask({
    code: "success",
    data: {
      task_id: "task-1",
      status: "SUCCESS",
      progress: "100%",
      data: [{ id: "clip-1", audio_url: "https://cdn1.suno.ai/clip-1.mp3", duration: 120 }],
    },
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.tracks[0].id, "clip-1");
  assert.equal(result.tracks[0].durationSeconds, 120);
});

test("归一化云雾 cld2 媒体字段", () => {
  const result = normalizeTask({
    data: {
      task_id: "task-cld2",
      status: "SUCCESS",
      data: [
        {
          id: "clip-cld2",
          cld2AudioUrl: "https://cdn.example.com/clip.mp3",
          cld2ImageUrl: "https://cdn.example.com/cover.webp",
          cld2VideoUrl: "https://cdn.example.com/video.mp4",
        },
      ],
    },
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.tracks[0].audioUrl, "https://cdn.example.com/clip.mp3");
  assert.equal(result.tracks[0].imageUrl, "https://cdn.example.com/cover.webp");
  assert.equal(result.tracks[0].videoUrl, "https://cdn.example.com/video.mp4");
});

test("归一化失败任务", () => {
  const result = normalizeTask({ data: { status: "FAILURE", fail_reason: "bad prompt" } });
  assert.equal(result.status, "FAILED");
  assert.equal(result.failReason, "bad prompt");
});
