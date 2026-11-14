/** Append-only storage for opaque Yjs updates and attachment change markers. */
import { mkdirSync, readFileSync, writeFileSync, truncateSync } from "node:fs";
import path from "node:path";
import { isNotFound } from "./errors.ts";

const LENGTH_PREFIX_BYTES = 4;
// Legacy frames have just a length. The high bit flags a timestamped frame.
const TIMESTAMP_FLAG = 0x80000000;
const TIMESTAMP_BYTES = 8;

export interface PadRevision {
  revision: number;
  updatedAt: string | null;
}

export interface UpdateLog {
  updates(): Buffer[];
  append(update: Buffer): PadRevision;
  current(): PadRevision;
}

export function openUpdateLog(padDir: string): UpdateLog {
  mkdirSync(padDir, { recursive: true });
  const file = path.join(padDir, "sync.log");
  const { frames, validBytes, lastUpdate, revision: initialRevision } = readFrames(file);
  let updatedAt = lastUpdate;
  let revision = initialRevision;
  const current = () => ({ revision, updatedAt });
  let offset = validBytes;
  let incompleteWrite = false;

  return {
    current,
    updates() {
      return frames;
    },
    append(update) {
      if (incompleteWrite) {
        try {
          truncateSync(file, offset);
        } catch (error) {
          if (!isNotFound(error) || offset !== 0) throw error;
        }
      }
      const timestamp = Date.now();
      const frame = Buffer.alloc(LENGTH_PREFIX_BYTES + TIMESTAMP_BYTES + update.length);
      frame.writeUInt32BE(TIMESTAMP_FLAG + update.length, 0);
      frame.writeDoubleBE(timestamp, LENGTH_PREFIX_BYTES);
      update.copy(frame, LENGTH_PREFIX_BYTES + TIMESTAMP_BYTES);
      incompleteWrite = true;
      writeFileSync(file, frame, { flag: "a" });
      incompleteWrite = false;
      offset += frame.length;
      if (update.length) frames.push(update);
      revision++;
      updatedAt = new Date(timestamp).toISOString();
      return current();
    },
  };
}

function readFrames(file: string): { frames: Buffer[]; validBytes: number; lastUpdate: string | null; revision: number } {
  let raw: Buffer;
  try {
    raw = readFileSync(file);
  } catch (cause) {
    if (isNotFound(cause)) return { frames: [], validBytes: 0, lastUpdate: null, revision: 0 };
    throw cause;
  }

  const frames: Buffer[] = [];
  let offset = 0;
  let revision = 0;
  let lastUpdate: string | null = null;
  while (offset + LENGTH_PREFIX_BYTES <= raw.length) {
    const header = raw.readUInt32BE(offset);
    const timestamped = header >= TIMESTAMP_FLAG;
    const length = timestamped ? header - TIMESTAMP_FLAG : header;
    const start = offset + LENGTH_PREFIX_BYTES + (timestamped ? TIMESTAMP_BYTES : 0);
    if (start + length > raw.length) break;
    if (timestamped) {
      const date = new Date(raw.readDoubleBE(offset + LENGTH_PREFIX_BYTES));
      if (!Number.isFinite(date.getTime())) break;
      lastUpdate = date.toISOString();
    }
    if (length || !timestamped) frames.push(raw.subarray(start, start + length));
    revision++;
    offset = start + length;
  }
  // Remove a torn tail so subsequent appends remain replayable.
  if (offset < raw.length) truncateSync(file, offset);
  return { frames, validBytes: offset, lastUpdate, revision };
}
