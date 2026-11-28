import * as Y from "yjs";
import { validInsertionRange } from "../src/reference-insertion.ts";

export function captureInsertion(note, from, to) {
  const original = note.toString().slice(from, to);
  return { note, original, start: Y.createRelativePositionFromTypeIndex(note, from, 0),
    end: Y.createRelativePositionFromTypeIndex(note, to, from === to ? 0 : -1) };
}

export function resolveInsertion(anchor, note) {
  if (!anchor || anchor.note !== note || !note.doc) return null;
  const start = Y.createAbsolutePositionFromRelativePosition(anchor.start, note.doc);
  const end = Y.createAbsolutePositionFromRelativePosition(anchor.end, note.doc);
  if (start?.type !== note || end?.type !== note || !validInsertionRange(note.toString(), start.index, end.index, anchor.original)) return null;
  return { from: start.index, to: end.index };
}
