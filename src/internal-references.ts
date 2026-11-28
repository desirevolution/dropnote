import { SPACE_ID_PATTERN } from "./space-identity.ts";
import { smartLines } from "./smart-note.ts";

export type ReferenceTarget =
  | { kind: "space"; spaceId: string; view: "note" | "files" }
  | { kind: "file"; spaceId: string; blobId: string };
export type ReferenceValue = ReferenceTarget & { label: string; alias: boolean };
export type NoteReference = ReferenceValue & { from: number; to: number };
const blobPattern = /^[0-9a-f]{32}$/;
const labelLimit = 4096;

/** Escape delimiters, backslashes and line breaks; the source stays one line. */
function encodeLabel(label: string): string {
  if (!label || label.length > labelLimit) throw new Error("Invalid reference label length");
  return label.replace(/[\\|\[\]\r\n]/g, c => c === "\n" ? "\\n" : c === "\r" ? "\\r" : `\\${c}`);
}

export function formatReference(value: ReferenceValue): string {
  if (!SPACE_ID_PATTERN.test(value.spaceId)) throw new Error("Invalid Space ID");
  let target: string;
  if (value.kind === "space") {
    if (value.view !== "note" && value.view !== "files") throw new Error("Invalid Space view");
    target = `space:${value.spaceId}${value.view === "files" ? "?view=files" : ""}`;
  } else {
    if (!blobPattern.test(value.blobId)) throw new Error("Invalid Attachment ID");
    target = `file:${value.spaceId}/${value.blobId}`;
  }
  return `[[${target}|${encodeLabel(value.label)}${value.alias ? "|alias" : ""}]]`;
}

/** Parse a complete canonical token. Unknown escapes and options are not references. */
export function parseReference(token: string): ReferenceValue | null {
  if (!token.startsWith("[[") || !token.endsWith("]]")) return null;
  const body = token.slice(2, -2);
  const separator = body.indexOf("|");
  if (separator < 0 || separator > 100) return null;
  const address = body.slice(0, separator);
  let target: ReferenceTarget;
  if (address.startsWith("space:")) {
    const [spaceId, option, ...extra] = address.slice(6).split("?");
    if (!spaceId || !SPACE_ID_PATTERN.test(spaceId) || extra.length || (option !== undefined && option !== "view=files")) return null;
    target = { kind: "space", spaceId, view: option ? "files" : "note" };
  } else if (address.startsWith("file:")) {
    const [spaceId, blobId, ...extra] = address.slice(5).split("/");
    if (!spaceId || !blobId || extra.length || !SPACE_ID_PATTERN.test(spaceId) || !blobPattern.test(blobId)) return null;
    target = { kind: "file", spaceId, blobId };
  } else return null;
  const value = parseLabel(body.slice(separator + 1));
  return value ? { ...target, ...value } : null;
}

function parseLabel(body: string): { label: string; alias: boolean } | null {
  let label = "", alias = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "|") {
      if (body.slice(i) !== "|alias") return null;
      alias = true;
      break;
    }
    if (c === "\\") {
      const escaped = body[++i];
      if (escaped === "n") label += "\n";
      else if (escaped === "r") label += "\r";
      else if (escaped && "\\|[]".includes(escaped)) label += escaped;
      else return null;
    } else {
      if (c === "[" || c === "]" || c === "\n" || c === "\r") return null;
      label += c;
    }
    if (label.length > labelLimit) return null;
  }
  return label ? { label, alias } : null;
}

/** Guest-only syntax carries no private Space ID. Authorization must still
 * check the blob against the redeemed guest session's allowed file list. */
export interface GuestFileReference { blobId: string; label: string }
export function formatGuestFileReference(value: GuestFileReference): string {
  if (!blobPattern.test(value.blobId)) throw new Error("Invalid Attachment ID");
  return `[[guest-file:${value.blobId}|${encodeLabel(value.label)}]]`;
}
export function parseGuestFileReference(token: string): GuestFileReference | null {
  const match = /^\[\[guest-file:([0-9a-f]{32})\|([\s\S]*)\]\]$/.exec(token);
  if (!match) return null;
  const value = parseLabel(match[2]!);
  return value && !value.alias ? { blobId: match[1]!, label: value.label } : null;
}

