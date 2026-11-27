import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGuestPage } from "../src/guest-page.ts";

test("guest page offers find and local display options without editor write controls", () => {
  const page = renderGuestPage("de", { oneTime: false });
  assert.match(page, /id="guest-note" role="region"/);
  assert.match(page, /id="guest-find" type="button">Suchen<\/button>/);
  for (const id of ["guest-markdown", "guest-links", "guest-checklists"]) assert.match(page, new RegExp(`id="${id}" type="checkbox" checked`));
  assert.doesNotMatch(page, /id="undo-note"|id="replace-note"|id="paste-note"/);
  assert.doesNotMatch(renderGuestPage("en"), /id="guest-note"|id="guest-find"/);
});
