import { DecryptionError, decodeBase64url, encodeBase64url, decryptBlob, encryptBlob } from "./crypto.js";

// Lowercase letters and digits with common lookalikes removed.
export const passwordCharacters = "abcdefghjkmnpqrtuvwxy346789";
const generatedPasswordGroups = new RegExp(
  `^[${passwordCharacters}]{4}[ \u00a0]+[${passwordCharacters}]{4}[ \u00a0]+[${passwordCharacters}]{4}[ \u00a0]+[${passwordCharacters}]{5}(?![\\s\\S])`,
  "u",
);

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
  return encodeBase64url(await derivePurposeKey(key, "dropnote v1 write proof"));
}

export function presenceKey(key) {
  return derivePurposeKey(key, "dropnote v1 cursor presence");
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

/** Try the literal passphrase before treating spaces as display separators. */
export async function unlockPadKey(passphrase, { salt, check }) {
  async function verify(candidate) {
    const key = await derivePadKey(candidate, salt);
    try {
      return await verifyPadKey(key, check) ? key : null;
    } catch (error) {
      if (error instanceof DecryptionError) return null;
      throw error;
    }
  }

  const key = await verify(passphrase);
  if (key || !generatedPasswordGroups.test(passphrase)) return key;
  return verify(passphrase.replace(/[ \u00a0]/gu, ""));
}
