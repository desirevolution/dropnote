/**
 * The client-side crypto module for Encrypted Pads (seam 2, ADR-0001): pure
 * headless tests over Node's WebCrypto — Key generation, the base64url
 * codec, whole-blob encrypt/decrypt (Note and Pad state) and the
 * chunked per-chunk API for streaming Attachments (wired to the UI only in
 * a later ticket). Wrong-Key and corrupted-data failures must be clean.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DecryptionError,
  KeyFormatError,
  decodeBase64url,
  decryptBlob,
  decryptChunk,
  encodeBase64url,
  encryptBlob,
  encryptChunk,
  generateKey,
} from "../frontend/crypto.js";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function random(size: number): Uint8Array {
  // A deterministic filler pattern (getRandomValues caps at 64 KiB): the
  // plaintext only has to be distinct from its frame, not random.
  const out = new Uint8Array(size);
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

test("a generated Key is 256 bits of fresh randomness", async () => {
  const first = await generateKey();
  const second = await generateKey();
  assert.equal(first.length, 32, "256 bits = 32 bytes");
  assert.notDeepEqual([...first], [...second], "two Keys never collide");
});

test("the base64url codec round-trips a Key in URL-safe base64url", async () => {
  const key = await generateKey();
  const encoded = encodeBase64url(key);
  assert.equal(encoded.length, 43, "32 bytes encode as 43 unpadded base64url characters");
  assert.match(encoded, /^[A-Za-z0-9_-]+$/, "only URL-safe characters: no escaping is needed");
  assert.deepEqual([...(decodeBase64url(encoded))], [...key]);
});

test("the base64url codec matches known-good base64url", async () => {
  // base64 of the bytes 00 FF is "AP8=" — a literal from an independent source.
  assert.equal(encodeBase64url(new Uint8Array([0x00, 0xff])), "AP8");
  assert.deepEqual([...decodeBase64url("AP8")], [0x00, 0xff]);
});

test("malformed base64url is rejected", () => {
  for (const bad of ["", "A", "with+slash_and=pad", "has spaces inside", "ümlaut", "AP8="]) {
    assert.throws(() => decodeBase64url(bad), KeyFormatError, `"${bad}" must be rejected`);
  }
});

test("whole-blob encrypt/decrypt round-trips Note-sized payloads", async () => {
  const key = await generateKey();
  for (const size of [0, 1, 1_000, 1024 * 1024]) {
    const plaintext = random(size);
    const frame = await encryptBlob(key, plaintext);
    assert.notDeepEqual([...frame], [...plaintext], "the stored bytes are not the plaintext");
    assert.equal(
      frame.length,
      1 + 12 + plaintext.length + 16,
      "frame = 1-byte version + 12-byte nonce + ciphertext + 16-byte GCM tag",
    );
    assert.deepEqual([...(await decryptBlob(key, frame))], [...plaintext]);
  }
});

test("encrypting the same plaintext twice yields different frames (fresh nonce) that decrypt identically", async () => {
  const key = await generateKey();
  const plaintext = bytes("same note, encrypted twice");
  const first = await encryptBlob(key, plaintext);
  const second = await encryptBlob(key, plaintext);
  assert.notDeepEqual([...first], [...second], "each encryption draws a fresh nonce");
  assert.deepEqual([...(await decryptBlob(key, first))], [...plaintext]);
  assert.deepEqual([...(await decryptBlob(key, second))], [...plaintext]);
});

test("a wrong Key fails cleanly instead of returning garbage", async () => {
  const key = await generateKey();
  const otherKey = await generateKey();
  const frame = await encryptBlob(key, bytes("classified"));
  await assert.rejects(
    decryptBlob(otherKey, frame),
    (cause: unknown) => {
      assert.ok(cause instanceof DecryptionError, "the failure is a DecryptionError");
      assert.match((cause as Error).message, /wrong Key|corrupted/i, "the error names its cause");
      return true;
    },
  );
});

test("corrupted ciphertext and a foreign frame version fail cleanly", async () => {
  const key = await generateKey();
  const frame = await encryptBlob(key, bytes("classified"));

  const flipped = [...frame];
  flipped[20] = flipped[20]! ^ 0xff; // inside the ciphertext body
  await assert.rejects(decryptBlob(key, Uint8Array.from(flipped)), DecryptionError, "a flipped byte breaks authentication");

  const wrongVersion = [...frame];
  wrongVersion[0] = 0xff;
  await assert.rejects(decryptBlob(key, Uint8Array.from(wrongVersion)), DecryptionError, "an unknown frame version is refused");

  await assert.rejects(decryptBlob(key, bytes("not even a frame")), DecryptionError, "a too-short frame is refused");
});

test("chunked encrypt/decrypt round-trips chunk by chunk", async () => {
  const key = await generateKey();
  const chunks = [random(64 * 1024), random(1), random(0), random(64 * 1024)];
  const frames = await Promise.all(chunks.map((chunk, index) => encryptChunk(key, index, chunk)));
  const back = await Promise.all(frames.map((frame, index) => decryptChunk(key, index, frame)));
  assert.deepEqual([...concat(back)], [...concat(chunks)], "chunk order and content survive");
});

test("a damaged chunk corrupts only its own range", async () => {
  const key = await generateKey();
  const chunks = [random(1_000), random(1_000), random(1_000)];
  const frames = await Promise.all(chunks.map((chunk, index) => encryptChunk(key, index, chunk)));

  const damaged = [...frames[1]!];
  damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 0xff; // strike the authentication tag
  await assert.rejects(decryptChunk(key, 1, Uint8Array.from(damaged)), DecryptionError);
  assert.deepEqual([...(await decryptChunk(key, 0, frames[0]!))], [...chunks[0]!], "the chunk before is intact");
  assert.deepEqual([...(await decryptChunk(key, 2, frames[2]!))], [...chunks[2]!], "the chunk after is intact");
});

test("a chunk frame only opens under its own index — chunk keys are derived per index", async () => {
  const key = await generateKey();
  const chunk = bytes("one chunk");
  const frameAtFive = await encryptChunk(key, 5, chunk);

  await assert.rejects(decryptChunk(key, 4, frameAtFive), DecryptionError, "a shifted index is not a valid Key");
  assert.deepEqual([...(await decryptChunk(key, 5, frameAtFive))], [...chunk]);

  await assert.rejects(decryptBlob(key, frameAtFive), DecryptionError, "a chunk frame is not a whole-blob frame");
  const blobFrame = await encryptBlob(key, chunk);
  await assert.rejects(decryptChunk(key, 0, blobFrame), DecryptionError, "a whole-blob frame is not a chunk frame");
});
