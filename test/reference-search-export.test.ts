import { test } from "node:test";
import assert from "node:assert/strict";
import { formatReference, referenceLabel, readableReferences, type NoteReference } from "../src/internal-references.ts";
import { searchReferences, replaceableMatch } from "../src/reference-search.ts";
import { replacementText, type SearchQuery } from "../src/note-search.ts";
import { countDeletedReferences } from "../src/reference-deletion.ts";

const spaceId = "12345678-1234-4123-8123-123456789abc";
const otherId = "87654321-1234-4123-8123-123456789abc";
const blobId = "a".repeat(32);
const anotherBlob = "b".repeat(32);
const page = formatReference({ kind: "space", spaceId, view: "note", label: "Old name", alias: false });
const file = formatReference({ kind: "file", spaceId, blobId, label: "compose.yml", alias: false });
const q = (text: string, extra: Partial<SearchQuery> = {}): SearchQuery => ({ text, caseSensitive: false, wholeWord: false, regex: false, ...extra });
const name = (ref: NoteReference) => referenceLabel(ref, "New name");

test("search includes renamed visible names without losing raw offsets", () => {
  const text = `New name 🌍 ${page} New name`;
  const result = searchReferences(text, q("New name"), name);
  assert.equal(result.matches.length, 3);
  assert.deepEqual(result.matches.map(m => m.visibleOnly), [false, true, false]);
  const hit = result.matches[1]!;
  assert.equal(text.slice(hit.from, hit.to), page);
  assert.equal(hit.displayName, "New name");
  assert.equal(replaceableMatch(hit, true), false);
  assert.equal(replaceableMatch(hit, false), false);
});
test("raw and visible name hits in a single reference are not duplicated", () => {
  const result = searchReferences(`Old name ${page}`, q("Old name"), ref => ref.label);
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches.map(m => [m.reference, m.visibleOnly]), [[false, false], [true, false]]);
  assert.equal(replaceableMatch(result.matches[1]!, true), false);
  assert.equal(replaceableMatch(result.matches[1]!, false), true);
});
test("protects reference IDs, delimiters, and a regex crossing token boundaries", () => {
  for (const [pattern, regex] of [[spaceId, false], ["[[", false], ["before.*after", true]] as const) {
    const result = searchReferences(`before ${page} after`, q(pattern, { regex }), name);
    assert.ok(result.matches.length);
    assert.ok(result.matches.every(m => m.reference && !replaceableMatch(m, true) && replaceableMatch(m, false)));
  }
  const text = `before ${page}${file} after`;
  const crossing = searchReferences(text, q("before.*after", { regex: true }), name);
  assert.equal(crossing.matches.length, 1);
  assert.equal(crossing.matches[0]?.reference, true);
});
test("zero-width regex inside a reference is protected; adjacent positions remain editable", () => {
  const result = searchReferences(page, q("(?=.)|$", { regex: true }), ref => ref.label);
  assert.equal(result.matches[0]?.reference, false);
  assert.equal(result.matches.at(-1)?.reference, false);
  assert.ok(result.matches.slice(1, -1).every(m => m.reference));
});
test("regex groups in real text still replace correctly with protected matches skipped", () => {
  const text = `Old name ${page} Old name`;
  const result = searchReferences(text, q("(Old) (name)", { regex: true }), name);
  let output = text;
  for (const hit of result.matches.filter(m => replaceableMatch(m, true)).reverse()) {
    output = output.slice(0, hit.from) + replacementText(text, hit, "$2:$1", true) + output.slice(hit.to);
  }
  assert.equal(output, `name:Old ${page} name:Old`);
});
test("alias, case sensitivity, whole words, escaped labels and code examples", () => {
  const alias = formatReference({ kind: "space", spaceId, view: "note", label: "Alias | Name", alias: true });
  const text = `${alias}\n\`${page}\`\n\`\`\`\n${page}\n\`\`\``;
  assert.equal(searchReferences(text, q("Alias | Name"), name).matches[0]?.visibleOnly, true);
  assert.equal(searchReferences(text, q("New name"), name).matches.length, 0);
  assert.equal(searchReferences(text, q("alias", { wholeWord: true, caseSensitive: true }), name).matches.length, 1); // raw alias flag only
  const examples = searchReferences(text, q("Old name"), name);
  assert.equal(examples.matches.length, 2);
  assert.ok(examples.matches.every(m => replaceableMatch(m, true)));
});
test("global match limit includes visible-only hits and invalid regex is harmless", () => {
  const result = searchReferences(`${"x ".repeat(10_000)}${page}`, q("x|New name", { regex: true }), name);
  assert.equal(result.matches.length, 10_000);
  assert.equal(result.limited, true);
  assert.equal(searchReferences(page, q("[", { regex: true }), name).error, true);
});
test("delete counts use stable IDs, include Downloads and bulk files, and ignore literal examples", () => {
  const other = formatReference({ kind: "file", spaceId: otherId, blobId, label: "compose.yml", alias: false });
  const secondFile = formatReference({ kind: "file", spaceId, blobId: anotherBlob, label: "compose.yml", alias: false });
  const downloads = formatReference({ kind: "space", spaceId, view: "files", label: "Downloads", alias: false });
  const text = `${file} ${file}\n${secondFile}\n${page} ${downloads}\n${other}\n\`${file}\``;
  assert.equal(countDeletedReferences(text, spaceId, new Set([blobId])), 2);
  assert.equal(countDeletedReferences(text, spaceId, new Set([blobId, anotherBlob])), 3);
  assert.equal(countDeletedReferences(text, spaceId), 5);
  assert.equal(countDeletedReferences(text, otherId), 1);
  assert.equal(countDeletedReferences(text, spaceId, new Set()), 0);
});
test("readable export uses aliases, authorized cached names and fallbacks without changing raw text", () => {
  const alias = formatReference({ kind: "file", spaceId, blobId, label: "Config", alias: true });
  const text = `# **Title**\n${page} ${alias} ${file}\n\`${file}\``;
  const output = readableReferences(text, ref => ref.kind === "space" ? "Renamed" : undefined);
  assert.equal(output, `# **Title**\nRenamed Config compose.yml\n\`${file}\``);
  assert.ok(text.includes(page));
});
