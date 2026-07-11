import assert from "node:assert/strict";
import test from "node:test";
import {canAccessOwnedResource, isAuthorized, notificationEmailForPrincipal, redactInternalPaths} from "../src/server.ts";

test("requires an exact Bearer API key when deployment keys are configured", () => {
  const keys = ["mooncut_test_key_0123456789abcdef"];
  assert.equal(isAuthorized(undefined, keys), false);
  assert.equal(isAuthorized("Basic abc", keys), false);
  assert.equal(isAuthorized("Bearer mooncut_test_key_wrong", keys), false);
  assert.equal(isAuthorized(`Bearer ${keys[0]}`, keys), true);
});

test("fails closed for service authorization when no API key is configured", () => {
  assert.equal(isAuthorized(undefined, []), false);
});

test("isolates user-owned resources while service credentials retain operator access", () => {
  const alice = {kind: "user" as const, user: {id: "alice", email: "alice@example.com", createdAt: "2026-01-01T00:00:00.000Z"}};
  const bob = {kind: "user" as const, user: {id: "bob", email: "bob@example.com", createdAt: "2026-01-01T00:00:00.000Z"}};
  assert.equal(canAccessOwnedResource("alice", alice), true);
  assert.equal(canAccessOwnedResource("alice", bob), false);
  assert.equal(canAccessOwnedResource(undefined, alice), false);
  assert.equal(canAccessOwnedResource(undefined, {kind: "service"}), true);
});

test("user jobs cannot choose a different mail recipient", () => {
  const user = {kind: "user" as const, user: {id: "alice", email: "alice@example.com", createdAt: "2026-01-01T00:00:00.000Z"}};
  assert.equal(notificationEmailForPrincipal(user, "victim@example.com"), "alice@example.com");
  assert.equal(notificationEmailForPrincipal({kind: "service"}, "ops@example.com"), "ops@example.com");
});

test("redacts absolute server paths repeated by an Agent summary", () => {
  const summary = "成片：`/opt/mooncut/data/jobs/abc/final.mp4`，缓存 /tmp/render.log";
  const redacted = redactInternalPaths(summary);
  assert.equal(redacted.includes("/opt/"), false);
  assert.equal(redacted.includes("/tmp/"), false);
  assert.match(redacted, /\[internal path\]/u);
});
