/**
 * external-cli adapter tests — pure node:test, no Electron needed.
 *
 * Strategy:
 *  - parseCliOutput: real pure function, exercised directly.
 *  - resolveCliCommand: exercises the "not found" path with a bogus PATH env,
 *    and the "explicit commandPath" fast path.
 *  - spawnCli + runExternalCliAssistant: use `node` itself as a fake "claude" by
 *    pointing commandPath at process.execPath and wrapping it in a script that
 *    echoes a JSON blob to stdout. This keeps the test cross-platform and
 *    dependency-free.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {writeFileSync, mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const mod = await import("../dist-electron/main/external-cli.js");
const {
  parseCliOutput,
  resolveCliCommand,
  spawnCli,
  runExternalCliAssistant,
  ExternalCliNotFoundError,
  CliJsonParseError,
  sentinelError,
  EXTERNAL_CLI_NOT_FOUND_SENTINEL,
  EXTERNAL_CLI_PARSE_ERROR_SENTINEL,
} = mod;

test("parseCliOutput extracts valid JSON object", () => {
  const stdout = JSON.stringify({
    reply: "好",
    phase: "discover",
    ready: false,
    draft: "",
    petMessage: "稳住",
    suggestions: [
      {eyebrow: "a", title: "t1", detail: "d1"},
      {eyebrow: "b", title: "t2", detail: "d2"},
      {eyebrow: "c", title: "t3", detail: "d3"},
    ],
    model: "claude-code",
  });
  const parsed = parseCliOutput(stdout);
  assert.equal(parsed.reply, "好");
  assert.equal(parsed.suggestions.length, 3);
  assert.equal(parsed.model, "claude-code");
});

test("parseCliOutput tolerates ```json fenced wrapper and trailing prose", () => {
  const stdout =
    "Here you go:\n```json\n" +
    JSON.stringify({
      reply: "ok",
      phase: "draft",
      ready: true,
      draft: "稿子",
      petMessage: "p",
      suggestions: [
        {eyebrow: "a", title: "t1", detail: "d1"},
        {eyebrow: "b", title: "t2", detail: "d2"},
        {eyebrow: "c", title: "t3", detail: "d3"},
      ],
      model: "opencode",
    }) +
    "\n```\nDone.";
  const parsed = parseCliOutput(stdout);
  assert.equal(parsed.draft, "稿子");
  assert.equal(parsed.model, "opencode");
});

test("parseCliOutput throws CliJsonParseError on non-JSON stdout", () => {
  assert.throws(() => parseCliOutput("no json here"), CliJsonParseError);
});

test("parseCliOutput throws CliJsonParseError when missing required fields", () => {
  assert.throws(
    () => parseCliOutput(JSON.stringify({reply: "x"})),
    CliJsonParseError,
  );
});

test("resolveCliCommand honors explicit commandPath", () => {
  const result = resolveCliCommand({kind: "claude", commandPath: "/usr/local/bin/claude"});
  assert.equal(result.command, "/usr/local/bin/claude");
  assert.deepEqual(result.args, []);
});

test("resolveCliCommand throws ExternalCliNotFoundError when neither CLI is on PATH", () => {
  // Use an empty PATH so `which`/`where` finds nothing.
  const originalPath = process.env.PATH;
  process.env.PATH = "/nonexistent-empty-path-12345";
  try {
    assert.throws(
      () => resolveCliCommand({kind: "claude"}),
      ExternalCliNotFoundError,
    );
  } finally {
    process.env.PATH = originalPath;
  }
});

test("spawnCli returns stdout from a real command", async () => {
  // Use a node script as our fake CLI; presetArgs run it, prompt is appended as -p.
  const dir = mkdtempSync(join(tmpdir(), "mooncut-extcli-"));
  const scriptPath = join(dir, "fake-claude.js");
  writeFileSync(
    scriptPath,
    `console.log(JSON.stringify({reply:"hi",phase:"discover",ready:false,draft:"",petMessage:"p",suggestions:[{eyebrow:"a",title:"t1",detail:"d1"},{eyebrow:"b",title:"t2",detail:"d2"},{eyebrow:"c",title:"t3",detail:"d3"}],model:"claude-code"}));`,
  );
  const out = await spawnCli(process.execPath, "ignored-prompt", [scriptPath]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.reply, "hi");
});

test("runExternalCliAssistant returns parsed assistant response", async () => {
  // Build a fake claude script that ignores -p and emits a valid JSON object.
  const dir = mkdtempSync(join(tmpdir(), "mooncut-extcli-"));
  const scriptPath = join(dir, "fake-claude.cjs");
  writeFileSync(
    scriptPath,
    `console.log(JSON.stringify({reply:"可以",phase:"discover",ready:false,draft:"",petMessage:"继续",suggestions:[{eyebrow:"钩子",title:"开头抓人",detail:"第一句直击痛点"},{eyebrow:"故事",title:"我那次经历",detail:"具体到时间地点"},{eyebrow:"反转",title:"意想不到结论",detail:"反常识收尾"}],model:"claude-code"}));`,
  );
  // commandPath = "node /path/script.cjs" → resolveCliCommand splits into
  // command=node, args=[scriptPath]; spawnCli appends -p <prompt> (ignored by script).
  const response = await runExternalCliAssistant(
    {action: "guide", messages: [{role: "user", content: "讲口播开头"}]},
    {kind: "claude", commandPath: `${process.execPath} ${scriptPath}`},
  );
  assert.equal(response.reply, "可以");
  assert.equal(response.suggestions.length, 3);
  assert.equal(response.model, "claude-code");
});

test("sentinelError prefixes the right sentinel", () => {
  const nf = sentinelError("not-found", "missing binary");
  assert.ok(nf.startsWith(EXTERNAL_CLI_NOT_FOUND_SENTINEL));
  const pe = sentinelError("parse-error", "bad json");
  assert.ok(pe.startsWith(EXTERNAL_CLI_PARSE_ERROR_SENTINEL));
});
