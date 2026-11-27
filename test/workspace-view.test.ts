import { test } from "node:test";
import assert from "node:assert/strict";
import { initialWorkspaceView, workspaceViewKey } from "../src/workspace-view.ts";

test("last selected tab wins over the content-based default", () => {
  assert.equal(initialWorkspaceView(false, "files", "a note", 0), "files");
  assert.equal(initialWorkspaceView(false, "note", "", 4), "note");
});

test("explicit files links take precedence over a remembered note tab", () => {
  assert.equal(initialWorkspaceView(true, "note", "a note", 0), "files");
});

test("first visit and invalid preferences retain the previous default", () => {
  assert.equal(initialWorkspaceView(false, null, "", 0), "note");
  assert.equal(initialWorkspaceView(false, null, " \n", 1), "files");
  assert.equal(initialWorkspaceView(false, "invalid", "text", 1), "note");
});

test("view preference is keyed by space identity, not just its URL", () => {
  const pad = { slug: "example", createdAt: "2026-01-01" };
  assert.notEqual(workspaceViewKey(pad), workspaceViewKey({ ...pad, slug: "other" }));
  assert.notEqual(workspaceViewKey(pad), workspaceViewKey({ ...pad, createdAt: "2026-02-01" }));
  assert.equal(workspaceViewKey(pad), workspaceViewKey({ ...pad }));
});
