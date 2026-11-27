export interface NoteLink {
  from: number;
  to: number;
  href: string;
}

/** Find plain-text web URLs without turning the note into HTML or Markdown. */
export function noteLinks(text: string): NoteLink[] {
  const links: NoteLink[] = [];
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'`]+/gi)) {
    const from = match.index;
    if (from > 0 && /[\p{L}\p{N}_@./:-]/u.test(text[from - 1]!)) continue;
    let value = match[0];
    // Keep balanced brackets in URL paths (e.g. Wikipedia article names).
    const balance: Record<string, number> = { ")": 0, "]": 0, "}": 0 };
    for (const char of value) {
      if (char === "(") balance[")"]!++;
      else if (char === "[") balance["]"]!++;
      else if (char === "{") balance["}"]!++;
      else if (Object.hasOwn(balance, char)) balance[char]!--;
    }
    while (value.length) {
      const last = value.at(-1)!;
      if (/[.,;:!?…]/u.test(last)) value = value.slice(0, -1);
      else if (Object.hasOwn(balance, last) && balance[last]! < 0) {
        balance[last]!++;
        value = value.slice(0, -1);
      } else break;
    }
    if (!/^(?:https?:\/\/|www\.)[^/\\]/i.test(value)) continue;
    try {
      const url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
      if (!url.hostname || !["http:", "https:"].includes(url.protocol)) continue;
      links.push({ from, to: from + value.length, href: url.href });
    } catch {
      // Incomplete URLs being typed are not links yet.
    }
  }
  return links;
}
