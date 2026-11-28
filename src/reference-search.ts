import { noteReferences, type NoteReference } from "./internal-references.ts";
import { searchNote, type SearchMatch, type SearchQuery } from "./note-search.ts";

export interface ReferenceSearchMatch extends SearchMatch {
  reference: boolean;
  visibleOnly: boolean;
  displayName?: string;
}
const LIMIT = 10_000;

/** Raw regex offsets always belong to the actual note. A display-only match
 * navigates to its complete source token and can never be replaced directly.
 * One display-only hit per reference; raw hits take precedence on overlap. */
export function searchReferences(text: string, query: SearchQuery, resolve: (ref: NoteReference) => string) {
  const raw = searchNote(text, query);
  const matches: ReferenceSearchMatch[] = [];
  if (!query.text || raw.error) return { ...raw, matches };
  const refs = text.includes("[[") ? noteReferences(text) : [];
  const covered = new Set<number>();
  let cursor = 0;
  for (const match of raw.matches) {
    while (refs[cursor] && refs[cursor]!.to <= match.from) cursor++;
    let intersects = false;
    for (let i = cursor; i < refs.length; i++) {
      const ref = refs[i]!;
      if (ref.from >= match.to) break;
      if (match.from < ref.to && (match.to > ref.from || (match.from === match.to && match.from > ref.from))) {
        intersects = true; covered.add(i);
      }
    }
    matches.push({ ...match, reference: intersects, visibleOnly: false });
  }
  let limited = raw.limited;
  for (let i = 0; i < refs.length; i++) {
    if (covered.has(i)) continue;
    const ref = refs[i]!, name = resolve(ref);
    const hit = searchNote(name, query).matches[0];
    if (!hit) continue;
    if (matches.length >= LIMIT) { limited = true; break; }
    matches.push({ from: ref.from, to: ref.to, match: hit.match, reference: true, visibleOnly: true, displayName: name });
  }
  matches.sort((a, b) => a.from - b.from || a.to - b.to);
  return { matches, error: false, limited };
}

export function replaceableMatch(match: ReferenceSearchMatch, protect: boolean): boolean {
  return !match.visibleOnly && (!protect || !match.reference);
}
