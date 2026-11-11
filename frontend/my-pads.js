/** Browser-local list of pad addresses and display metadata. */
export const STORAGE_KEY = "share-tool:my-pads";

export function listMyPads(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry) =>
      entry &&
      typeof entry.slug === "string" &&
      typeof entry.url === "string" &&
      (entry.encrypted === undefined || typeof entry.encrypted === "boolean"),
  );
}

/** Adds one entry (deduplicated by Share Link); returns the new list. */
export function addMyPad(storage, entry) {
  const pads = listMyPads(storage);
  const index = pads.findIndex((pad) => pad.url === entry.url);
  const next = [...pads];
  if (index === -1) next.push({ ...entry });
  else {
    const previous = pads[index];
    next[index] = previous.createdHere && previous.createdAt === entry.createdAt
      ? { ...entry, createdHere: true }
      : { ...entry };
  }
  writeList(storage, next);
  return next;
}

/** Removes the entry with the given Share Link; returns the new list. */
export function removeMyPad(storage, url, createdAt) {
  const next = listMyPads(storage).filter((pad) =>
    pad.url !== url || (createdAt !== undefined && pad.createdAt !== createdAt));
  writeList(storage, next);
  return next;
}

/** Clears bookmarks while keeping spaces created here and the selected start page. */
export function clearMyPads(storage, keepUrl) {
  const next = listMyPads(storage).filter((pad) => pad.createdHere || pad.url === keepUrl);
  writeList(storage, next);
  return next;
}

function writeList(storage, pads) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(pads));
  } catch {
    // Storage may be unavailable (private mode, quota) — the Pad still
    // opens; it is just not remembered locally.
  }
}
