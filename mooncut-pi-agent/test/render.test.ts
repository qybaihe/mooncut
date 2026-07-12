import assert from "node:assert/strict";
import test from "node:test";
import {buildRemotionRenderArgs} from "../src/render.ts";

test("buildRemotionRenderArgs includes GPU gl and concurrency for shared export path", () => {
  const args = buildRemotionRenderArgs({
    composition: "AgentTalkingHeadVideo",
    outputPath: "/tmp/final.mp4",
    propsPath: "/tmp/props.json",
    concurrency: 2,
    gl: "angle",
  });
  assert.equal(args[0], "render");
  assert.ok(args.includes("AgentTalkingHeadVideo"));
  assert.ok(args.includes("--gl=angle"));
  assert.ok(args.includes("--concurrency=2"));
  assert.ok(args.includes("--codec=h264"));
  assert.ok(args.includes("--hardware-acceleration=required"));
  assert.ok(args.includes("--props=/tmp/props.json"));
  assert.ok(args.includes("--overwrite"));
});

test("buildRemotionRenderArgs omits --gl when gl is null", () => {
  const args = buildRemotionRenderArgs({
    composition: "MoonCutOutro16x9",
    outputPath: "/tmp/out.mp4",
    gl: null,
    concurrency: 1,
  });
  assert.ok(!args.some((value) => value.startsWith("--gl=")));
  assert.ok(args.includes("--concurrency=1"));
});
