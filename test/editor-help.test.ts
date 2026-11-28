import { test } from "node:test";
import assert from "node:assert/strict";
import { HELP_EXAMPLES, GUEST_FILE_EXAMPLE, helpInsertion, helpTab } from "../src/editor-help.ts";
import { renderEditorHelp } from "../src/editor-help-page.ts";
import { renderGuestPage } from "../src/guest-page.ts";
import { inlineFormats, smartLines } from "../src/smart-note.ts";
import { parseReference, parseGuestFileReference } from "../src/internal-references.ts";

test("help examples agree with the editor's actual inline dialect and reference parser", () => {
  for (const example of HELP_EXAMPLES.markdown) {
    if (example.format) assert.ok(inlineFormats(example.syntax).some(f => f.kind === example.format && f.from === 0 && f.to === example.syntax.length), example.id);
  }
  for (const example of HELP_EXAMPLES.references) assert.ok(parseReference(example.syntax), example.id);
  assert.ok(parseGuestFileReference(GUEST_FILE_EXAMPLE.syntax));
  assert.ok(smartLines(HELP_EXAMPLES.checklists[0]!.syntax)[0]!.task);
  assert.equal(smartLines(HELP_EXAMPLES.checklists[1]!.syntax)[0]!.task?.checked, true);
  assert.equal(helpInsertion("page", "", 0, 0), null, "never insert a dummy ID");
});

test("inline help wraps selection and preserves whitespace and line breaks", () => {
  assert.equal(helpInsertion("bold", "pre abc post", 4, 7), "**abc**");
  const lines = " one \n\ntwo";
  assert.equal(helpInsertion("italic", lines, 0, lines.length), " *one* \n\n*two*");
  assert.equal(helpInsertion("md-link", "Label", 0, 5), "[Label](https://example.org)");
  assert.equal(helpInsertion("bold", "", 0, 0), "**Text**");
});

test("unsupported formatting cannot destroy a selection", () => {
  assert.equal(helpInsertion("url", "secret", 0, 6), null);
  assert.equal(helpInsertion("inline-code", "a`b", 0, 3), null);
  assert.equal(helpInsertion("bold", "a*b", 0, 3), null);
  assert.equal(helpInsertion("md-link", "a]b", 0, 3), null);
  assert.equal(helpInsertion("unknown", "text", 0, 4), null);
});

test("block formatting preserves selected text and isolates block boundaries", () => {
  assert.equal(helpInsertion("h1", "pre title post", 4, 9), "\n# title\n");
  assert.equal(helpInsertion("task", "a\nb\n", 0, 4), "- [ ] a\n- [ ] b\n");
  assert.equal(helpInsertion("ordered", "a\nb", 0, 3), "1. a\n2. b");
  assert.equal(helpInsertion("rule", "abc", 0, 3), "abc\n---");
  const code = "```\nexample\n```";
  const block = helpInsertion("fence", code, 0, code.length)!;
  assert.equal(block, "````\n" + code + "\n````");
  assert.deepEqual(smartLines(block).map(line => line.kind), ["fence", "code", "code", "code", "fence"]);
});

test("help tabs fall back to Markdown and render localized accessible controls", () => {
  assert.equal(helpTab("shortcuts"), "shortcuts");
  assert.equal(helpTab("unknown"), "markdown");
  assert.equal(helpTab(null), "markdown");
  const html = renderEditorHelp("de");
  assert.match(html, /id="editor-help-title">Editor-Hilfe/);
  assert.match(html, /data-help-tab="checklists"[^>]*>Checklisten/);
  assert.match(html, /data-help-copy="bold"[^>]*>Text kopieren/);
  assert.match(html, /data-help-insert="bold"[^>]* hidden>Einfügen/);
  assert.match(html, /&gt; Text/);
  assert.match(html, /data-help-panel="shortcuts" hidden/);
});

test("guest help offers copies but never edit controls or private reference examples", () => {
  const html = renderGuestPage("en", { oneTime: false });
  assert.match(html, /id="guest-help"/);
  assert.match(html, /data-help-copy="guest-file"/);
  assert.match(html, /\[\[guest-file:/);
  assert.doesNotMatch(html, /data-help-insert=|\[\[space:|\[\[file:|Ctrl\/Cmd \+ K|Ctrl\/Cmd \+ H/);
  assert.doesNotMatch(renderGuestPage("en"), /<dialog id="editor-help-dialog"|id="guest-help"/);
});
