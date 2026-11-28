import { inlineFormats } from "./smart-note.ts";

export const HELP_TABS = ["markdown", "checklists", "references", "shortcuts"] as const;
export type HelpTab = typeof HELP_TABS[number];
export function helpTab(value: string | null): HelpTab {
  return HELP_TABS.find(tab => tab === value) ?? "markdown";
}

type Example = { id: string; title: string; syntax: string; preview: string; kind: "inline" | "line" | "fence" | "rule" | "reference" | "literal"; marker?: string; format?: string };
// The preview markup is static application code, never note content or external HTML.
export const HELP_EXAMPLES: Record<Exclude<HelpTab, "shortcuts">, readonly Example[]> = {
  markdown: [
    { id: "h1", title: "Heading 1", syntax: "# Heading", preview: '<strong class="help-h1">Heading</strong>', kind: "line", marker: "# " },
    { id: "h2", title: "Heading 2", syntax: "## Heading", preview: '<strong class="help-h2">Heading</strong>', kind: "line", marker: "## " },
    { id: "bold", title: "Bold", syntax: "**Text**", preview: "<strong>Text</strong>", kind: "inline", marker: "**", format: "bold" },
    { id: "italic", title: "Italic", syntax: "*Text*", preview: "<em>Text</em>", kind: "inline", marker: "*", format: "italic" },
    { id: "bold-italic", title: "Bold and italic", syntax: "***Text***", preview: "<strong><em>Text</em></strong>", kind: "inline", marker: "***", format: "bold-italic" },
    { id: "strike", title: "Strikethrough", syntax: "~~Text~~", preview: "<s>Text</s>", kind: "inline", marker: "~~", format: "strike" },
    { id: "inline-code", title: "Inline code", syntax: "`docker ps`", preview: '<code class="help-code">docker ps</code>', kind: "inline", marker: "`", format: "inline-code" },
    { id: "quote", title: "Quote", syntax: "> Text", preview: '<div class="help-quote">Text</div>', kind: "line", marker: "> " },
    { id: "bullet", title: "Bullet list", syntax: "- First\n- Second", preview: "• First<br>• Second", kind: "line", marker: "- " },
    { id: "ordered", title: "Numbered list", syntax: "1. First\n2. Second", preview: "1. First<br>2. Second", kind: "line", marker: "1. " },
    { id: "fence", title: "Code block", syntax: "```sh\ndocker ps\n```", preview: '<pre class="help-code">sh<br>docker ps</pre>', kind: "fence" },
    { id: "rule", title: "Horizontal rule", syntax: "---", preview: "<hr>", kind: "rule" },
    { id: "md-link", title: "Markdown link", syntax: "[Text](https://example.org)", preview: '<span class="help-link">Text</span>', kind: "inline", marker: "[", format: "md-link" },
    { id: "url", title: "URL", syntax: "https://example.org", preview: '<span class="help-link">https://example.org</span>', kind: "literal" },
    { id: "email", title: "Email address", syntax: "mail@example.org", preview: '<span class="help-link">mail@example.org</span>', kind: "literal" },
  ],
  checklists: [
    { id: "task", title: "Open task", syntax: "- [ ] Task", preview: '<span aria-hidden="true">☐</span> Task', kind: "line", marker: "- [ ] " },
    { id: "done", title: "Completed task", syntax: "- [x] Task", preview: '<span aria-hidden="true">☑</span> <s>Task</s>', kind: "line", marker: "- [x] " },
  ],
  references: [
    { id: "page", title: "Page reference", syntax: "[[space:00000000-0000-4000-8000-000000000001|Page]]", preview: '<span class="help-ref">▤ Page</span>', kind: "reference" },
    { id: "downloads", title: "Downloads reference", syntax: "[[space:00000000-0000-4000-8000-000000000001?view=files|Page]]", preview: '<span class="help-ref">▤ Page</span>', kind: "reference" },
    { id: "file", title: "File reference", syntax: "[[file:00000000-0000-4000-8000-000000000001/00000000000000000000000000000001|file.txt]]", preview: '<span class="help-ref">📎 file.txt</span>', kind: "reference" },
    { id: "alias", title: "Reference with alias", syntax: "[[space:00000000-0000-4000-8000-000000000001|My label|alias]]", preview: '<span class="help-ref">▤ My label</span>', kind: "reference" },
  ],
};
export const GUEST_FILE_EXAMPLE: Example = { id: "guest-file", title: "Shared file reference", syntax: "[[guest-file:00000000000000000000000000000001|file.txt]]", preview: '<span class="help-ref">📎 file.txt</span>', kind: "reference" };
export function helpExample(id: string): Example | undefined {
  if (id === GUEST_FILE_EXAMPLE.id) return GUEST_FILE_EXAMPLE;
  return Object.values(HELP_EXAMPLES).flat().find(example => example.id === id);
}

/** Compute only after resolving the relative insertion range. Never discard selected text. */
export function helpInsertion(id: string, text: string, from: number, to: number): string | null {
  const example = helpExample(id);
  if (!example || example.kind === "reference" || from < 0 || to < from || to > text.length) return null;
  const selected = text.slice(from, to);
  if (example.kind === "literal") return selected ? null : example.syntax;
  if (example.kind === "inline") {
    if (!selected) return example.syntax;
    const result = selected.split("\n").map(line => {
      if (!line.trim()) return line;
      const [, left, core, right] = /^(\s*)(.*?)(\s*)$/.exec(line)!;
      let wrapped: string;
      if (id === "md-link") wrapped = `[${core}](https://example.org)`;
      else if (id === "inline-code") {
        // The current dialect does not support embedded backticks in inline code.
        if (core!.includes("`")) return null;
        wrapped = "`" + core + "`";
      } else wrapped = example.marker + core! + example.marker;
      if (!inlineFormats(wrapped).some(f => f.kind === example.format && f.from === 0 && f.to === wrapped.length)) return null;
      return left + wrapped + right;
    });
    return result.some(line => line === null) ? null : result.join("\n");
  }
  let value = example.syntax;
  if (selected) {
    if (example.kind === "line") {
      const finalNewline = selected.endsWith("\n");
      const lines = (finalNewline ? selected.slice(0, -1) : selected).split("\n");
      value = lines.map((line, i) => line.trim() ? (id === "ordered" ? `${i + 1}. ` : example.marker) + line : line).join("\n") + (finalNewline ? "\n" : "");
    } else if (example.kind === "fence") {
      let width = 3;
      for (const match of selected.matchAll(/`+/g)) width = Math.max(width, match[0].length + 1);
      const fence = "`".repeat(width);
      value = `${fence}\n${selected}${selected.endsWith("\n") ? "" : "\n"}${fence}`;
    } else value = `${selected}${selected.endsWith("\n") ? "" : "\n"}---`;
  }
  return (from && text[from - 1] !== "\n" ? "\n" : "") + value + (to < text.length && text[to] !== "\n" && !value.endsWith("\n") ? "\n" : "");
}
