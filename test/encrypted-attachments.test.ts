/**
 * Encrypted Attachments (ticket 08, ADR-0001): a file attached to an
 * Encrypted Pad is sealed chunk-wise in the client before any byte leaves,
 * the server stores the container as opaque ciphertext, and a download is
 * opened with the Pad's Key back into the original bytes. Two seams:
 *  - the client streaming module (frontend/encrypted-attachments.js),
 *    tested headlessly like the crypto core;
 *  - the real server, driven by the same headless clients that speak the
 *    wrapped Live-Sync protocol.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHUNK_BYTES, decryptAttachment, encryptAttachment } from "../frontend/encrypted-attachments.js";
import { DecryptionError, encryptChunk, generateKey } from "../frontend/crypto.js";
import { makeTempDataDir, startServer } from "./helpers/server.ts";
import { SyncClient, waitFor } from "./helpers/sync-client.ts";
import { createEncryptedPad, dataDirContains } from "./helpers/encrypted-pad.ts";
import { createUpdateCodec } from "../frontend/encrypted-sync.js";

/** A recognizable plaintext marker embedded in the E2E test file's bytes. */
const SECRET_MARKER = "vault-attachment-plaintext-88";

/** A deterministic filler pattern (plaintext only has to be distinct from its container). */
function filler(size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(size));
  for (let i = 0; i < size; i++) {
    out[i] = (i * 31 + 7) & 0xff;
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Collects a decryptAttachment iteration into plain bytes (test convenience). */
async function openAll(key: Uint8Array, ciphertext: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for await (const result of decryptAttachment(key, ciphertext)) {
    if (!result.ok) throw result.error;
    chunks.push(result.bytes);
  }
  return chunks;
}

/** Wraps bytes into a one-shot ReadableStream, like a download response body. */
function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  const queue = [...parts];
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
  });
}

test("an Attachment is sealed chunk-wise and opens back into the original bytes", async () => {
  const key = await generateKey();
  // Multi-chunk file with a partial last chunk, plus the empty edge.
  for (const size of [2 * CHUNK_BYTES + 5, CHUNK_BYTES + 1, 1, 0]) {
    const file = new File([filler(size)], "report.bin");
    const sealed = encryptAttachment(key, file);

    // The container is collected in memory here only because the test is
    // small; the wire never needs it whole (see the laziness test below).
    const container: Uint8Array[] = [];
    const reader = sealed.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      container.push(value);
    }

    const chunks = await openAll(key, streamOf(container));
    assert.deepEqual(concat(chunks), filler(size), `a ${size}-byte file round-trips through the container`);
  }
});

test("sealing pulls one chunk at a time — the file is never materialized whole", async () => {
  const key = await generateKey();
  // A 3-chunk file that does NOT exist in memory: each slice is generated
  // (and counted) only when the stream asks for it.
  const size = 3 * CHUNK_BYTES + 123;
  let materialized = 0;
  const file = {
    size,
    slice(start: number, end: number): Blob {
      materialized += end - start;
      return new Blob([filler(end - start)]);
    },
  };

  const reader = encryptAttachment(key, file).getReader();
  assert.equal((await reader.read()).done, false, "the first frame arrives");
  assert.equal(materialized, CHUNK_BYTES, "only the first chunk was read — not the whole file");

  while (!(await reader.read()).done) {
    assert.ok(materialized <= size, "the source is pulled incrementally, never all at once");
  }
  assert.equal(materialized, size, "the last pull reaches exactly the end of the file");
});

/** Hand-builds the container envelopes the way the encoder does (for damage tests). */
async function sealEnvelopes(key: Uint8Array, chunks: Uint8Array[]): Promise<Uint8Array[]> {
  const envelopes: Uint8Array[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const frame = await encryptChunk(key, index, chunk);
    const envelope = new Uint8Array(4 + frame.length);
    new DataView(envelope.buffer).setUint32(0, frame.length, false);
    envelope.set(frame, 4);
    envelopes.push(envelope);
  }
  return envelopes;
}

/** Collects a ReadableStream into one buffer (test-sized containers only). */
async function drain(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return concat(parts);
}

