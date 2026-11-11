/** A 32-byte AES-256-GCM Key. */
export type Key = Uint8Array;

/** The Key's size in bytes (AES-256). */
export const KEY_BYTES: number;

/** A wrong Key, corrupted bytes or an unreadable frame: decryption refused. */
export class DecryptionError extends Error {}

/** A base64url string is malformed. */
export class KeyFormatError extends Error {}

/** A fresh random 256-bit Key. */
export function generateKey(): Key;

/** Encodes bytes as unpadded base64url (the URL-safe alphabet). */
export function encodeBase64url(bytes: Uint8Array): string;

/** Decodes unpadded base64url back into bytes. */
export function decodeBase64url(text: string): Uint8Array;

/** Encrypts a whole blob (a Note snapshot, Pad state, one Yjs update). */
export function encryptBlob(key: Key, plaintext: Uint8Array): Promise<Uint8Array>;

/** Decrypts a whole-blob frame; refuses anything inauthentic. */
export function decryptBlob(key: Key, blob: Uint8Array): Promise<Uint8Array>;

/**
 * Encrypts one chunk of a streamed Attachment under the chunk key derived
 * for `index` (chunks are numbered from 0).
 */
export function encryptChunk(key: Key, index: number, chunk: Uint8Array): Promise<Uint8Array>;

/** Decrypts one chunk frame with the key derived for `index`. */
export function decryptChunk(key: Key, index: number, blob: Uint8Array): Promise<Uint8Array>;
