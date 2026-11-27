import { noteLinks, type NoteLink } from "./note-links.ts";

export interface InlineFormat { from: number; to: number; start: number; end: number; kind: string; href?: string }
export interface SmartLine { from: number; to: number; text: string; kind: string; prefix: number; bullet?: number; task?: { from: number; checked: boolean }; code?: { from: number; to: number }; }

/** A deliberately small Markdown dialect; no HTML, images or external resources. */
export function smartLines(text: string): SmartLine[] {
  const lines: SmartLine[] = [];
  let offset = 0;
  let fence: { marker: string; line: SmartLine } | undefined;
  for (const value of text.split("\n")) {
    const line: SmartLine = { from: offset, to: offset + value.length, text: value, kind: "", prefix: 0 };
    offset += value.length + 1;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
    if (fence) {
      if (marker && marker[1]![0] === fence.marker[0] && marker[1]!.length >= fence.marker.length && !marker[2]!.trim()) {
        line.kind = "fence";
        fence.line.code = { from: fence.line.to + 1, to: Math.max(fence.line.to + 1, line.from - 1) };
        fence = undefined;
      } else line.kind = "code";
    } else if (marker && !(marker[1]![0] === "`" && marker[2]!.includes("`"))) {
      line.kind = "fence";
      fence = { marker: marker[1]!, line };
    } else {
      const task = /^(\s*[-+*]\s+)\[([ xX])\](?:\s|$)/.exec(value);
      if (task) line.task = { from: task[1]!.length, checked: task[2]!.toLowerCase() === "x" };
      const heading = /^( {0,3}#{1,6})[ \t]+/.exec(value);
      const quote = /^ {0,3}> ?/.exec(value);
      if (heading) { line.kind = `h${heading[1]!.trim().length}`; line.prefix = heading[0].length; }
      else if (quote) { line.kind = "quote"; line.prefix = quote[0].length; }
      else if (/^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(value)) line.kind = "rule";
      else if (!line.task) {
        const bullet = /^(\s*)[-+*][ \t]+/.exec(value);
        if (bullet) line.bullet = bullet[1]!.length;
      }
    }
    lines.push(line);
  }
  if (fence) fence.line.code = { from: Math.min(text.length, fence.line.to + 1), to: text.length };
  return lines;
}

function escaped(text: string, offset: number): boolean {
  let n = 0;
  while (offset > 0 && text[--offset] === "\\") n++;
  return n % 2 === 1;
}

function safeDestination(value: string): string | undefined {
  if (/^mailto:[\w.+%-]+@[\w.-]+\.[a-z]{2,}$/i.test(value)) return value;
  const link = noteLinks(value)[0];
  // Markdown destinations can end in punctuation; validate directly, not via prose trimming.
  if (link?.from === 0 || /^(https?:\/\/|www\.)/i.test(value)) {
    try {
      const url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
      if (["https:", "http:"].includes(url.protocol) && url.hostname) return url.href;
    } catch { /* incomplete destination */ }
  }
}

export function inlineFormats(text: string): InlineFormat[] {
  const formats: InlineFormat[] = [];
  const add = (pattern: RegExp, kind: string, make: (m: RegExpMatchArray) => { start: number; end: number; href?: string } | undefined) => {
    for (const m of text.matchAll(pattern)) {
      const from = m.index!, to = from + m[0].length;
      if (escaped(text, from) || formats.some(f => f.from < to && f.to > from)) continue;
      const data = make(m);
      if (data) formats.push({ from, to, kind, ...data });
    }
  };
  add(/(`+)([^`]+)\1(?!`)/g, "inline-code", m => ({ start: m[1]!.length, end: m[1]!.length }));
  add(/(?<!!)\[([^\]\n]+)\]\(((?:[^\s()]|\([^\s()]*\))+?)\)/g, "md-link", m => {
    const href = safeDestination(m[2]!);
    return href ? { start: 1, end: m[0].length - 1 - m[1]!.length, href } : undefined;
  });
  // Link recognition precedes emphasis so underscores in URLs aren't Markdown.
  const links: NoteLink[] = noteLinks(text);
  for (const m of text.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}/gi)) {
    const from = m.index!, to = from + m[0].length;
    if (from && /[\w@/]/.test(text[from - 1]!)) continue;
    if (text[to] && /[\w@-]/.test(text[to]!)) continue;
    links.push({ from, to, href: `mailto:${encodeURIComponent(m[0]).replace(/%40/g, "@")}` });
  }
  for (const link of links) {
    if (!formats.some(f => f.from < link.to && f.to > link.from)) formats.push({ ...link, kind: "link", start: 0, end: 0 });
  }
  for (const [pattern, kind, width] of [
    [/\*\*\*([^*\n]+)\*\*\*/g, "bold-italic", 3], [/\*\*([^*\n]+)\*\*/g, "bold", 2],
    [/(?<!\w)__([^_\n]+)__(?!\w)/g, "bold", 2], [/~~([^~\n]+)~~/g, "strike", 2],
    [/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "italic", 1], [/(?<!\w)_([^_\n]+)_(?!\w)/g, "italic", 1],
  ] as const) add(pattern, kind, m => m[1]!.trim() === m[1] ? { start: width, end: width } : undefined);
  return formats.sort((a, b) => a.from - b.from);
}

export function listContinuation(before: string, after: string): { insert: string; remove: number } | null {
  const match = /^(\s*)([-+*]|\d+[.)])([ \t]+)(?:\[([ xX])\]([ \t]*))?(.*)$/.exec(before);
  if (!match) return null;
  const [, indent, marker, space, task, taskSpace, content] = match;
  if (!content!.trim() && !after.trim()) return { insert: indent!, remove: before.length };
  // An ordered list continues its numbering; task entries always start unchecked.
  const next = /^\d/.test(marker!) ? `${BigInt(marker!.slice(0, -1)) + 1n}${marker!.at(-1)}` : marker;
  return { insert: `\n${indent}${next}${space}${task !== undefined ? `[ ]${taskSpace || " "}` : ""}`, remove: 0 };
}

export interface EditorPosition { anchor: number; head: number; top: number; left: number }
export function editorPosition(raw: string | null, length: number): EditorPosition | null {
  try {
    const p = JSON.parse(raw ?? "null");
    if (!p || ![p.anchor, p.head, p.top, p.left].every(n => typeof n === "number" && Number.isFinite(n))) return null;
    const clamp = (n: number) => Math.min(length, Math.max(0, Math.trunc(n)));
    return { anchor: clamp(p.anchor), head: clamp(p.head), top: Math.max(0, p.top), left: Math.max(0, p.left) };
  } catch { return null; }
}
