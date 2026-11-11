import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { encodeBase64url, type Key } from "../../frontend/crypto.js";
import { createEncryption, derivePadKey, padProof } from "../../frontend/passphrase.js";

export interface CreatedEncryptedPad {
  slug: string;
  /** The keyless Pad path exactly as the server returned it. */
  path: string;
  /** The full, keyless Share Link. */
  shareLink: string;
  encodedKey: string;
  proof: string;
  passphrase: string;
  key: Key;
  status: number;
  response: Record<string, unknown>;
}

export async function createEncryptedPad(
  baseUrl: string,
  options: { slug?: string; ttl?: number | "never"; pin?: string } = {},
): Promise<CreatedEncryptedPad> {
  const passphrase = "correct swan lantern sail";
  const encryption = await createEncryption(passphrase);
  const key = await derivePadKey(passphrase, encryption.salt);
  const proof = await padProof(key);
  const body: Record<string, unknown> = { encrypted: true, encryption, ...options };

  const response = await fetch(`${baseUrl}/api/pads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as Record<string, unknown>;
  const path = result.path as string;
  const shareLink = new URL(path, baseUrl).href;
  return {
    slug: result.slug as string,
    path,
    shareLink,
    encodedKey: encodeBase64url(key),
    proof,
    passphrase,
    key,
    status: response.status,
    response: result,
  };
}

/**
 * Every file under the data directory in which `needle` (UTF-8 text or raw
 * bytes) appears. Empty means: the needle is nowhere on disk.
 */
export async function dataDirContains(dataDir: string, needle: string | Uint8Array): Promise<string[]> {
  const needleBytes = typeof needle === "string" ? Buffer.from(needle, "utf8") : Buffer.from(needle);
  const hits: string[] = [];
  const stack = [dataDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        const content = await readFile(full);
        if (content.includes(needleBytes)) hits.push(full);
      }
    }
  }
  return hits;
}
