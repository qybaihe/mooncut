/**
 * Exercises shipped uiIconId helpers (isUiIconId / uiIconUrl) and asset presence.
 */
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {isUiIconId, uiIconUrl, UI_ICON_IDS} from "../src/renderer/lib/uiIconId.js";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const iconsDir = join(root, "src/renderer/public/ui-icons");

test("isUiIconId accepts known ids and rejects unknown", () => {
  assert.equal(isUiIconId("library"), true);
  assert.equal(isUiIconId("settings"), true);
  assert.equal(isUiIconId("sparkles"), true);
  assert.equal(isUiIconId("not-a-real-icon"), false);
  assert.equal(isUiIconId(""), false);
  assert.equal(isUiIconId("Library"), false);
});

test("uiIconUrl resolves known ids under base prefix", () => {
  assert.equal(uiIconUrl("library", "./"), "./ui-icons/library.svg");
  assert.equal(uiIconUrl("settings", "/"), "/ui-icons/settings.svg");
  assert.equal(uiIconUrl("workbench", "/app/"), "/app/ui-icons/workbench.svg");
  // base without trailing slash is normalized
  assert.equal(uiIconUrl("folder", "/app"), "/app/ui-icons/folder.svg");
});

test("uiIconUrl falls back to sparkles for unknown ids", () => {
  assert.equal(uiIconUrl("totally-missing", "./"), "./ui-icons/sparkles.svg");
  assert.equal(uiIconUrl("", "./"), "./ui-icons/sparkles.svg");
});

test("UI_ICON_IDS list is non-empty and every id has an SVG asset", () => {
  assert.ok(UI_ICON_IDS.length >= 20, `expected ≥20 icons, got ${UI_ICON_IDS.length}`);
  for (const id of UI_ICON_IDS) {
    assert.equal(isUiIconId(id), true, `catalog id not recognized: ${id}`);
    assert.ok(existsSync(join(iconsDir, `${id}.svg`)), `missing svg for ${id}`);
    const url = uiIconUrl(id, "./");
    assert.equal(url, `./ui-icons/${id}.svg`);
  }
});

test("uiIconUrl default base is ./ when omitted", () => {
  assert.equal(uiIconUrl("check"), "./ui-icons/check.svg");
});
