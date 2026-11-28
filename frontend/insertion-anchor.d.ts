import type * as Y from "yjs";
export interface InsertionAnchor {
  note: Y.Text;
  original: string;
  start: Y.RelativePosition;
  end: Y.RelativePosition;
}
export function captureInsertion(note: Y.Text, from: number, to: number): InsertionAnchor;
export function resolveInsertion(anchor: InsertionAnchor, note: Y.Text): { from: number; to: number } | null;
