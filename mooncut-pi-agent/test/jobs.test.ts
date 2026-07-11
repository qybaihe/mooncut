import assert from "node:assert/strict";
import test from "node:test";
import {friendlyJobName, isProcessAlive} from "../src/jobs.ts";

test("does not recover a job owned by a live local worker as interrupted", () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(undefined), false);
  assert.equal(isProcessAlive(2_147_483_647), false);
});

test("creates stable privacy-safe names for the shared render queue", () => {
  const id = "0123456789abcdef0123456789abcdef";
  const name = friendlyJobName(id, "2026-07-11T00:34:00.000Z");
  assert.equal(name, friendlyJobName(id, "2026-07-11T00:34:00.000Z"));
  assert.match(name, /^[\p{Script=Han}]+ · [\p{Script=Han}]+ · \d{2}:\d{2}$/u);
  assert.equal(name.includes(id.slice(0, 8)), false);
});