test("one damaged chunk spoils only its own range — the neighbors open exactly", async () => {
  const key = await generateKey();
  const chunks = [filler(CHUNK_BYTES), filler(777), filler(CHUNK_BYTES - 1)];
  // Hand-build the container the way the encoder does, then damage one
  // frame the way a flipped bit on disk would: inside the frame, well-formed.
  const envelopes = await sealEnvelopes(key, chunks);
  const damaged = [...envelopes[1]!];
  damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 0xff; // strike the authentication tag

  const results: Array<{ ok: boolean; index: number; bytes?: Uint8Array; error?: unknown }> = [];
  for await (const result of decryptAttachment(key, streamOf([envelopes[0]!, Uint8Array.from(damaged), envelopes[2]!]))) {
    results.push(result);
  }

  assert.equal(results.length, 3, "every chunk reports — damage never hides");
  assert.equal(results[0]?.ok, true);
  assert.deepEqual(results[0]?.bytes, chunks[0], "the chunk before the damage is intact");
  assert.equal(results[1]?.ok, false, "the damaged chunk refuses");
  assert.ok(results[1]?.error instanceof DecryptionError, "the refusal is a clean DecryptionError");
  assert.equal(results[2]?.ok, true);
  assert.deepEqual(results[2]?.bytes, chunks[2], "the chunk after the damage is intact");
});

test("a structurally unreadable container fails cleanly instead of yielding bytes", async () => {
  const key = await generateKey();
  // A length prefix that promises more bytes than the stream delivers.
  const envelope = new Uint8Array(8);
  new DataView(envelope.buffer).setUint32(0, 500_000, false);
  await assert.rejects(
    (async () => {
      for await (const _ of decryptAttachment(key, streamOf([envelope]))) {
        // nothing usable can come out
      }
    })(),
    DecryptionError,
  );
});

test("the sealed container frames are length-prefixed and carry per-chunk keys", async () => {
  const key = await generateKey();
  const file = new File([filler(CHUNK_BYTES + 4)], "two-chunks.bin");
  const reader = encryptAttachment(key, file).getReader();

  const first = (await reader.read()).value!;
  // Frame = 4-byte length prefix + [1-byte version][12-byte nonce][CHUNK + 16-byte tag].
  const firstLength = new DataView(first.buffer, first.byteOffset, 4).getUint32(0, false);
  assert.equal(firstLength, CHUNK_BYTES + 29, "a full chunk seals into a frame of chunk + 29 bytes");
  assert.equal(first.length, 4 + firstLength, "the envelope is prefix + frame");
  assert.equal(first[4], 1, "the frame carries the crypto frame version");

  const second = (await reader.read()).value!;
  const secondLength = new DataView(second.buffer, second.byteOffset, 4).getUint32(0, false);
  assert.equal(secondLength, 4 + 29, "the 4-byte remainder is its own short frame");

  assert.equal((await reader.read()).done, true, "two chunks, no more");
});

/* ------------------------------------------------------------------ *
 * Seam 1: the real server, driven the way the browser drives it — the
 * sealed container streams over the Attachment endpoints while the Pad's
 * metadata rides the wrapped Live-Sync protocol.
 * ------------------------------------------------------------------ */

function attachmentsUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/api/pads/${slug}/attachments`;
}

test("an Attachment on an Encrypted Pad travels and rests as ciphertext only, and decrypts back", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const pad = await createEncryptedPad(server.baseUrl, { slug: "vault-files" });
    const writer = await SyncClient.connect(server.baseUrl, "vault-files", { codec: createUpdateCodec(pad.key), proof: pad.proof });
    const observer = await SyncClient.connect(server.baseUrl, "vault-files", { codec: createUpdateCodec(pad.key), proof: pad.proof });
    try {
      // A multi-chunk file with a partial last chunk, binary content, and a
      // recognizable ASCII marker so a plaintext leak would be findable.
      const size = 2 * CHUNK_BYTES + 40_001;
      const original = filler(size);
      original.set(Buffer.from(SECRET_MARKER, "utf8"), 1234);
      const name = "quarterly-report.bin";
      const file = new File([original], name);

      // Upload exactly the way the browser does: the sealed container is
      // the request body, streamed chunk by chunk — no plaintext is sent.
      const upload = await fetch(attachmentsUrl(server.baseUrl, "vault-files"), {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-pad-proof": pad.proof },
        body: encryptAttachment(pad.key, file),
        duplex: "half",
      } as RequestInit);
      assert.equal(upload.status, 201, "the Encrypted Pad accepts sealed Attachment uploads");
      const stored = (await upload.json()) as { blobId: string; size: number };
      assert.ok(stored.size > original.length, "the stored blob is the container, not the plaintext");

      writer.addAttachment({
        blobId: stored.blobId,
        name,
        size: original.length,
        contentType: "application/octet-stream",
        addedAt: new Date().toISOString(),
      });
      await waitFor(() => observer.attachmentList().length === 1, "the list entry reaching the other side");

      // Zero-Knowledge on disk: no plaintext bytes, not even the file's name.
      assert.deepEqual(await dataDirContains(dataDir, SECRET_MARKER), [], "the Attachment's plaintext is nowhere on disk");
      assert.deepEqual(await dataDirContains(dataDir, name), [], "the file's name rests in no plaintext file");

      // Download and open: the original bytes come back exactly.
      const download = await fetch(`${attachmentsUrl(server.baseUrl, "vault-files")}/${stored.blobId}`, { headers: { "x-pad-proof": pad.proof } });
      assert.equal(download.status, 200);
      assert.deepEqual(concat(await openAll(pad.key, download.body!)), original, "the download decrypts to the original bytes");
    } finally {
      await Promise.all([writer.close(), observer.close()]);
    }
  } finally {
    await server.stop();
  }
});

test("a download under the wrong Key fails cleanly instead of producing corrupt output", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const pad = await createEncryptedPad(server.baseUrl, { slug: "locked-files" });
    const original = filler(64 * 1024 + 9);
    const upload = await fetch(attachmentsUrl(server.baseUrl, "locked-files"), {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-pad-proof": pad.proof },
      body: encryptAttachment(pad.key, new File([original], "secret.bin")),
      duplex: "half",
    } as RequestInit);
    assert.equal(upload.status, 201);
    const { blobId } = (await upload.json()) as { blobId: string };

    const download = await fetch(`${attachmentsUrl(server.baseUrl, "locked-files")}/${blobId}`, { headers: { "x-pad-proof": pad.proof } });
    assert.equal(download.status, 200, "the server serves ciphertext to a client with the Pad proof");

    const wrongKey = await generateKey();
    const results: Array<{ ok: boolean; bytes?: Uint8Array; error?: unknown }> = [];
    for await (const result of decryptAttachment(wrongKey, download.body!)) {
      results.push(result);
    }
    assert.ok(results.length >= 1, "the container opened into chunk reports");
    assert.ok(
      results.every((result) => !result.ok),
      "no chunk under the wrong Key yields any bytes at all",
    );
    assert.ok(results[0]?.error instanceof DecryptionError, "the failure is a clean DecryptionError");
  } finally {
    await server.stop();
  }
});

test("one damaged chunk in the stored bytes corrupts only its own range, not the file", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const pad = await createEncryptedPad(server.baseUrl, { slug: "flaky-disk" });
    // A hostile disk flips one byte inside a stored frame; the server,
    // unable to read ciphertext, stores and serves it faithfully.
    const key = pad.key;
    const chunks = [filler(CHUNK_BYTES), filler(777), filler(CHUNK_BYTES - 1)];
    const envelopes = await sealEnvelopes(key, chunks);
    const damaged = [...envelopes[1]!];
    damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 0xff;
    const upload = await fetch(attachmentsUrl(server.baseUrl, "flaky-disk"), {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-pad-proof": pad.proof },
      body: Buffer.concat([Buffer.from(envelopes[0]!), Buffer.from(damaged), Buffer.from(envelopes[2]!)]),
    });
    assert.equal(upload.status, 201);
    const { blobId } = (await upload.json()) as { blobId: string };

    const download = await fetch(`${attachmentsUrl(server.baseUrl, "flaky-disk")}/${blobId}`, { headers: { "x-pad-proof": pad.proof } });
    const results: Array<{ ok: boolean; index: number; bytes?: Uint8Array; error?: unknown }> = [];
    for await (const result of decryptAttachment(key, download.body!)) {
      results.push(result);
    }

    assert.equal(results.length, 3, "all three chunks report");
    assert.equal(results[0]?.ok, true);
    assert.deepEqual(results[0]?.bytes, chunks[0], "the range before the damage downloads intact");
    assert.equal(results[1]?.ok, false, "the damaged range refuses with a clear failure");
    assert.ok(results[1]?.error instanceof DecryptionError);
    assert.equal(results[2]?.ok, true);
    assert.deepEqual(results[2]?.bytes, chunks[2], "the range after the damage downloads intact");
  } finally {
    await server.stop();
  }
});

test("the per-file limit still guards an Encrypted Pad's uploads", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { MAX_FILE_SIZE: "1KB" } });
  try {
    const pad = await createEncryptedPad(server.baseUrl, { slug: "capped" });
    const original = filler(4 * 1024);
    const sealed = encryptAttachment(pad.key, new File([original], "big.bin"));
    const container = await drain(sealed);

    const upload = await fetch(attachmentsUrl(server.baseUrl, "capped"), {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-pad-proof": pad.proof },
      body: Buffer.from(container),
    });
    assert.equal(upload.status, 413, "the oversized sealed upload is rejected like any other");
    assert.match(((await upload.json()) as { error: string }).error, /per-file/);

    // Not even the ciphertext of the rejected upload may linger on disk.
    assert.deepEqual(
      await dataDirContains(dataDir, container.subarray(0, 64)),
      [],
      "the rejected container is nowhere on disk",
    );
  } finally {
    await server.stop();
  }
});
