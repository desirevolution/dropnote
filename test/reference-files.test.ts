import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { createReferenceFiles, replayReferenceFiles, type ReferenceReplay } from "../frontend/reference-files.js";
import { createEncryption, derivePadKey, padProof } from "../frontend/passphrase.js";
import { encryptBlob } from "../frontend/crypto.js";

const spaceId = "aabbccdd-1234-4321-8123-aabbccddeeff";
const blobId = "a".repeat(32);
const entry = { blobId, name: "config.yaml", size: 2, contentType: "text/plain" };
const signal = new AbortController().signal;
function makeUpdate() {
  const doc = new Y.Doc();
  try {
    doc.getArray("attachments").push([entry, { ...entry, blobId: "b".repeat(32) }, { ...entry, name: "duplicate" }]);
    return Y.encodeStateAsUpdate(doc);
  } finally { doc.destroy(); }
}
function envelope(update: Uint8Array): ReferenceReplay {
  return { spaceId, updates: [Buffer.from(update).toString("base64url")], blobIds: [blobId] };
}
test("plain replay filters removed and duplicate attachment metadata", async () => {
  assert.deepEqual((await replayReferenceFiles(envelope(makeUpdate()), null, signal)).map(f => f.name), [entry.name]);
});
test("explicit encrypted reads reuse a key but reauthorize and clear on denial", async () => {
  const password = "correct swan lantern sail";
  const encryption = await createEncryption(password);
  const key = await derivePadKey(password, encryption.salt);
  const proof = await padProof(key);
  const replay = envelope(await encryptBlob(key, makeUpdate()));
  let requests = 0, prompts = 0, allowed = true;
  const request: typeof fetch = async (input, init) => {
    requests++;
    assert.equal(init?.cache, "no-store");
    if (!allowed) return new Response(null, { status: 404 });
    if (String(input).endsWith("/files")) {
      assert.equal(new Headers(init?.headers).get("x-pad-proof"), proof);
      return Response.json(replay);
    }
    return Response.json({ spaceId, slug: "vault", displayName: "Vault", encrypted: true, encryption });
  };
  const access = createReferenceFiles({ request });
  const options = { unlock: async () => { prompts++; return password; } };
  assert.equal((await access.browse(spaceId, options)).files[0]?.name, entry.name);
  assert.equal(access.name(spaceId, blobId), entry.name);
  assert.equal(await access.open(spaceId, blobId, options, async (file, context) => {
    assert.equal(context.spaceId, spaceId);
    assert.equal(context.proof, proof);
    assert.deepEqual(context.key, key);
    return file.name;
  }), entry.name);
  assert.equal(prompts, 1);
  assert.equal(requests, 4);
  allowed = false;
  await assert.rejects(access.browse(spaceId, options), { code: "unavailable" });
  assert.equal(access.name(spaceId, blobId), undefined);
  allowed = true;
  await access.browse(spaceId, options);
  assert.equal(prompts, 2);
  access.clear();
  assert.equal(access.name(spaceId), undefined);
});
test("clear cancels an outstanding request and prevents cache repopulation", async () => {
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  const request: typeof fetch = async (_input, init) => {
    started();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  };
  const access = createReferenceFiles({ request });
  const read = access.browse(spaceId);
  await pending;
  access.clear();
  await assert.rejects(read, { name: "AbortError" });
  assert.equal(access.name(spaceId), undefined);
});
