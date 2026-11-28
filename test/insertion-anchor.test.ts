import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { helpInsertion } from "../src/editor-help.ts";
import { captureInsertion, resolveInsertion } from "../frontend/insertion-anchor.js";

test("relative insertion follows changes in a second Yjs document", () => {
  const a = new Y.Doc(), b = new Y.Doc();
  try {
    const note = a.getText("note"), remote = b.getText("note");
    note.insert(0, "hello original");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const anchor = captureInsertion(note, 6, 14);
    remote.insert(0, "new ");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    assert.deepEqual(resolveInsertion(anchor, note), { from: 10, to: 18 });
    remote.delete(11, 1);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    assert.equal(resolveInsertion(anchor, note), null);
    assert.equal(resolveInsertion(anchor, remote), null);
  } finally { a.destroy(); b.destroy(); }
});

test("help formatting follows a relative selection and rejects changed text", () => {
  const a = new Y.Doc(), b = new Y.Doc();
  try {
    const note = a.getText("note"), remote = b.getText("note");
    note.insert(0, "title\nTask");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const anchor = captureInsertion(note, 6, 10);
    remote.insert(0, "Intro\n");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    const range = resolveInsertion(anchor, note)!;
    assert.deepEqual(range, { from: 12, to: 16 });
    assert.equal(helpInsertion("task", note.toString(), range.from, range.to), "- [ ] Task");
    remote.delete(13, 1);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    assert.equal(resolveInsertion(anchor, note), null);
  } finally { a.destroy(); b.destroy(); }
});
