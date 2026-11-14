import type { Doc } from "yjs";
import type { Key } from "./crypto.js";

export function sealGuestSnapshot(key: Key, doc: Doc): Promise<{ ciphertext: string; fileIds: string[] }>;
export function openGuestSnapshot(key: Key, ciphertext: string): Promise<{
  note: string;
  files: { blobId: string; name: string; size: number }[];
}>;
