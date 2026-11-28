import { test } from "node:test";
import assert from "node:assert/strict";
import { noteCounts, toolbarOverflow } from "../src/editor-ui.ts";
import { SMART_NOTE_CSS } from "../src/smart-note-styles.ts";
import { PAD_CSS } from "../src/pad-styles.ts";
import { renderPadPage } from "../src/pages.ts";
import { renderGuestPage } from "../src/guest-page.ts";
import { translate } from "../src/translations.ts";

test("status counts include Unicode characters and use original source text", () => {
  assert.deepEqual(noteCounts(""), { words: 0, characters: 0 });
  assert.deepEqual(noteCounts("a  b\n😀"), { words: 3, characters: 6 });
  assert.deepEqual(noteCounts(" \t\n"), { words: 0, characters: 3 });
  assert.deepEqual(noteCounts("# Heading"), { words: 2, characters: 9 });
});
test("toolbar overflow keeps every action reachable and never duplicates IDs", () => {
  const large = toolbarOverflow(600);
  assert.deepEqual(large, ["download-note", "readable-export"]);
  const mobile = toolbarOverflow(320);
  assert.ok(mobile.includes("note-view") && mobile.includes("editor-help"));
  assert.ok(!mobile.includes("find-note") && !mobile.includes("insert-reference"));
  for (const width of [400, 399, 240, 239, 160, 159]) {
    const ids = toolbarOverflow(width);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(large.every(id => ids.includes(id)));
  }
  assert.equal(toolbarOverflow(150).length, 10);
});
test("gutter follows CodeMirror geometry and the shared surface palette", () => {
  assert.doesNotMatch(PAD_CSS, /\.cm-gutter\s*\{[^}]*padding-block/);
  assert.match(SMART_NOTE_CSS, /\.cm-content \{ padding: var\(--editor-padding\) 0/);
  assert.match(SMART_NOTE_CSS, /\.cm-gutters \{ background: var\(--surface, Canvas\)/);
  assert.match(SMART_NOTE_CSS, /\.cm-focused \.cm-activeLineGutter \{ background: var\(--editor-active\)/);
  for (const [level, size] of [[1, "1.4"], [2, "1.25"], [3, "1.15"]]) assert.ok(SMART_NOTE_CSS.includes(`.smart-h${level} { font-size: ${size}em`));
});
test("guest uses shared theme, status bar and copy toast without edit or sync controls", () => {
  const html = renderGuestPage("de", { oneTime: false });
  assert.match(html, /id="guest-status-option" type="checkbox" checked/);
  assert.match(html, /id="guest-status-bar" class="editor-status-bar"/);
  assert.match(html, /id="guest-note-toast" class="editor-toast"/);
  assert.match(html, /localStorage\.getItem\("theme"\)/);
  assert.doesNotMatch(html, /id="sync-status"|id="undo-note"|<span data-metric="cursor"/);
  assert.equal(translate("de", "{count} words", { count: "3" }), "3 Wörter");
});

test("live page has one set of toolbar controls, a separate toast and a default status bar", () => {
  const html = renderPadPage({ spaceId: "12345678-1234-4123-8123-123456789abc", slug: "default", kind: "plain", createdAt: "2026-01-01T00:00:00Z", expiresAt: null }, {
    defaultTtlSeconds: null, maxTtlSeconds: null, instancePinRequired: false, padPath: "/p", language: "de",
  });
  for (const id of ["undo-note", "redo-note", "copy-note", "paste-note", "insert-reference", "find-note", "note-view", "editor-help", "download-note", "readable-export", "sync-status"]) {
    assert.equal(html.match(new RegExp(`id="${id}"`, "g"))?.length, 1, id);
  }
  assert.match(html, /id="note-clipboard-status" class="editor-toast" role="status"/);
  assert.match(html, /id="show-status-bar" checked/);
  assert.match(html, /<div id="note"><\/div>\s*<div id="note-status-bar"/);
  assert.match(html, /id="note-sync-slot"/);
  assert.match(html, /id="files-sync-slot"/);
  assert.match(html, /id="editor-more"/);
  assert.match(html, /id="show-status-bar" checked> Statusleiste anzeigen/);
});
