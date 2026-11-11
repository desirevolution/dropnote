/**
 * Client-side crypto for Encrypted Pads (ADR-0001, Zero-Knowledge): the
 * browser encrypts everything before first contact — the server stores and
 * relays ciphertext only, and the Key never leaves the client.
 *
 * AES-256-GCM frames use a fresh nonce:
 *
 *   [1-byte version][12-byte nonce][ciphertext + 16-byte GCM tag]
 *
 * Whole-blob frames (Note text, Pad state) encrypt under the Key directly.
 * Chunk frames (for streaming Attachments, wired in a later ticket) encrypt
 * under a key derived per chunk index with HKDF-SHA-256 from the Key, so a
 * damaged chunk corrupts only its own range. A wrong Key, corrupted bytes
 * or a foreign frame fails cleanly with a DecryptionError — GCM
 * authentication never returns garbage.
 *
 * Pure WebCrypto, no dependencies — importable by the browser bundle and
 * by headless Node tests alike (Node ≥ 20 ships WebCrypto globally).
 */

/** The Key's size in bytes (AES-256). */
export const KEY_BYTES = 32;
/** Nonce size for every frame (GCM standard). */
const NONCE_BYTES = 12;
/** The GCM authentication tag size in bytes. */
const TAG_BYTES = 16;
/** The current frame-format version (first byte of every frame). */
const FRAME_VERSION = 1;
const HKDF_SALT = "dropnote v1 chunk salt";
const CHUNK_INFO_PREFIX = "dropnote attachment chunk ";

/** A wrong Key, corrupted bytes or an unreadable frame: decryption refused. */
export class DecryptionError extends Error {
  constructor(cause) {
    super("Decryption failed — the wrong Key or corrupted data", { cause });
    this.name = "DecryptionError";
  }
}

/** A base64url string is malformed. */
export class KeyFormatError extends Error {
  constructor(detail) {
    super(`This is not a valid Key: ${detail}`);
    this.name = "KeyFormatError";
  }
}

/** A fresh random 256-bit Key. */
export function generateKey() {
  const key = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(key);
  return key;
}

/** Encodes bytes as unpadded base64url (the URL-safe alphabet). */
export function encodeBase64url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Decodes unpadded base64url back into bytes. */
export function decodeBase64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new KeyFormatError("expected unpadded base64url (characters A–Z, a–z, 0–9, -, _)");
  }
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    throw new KeyFormatError("the base64url decoding failed");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encrypts a whole blob (a Note snapshot, Pad state, one Yjs update). */
export async function encryptBlob(key, plaintext) {
  const aesKey = await importKey(key, "encrypt");
  const nonce = newNonce();
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext),
  );
  return frame(nonce, ciphertext);
}

/** Decrypts a whole-blob frame; refuses anything inauthentic. */
export async function decryptBlob(key, blob) {
  const { nonce, ciphertext } = unframe(blob);
  const aesKey = await importKey(key, "decrypt");
  return decrypt(aesKey, nonce, ciphertext);
}

/**
 * Encrypts one chunk of a streamed Attachment under the chunk key derived
 * for `index` (chunks are numbered from 0). Per-chunk nonces plus derived
 * keys keep damage local: one broken chunk never poisons its neighbors.
 */
export async function encryptChunk(key, index, chunk) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`The chunk index must be a non-negative integer, got ${index}`);
  }
  const aesKey = await chunkKey(key, index, "encrypt");
  const nonce = newNonce();
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, chunk),
  );
  return frame(nonce, ciphertext);
}

/** Decrypts one chunk frame with the key derived for `index`. */
export async function decryptChunk(key, index, blob) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`The chunk index must be a non-negative integer, got ${index}`);
  }
  const { nonce, ciphertext } = unframe(blob);
  const aesKey = await chunkKey(key, index, "decrypt");
  return decrypt(aesKey, nonce, ciphertext);
}

function importKey(key, usage) {
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, [usage]);
}

/**
 * Derives the AES-GCM key for one chunk index from the Key (HKDF-SHA-256,
 * fixed salt, the index in the info string): every chunk of an Attachment
 * is sealed under its own key, so frames cannot be re-ordered or swapped
 * without failing authentication.
 */
async function chunkKey(key, index, usage) {
  const base = await crypto.subtle.importKey("raw", key, "HKDF", false, ["deriveKey"]);
  const info = new TextEncoder().encode(CHUNK_INFO_PREFIX + index.toFixed(0));
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(HKDF_SALT), info },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

function newNonce() {
  const nonce = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(nonce);
  return nonce;
}

function frame(nonce, ciphertext) {
  const out = new Uint8Array(1 + NONCE_BYTES + ciphertext.length);
  out[0] = FRAME_VERSION;
  out.set(nonce, 1);
  out.set(ciphertext, 1 + NONCE_BYTES);
  return out;
}

function unframe(blob) {
  if (!(blob instanceof Uint8Array) || blob.length < 1 + NONCE_BYTES + TAG_BYTES) {
    throw new DecryptionError();
  }
  if (blob[0] !== FRAME_VERSION) {
    throw new DecryptionError();
  }
  return {
    nonce: blob.subarray(1, 1 + NONCE_BYTES),
    ciphertext: blob.subarray(1 + NONCE_BYTES),
  };
}

async function decrypt(aesKey, nonce, ciphertext) {
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext);
    return new Uint8Array(plaintext);
  } catch (cause) {
    throw new DecryptionError(cause);
  }
}
