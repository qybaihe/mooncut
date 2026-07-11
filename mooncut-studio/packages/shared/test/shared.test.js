import assert from "node:assert/strict";
import test from "node:test";
import {
  IPC_CHANNELS,
  isLoopbackHost,
  isSafeHttpUrl,
  maskSecret,
  redactSecrets,
} from "../dist/index.js";

test("IPC channel names are stable and unique", () => {
  const values = Object.values(IPC_CHANNELS);
  assert.equal(new Set(values).size, values.length);
  assert.ok(IPC_CHANNELS.projectCreate.startsWith("studio:"));
});

test("URL and loopback helpers", () => {
  assert.equal(isSafeHttpUrl("https://api.example.com/v1"), true);
  assert.equal(isSafeHttpUrl("file:///etc/passwd"), false);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
});

test("secret redaction never leaks keys", () => {
  const raw = 'Authorization: Bearer sk-abc123456789 and api_key="super-secret-key"';
  const redacted = redactSecrets(raw);
  assert.equal(redacted.includes("sk-abc123456789"), false);
  assert.equal(redacted.includes("super-secret-key"), false);
  assert.ok(redacted.includes("[REDACTED]"));
  assert.equal(maskSecret("abcd"), "••••");
  assert.ok(maskSecret("abcdefghijklmnop").endsWith("mnop"));
});
