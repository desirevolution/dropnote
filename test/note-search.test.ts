import { test } from "node:test";
import assert from "node:assert/strict";
import { searchNote, replacementText, type SearchQuery } from "../src/note-search.ts";
const q = (text: string, extra: Partial<SearchQuery> = {}): SearchQuery => ({ text, caseSensitive: false, wholeWord: false, regex: false, ...extra });

test("literal search treats special characters literally and matches case independently", () => {
  assert.deepEqual(searchNote("a.b A.B axb", q("a.b")).matches.map(m => m.from), [0, 4]);
  assert.deepEqual(searchNote("a.b A.B", q("a.b", { caseSensitive: true })).matches.map(m => m.from), [0]);
});

test("whole words work with Unicode letters and avoid partial identifiers", () => {
  const text = "äpfel äpfelbaum Äpfel _äpfel";
  assert.deepEqual(searchNote(text, q("äpfel", { wholeWord: true })).matches.map(m => text.slice(m.from, m.to)), ["äpfel", "Äpfel"]);
});

test("invalid regular expressions and empty queries are harmless", () => {
  assert.equal(searchNote("abc", q("[", { regex: true })).error, true);
  assert.deepEqual(searchNote("abc", q("")), { matches: [], error: false, limited: false });
});

test("regex groups, named captures, and literal replacement behave as expected", () => {
  const text = "alpha-12 beta-34";
  const result = searchNote(text, q("(?<word>[a-z]+)-(\\d+)", { regex: true }));
  assert.equal(result.matches.length, 2);
  assert.equal(replacementText(text, result.matches[0]!, "$2:$<word>:$$:$&", true), "12:alpha:$:alpha-12");
  assert.equal(replacementText(text, result.matches[0]!, "$2", false), "$2");
  assert.equal(replacementText(text, result.matches[0]!, "$12", true), "alpha2");
});

test("zero-width regex advances and large match sets are explicitly limited", () => {
  assert.deepEqual(searchNote("aaa", q("(?=a)", { regex: true })).matches.map(m => [m.from, m.to]), [[0, 0], [1, 1], [2, 2]]);
  const result = searchNote("a".repeat(10_001), q("a"));
  assert.equal(result.matches.length, 10_000);
  assert.equal(result.limited, true);
});

test("regex line anchors search individual lines", () => {
  assert.deepEqual(searchNote("start\nother\nstart", q("^start$", { regex: true })).matches.map(m => m.from), [0, 12]);
});
