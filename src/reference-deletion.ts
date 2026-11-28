import { noteReferences } from "./internal-references.ts";

/** Counts occurrences in the supplied, already decrypted note only. A Space
 * deletion includes its page, Downloads and all its file targets. */
export function countDeletedReferences(text: string, spaceId: string, blobIds?: ReadonlySet<string>): number {
  if (!text.includes("[[") || !spaceId || blobIds?.size === 0) return 0;
  return noteReferences(text).filter(ref => ref.spaceId === spaceId &&
    (blobIds === undefined || (ref.kind === "file" && blobIds.has(ref.blobId)))).length;
}
