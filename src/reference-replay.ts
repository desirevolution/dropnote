/** A bounded, explicit read of the existing update log; no live room is joined. */
export const MAX_REFERENCE_REPLAY_BYTES = 16 * 1024 * 1024;
export const MAX_REFERENCE_REPLAY_FRAMES = 50_000;
export const MAX_REFERENCE_FILES = 20_000;

export function referenceReplay(updates: readonly Buffer[], blobIds: string[]) {
  if (updates.length > MAX_REFERENCE_REPLAY_FRAMES || blobIds.length > MAX_REFERENCE_FILES) return null;
  let bytes = 0;
  for (const update of updates) {
    bytes += update.length;
    if (bytes > MAX_REFERENCE_REPLAY_BYTES) return null;
  }
  return { updates: updates.filter(update => update.length).map(update => update.toString("base64url")), blobIds };
}
