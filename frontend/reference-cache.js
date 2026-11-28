/** Per-document bounded cache. No storage APIs, timers or background I/O. */
export function createReferenceCache({ maxSpaces = 8, maxFiles = 2000, maxAgeMs = 5 * 60_000, now = Date.now } = {}) {
  const spaces = new Map();
  const remove = id => {
    spaces.get(id)?.key?.fill(0);
    spaces.delete(id);
  };
  const get = id => {
    const entry = spaces.get(id);
    if (!entry) return undefined;
    spaces.delete(id);
    spaces.set(id, entry);
    return entry;
  };
  return {
    key(id, salt) {
      const entry = get(id);
      return entry?.salt === salt ? entry.key?.slice() : undefined;
    },
    name(id, blobId) {
      const entry = get(id);
      if (!entry || now() - entry.at >= maxAgeMs) return undefined;
      return blobId ? entry.files.find(file => file.blobId === blobId)?.name : entry.name;
    },
    put(id, { key, salt, name, files }) {
      const copy = key?.slice();
      remove(id);
      spaces.set(id, { key: copy, salt, name: name?.length <= 512 ? name : undefined, files: files.slice(0, maxFiles).filter(file => file.name.length <= 512).map(({ blobId, name }) => ({ blobId, name })), at: now() });
      while (spaces.size > maxSpaces) remove(spaces.keys().next().value);
    },
    invalidate: remove,
    clear() { for (const id of spaces.keys()) remove(id); },
  };
}
