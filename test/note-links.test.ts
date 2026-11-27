import { test } from "node:test";
import assert from "node:assert/strict";
import { noteLinks } from "../src/note-links.ts";

function matched(text: string) {
  return noteLinks(text).map(({ from, to, href }) => [text.slice(from, to), href]);
}

test("web URLs have exact plain-text ranges and safe normalized destinations", () => {
  assert.deepEqual(matched("🌍 https://example.com/a?q=1&b=2#x\nwww.example.org http://localhost:8080/"), [
    ["https://example.com/a?q=1&b=2#x", "https://example.com/a?q=1&b=2#x"],
    ["www.example.org", "https://www.example.org/"],
    ["http://localhost:8080/", "http://localhost:8080/"],
  ]);
});

test("surrounding punctuation is not linked, balanced brackets are preserved", () => {
  assert.deepEqual(matched('(https://example.com/a_(b)). [http://[::1]:8080/] "https://example.com",'), [
    ["https://example.com/a_(b)", "https://example.com/a_(b)"],
    ["http://[::1]:8080/", "http://[::1]:8080/"],
    ["https://example.com", "https://example.com/"],
  ]);
});

test("non-web schemes, email fragments and incomplete web URLs are ignored", () => {
  assert.deepEqual(noteLinks("javascript:alert(1) data:text/html,test ftp://www.example.com user@www.example.org https:// http://[ www.. https:///"), []);
});

test("markup is plain text and cannot inject a link attribute", () => {
  assert.deepEqual(matched('<a href="https://example.com" onclick="alert(1)">text</a>'), [
    ["https://example.com", "https://example.com/"],
  ]);
});
