/**
 * Chunk-wise streaming for Attachments on Encrypted Pads (ADR-0001): the
 * client seals a picked file one chunk at a time — a 1 GB-class file never
 * sits whole in memory — and opens a downloaded container back into the
 * original bytes. Built purely on the crypto core's per-chunk API
 * (frontend/crypto.js): no new primitives, just the streamed container.
 *
 * The container travels over the same Attachment endpoints as plaintext
 * blobs; the server is a dumb byte pipe (it stores ciphertext it cannot
 * inspect, per Zero-Knowledge). Layout, byte for byte:
 *
 *   container  = *envelope
 *   envelope   = 4-byte big-endian frame length + frame
 *   frame      = [1-byte version][12-byte nonce][ciphertext + 16-byte tag]
 *   chunk i    = the plaintext of file.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)
 *
 * Every chunk is sealed under its own HKDF-derived key (encryptChunk), so
 * one damaged chunk makes only its own range unreadable — the neighbors
 * still open exactly. A wrong Key or corrupted bytes fail cleanly
 * (DecryptionError); authentication never returns garbage.
 */

import { decryptChunk, encryptChunk, DecryptionError } from "./crypto.js";

/** Plaintext bytes per chunk; each frame adds 29 bytes (nonce, tag, version). */
export const CHUNK_BYTES = 1_048_576;

/** Envelope overhead per chunk: 4-byte length prefix + version + nonce + tag. */
const ENVELOPE_BYTES = 4 + 1 + 12 + 16;

/** Anything outside these bounds is not a chunk frame of this container. */
const MIN_FRAME_BYTES = 1 + 12 + 16 + 1; // a chunk holds at least 1 byte
const MAX_FRAME_BYTES = 1 + 12 + 16 + CHUNK_BYTES; // a chunk never exceeds CHUNK_BYTES

/**
 * Seals a picked file (a Blob — the browser's File qualifies) into the
 * streamed container: a ReadableStream of length-prefixed frames, pulled
 * and sealed strictly one chunk at a time. `onProgress` reports the
 * plaintext bytes sealed so far after each chunk.
 */
export function encryptAttachment(key, file, { onProgress } = {}) {
  let index = 0;
  let sealed = 0;
  return new ReadableStream({
    async pull(controller) {
      const start = index * CHUNK_BYTES;
      if (start >= file.size) {
        controller.close();
        return;
      }
      const end = Math.min(start + CHUNK_BYTES, file.size);
      const plaintext = new Uint8Array(await file.slice(start, end).arrayBuffer());
      const frame = await encryptChunk(key, index, plaintext);

      const envelope = new Uint8Array(4 + frame.length);
      new DataView(envelope.buffer).setUint32(0, frame.length, false);
      envelope.set(frame, 4);
      controller.enqueue(envelope);

      sealed += plaintext.length;
      index += 1;
      onProgress?.(sealed);
    },
  });
}

/**
 * Opens a downloaded container (a ReadableStream of ciphertext, e.g. a
 * fetch response body) and yields one result per chunk, in order:
 *
 *   { ok: true, index, bytes }              — the chunk, decrypted
 *   { ok: false, index, error }             — a chunk that failed authentication
 *
 * A failed chunk never stops the iteration: its neighbors are independent
 * and stay readable, which is what makes damage local (the caller decides
 * what to do — the editor aborts the download on the first failure, so a
 * corrupt file is never saved). The generator itself throws DecryptionError
 * only when the container is structurally unreadable (bad length prefix or
 * a truncated frame) — there is no chunk to report then. `onProgress`
 * reports the plaintext bytes decrypted so far.
 */
export async function* decryptAttachment(key, ciphertext, { onProgress } = {}) {
  const reader = ciphertext.getReader();
  try {
    let buffer = new Uint8Array(0);
    let consumed = 0; // how much of `buffer` is already handed out as frames
    let index = 0;
    let decrypted = 0;

    for (;;) {
      // Hand out every complete frame the buffer already holds.
      for (;;) {
        const frame = nextFrame(buffer, consumed);
        if (frame === null) break;
        consumed = frame.end;

        let result;
        try {
          result = { ok: true, index, bytes: await decryptChunk(key, index, frame.bytes) };
        } catch (cause) {
          if (!(cause instanceof DecryptionError)) throw cause;
          result = { ok: false, index, error: cause };
        }
        yield result;

        if (result.ok) {
          decrypted += result.bytes.length;
          onProgress?.(decrypted);
        }
        index += 1;
      }

      if (consumed > 0) {
        buffer = buffer.subarray(consumed);
        consumed = 0;
      }
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.length > 0) {
          throw new DecryptionError(new Error("the container ends mid-frame"));
        }
        return;
      }
      buffer = concatInto(buffer, value);
    }
  } finally {
    // An early exit (a failed chunk aborts the download) must release the
    // connection instead of leaving the body unconsumed.
    reader.cancel().catch(() => {});
  }
}

/**
 * Parses the next envelope out of `buffer` (from `from` on). Returns null
 * while the buffer holds less than one complete envelope.
 */
function nextFrame(buffer, from) {
  if (buffer.length - from < 4) return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const length = view.getUint32(from, false);
  if (length < MIN_FRAME_BYTES || length > MAX_FRAME_BYTES) {
    throw new DecryptionError(new Error(`implausible frame length ${length}`));
  }
  if (buffer.length - from < 4 + length) return null;
  return { bytes: buffer.subarray(from + 4, from + 4 + length), end: from + 4 + length };
}

function concatInto(buffer, addition) {
  const out = new Uint8Array(buffer.length + addition.length);
  out.set(buffer, 0);
  out.set(addition, buffer.length);
  return out;
}
