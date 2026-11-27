export interface SearchQuery { text: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean }
export interface SearchMatch { from: number; to: number; match: RegExpMatchArray }
export function searchNote(text: string, query: SearchQuery): { matches: SearchMatch[]; error: boolean; limited: boolean } {
  if (!query.text) return { matches: [], error: false, limited: false };
  try {
    let source = query.regex ? query.text : query.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (query.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
    const regex = new RegExp(source, query.caseSensitive ? "gmu" : "gimu");
    const matches: SearchMatch[] = [];
    for (const match of text.matchAll(regex)) {
      if (matches.length === 10000) return { matches, error: false, limited: true };
      matches.push({ from: match.index!, to: match.index! + match[0].length, match });
    }
    return { matches, error: false, limited: false };
  } catch { return { matches: [], error: true, limited: false }; }
}
export function replacementText(text: string, result: SearchMatch, replacement: string, regex: boolean): string {
  if (!regex) return replacement;
  return replacement.replace(/\$(\$|&|`|'|<[^>]+>|\d{1,2})/g, (token, key: string) => {
    if (key === "$") return "$";
    if (key === "&") return result.match[0];
    if (key === "`") return text.slice(0, result.from);
    if (key === "'") return text.slice(result.to);
    if (key.startsWith("<")) return result.match.groups ? result.match.groups[key.slice(1, -1)] ?? "" : token;
    const number = Number(key);
    if (number > 0 && number < result.match.length) return result.match[number] ?? "";
    const first = Number(key[0]);
    if (key.length === 2 && first > 0 && first < result.match.length) return (result.match[first] ?? "") + key[1];
    return token;
  });
}
