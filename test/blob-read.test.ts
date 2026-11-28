import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBlobRead } from "../src/blob-read.ts";

test("an authorized blob stream cannot switch to a replacement at the same path", async t => {
  const dir = mkdtempSync(join(tmpdir(), "dropnote-blob-read-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "blob");
  writeFileSync(path, "original authorized bytes");
  const { stream, size } = openBlobRead(path);
  unlinkSync(path);
  writeFileSync(path, "private replacement bytes");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString(), "original authorized bytes");
  assert.equal(size, Buffer.byteLength("original authorized bytes"));
  assert.equal(stream.closed, true);
});

test("missing blobs and non-file paths fail closed", t => {
  const dir = mkdtempSync(join(tmpdir(), "dropnote-blob-read-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => openBlobRead(join(dir, "missing")));
  assert.throws(() => openBlobRead(dir), /Not an attachment file/);
});
