import { sanitizeGuestNote } from "../src/internal-references.ts";
import { decodeBase64url, decryptBlob, encodeBase64url, encryptBlob } from "./crypto.js";

export function listedGuestFiles(files) {
  return files.filter((entry) => entry && typeof entry.name === "string" &&
    typeof entry.blobId === "string" && /^[0-9a-f]{32}$/.test(entry.blobId));
}

export async function sealGuestSnapshot(key, doc, spaceId, availableIds) {
  const files = listedGuestFiles(doc.getArray("attachments").toArray())
    .filter(({ blobId }) => availableIds.has(blobId))
    .map(({ blobId, name, size }) => ({ blobId, name, size }));
  if (typeof spaceId !== "string" || !spaceId) throw new Error("Missing Space identity");
  const note = sanitizeGuestNote(doc.getText("note").toString(), new Set(files.map(file => file.blobId)), spaceId);
  const bytes = new TextEncoder().encode(JSON.stringify({ note, files }));
  const ciphertext = await encryptBlob(key, bytes);
  if (ciphertext.length > 1024 * 1024) throw new Error("The encrypted snapshot is too large.");
  return {
    ciphertext: encodeBase64url(ciphertext),
    fileIds: [...new Set(files.map((file) => file.blobId))],
  };
}

export async function openGuestSnapshot(key, ciphertext) {
  const bytes = await decryptBlob(key, decodeBase64url(ciphertext));
  return JSON.parse(new TextDecoder().decode(bytes));
}
