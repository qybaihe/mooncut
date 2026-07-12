import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {CapabilityStore, CapabilityStoreError, parseCapabilityManifest} from "../src/capabilities.ts";

const createStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "mooncut-capabilities-"));
  const cliPath = join(directory, "fake-wc26.mjs");
  await writeFile(cliPath, [
    "const args = process.argv.slice(2);",
    "if (args.includes('--download') || args.includes('--open')) process.exit(9);",
    "console.log(JSON.stringify({provider: 'FIFA', catalogUrl: 'https://www.fifa.com/', results: []}));",
  ].join("\n"));
  return {
    directory,
    store: new CapabilityStore({
      databasePath: join(directory, "mooncut.sqlite"),
      artifactRoot: join(directory, "artifacts"),
      fifaCliPath: cliPath,
      fifaCliCwd: directory,
      signingKey: "test-capability-signing-key",
    }),
  };
};

test("rejects manifests that request capabilities the host cannot enforce", () => {
  assert.throws(() => parseCapabilityManifest({
    schemaVersion: "mooncut.capability.v1",
    id: "com.example.unsafe",
    version: "1.0.0",
    kind: "hosted-cli",
    adapter: "unreviewed-shell",
    display: {name: "unsafe", tagline: "unsafe", category: "unsafe"},
    compatibility: {agent: ">=0.1.0", tasks: ["research"]},
    permissions: [{name: "shell", reason: "no"}],
    tools: [{name: "unsafe_tool", description: "unsafe", confirmation: "never", inputSchema: {type: "object"}}],
    guidance: {whenToUse: "never", evidenceRule: "never", neverDo: []},
  }), (error) => error instanceof CapabilityStoreError && error.code === "INVALID_MANIFEST");

  assert.throws(() => parseCapabilityManifest({
    schemaVersion: "mooncut.capability.v1",
    id: "com.example.unreviewed-http",
    version: "1.0.0",
    kind: "hosted-http",
    display: {name: "unreviewed", tagline: "unreviewed", category: "unsafe"},
    compatibility: {agent: ">=0.1.0", tasks: ["research"]},
    permissions: [{name: "network", domains: ["example.com"], reason: "no reviewed adapter"}],
    tools: [{name: "query_data", description: "unsafe", confirmation: "never", inputSchema: {type: "object"}}],
    guidance: {whenToUse: "never", evidenceRule: "never", neverDo: []},
  }), (error) => error instanceof CapabilityStoreError && error.code === "INVALID_MANIFEST");
});

