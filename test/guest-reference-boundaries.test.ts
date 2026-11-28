import { test } from "node:test";
import assert from "node:assert/strict";
import { formatReference, formatGuestFileReference, guestNoteReferences, sanitizeGuestNote, readableGuestNote } from "../src/internal-references.ts";
import { generateKey } from "../frontend/crypto.js";
import { sealGuestSnapshot, openGuestSnapshot } from "../frontend/guest-snapshot.js";
import type { Doc } from "yjs";

const local = "12345678-1234-4123-8123-123456789abc";
const foreign = "12345678-1234-4123-8123-123456789abd";
const blob = "a".repeat(32), missing = "b".repeat(32);
const page = formatReference({ kind: "space", spaceId: foreign, view: "note", label: "Private page", alias: false });
const file = (spaceId = local, blobId = blob, label = "Config | [prod]") => formatReference({ kind: "file", spaceId, blobId, label, alias: true });
const guest = formatGuestFileReference({ blobId: blob, label: "Config | [prod]" });
const allowed = new Set([blob]);

test("public transformation preserves only active local allowed files, not private IDs", () => {
  const original = `# Setup\n${page}\n${file()}\n${file(foreign, blob, "Foreign file")}\n${file(local, missing, "Deleted file")}`;
  const output = sanitizeGuestNote(original, allowed, local);
  assert.equal(output, `# Setup\nPrivate page\n${guest}\nForeign file\nDeleted file`);
  assert.ok(!output.includes(local) && !output.includes(foreign) && !output.includes(missing));
  assert.equal(guestNoteReferences(output).length, 1);
  assert.ok(original.includes(foreign));
});
test("literal private tokens are stripped at public boundary but never activated", () => {
  const note = `\\${file()}\n\`${page}\`\n\`\`\`md\n${file()}\n\`\`\`\n${guest}`;
  const sanitized = sanitizeGuestNote(note, allowed, local);
  assert.equal(sanitized, "\\Config | [prod]\n`Private page`\n```md\nConfig | [prod]\n```\nConfig | [prod]");
  assert.deepEqual(guestNoteReferences(sanitized), []);
});
test("legacy client view strips private tokens and denies guest tokens outside allowlist", () => {
  const note = `${page}\n${file()}\n${guest}\n${formatGuestFileReference({ blobId: missing, label: "Unavailable" })}`;
  assert.equal(sanitizeGuestNote(note, allowed), `Private page\nConfig | [prod]\n${guest}\nUnavailable`);
  assert.equal(sanitizeGuestNote(guest, new Set()), "Config | [prod]");
});
test("guest parser ignores private, escaped, inline-code and fenced tokens", () => {
  const text = `${page}\n\\${guest}\n\`${guest}\`\n~~~\n${guest}\n~~~\n🌍 ${guest}`;
  const refs = guestNoteReferences(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "file");
  assert.equal(refs[0]?.blobId, blob);
  assert.equal(text.slice(refs[0]?.from, refs[0]?.to), guest);
});
test("readable guest export removes guest syntax and leaves other Markdown intact", () => {
  const note = `# Heading\n**Text** ${guest}\n- [x] Done`;
  assert.equal(readableGuestNote(note), "# Heading\n**Text** Config | [prod]\n- [x] Done");
  assert.equal(sanitizeGuestNote(sanitizeGuestNote(note, allowed), allowed), note);
});
test("actual encrypted snapshot is sanitized before encryption, with no mutation of source", async () => {
  const note = `${page}\n${file()}\n${file(local, missing, "Missing")}`;
  const files = [{ blobId: blob, name: "config", size: 12 }, { blobId: missing, name: "missing", size: 1 }];
  // A minimal read-only Doc interface isolates the actual snapshot codec from Yjs installation.
  const doc = { getText: () => ({ toString: () => note }), getArray: () => ({ toArray: () => files }) } as unknown as Doc;
  const key = await generateKey();
  const sealed = await sealGuestSnapshot(key, doc, local, allowed);
  const content = await openGuestSnapshot(key, sealed.ciphertext);
  assert.deepEqual(sealed.fileIds, [blob]);
  assert.deepEqual(content, { note: `Private page\n${guest}\nMissing`, files: [files[0]] });
  assert.ok(!JSON.stringify(content).includes(foreign));
  assert.equal(doc.getText("note").toString(), note);
  assert.equal(files.length, 2);
});
