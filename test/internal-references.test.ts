import { test } from "node:test";
import assert from "node:assert/strict";
import { formatReference, parseReference, formatGuestFileReference, parseGuestFileReference, noteReferences, readableReferences, referenceLabel, type ReferenceValue } from "../src/internal-references.ts";
const id = "12345678-1234-4123-8123-123456789abc";
const blob = "1234567890abcdef1234567890abcdef";
const space: ReferenceValue = { kind: "space", spaceId: id, view: "note", label: "Docker-Setup", alias: false };
const file: ReferenceValue = { kind: "file", spaceId: id, blobId: blob, label: "compose.yml", alias: false };
const token = formatReference(space);

test("canonical page, Downloads and file references round trip", () => {
  const downloads: ReferenceValue = { ...space, view: "files", alias: true };
  for (const value of [space, downloads, file]) assert.deepEqual(parseReference(formatReference(value)), value);
  assert.equal(token, `[[space:${id}|Docker-Setup]]`);
  assert.equal(formatReference(downloads), `[[space:${id}?view=files|Docker-Setup|alias]]`);
  assert.equal(formatReference(file), `[[file:${id}/${blob}|compose.yml]]`);
});
test("names with delimiters, backslashes, line breaks and Unicode round trip", () => {
  const value = { ...file, label: "🌍 Ä [a] | \\ \n\r |alias", alias: true };
  const encoded = formatReference(value);
  assert.ok(!encoded.includes("\n") && !encoded.includes("\r"));
  assert.deepEqual(parseReference(encoded), value);
  assert.equal(noteReferences(encoded)[0]?.label, value.label);
});
test("malformed IDs, targets, escapes and aliases remain text", () => {
  for (const malformed of [
    "[[space:slug|Name]]", `[[space:${id}?view=other|Name]]`, `[[space:${id}?view=files?x|Name]]`,
    `[[file:${id}/123|Name]]`, `[[file:${id}/${blob}/more|Name]]`, `[[space:${id}|]]`,
    `[[space:${id}|Name|unknown]]`, `[[space:${id}|Name|alias|alias]]`, `[[space:${id}|Name\\q]]`,
    `[[space:${id}|Name[bad]]]`, `[[space:${id}|Name\nmore]]`, `[[space:${id}|Name`,
  ]) {
    assert.equal(parseReference(malformed), null, malformed);
    assert.deepEqual(noteReferences(malformed), [], malformed);
  }
  assert.throws(() => formatReference({ ...space, spaceId: "../private" }));
  assert.throws(() => formatReference({ ...file, blobId: "bad" }));
  assert.throws(() => formatReference({ ...space, label: "" }));
});
test("scanner preserves UTF-16 offsets and finds adjacent references", () => {
  const second = formatReference(file), text = `🌍\n${token}${second}\nend`;
  const refs = noteReferences(text);
  assert.equal(refs.length, 2);
  assert.equal(refs[0]?.from, 3);
  assert.deepEqual(refs.map(r => text.slice(r.from, r.to)), [token, second]);
});
test("escaped references and literal code examples are not interpreted", () => {
  const text = `\\${token}\n\`${token}\`\n\`\`\`md\n${token}\n\`\`\`\n~~~\n${token}\n~~~\n\\\\${token}\n${token}\n\`\`\`\n${token}`;
  const refs = noteReferences(text);
  assert.equal(refs.length, 2);
  assert.equal(refs[0]?.from, text.indexOf(`\\\\${token}`) + 2);
});
test("dynamic names are display-only and aliases take precedence", () => {
  assert.equal(referenceLabel(space, "Renamed"), "Renamed");
  assert.equal(referenceLabel(space, null), space.label);
  assert.equal(referenceLabel({ ...space, alias: true }, "Renamed"), space.label);
  const alias = formatReference({ ...file, label: "Production", alias: true });
  const text = `# Heading\n${token} ${alias}\n\`${token}\``;
  assert.equal(readableReferences(text, () => "New name"), `# Heading\nNew name Production\n\`${token}\``);
  assert.equal(readableReferences(text), `# Heading\nDocker-Setup Production\n\`${token}\``);
});
test("long or malformed tokens do not swallow later valid references", () => {
  const text = `[[space:${id}|${"a".repeat(9000)}]] ${token}`;
  assert.equal(noteReferences(text).length, 1);
  assert.equal(noteReferences(text)[0]?.from, text.lastIndexOf(token));
});


test("guest-local file tokens carry no private Space ID and use a separate parser", () => {
  const value = { blobId: blob, label: "file [a] | 🌍" };
  const encoded = formatGuestFileReference(value);
  assert.deepEqual(parseGuestFileReference(encoded), value);
  assert.equal(parseReference(encoded), null);
  assert.deepEqual(noteReferences(encoded), []);
  assert.equal(parseGuestFileReference(formatReference(file)), null);
  assert.equal(parseGuestFileReference(`[[guest-file:${blob}|file|alias]]`), null);
});
