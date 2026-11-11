/** Append-only storage for opaque Yjs updates, framed with a 4-byte length. */
import { mkdirSync, readFileSync, writeFileSync, truncateSync } from "node:fs";
import path from "node:path";
import { isNotFound } from "./errors.ts";

const LENGTH_PREFIX_BYTES = 4;

export interface UpdateLog {
  updates(): Buffer[];
  append(update: Buffer): void;
}

export function openUpdateLog(padDir: string): UpdateLog {
  mkdirSync(padDir, { recursive: true });
  const file = path.join(padDir, "sync.log");
  const { frames, validBytes } = readFrames(file);
  let offset = validBytes;
  let incompleteWrite = false;

  return {
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
      const frame = Buffer.alloc(LENGTH_PREFIX_BYTES + update.length);
      frame.writeUInt32BE(update.length, 0);
      update.copy(frame, LENGTH_PREFIX_BYTES);
      incompleteWrite = true;
      writeFileSync(file, frame, { flag: "a" });
      incompleteWrite = false;
      offset += frame.length;
      frames.push(update);
    },
  };
}

function readFrames(file: string): { frames: Buffer[]; validBytes: number } {
  let raw: Buffer;
  try {
    raw = readFileSync(file);
  } catch (cause) {
    if (isNotFound(cause)) return { frames: [], validBytes: 0 };
    throw cause;
  }

  const frames: Buffer[] = [];
  let offset = 0;
  while (offset + LENGTH_PREFIX_BYTES <= raw.length) {
    const length = raw.readUInt32BE(offset);
    const start = offset + LENGTH_PREFIX_BYTES;
    if (start + length > raw.length) break;
    frames.push(raw.subarray(start, start + length));
    offset = start + length;
  }
  // Remove a torn tail so subsequent appends remain replayable.
  if (offset < raw.length) truncateSync(file, offset);
  return { frames, validBytes: offset };
}
