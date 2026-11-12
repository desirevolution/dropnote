/**
 * Dark/light mode (Story 36): the page CSS follows prefers-color-scheme by
 * default via CSS custom properties, a small toggle button pins one palette
 * and persists the choice in localStorage — no framework, two tiny inline
 * scripts. Also verifies the story's mobile-friendly layout claim: viewport
 * meta on every page and single-column breakpoints for narrow screens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTempDataDir, startServer } from "./helpers/server.ts";

test("every Pad page carries the theme toggle and its persistence wiring", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const created = await fetch(`${server.baseUrl}/api/pads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "team-notes" }),
    });
    assert.equal(created.status, 201, "an additional Pad to inspect exists");
    for (const url of [`${server.baseUrl}/`, `${server.baseUrl}/p/team-notes`]) {
      const body = await (await fetch(url)).text();
      const button = /<button[^>]*id="theme-toggle"[^>]*>/.exec(body)?.[0];
      assert.ok(button, `the theme toggle is on ${url}`);
      assert.match(button, /aria-label="Toggle dark or light mode"/, "the toggle is reachable by assistive tech");
      assert.match(body, /localStorage\.setItem\("theme"/, "clicking the toggle persists the choice");
      assert.match(body, /localStorage\.getItem\("theme"/, "a saved choice is restored before first paint");
    }
  } finally {
    await server.stop();
  }
});

test("the page stylesheet follows prefers-color-scheme with CSS custom properties", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const body = await (await fetch(`${server.baseUrl}/`)).text();
    const style = /<style>([\s\S]*?)<\/style>/.exec(body)?.[1] ?? "";
    assert.match(style, /:root\s*{[^}]*--bg:/, "the palette is defined as custom properties");
    assert.match(style, /@media \(prefers-color-scheme: dark\)/, "the OS preference is followed by default");
    assert.match(style, /:root\[data-theme="dark"\]/, "a saved dark choice pins the dark palette");
    assert.match(style, /:root\[data-theme="light"\]/, "a saved light choice pins the light palette over a dark OS");
    assert.match(style, /\.card, \.access-panel\s*{[^}]*var\(--border\)/, "the palette is actually used, not just declared");
  } finally {
    await server.stop();
  }
});

test("the not-found page follows the same theme without the toggle", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const body = await (await fetch(`${server.baseUrl}/p/no-such-pad`)).text();
    assert.equal((await fetch(`${server.baseUrl}/p/no-such-pad`)).status, 404);
    assert.match(body, /--bg:/, "the not-found page carries the theme palette");
    assert.match(body, /@media \(prefers-color-scheme: dark\)/);
    assert.doesNotMatch(body, /id="theme-toggle"/, "a bare notice page needs no toggle");
  } finally {
    await server.stop();
  }
});

test("the pages degrade sanely to narrow screens (Story 36)", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    for (const url of [`${server.baseUrl}/`, `${server.baseUrl}/p/no-such-pad`]) {
      const body = await (await fetch(url)).text();
      assert.match(body, /<meta name="viewport" content="width=device-width, initial-scale=1">/, `viewport meta on ${url}`);
    }
    const body = await (await fetch(`${server.baseUrl}/`)).text();
    const style = /<style>([\s\S]*?)<\/style>/.exec(body)?.[1] ?? "";
    assert.match(style, /\.workspace-toolbar, \.workspace-tabs,[^{]*\{[^}]*flex-wrap: wrap/, "workspace controls wrap on narrow screens");
    assert.match(style, /#one-time-link\s*{[^}]*min\(40rem, calc\(100vw - 2rem\)\)/, "the disclosure dialog fits narrow viewports");
  } finally {
    await server.stop();
  }
});
