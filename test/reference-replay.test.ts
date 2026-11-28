import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, existsSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openUpdateLog, readBoundedUpdates } from "../src/update-log.ts";
import { referenceReplay, MAX_REFERENCE_REPLAY_BYTES, MAX_REFERENCE_REPLAY_FRAMES } from "../src/reference-replay.ts";
import { createReferenceCache } from "../frontend/reference-cache.js";

test("bounded replay does not create, truncate or change an update log", t => {
  const dir = mkdtempSync(path.join(tmpdir(), "reference-replay-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "sync.log");
  assert.deepEqual(readBoundedUpdates(dir, 100), []);
  assert.equal(existsSync(file), false);
  const log = openUpdateLog(dir);
  log.append(Buffer.from("one"));
  log.append(Buffer.alloc(0)); // attachment revision marker
  log.append(Buffer.from("two"));
  appendFileSync(file, Buffer.from([0, 0, 0, 9, 1])); // torn tail
  const bytes = readFileSync(file);
  assert.deepEqual(readBoundedUpdates(dir, 100), [Buffer.from("one"), Buffer.from("two")]);
  assert.equal(readBoundedUpdates(dir, 1), null);
  assert.equal(readBoundedUpdates(dir, 100, 2), null);
  assert.deepEqual(readFileSync(file), bytes);
});
test("legacy frames replay without modification", t => {
  const dir = mkdtempSync(path.join(tmpdir(), "reference-legacy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "sync.log"), Buffer.from([0, 0, 0, 1, 42]));
  assert.deepEqual(readBoundedUpdates(dir, 5), [Buffer.from([42])]);
});
test("replay bounds raw bytes, frames and blob IDs before encoding", () => {
  assert.equal(referenceReplay([Buffer.alloc(MAX_REFERENCE_REPLAY_BYTES + 1)], []), null);
  assert.equal(referenceReplay(Array(MAX_REFERENCE_REPLAY_FRAMES + 1).fill(Buffer.alloc(0)), []), null);
  assert.equal(referenceReplay([], Array(20_001).fill("a")), null);
  assert.deepEqual(referenceReplay([Buffer.from([0, 255]), Buffer.alloc(0)], ["id"]), { updates: ["AP8"], blobIds: ["id"] });
});
test("cache is bounded, salt scoped and returns isolated key copies", () => {
  let time = 0;
  const cache = createReferenceCache({ maxSpaces: 2, maxFiles: 1, maxAgeMs: 100, now: () => time });
  const key = new Uint8Array([1, 2]);
  const entry = { key, salt: "salt", name: "Vault", files: [{ blobId: "a", name: "A" }, { blobId: "b", name: "B" }] };
  cache.put("one", entry);
  key.fill(0);
  assert.deepEqual(cache.key("one", "salt"), new Uint8Array([1, 2]));
  cache.key("one", "salt")!.fill(0);
  assert.deepEqual(cache.key("one", "salt"), new Uint8Array([1, 2]));
  assert.equal(cache.key("one", "wrong"), undefined);
  assert.equal(cache.name("one", "a"), "A");
  assert.equal(cache.name("one", "b"), undefined);
  time = 101;
  assert.equal(cache.name("one"), undefined);
  assert.ok(cache.key("one", "salt")); // key survives label expiry
  cache.put("two", entry);
  cache.put("three", entry);
  assert.equal(cache.key("one", "salt"), undefined);
  cache.invalidate("two");
  assert.equal(cache.key("two", "salt"), undefined);
  cache.clear();
  assert.equal(cache.key("three", "salt"), undefined);
});
