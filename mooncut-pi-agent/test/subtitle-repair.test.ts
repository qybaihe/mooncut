import assert from "node:assert/strict";
import test from "node:test";
import {applySubtitleRepair} from "../src/subtitle-repair.ts";

test("applies only the Agent-approved subtitle segments and preserves timing", () => {
  const source = {
    duration_ms: 2_400,
    transcript: "欢迎使用梦卡\n今天开始剪视频",
    provider: "hybrid-test",
    segments: [
      {index: 0, text: "欢迎使用梦卡", start_ms: 0, end_ms: 1_100},
      {index: 1, text: "今天开始剪视频", start_ms: 1_100, end_ms: 2_400},
    ],
  };
  const repaired = applySubtitleRepair(source, [{
    segmentIndex: 0,
    before: "欢迎使用梦卡",
    after: "欢迎使用 MoonCut",
    startMs: 0,
    endMs: 1_100,
    reason: "品牌名误识别",
  }]);

  assert.deepEqual(repaired.segments, [
    {index: 0, text: "欢迎使用 MoonCut", start_ms: 0, end_ms: 1_100},
    {index: 1, text: "今天开始剪视频", start_ms: 1_100, end_ms: 2_400},
  ]);
  assert.equal(repaired.transcript, "欢迎使用 MoonCut\n今天开始剪视频");
  assert.equal(repaired.provider, "hybrid-test + human-repair");
});
