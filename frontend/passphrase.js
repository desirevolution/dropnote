import { decodeBase64url, encodeBase64url, decryptBlob, encryptBlob } from "./crypto.js";

const text = new TextEncoder();
const iterations = 600_000;

export async function derivePadKey(passphrase, salt) {
  const secret = await crypto.subtle.importKey("raw", text.encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: decodeBase64url(salt), iterations,
  }, secret, 256);
  return new Uint8Array(bits);
}

async function derivePurposeKey(key, purpose) {
  const base = await crypto.subtle.importKey("raw", key, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: text.encode(purpose),
  }, base, 256);
  return new Uint8Array(bits);
}

export async function padProof(key) {
  return encodeBase64url(await derivePurposeKey(key, "share-tool v1 write proof"));
}

export function presenceKey(key) {
  return derivePurposeKey(key, "share-tool v1 cursor presence");
}

export async function createEncryption(passphrase) {
  const salt = encodeBase64url(crypto.getRandomValues(new Uint8Array(16)));
  const key = await derivePadKey(passphrase, salt);
  const check = encodeBase64url(await encryptBlob(key, new Uint8Array()));
  const proofHash = encodeBase64url(new Uint8Array(await crypto.subtle.digest("SHA-256", text.encode(await padProof(key)))));
  return { salt, check, proofHash };
}

export async function verifyPadKey(key, check) {
  return (await decryptBlob(key, decodeBase64url(check))).length === 0;
}
