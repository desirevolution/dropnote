import type { Key } from "./crypto.js";

/**
 * The update codec for Encrypted Pads: Yjs updates are encrypted whole-blob
 * before sending and decrypted on arrival, in strict order.
 */
export interface UpdateCodec {
  /** An incoming ciphertext frame → the plaintext update inside. */
  open(frame: Uint8Array): Promise<Uint8Array>;
  /** An outgoing plaintext update → the ciphertext frame to send. */
  seal(update: Uint8Array): Promise<Uint8Array>;
}

/** Builds the codec for one Encrypted Pad's Key. */
export function createUpdateCodec(key: Key): UpdateCodec;