/** Source ranges are UTF-16 offsets, as used by CodeMirror and Y.Text. */
function scanReferences<T extends object>(text: string, parse: (token: string) => T | null, literal = false): (T & { from: number; to: number })[] {
  const results: (T & { from: number; to: number })[] = [];
  for (const line of smartLines(text)) {
    if (!literal && (line.kind === "code" || line.kind === "fence")) continue;
    // Same inline-code dialect as Smart Editor. Escape parity is checked below.
    const code = literal ? [] : [...line.text.matchAll(/(`+)([^`]+)\1(?!`)/g)];
    let codeIndex = 0;
    for (let i = 0; i < line.text.length - 1; i++) {
      while (code[codeIndex] && code[codeIndex]!.index! + code[codeIndex]![0].length <= i) codeIndex++;
      const block = code[codeIndex];
      if (block && block.index! <= i) { i = block.index! + block[0].length - 1; continue; }
      if (!line.text.startsWith("[[", i)) continue;
      let slashes = 0;
      for (let j = i - 1; j >= 0 && line.text[j] === "\\"; j--) slashes++;
      if (!literal && slashes % 2) { i++; continue; }
      if (!line.text.startsWith("[[space:", i) && !line.text.startsWith("[[file:", i) && !line.text.startsWith("[[guest-file:", i)) continue;
      // A token cannot span a line or an unescaped nested opening bracket.
      // Bound the scan even for an unfinished token or a very long line.
      const limit = Math.min(line.text.length, i + 2 * labelLimit + 128);
      for (let end = i + 2; end < limit; end++) {
        if (line.text[end] === "\\") { end++; continue; }
        if (line.text[end] === "[") break;
        if (line.text.startsWith("]]", end)) {
          const to = end + 2;
          const value = parse(line.text.slice(i, to));
          if (value) {
            results.push({ ...value, from: line.from + i, to: line.from + to });
            i = to - 1;
          }
          break;
        }
      }
    }
  }
  return results;
}

export function noteReferences(text: string): NoteReference[] {
  return scanReferences(text, parseReference);
}

export type GuestNoteReference = GuestFileReference & { kind: "file"; from: number; to: number };
export function guestNoteReferences(text: string): GuestNoteReference[] {
  return scanReferences(text, token => {
    const value = parseGuestFileReference(token);
    return value && { ...value, kind: "file" as const };
  });
}

type PublicToken = { privateRef: ReferenceValue; guestRef?: never } | { privateRef?: never; guestRef: GuestFileReference };
function publicTokens(text: string) {
  // Public boundary: redact canonical private tokens even in literal code or escaped text.
  return scanReferences<PublicToken>(text, token => {
    const privateRef = parseReference(token);
    if (privateRef) return { privateRef };
    const guestRef = parseGuestFileReference(token);
    return guestRef ? { guestRef } : null;
  }, true);
}

/** At creation, only a real local reference to an included file becomes a guest token.
 * At redemption (no sourceSpaceId), only existing allowed guest tokens survive.
 * The latter also protects the UI when displaying legacy encrypted snapshots. */
export function sanitizeGuestNote(text: string, allowed: ReadonlySet<string>, sourceSpaceId?: string): string {
  const active = new Set((sourceSpaceId ? noteReferences(text) : guestNoteReferences(text)).map(ref => ref.from));
  let result = "", offset = 0;
  for (const token of publicTokens(text)) {
    const ref = token.privateRef;
    const guest = token.guestRef;
    const local = sourceSpaceId && ref?.kind === "file" && ref.spaceId === sourceSpaceId && allowed.has(ref.blobId);
    const permitted = !sourceSpaceId && guest && allowed.has(guest.blobId);
    const label = ref?.label ?? guest!.label;
    result += text.slice(offset, token.from);
    if (active.has(token.from) && local && ref.kind === "file") result += formatGuestFileReference({ blobId: ref.blobId, label });
    else if (active.has(token.from) && permitted) result += formatGuestFileReference(guest);
    else result += label;
    offset = token.to;
  }
  return result + text.slice(offset);
}

/** Readable guest export never emits internal reference syntax for guest files. */
export function readableGuestNote(text: string): string {
  return sanitizeGuestNote(text, new Set());
}

/** A name resolver may only use already available authorized metadata. */
export function referenceLabel(reference: ReferenceValue, currentName?: string | null): string {
  return reference.alias ? reference.label : currentName || reference.label;
}

/** Non-mutating plain text export; other Markdown and literal examples survive. */
export function readableReferences(text: string, resolve?: (ref: NoteReference) => string | null | undefined): string {
  let result = "", offset = 0;
  for (const ref of noteReferences(text)) {
    result += text.slice(offset, ref.from) + referenceLabel(ref, resolve?.(ref));
    offset = ref.to;
  }
  return result + text.slice(offset);
}
