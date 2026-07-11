import assert from "node:assert/strict";
import test from "node:test";
import {validatePublicResearchUrl} from "../src/research.ts";

const publicDns = async () => [{address: "93.184.216.34"}];
const privateDns = async () => [{address: "127.0.0.1"}];

test("research capture accepts a public HTTPS destination", async () => {
  assert.equal(
    await validatePublicResearchUrl("https://example.com/article", publicDns),
    "https://example.com/article",
  );
});

test("research capture rejects loopback, private DNS, HTTP, and credential URLs", async () => {
  await assert.rejects(() => validatePublicResearchUrl("https://127.0.0.1/", publicDns));
  await assert.rejects(() => validatePublicResearchUrl("https://example.com/", privateDns));
  await assert.rejects(() => validatePublicResearchUrl("http://example.com/", publicDns));
  await assert.rejects(() => validatePublicResearchUrl("https://user:pass@example.com/", publicDns));
});
