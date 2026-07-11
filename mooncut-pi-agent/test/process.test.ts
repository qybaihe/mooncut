import assert from "node:assert/strict";
import test from "node:test";
import {runProcess} from "../src/process.ts";

test("returns after the command exits when a grandchild keeps stdout open", async () => {
  const startedAt = Date.now();
  const result = await runProcess("sh", ["-c", "sleep 5 & echo parent-finished"]);
  assert.match(result.stdout, /parent-finished/u);
  assert.ok(Date.now() - startedAt < 3_000, "waited for an unrelated grandchild pipe");
});
