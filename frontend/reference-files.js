import * as Y from "yjs";
import { spaceLabel } from "../src/space-label.ts";
import { SPACE_ID_PATTERN } from "../src/space-identity.ts";
import { decodeBase64url, decryptBlob } from "./crypto.js";
import { unlockPadKey, padProof } from "./passphrase.js";
import { createReferenceCache } from "./reference-cache.js";

const blobPattern = /^[0-9a-f]{32}$/;
const base = id => `/api/space-references/${encodeURIComponent(id)}`;

export class ReferenceAccessError extends Error {
  constructor(code, message) { super(message); this.name = "ReferenceAccessError"; this.code = code; }
}

/** No retained Y.Doc, sockets, passphrases or persistent metadata. */
export async function replayReferenceFiles(replay, key, signal) {
  const doc = new Y.Doc();
  try {
    let count = 0;
    for (const frame of replay.updates) {
      signal.throwIfAborted();
      const bytes = decodeBase64url(frame);
      Y.applyUpdate(doc, key ? await decryptBlob(key, bytes) : bytes);
      // Let the UI process cancellation during long plain replays.
      if (++count % 128 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    const available = new Set(replay.blobIds);
    const seen = new Set();
    const entries = [];
    for (const file of doc.getArray("attachments").toArray()) {
      if (!file || !blobPattern.test(file.blobId) || !available.has(file.blobId) || seen.has(file.blobId) ||
          typeof file.name !== "string" || !Number.isSafeInteger(file.size) || file.size < 0) continue;
      seen.add(file.blobId);
      entries.push({ blobId: file.blobId, name: file.name, size: file.size,
        contentType: typeof file.contentType === "string" ? file.contentType : "", addedAt: file.addedAt });
    }
    return entries;
  } finally { doc.destroy(); }
}

/** Every explicit browse/open reauthorizes; the cache is only for key reuse and labels. */
export function createReferenceFiles({ request = globalThis.fetch, cache = createReferenceCache(), replayFiles = replayReferenceFiles } = {}) {
  let lifetime = new AbortController();
  const combined = signal => signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
  async function json(url, signal, proof) {
    const response = await request(url, { signal, cache: "no-store", credentials: "same-origin", redirect: "error",
      headers: proof ? { "x-pad-proof": proof } : {} });
    if (!response.ok) throw new ReferenceAccessError(response.status === 404 ? "unavailable" : response.status === 403 ? "denied" : response.status === 413 ? "too-large" : "request-failed", response.status === 413 ? "Reference data is too large. Open the space directly." : "Reference data is unavailable");
    return response.json();
  }
  async function access(id, { signal: external, unlock } = {}, use) {
    if (!SPACE_ID_PATTERN.test(id)) throw new ReferenceAccessError("unavailable", "Invalid reference identity");
    const signal = combined(external);
    let key;
    try {
      signal.throwIfAborted();
      const target = await json(base(id), signal);
      signal.throwIfAborted();
      if (target.spaceId !== id || typeof target.slug !== "string") throw new ReferenceAccessError("unavailable", "Reference identity mismatch");
      if (target.encrypted) {
        if (!target.encryption?.salt || !target.encryption?.check) throw new ReferenceAccessError("unavailable", "Invalid encryption parameters");
        key = cache.key(id, target.encryption.salt);
        if (!key) {
          if (!unlock) throw new ReferenceAccessError("locked", "Unlock the encrypted Pad first");
          const passphrase = await unlock(target, signal);
          signal.throwIfAborted();
          if (passphrase == null) throw new DOMException("Unlock cancelled", "AbortError");
          key = await unlockPadKey(passphrase, target.encryption);
          if (!key) throw new ReferenceAccessError("wrong-password", "The passphrase could not unlock this space.");
        }
      }
      signal.throwIfAborted();
      const proof = key ? await padProof(key) : undefined;
      signal.throwIfAborted();
      const replay = await json(`${base(id)}/files`, signal, proof);
      if (replay.spaceId !== id) throw new ReferenceAccessError("unavailable", "Reference identity mismatch");
      const files = await replayFiles(replay, key, signal);
      signal.throwIfAborted();
      cache.put(id, { key, salt: target.encryption?.salt, name: spaceLabel(target.slug, target.displayName), files });
      return await use({ target, files, key, proof, signal });
    } catch (error) {
      // A stale/denied target must never remain a source of cached names or keys.
      if (!signal.aborted) cache.invalidate(id);
      throw error;
    } finally { key?.fill(0); }
  }
  return {
    browse(id, options) { return access(id, options, ({ target, files }) => ({ target, files })); },
    open(id, blobId, options, transfer) {
      return access(id, options, async ({ target, files, key, proof, signal }) => {
        const file = files.find(item => item.blobId === blobId);
        if (!file) throw new ReferenceAccessError("unavailable", "The referenced file is no longer available.");
        // The transfer endpoint checks live ACL, proof, Space ID and blob ID again.
        return transfer(file, { slug: target.slug, spaceId: id, key, proof, signal });
      });
    },
    name: cache.name,
    invalidate(id) { lifetime.abort(); lifetime = new AbortController(); cache.invalidate(id); },
    clear() { lifetime.abort(); lifetime = new AbortController(); cache.clear(); },
  };
}
