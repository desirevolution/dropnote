import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGuestPage } from "../src/guest-page.ts";
import { createHash } from "node:crypto";
import { GUEST_CSP, GUEST_FONT_PATH } from "../src/guest-security.ts";

test("guest page offers find and local display options without editor write controls", () => {
  const page = renderGuestPage("de", { oneTime: false });
  assert.match(page, /id="guest-note" role="region"/);
  assert.match(page, /id="guest-find" type="button">Suchen<\/button>/);
  for (const id of ["guest-markdown", "guest-links", "guest-checklists", "guest-references"]) assert.match(page, new RegExp(`id="${id}" type="checkbox" checked`));
  assert.match(page, /id="guest-copy-readable"/);
  assert.match(page, /id="guest-download-readable"/);
  assert.doesNotMatch(page, /id="undo-note"|id="replace-note"|id="paste-note"/);
  assert.doesNotMatch(renderGuestPage("en"), /id="guest-note"|id="guest-find"/);
});


test("guest CSP permits only exact fragment/theme scripts and the local font", () => {
  for (const opening of [{ oneTime: false }, { encryption: { salt: "test", check: "test" }, oneTime: false }, undefined]) {
    const html = renderGuestPage("en", opening);
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      assert.ok(GUEST_CSP.includes(`'sha256-${createHash("sha256").update(match[1]!).digest("base64")}'`));
    }
    assert.ok(html.includes(GUEST_FONT_PATH));
  }
  assert.match(GUEST_CSP, /font-src 'self'/);
  assert.match(GUEST_CSP, /default-src 'none'/);
  assert.match(GUEST_CSP, /frame-ancestors 'none'/);
  assert.doesNotMatch(GUEST_CSP.split(";").find(part => part.trim().startsWith("script-src"))!, /unsafe-inline|unsafe-eval/);
});
