import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PadStore } from "../src/store.ts";
import { padRole } from "../src/pad-access.ts";
import { matchesSpaceId, SPACE_ID_PATTERN } from "../src/space-identity.ts";

function directory(t: TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "dropnote-identity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("legacy index gets a persisted immutable ID without changing existing metadata", t => {
  const dir = directory(t), filename = path.join(dir, "index.json");
  const old = { slug: "old", kind: "plain", createdAt: "2024-01-01T00:00:00.000Z", expiresAt: null, displayName: "Old" };
  writeFileSync(filename, JSON.stringify({ version: 1, pads: { old } }));
  const first = PadStore.open(dir).getLivePad("old")!;
  assert.match(first.spaceId, SPACE_ID_PATTERN);
  assert.deepEqual(first, { ...old, spaceId: first.spaceId });
  const disk = JSON.parse(readFileSync(filename, "utf8"));
  assert.equal(disk.pads.old.spaceId, first.spaceId);
  assert.equal(PadStore.open(dir).getLivePadById(first.spaceId)?.slug, "old");
});
test("rename, delete and recreation never redirect an old ID", async t => {
  const dir = directory(t), store = PadStore.open(dir);
  const old = store.createPad("same", { ttlSeconds: null });
  store.renamePad(store.getLivePad("same")!, "New name");
  assert.equal(store.getLivePadById(old.spaceId)?.displayName, "New name");
  let finish!: () => void;
  const deletion = store.removePad("same", () => new Promise<void>(resolve => { finish = resolve; }));
  assert.equal(store.getLivePadById(old.spaceId), undefined);
  await Promise.resolve();
  finish();
  await deletion;
  const replacement = store.createPad("same", { ttlSeconds: null });
  assert.notEqual(replacement.spaceId, old.spaceId);
  assert.equal(store.getLivePadById(old.spaceId), undefined);
  assert.equal(store.getLivePadById(replacement.spaceId)?.slug, "same");
  assert.equal(matchesSpaceId(replacement.spaceId, old.spaceId), false);
});
test("expiry excludes ID lookups immediately", t => {
  const store = PadStore.open(directory(t));
  const expired = store.createPad("expired", { ttlSeconds: -1 });
  assert.equal(store.getLivePadById(expired.spaceId), undefined);
});
test("personal Defaults receive different stable IDs and retain owner ACL", t => {
  const dir = directory(t), store = PadStore.open(dir, true);
  const alice = store.ensureDefaultPad("alice"), bob = store.ensureDefaultPad("bob");
  assert.notEqual(alice.spaceId, bob.spaceId);
  assert.equal(padRole(alice, "bob"), null);
  assert.equal(padRole(bob, "alice"), null);
  assert.equal(PadStore.open(dir, true).ensureDefaultPad("alice").spaceId, alice.spaceId);
});
test("identity guard rejects malformed or duplicated expected values", () => {
  assert.equal(matchesSpaceId("abc", undefined), true);
  assert.equal(matchesSpaceId("abc", "abc"), true);
  for (const value of ["", "other", null, ["abc", "abc"], { id: "abc" }]) assert.equal(matchesSpaceId("abc", value), false);
});
test("corrupt or duplicate persisted identities fail closed", t => {
  const dir = directory(t), store = PadStore.open(dir);
  const first = store.createPad("first", { ttlSeconds: null });
  store.createPad("second", { ttlSeconds: null });
  const index = store.getIndex();
  Object.assign(index.pads.second!, { spaceId: first.spaceId });
  writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  assert.throws(() => PadStore.open(dir), /duplicate Space identity/);
});

test("deleted attachment IDs cannot be reused, even after restart", t => {
  const dir = directory(t), store = PadStore.open(dir);
  const pad = store.createPad("files", { ttlSeconds: null });
  const blobId = "a".repeat(32);
  store.recordBlob(pad.slug, blobId, 10);
  store.forgetBlob(pad.slug, blobId, true);
  assert.equal(store.getLivePad(pad.slug)?.blobs?.[blobId], undefined);
  assert.equal(store.usageBytes(), 0);
  const reopened = PadStore.open(dir);
  assert.throws(() => reopened.recordBlob(pad.slug, blobId, 2), /deleted Attachment ID/);
  reopened.recordBlob(pad.slug, "b".repeat(32), 2);
  assert.equal(reopened.usageBytes(), 2);
});
