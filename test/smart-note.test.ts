import { test } from "node:test";
import assert from "node:assert/strict";
import { smartLines, inlineFormats, listContinuation, editorPosition } from "../src/smart-note.ts";
import { workspacePositionKey } from "../src/workspace-view.ts";

const formatted = (text: string) => inlineFormats(text).map(f => ({ kind: f.kind, value: text.slice(f.from + f.start, f.to - f.end), ...(f.href ? { href: f.href } : {}) }));

test("Markdown Light identifies heading, quote, rule, bullet and task lines without changing offsets", () => {
  const text = "🌍\n# Heading\n> Quote\n---\n  - item\n- [ ] open\n  * [X] done\n";
  const lines = smartLines(text);
  assert.deepEqual(lines.map(l => l.kind), ["", "h1", "quote", "rule", "", "", "", ""]);
  assert.equal(lines[1]!.prefix, 2);
  assert.equal(lines[4]!.bullet, 2);
  assert.deepEqual(lines[5]!.task, { from: 2, checked: false });
  assert.deepEqual(lines[6]!.task, { from: 4, checked: true });
  for (const line of lines) assert.equal(text.slice(line.from, line.to), line.text);
});

test("fences suppress checklist and heading parsing, copy range excludes delimiters", () => {
  const text = "~~~bash\n# comment\n- [x] literal\nhttps://example.org\n~~~\n- [ ] task";
  const lines = smartLines(text);
  assert.deepEqual(lines.map(l => l.kind), ["fence", "code", "code", "code", "fence", ""]);
  assert.equal(lines[2]!.task, undefined);
  const range = lines[0]!.code!;
  assert.equal(text.slice(range.from, range.to), "# comment\n- [x] literal\nhttps://example.org");
  assert.equal(lines[5]!.task?.checked, false);
});

test("empty and unclosed fences have valid code copy ranges", () => {
  for (const [text, expected] of [["```\n```", ""], ["```", ""], ["````js\n```\nhello", "```\nhello"], ["~~~\na\n", "a\n"]]) {
    const range = smartLines(text!)[0]!.code!;
    assert.ok(range.from <= range.to && range.to <= text!.length);
    assert.equal(text!.slice(range.from, range.to), expected);
  }
});

test("inline formatting and links have exact source ranges; code spans are literal", () => {
  assert.deepEqual(formatted("**bold** *em* ~~old~~ `https://example.org` [docs](https://example.com/a_(b)) mail@example.org"), [
    { kind: "bold", value: "bold" }, { kind: "italic", value: "em" }, { kind: "strike", value: "old" },
    { kind: "inline-code", value: "https://example.org" }, { kind: "md-link", value: "docs", href: "https://example.com/a_(b)" },
    { kind: "link", value: "mail@example.org", href: "mailto:mail@example.org" },
  ]);
});

test("links never navigate to unsafe schemes or interpret images and HTML", () => {
  const formats = inlineFormats("[x](javascript:alert(1)) [y](data:text/html,test) ![image](https://example.org/a.png) <script>alert(1)</script>");
  assert.equal(formats.some(f => f.kind === "md-link"), false);
  assert.deepEqual(formats.filter(f => f.href).map(f => f.href), ["https://example.org/a.png"]);
  assert.deepEqual(formatted("\\*literal* snake_case_word"), []);
});

test("emails with plus signs and web links do not overlap", () => {
  assert.deepEqual(formatted("person+tag@example.org; https://example.org/person@example.org"), [
    { kind: "link", value: "person+tag@example.org", href: "mailto:person%2Btag@example.org" },
    { kind: "link", value: "https://example.org/person@example.org", href: "https://example.org/person@example.org" },
  ]);
});

test("list continuation preserves indentation, advances numbering, and creates unchecked tasks", () => {
  assert.deepEqual(listContinuation("  - [x] done", ""), { insert: "\n  - [ ] ", remove: 0 });
  assert.deepEqual(listContinuation("  9. item", ""), { insert: "\n  10. ", remove: 0 });
  assert.deepEqual(listContinuation("  - ", ""), { insert: "  ", remove: 4 });
  assert.deepEqual(listContinuation("- [ ] ", ""), { insert: "", remove: 6 });
  assert.deepEqual(listContinuation("- first", "second"), { insert: "\n- ", remove: 0 });
  assert.equal(listContinuation("ordinary text", ""), null);
});

test("restored positions are bounded, malformed preferences ignored", () => {
  assert.deepEqual(editorPosition('{"anchor":20,"head":-3,"top":45,"left":-1}', 8), { anchor: 8, head: 0, top: 45, left: 0 });
  for (const value of [null, "invalid", "{}", '{"anchor":"3","head":1,"top":0,"left":0}', '{"anchor":1,"head":1,"top":1e999,"left":0}']) assert.equal(editorPosition(value, 8), null);
  assert.notEqual(workspacePositionKey({ slug: "demo", createdAt: "a" }), workspacePositionKey({ slug: "demo", createdAt: "b" }));
});
