import { smartLines, inlineFormats } from "./smart-note.ts";

/** A typed, unfinished reference, not a literal example or a completed token. */
export function referenceTrigger(text: string, head: number): number | null {
  if (head < 2 || text.slice(head - 2, head) !== "[[" || text[head - 3] === "[") return null;
  const from = head - 2;
  const line = smartLines(text).find(line => line.from <= from && from <= line.to);
  if (!line || line.kind === "code" || line.kind === "fence") return null;
  const offset = from - line.from;
  let escapes = 0;
  for (let i = offset - 1; i >= 0 && line.text[i] === "\\"; i--) escapes++;
  if (escapes % 2) return null;
  if (inlineFormats(line.text).some(f => f.kind === "inline-code" && f.from <= offset && offset < f.to)) return null;
  // An unmatched backtick run before the trigger is also a code-writing context.
  const runs = [...line.text.slice(0, offset).matchAll(/`+/g)];
  let open = 0;
  for (const run of runs) { if (!open) open = run[0].length; else if (open === run[0].length) open = 0; }
  return open ? null : from;
}

export function referenceQuery(value: string): { filter: "all" | "pages" | "files"; query: string } {
  const prefix = /^(space|file):/i.exec(value);
  return { filter: prefix?.[1]?.toLowerCase() === "space" ? "pages" : prefix ? "files" : "all", query: prefix ? value.slice(prefix[0].length) : value };
}

/** Validate exact captured text before replacing it; positions are resolved by Yjs. */
export function validInsertionRange(text: string, from: number, to: number, original: string): boolean {
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from && to <= text.length && text.slice(from, to) === original;
}
