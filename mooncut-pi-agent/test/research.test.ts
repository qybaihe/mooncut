import assert from "node:assert/strict";
import test from "node:test";
import {isBrowserChallenge} from "../src/research.ts";

test("detects browser challenge pages before publishing them as evidence", () => {
  assert.equal(isBrowserChallenge("请验证您是真人 Cloudflare 隐私 · 帮助"), true);
  assert.equal(isBrowserChallenge("Just a moment... Checking your browser before accessing the site"), true);
  assert.equal(isBrowserChallenge("Page Title: 请稍候…\n- HTTP status: 403"), true);
  assert.equal(isBrowserChallenge("heading \"Make videos programmatically\""), false);
});
