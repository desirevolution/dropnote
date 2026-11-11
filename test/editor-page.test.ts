/**
 * The Default Pad editor: the page offers a plain-text editor beside
 * the file list and serves the local frontend bundle as a static asset. No browser is driven
 * here — the Live-Sync behavior itself is verified by the headless Yjs
 * clients in live-sync.test.ts speaking the same protocol as this frontend.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDataDir, startServer } from "./helpers/server.ts";

test("the Default Pad shows the plain-text editor alongside its files", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const response = await fetch(`${server.baseUrl}/`);
    const body = await response.text();

    assert.match(body, /<div id="note"><\/div>/, "the editor has an empty mount point");
    assert.doesNotMatch(body, /id="preview"/, "the Note has no rendered preview");
    assert.match(body, /<button[^>]*id="choose-files"/, "the file picker has a keyboard-accessible trigger");
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

test("the committed editor bundle matches the frontend sources", async () => {
  const bundleFile = fileURLToPath(new URL("../public/js/editor.bundle.js", import.meta.url));
  assert.ok(existsSync(bundleFile), "the bundle is committed next to its build script");

  const tempDir = await mkdtemp(path.join(existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir(), "bundle-check-"));
  const rebuilt = path.join(tempDir, "editor.bundle.js");
  const frontendEntry = fileURLToPath(new URL("../frontend/editor.js", import.meta.url));
  await build({
    entryPoints: [frontendEntry],
    bundle: true,
    minify: true,
    format: "esm",
    outfile: rebuilt,
  });

  const [committed, fresh] = await Promise.all([readFile(bundleFile), readFile(rebuilt)]);
  assert.deepEqual(committed, fresh, "the committed bundle is up to date; run `npm run build` after frontend changes");
});
