import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceTrigger, referenceQuery, validInsertionRange } from "../src/reference-insertion.ts";

test("typed reference trigger is limited to actual note text", () => {
  for (const [value, expected] of [["[[", 0], ["hello [[", 6], ["🌍 [[", 3], ["\\[[", null], ["[[[", null], ["`[[", null], ["```md\n[[", null], ["~~~\n[[", null], ["```\nx\n```\n[[", 10]] as const) {
    assert.equal(referenceTrigger(value, value.length), expected, value);
  }
  assert.equal(referenceTrigger("`[[`", 3), null);
  assert.equal(referenceTrigger("[[file:x]]", 10), null);
});
test("picker query prefixes select the requested type", () => {
  assert.deepEqual(referenceQuery("docker"), { filter: "all", query: "docker" });
  assert.deepEqual(referenceQuery("space: Docker"), { filter: "pages", query: " Docker" });
  assert.deepEqual(referenceQuery("FILE:compose"), { filter: "files", query: "compose" });
});
test("insertion never replaces changed or invalid selections", () => {
  assert.equal(validInsertionRange("new original", 4, 12, "original"), true);
  assert.equal(validInsertionRange("new changed!", 4, 12, "original"), false);
  assert.equal(validInsertionRange("hello", 2, 2, ""), true);
  assert.equal(validInsertionRange("hello", 5, 6, ""), false);
  assert.equal(validInsertionRange("hello", 2, 1, ""), false);
});
