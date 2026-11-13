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
  const server = await startServer({ dataDir, env: { DROPNOTE_RELEASE_TAG: "v0.1.4" } });
  try {
    const response = await fetch(`${server.baseUrl}/`);
    const body = await response.text();

    assert.match(body, /class="brand" href="https:\/\/github\.com\/desirevolution\/dropnote"/);
    assert.match(body, /<span class="release-version">v0\.1\.4<\/span>/);
    assert.match(body, /<a href="\/" id="home-link"/);
    assert.match(body, /id="owned-spaces-dialog"[\s\S]*?<a href="\/default">Default<\/a>[\s\S]*?id="owned-spaces-list"/);
    assert.doesNotMatch(body, /id="my-pads-dialog"|id="remember-pad"/);
    assert.match(body, /<select id="note-font-size">[\s\S]*?<option value="standard" selected>/);
    assert.match(body, /id="word-wrap" checked>/);
    assert.match(body, /class="workspace-footer">[\s\S]*?id="read-mode">/);
    const viewMenu = /<details id="note-view"[\s\S]*?<\/details>/.exec(body)?.[0] ?? "";
    assert.doesNotMatch(viewMenu, /id="read-mode"/);
    assert.match(body, /IBM Plex Mono/);
    const font = await fetch(`${server.baseUrl}/fonts/IBMPlexMono-Regular.woff2`);
    assert.equal(font.status, 200);
    assert.match(font.headers.get("content-type") ?? "", /font\/woff2/);
    assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString(), "wOF2");
    assert.match(body, /id="line-numbers">/);
    assert.match(body, /id="note-panel"[^>]*>[\s\S]*?<p id="note-clipboard-status" role="status"><\/p>[\s\S]*?<div id="note">/,
      "copy and paste feedback has a shared status line above the editor, outside the toolbar");
    assert.match(body, /id="paste-note" disabled>/);
    assert.match(body, /id="undo-note"[^>]*disabled>/);
    assert.match(body, /id="redo-note"[^>]*disabled>/);
    assert.doesNotMatch(body, /<a[^>]*class="release-version"/);

    assert.match(body, /<button[^>]*id="download-note" disabled>Download text \(.txt\)<\/button>/);
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

test("the page and word lists follow supported browser languages", async (t) => {
  const server = await startServer({ dataDir: await makeTempDataDir() });
  t.after(() => server.stop());

  const german = await fetch(server.baseUrl, { headers: { "Accept-Language": "fr, de-CH;q=0.8, en;q=0.6" } });
  assert.match(german.headers.get("vary") ?? "", /Accept-Language/i);
  const page = await german.text();
  assert.match(page, /<html lang="de">/);
  assert.match(page, /Neue Ablage/);
  assert.match(page, /Zeilennummern/);
  assert.match(page, /Instanzvorgabe \(7 Tage\)/);

  const fallback = await fetch(server.baseUrl, { headers: { "Accept-Language": "fr, de;q=0" } });
  assert.match(await fallback.text(), /<html lang="en">/);

  for (const locale of ["en", "de"]) {
    const response = await fetch(`${server.baseUrl}/api/words/${locale}`);
    assert.equal(response.status, 200);
    const words = (await response.text()).trim().split("\n");
    assert.equal(words.length, 7_776);
    assert.equal(new Set(words).size, 7_776);
  }
  assert.equal((await fetch(`${server.baseUrl}/api/words/fr`)).status, 404);
});
