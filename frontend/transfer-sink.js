/** Transfers above this size spill into an OPFS temp file instead of memory. */
const SPILL_TO_DISK_BYTES = 64 * 1024 * 1024;
/** OPFS directory holding in-flight transfer temp files; stale ones are swept. */
const TEMP_DIRECTORY = "attachment-transfers";
const STALE_TEMP_MS = 24 * 60 * 60 * 1000;
/** How long a saved download's backing file is kept before cleanup. */
export const KEEP_SAVED_MS = 10 * 60 * 1000;

/* --------------------------------------------------------------------- *
 * Transfer sinks: where sealed upload bytes and decrypted download bytes
 * land before they are sent or saved. Big transfers stream through an
 * OPFS temp file (disk-backed), small ones fit an in-memory Blob.
 * --------------------------------------------------------------------- */

/**
 * Opens a sink sized for `estimatedBytes`. Requires OPFS (secure contexts,
 * where Encrypted Pads already live for their WebCrypto); without it the
 * in-memory sink still works, at the cost of holding the transfer whole.
 */
export function createTransferSink(estimatedBytes) {
  if (estimatedBytes > SPILL_TO_DISK_BYTES && navigator.storage?.getDirectory) {
    return opfsSink();
  }
  return memorySink();
}

function memorySink() {
  const parts = [];
  return {
    async write(part) {
      parts.push(part);
    },
    async close() {
      return new Blob(parts);
    },
    async dispose() {},
  };
}

async function opfsSink() {
  const directory = await tempDirectory();
  const handle = await directory.getFileHandle(`transfer-${transferId()}`, { create: true });
  const writable = await handle.createWritable();
  return {
    async write(part) {
      await writable.write(part);
    },
    async close() {
      await writable.close();
      return handle.getFile();
    },
    async dispose() {
      try {
        await writable.abort();
      } catch {
        // already closed: the file was committed, nothing to undo
      }
      try {
        await directory.removeEntry(handle.name);
      } catch {
        // already gone
      }
    },
  };
}

async function tempDirectory() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(TEMP_DIRECTORY, { create: true });
}

/** Removes transfer temp files left behind by a closed tab or a crash. */
export async function sweepStaleTemps() {
  try {
    const directory = await tempDirectory();
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind !== "file") continue;
      const file = await handle.getFile();
      if (Date.now() - file.lastModified > STALE_TEMP_MS) await directory.removeEntry(name);
    }
  } catch {
    // no OPFS: nothing to sweep
  }
}

/** crypto.randomUUID needs a secure context; a LAN deployment may not have one. */
function transferId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