test("installs are user-isolated, stateful, and resolve into immutable task snapshots", async () => {
  const {directory, store} = await createStore();
  try {
    const catalog = store.listCatalog();
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.slug, "fifa-official-highlights");

    const alice = store.install("alice", "fifa-official-highlights");
    assert.equal(alice.created, true);
    assert.equal(alice.installation.status, "enabled");
    assert.equal(store.install("alice", "fifa-official-highlights").created, false);
    assert.equal(store.listInstallations("bob").length, 0);
    assert.throws(() => store.getInstallation("bob", alice.installation.installationId), (error) => error instanceof CapabilityStoreError && error.status === 404);

    const snapshot = store.resolveSnapshots("alice", [alice.installation.installationId], "video-edit");
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0]?.version, "1.0.0");
    store.setStatus("alice", alice.installation.installationId, "disabled");
    assert.throws(() => store.resolveSnapshots("alice", [alice.installation.installationId], "video-edit"), (error) => error instanceof CapabilityStoreError && error.code === "CAPABILITY_DISABLED");
    store.setStatus("alice", alice.installation.installationId, "enabled");
    assert.equal(store.resolveRuntime("alice", snapshot, "video-edit").length, 1);
  } finally {
    store.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("FIFA adapter only receives allowlisted argv and requires explicit screenshot confirmation", async () => {
  const {directory, store} = await createStore();
  try {
    const installation = store.install("alice", "fifa-official-highlights").installation;
    const invocation = await store.invoke("alice", installation.installationId, {
      tool: "fifa_find_highlights",
      input: {query: "阿根廷 vs 埃及"},
    });
    assert.equal(invocation.status, "succeeded");
    assert.equal(invocation.output.provider, "FIFA");
    assert.equal(store.listInvocations("alice", installation.installationId).length, 1);
    const preflight = await store.preflight("alice", installation.installationId);
    assert.equal(preflight.ok, true);

    await assert.rejects(
      () => store.invoke("alice", installation.installationId, {
        tool: "fifa_match_context",
        input: {matchId: "M95", screenshotView: "ratings"},
      }),
      (error) => error instanceof CapabilityStoreError && error.code === "ARTIFACT_CONFIRMATION_REQUIRED",
    );
  } finally {
    store.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("admin releases stay immutable and can publish non-executable skill-only guidance", async () => {
  const {directory, store} = await createStore();
  try {
    const packageRecord = store.createPackage("subtitle-glossary", "verified");
    const release = store.publishRelease(packageRecord.id, {
      schemaVersion: "mooncut.capability.v1",
      id: "com.example.subtitle-glossary",
      version: "1.0.0",
      kind: "skill-only",
      display: {name: "术语词库", tagline: "为字幕提供审核过的术语提示", category: "字幕 / 语言"},
      compatibility: {agent: ">=0.1.0", tasks: ["video-edit"]},
      permissions: [],
      tools: [{name: "glossary_hint", description: "Return reviewed terminology guidance", confirmation: "never", inputSchema: {type: "object"}}],
      guidance: {whenToUse: "用户明确要求术语规范时使用。", evidenceRule: "不把术语提示伪装成事实来源。", neverDo: ["不执行任意代码"]},
    });
    assert.equal(release.version, "1.0.0");
    assert.throws(() => store.publishRelease(packageRecord.id, {
      schemaVersion: "mooncut.capability.v1",
      id: "com.example.subtitle-glossary",
      version: "1.0.0",
      kind: "skill-only",
      display: {name: "术语词库", tagline: "重复版本", category: "字幕 / 语言"},
      compatibility: {agent: ">=0.1.0", tasks: ["video-edit"]},
      permissions: [],
      tools: [{name: "glossary_hint", description: "Return reviewed terminology guidance", confirmation: "never", inputSchema: {type: "object"}}],
      guidance: {whenToUse: "用户明确要求术语规范时使用。", evidenceRule: "不把术语提示伪装成事实来源。", neverDo: ["不执行任意代码"]},
    }), (error) => error instanceof CapabilityStoreError && error.code === "RELEASE_VERSION_EXISTS");
    const install = store.install("alice", "subtitle-glossary");
    assert.equal(store.resolveRuntime("alice", store.resolveSnapshots("alice", [install.installation.installationId], "video-edit"), "video-edit")[0]?.manifest.kind, "skill-only");
    store.yankRelease(release.id);
    assert.throws(() => store.getCatalog("subtitle-glossary"), (error) => error instanceof CapabilityStoreError && error.status === 404);
  } finally {
    store.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("imports a Pages community package only as a non-executable reviewed declaration", async () => {
  const {directory, store} = await createStore();
  try {
    const manifest = JSON.stringify({
      schemaVersion: "mooncut.capability.v1",
      id: "com.example.community-glossary",
      version: "1.0.0",
      kind: "skill-only",
      display: {name: "社区术语词库", tagline: "创作者共享的术语提示", category: "字幕 / 语言"},
      compatibility: {agent: ">=0.1.0", tasks: ["video-edit"]},
      permissions: [],
      tools: [{name: "glossary_hint", description: "Provide terminology guidance", confirmation: "never", inputSchema: {type: "object"}}],
      guidance: {whenToUse: "需要术语提示时使用。", evidenceRule: "不将提示当作事实来源。", neverDo: ["不执行下载代码"]},
    });
    const skill = "# 社区术语词库\n\n仅提供写作提示。";
    const connector = JSON.stringify({
      schemaVersion: "mooncut.connector.v1",
      id: "com.example.community-glossary.connector",
      mode: "builtin-adapter-reference",
      execution: "local-reviewed-adapter-only",
      security: {neverExecutePackageCode: true, requiresLocalAdapter: true, requiresUserConfirmationFor: []},
    });
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const first = store.importCommunityRelease("alice", {
      slug: "community-glossary",
      version: "1.0.0",
      manifest,
      skill,
      connector,
      integrity: {skillSha256: hash(skill), connectorSha256: hash(connector)},
    });
    assert.equal(first.created, true);
    assert.equal(first.installation.status, "enabled");
    assert.equal(store.importCommunityRelease("alice", {
      slug: "community-glossary", version: "1.0.0", manifest, skill, connector,
      integrity: {skillSha256: hash(skill), connectorSha256: hash(connector)},
    }).created, false);
    assert.throws(() => store.importCommunityRelease("alice", {
      slug: "community-glossary", version: "1.0.0", manifest, skill: `${skill}\nmalicious`, connector,
      integrity: {skillSha256: hash(skill), connectorSha256: hash(connector)},
    }), (error) => error instanceof CapabilityStoreError && error.code === "PACKAGE_INTEGRITY_MISMATCH");
  } finally {
    store.close();
    await rm(directory, {recursive: true, force: true});
  }
});
