import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceAddress, spaceHistoryState } from "../src/reference-navigation.ts";
import { initialWorkspaceView } from "../src/workspace-view.ts";

const spaceId = "aabbccdd-1234-4321-8123-aabbccddeeff";
const origin = "https://dropnote.example";
const target = { spaceId, path: "/p/docker" };
const note = { kind: "space", spaceId, view: "note" } as const;
const file = { kind: "file", spaceId, blobId: "a".repeat(32) } as const;

test("page and file references carry immutable identity and explicit target view", () => {
  assert.equal(referenceAddress(target, note, origin), `/p/docker?spaceId=${spaceId}&view=note`);
  assert.equal(referenceAddress(target, { ...note, view: "files" }, origin), `/p/docker?spaceId=${spaceId}&view=files`);
  assert.equal(referenceAddress(target, file, origin), `/p/docker?spaceId=${spaceId}&view=files&file=${file.blobId}`);
  assert.equal(referenceAddress({ ...target, path: "/default" }, note, origin), `/default?spaceId=${spaceId}&view=note`);
});
test("navigation rejects wrong identities and cross-origin targets, strips inherited secrets", () => {
  for (const path of ["//evil.example/p", "/\\evil.example/p", "https://evil.example/", "javascript:alert(1)"]) {
    assert.throws(() => referenceAddress({ ...target, path }, note, origin));
  }
  assert.throws(() => referenceAddress({ ...target, spaceId: "wrong" }, note, origin));
  assert.throws(() => referenceAddress(target, { ...file, blobId: "wrong" }, origin));
  assert.equal(referenceAddress({ ...target, path: "/p/docker?secret=foo#private" }, note, origin), `/p/docker?spaceId=${spaceId}&view=note`);
});
test("explicit note links override saved Downloads and empty note defaults", () => {
  assert.equal(initialWorkspaceView("note", "files", "", 9), "note");
  assert.equal(initialWorkspaceView("files", "note", "text", 0), "files");
});
test("tab-local history preserves back/forward and drops the forward branch on new navigation", () => {
  const a = spaceHistoryState(null, null, "navigate", undefined, "a");
  assert.deepEqual(a, { trail: "a", index: 0, max: 0, left: null });
  const b = spaceHistoryState({ ...a, left: { path: "/p/a" } }, null, "navigate", "/p/a", "b");
  assert.deepEqual(b, { trail: "a", index: 1, max: 1, left: null });
  const c = spaceHistoryState({ ...b, left: { path: "/p/b" } }, null, "navigate", "/p/b", "c");
  assert.equal(c.index, 2);
  const back = spaceHistoryState(c, b, "back_forward", undefined, "d");
  assert.deepEqual(back, { trail: "a", index: 1, max: 2, left: null });
  assert.deepEqual(spaceHistoryState(back, back, "reload", undefined, "e"), back);
  const first = spaceHistoryState(back, a, "back_forward", undefined, "f");
  const branch = spaceHistoryState({ ...first, left: { path: "/p/a" } }, null, "navigate", "/p/a", "g");
  assert.deepEqual(branch, { trail: "a", index: 1, max: 1, left: null });
});
test("unrelated navigation and corrupt history reset to a new trail", () => {
  const previous = { trail: "old", index: 2, max: 4, left: { path: "/p/x" } };
  for (const [state, path] of [[previous, "/other"], [previous, undefined], [{ ...previous, index: -1 }, "/p/x"]] as const) {
    assert.deepEqual(spaceHistoryState(state, null, "navigate", path, "fresh"), { trail: "fresh", index: 0, max: 0, left: null });
  }
  assert.equal(spaceHistoryState(previous, { trail: "other", index: 0 }, "back_forward", undefined, "fresh").trail, "fresh");
});
