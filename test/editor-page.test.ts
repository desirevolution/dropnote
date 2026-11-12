/**
 * The Default Pad editor: the page offers a plain-text editor beside
 * the file list and serves the local frontend bundle as a static asset. No browser is driven
 * here — the Live-Sync behavior itself is verified by the headless Yjs
 * clients in live-sync.test.ts speaking the same protocol as this frontend.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTempDataDir, startServer } from "./helpers/server.ts";

test("the Default Pad shows the plain-text editor alongside its files", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const response = await fetch(`${server.baseUrl}/`);
    const body = await response.text();

    assert.match(body, /<div id="note"><\/div>/, "the editor has an empty mount point");
    assert.match(body, /role="tablist"/, "note and files have a shared tab list");
    assert.match(body, /id="note-tab"[^>]*role="tab"[^>]*aria-controls="note-panel"/);
    assert.match(body, /id="files-tab"[^>]*role="tab"[^>]*aria-controls="files-card"/);
    assert.match(body, /id="attachment-uploads"[\s\S]*id="note-panel"[^>]*role="tabpanel"[\s\S]*id="files-card"[^>]*role="tabpanel"/,
      "transfer progress is outside both panels");
    assert.doesNotMatch(body, /id="full-width"/, "the note tab already uses the available width");
    assert.doesNotMatch(body, /id="preview"/, "the Note has no rendered preview");
    assert.match(body, /<button[^>]*id="choose-files"/, "the note has a keyboard-accessible file picker");
    assert.match(body, /<button[^>]*id="file-drop"[^>]*disabled[\s\S]*?Choose files[\s\S]*?<\/button>/,
      "the file drop zone is a keyboard-accessible file picker when uploads are enabled");
    assert.match(body, /<p[^>]*id="sync-error"[^>]*role="alert"/, "sync errors are announced separately from the editor");
    assert.match(body, /<input[^>]*type="file"[^>]*id="attachment-input"/, "a file input offers Attachment uploads");
    assert.match(body, /<ul[^>]*id="attachments"/, "a flat attachment list renders the Pad's Attachments");
    assert.match(body, /<script[^>]*src="\/js\/editor\.bundle\.js"/, "the page loads the bundled editor");
    assert.doesNotMatch(body, /https?:\/\/[^"']*\.js/, "no frontend asset is loaded from a foreign origin");
  } finally {
    await server.stop();
  }
});

test("the bundled editor frontend is served as a static asset", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const response = await fetch(`${server.baseUrl}/js/editor.bundle.js`);
    assert.equal(response.status, 200, "the bundle exists and is served");
    assert.match(response.headers.get("content-type") ?? "", /javascript/, "served as JavaScript");
    const body = await response.text();
    assert.ok(body.length > 1_000, "the bundle carries the Yjs editor code, not a stub");
  } finally {
    await server.stop();
  }
});
