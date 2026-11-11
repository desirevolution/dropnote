/**
 * The update codec for Encrypted Pads (ADR-0001 + ADR-0002): a Yjs update
 * is encrypted whole-blob before it leaves the client and decrypted on
 * arrival — the relay keeps moving opaque bytes and never sees plaintext.
 *
 * Every step is async (WebCrypto), so both directions are strictly
 * serialized: incoming frames are opened in arrival order and outgoing
 * updates sealed in emission order, no matter how the event loop interleaves
 * them. Shared by the browser bundle and the headless test clients.
 */
import { decryptBlob, encryptBlob } from "./crypto.js";

export function createUpdateCodec(key) {
  let incoming = Promise.resolve();
  let outgoing = Promise.resolve();

  return {
    /** An incoming ciphertext frame → the plaintext update inside. */
    open(frame) {
      const next = incoming.then(() => decryptBlob(key, frame));
      // Keep the queue flowing when one frame fails; the caller's promise
      // still rejects with the real error.
      incoming = next.catch(() => {});
      return next;
    },
    /** An outgoing plaintext update → the ciphertext frame to send. */
    seal(update) {
      const next = outgoing.then(() => encryptBlob(key, update));
      outgoing = next.catch(() => {});
      return next;
    },
  };
}
