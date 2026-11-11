import type { Key } from "./crypto.js";

/** Plaintext bytes per Attachment chunk; each frame adds 29 bytes and a 4-byte length prefix. */
export const CHUNK_BYTES: number;

/** The picked file: Blob-shaped — a size plus lazily-sliced parts. */
export interface SealableSource {
  readonly size: number;
  slice(start?: number, end?: number, contentType?: string): Blob;
}

/** One opened chunk of a streamed Attachment. */
export type ChunkResult =
  | { ok: true; index: number; bytes: Uint8Array }
  | { ok: false; index: number; error: Error };

/**
 * Seals a picked file (a Blob) into the streamed container: a ReadableStream
 * of length-prefixed frames, pulled and sealed one chunk at a time.
 * `onProgress` reports the plaintext bytes sealed so far.
 */
export function encryptAttachment(
  key: Key,
  file: SealableSource,
  options?: { onProgress?: (sealedBytes: number) => void },
): ReadableStream<Uint8Array>;

/**
 * Opens a downloaded container (a ReadableStream of ciphertext) and yields
 * one ChunkResult per chunk in order; a chunk that fails authentication is
 * reported and the iteration continues (damage stays local). Throws
 * DecryptionError on a structurally unreadable container. `onProgress`
 * reports the plaintext bytes decrypted so far.
 */
export function decryptAttachment(
  key: Key,
  ciphertext: ReadableStream<Uint8Array>,
  options?: { onProgress?: (decryptedBytes: number) => void },
): AsyncGenerator<ChunkResult, void, undefined>;
