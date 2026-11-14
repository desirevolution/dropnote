/**
 * Encrypted Pads (ticket 07, ADR-0001 + ADR-0002): the browser generates
 * the Key, encrypts everything before first contact, and the server stores
 * and relays ciphertext only (Zero-Knowledge). Everything is driven
 * black-box over the real server (seam 1) with headless Yjs clients
 * speaking the same wrapped protocol as the frontend bundle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { makeTempDataDir, startServer } from "./helpers/server.ts";
import { SyncClient, waitFor } from "./helpers/sync-client.ts";
import { createEncryptedPad, dataDirContains } from "./helpers/encrypted-pad.ts";
import { decryptBlob } from "../frontend/crypto.js";
import { createUpdateCodec } from "../frontend/encrypted-sync.js";

/** A passive WebSocket in the Pad's room that records the raw relayed bytes. */
async function eavesdropOn(server: { syncUrl(slug: string): string }, slug: string, proof: string): Promise<{ frames(): Buffer[]; close(): Promise<void> }> {
  const socket = new WebSocket(server.syncUrl(slug), ["dropnote", `proof.${proof}`]);
  const wire: Buffer[] = [];
  socket.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) wire.push(Buffer.from(data));
  });
  await new Promise<void>((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  return {
    frames: () => wire,
    close: () =>
      new Promise<void>((resolve) => {
        socket.close();
        socket.on("close", () => resolve());
      }),
  };
}

test("creating an Encrypted Pad: the Key is born in the client and never reaches the server", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const pad = await createEncryptedPad(server.baseUrl, { slug: "vault-talk" });
    assert.equal(pad.status, 201, "creation succeeds");
    assert.equal(pad.response.encrypted, true, "the server marks the Pad as encrypted");

    assert.equal(pad.shareLink, `${server.baseUrl}/p/vault-talk`);

    // No Key material anywhere on the server: not in the index, not in any
    // Pad file, not in the rendered page.
    assert.deepEqual(await dataDirContains(dataDir, pad.encodedKey), [], "no stored file contains the Key");
    assert.deepEqual(await dataDirContains(dataDir, pad.passphrase), [], "the passphrase is never stored");
    assert.deepEqual(await dataDirContains(dataDir, pad.proof), [], "only a digest of the write proof is stored");
    const page = await (await fetch(`${server.baseUrl}/p/vault-talk`)).text();
    assert.ok(!page.includes(pad.proof) && !page.includes(pad.encodedKey), "the rendered page never embeds the Key");
    assert.match(page, /"encrypted":true/, "the page tells the client this Pad is encrypted");
  } finally {
    await server.stop();
  }
});

test("an Encrypted Pad prompts for the passphrase and starts with its workspace hidden", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createEncryptedPad(server.baseUrl, { slug: "secret" });

    const encryptedPage = await (await fetch(`${server.baseUrl}/p/secret`)).text();
    assert.match(encryptedPage, /id="key-prompt"/, "the Key prompt is part of the page");
    assert.match(encryptedPage, /id="key-form"/, "the prompt takes the passphrase");
    assert.match(
      encryptedPage,
      /<input[^>]*type="file"[^>]*id="attachment-input"/,
      "the Attachment picker is present on the Encrypted Pad",
    );
    assert.match(encryptedPage, /<div[^>]*id="workspace"[^>]*hidden/, "the workspace starts locked");
    assert.match(encryptedPage, /<input[^>]*id="attachment-input"[^>]*disabled/, "uploads wait for key and replay");

    const plainPage = await (await fetch(`${server.baseUrl}/`)).text();
    assert.doesNotMatch(plainPage, /id="key-prompt"/, "a Plain Pad needs no Key");
    assert.match(plainPage, /<input[^>]*type="file"[^>]*id="attachment-input"/, "a Plain Pad also offers the Attachment picker");
    assert.doesNotMatch(plainPage, /<div[^>]*id="workspace"[^>]*hidden/, "a Plain Pad can show its workspace while connecting");
  } finally {
    await server.stop();
  }
});

test("a creation request that is not clearly encrypted is refused rather than guessed", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const response = await fetch(`${server.baseUrl}/api/pads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encrypted: "yes" }),
    });
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as { error: string }).error, /boolean/i);
  } finally {
    await server.stop();
  }
});

const SECRET = "TOP SECRET: the vault opens at 12-34-56";

test("the creation form offers encryption and sharing requires explicit passphrase inclusion", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const body = await (await fetch(`${server.baseUrl}/`)).text();
    assert.match(body, /<input[^>]*type="checkbox"[^>]*id="new-pad-encrypted"/, "the creator can choose encryption");
    assert.match(body, /id="suggest-password"/);
    assert.match(body, /id="suggest-passphrase"/);
    assert.match(body, /id="create-passphrase"[^>]*minlength="12"/);
    assert.doesNotMatch(body, /id="share-secret-options"|id="include-passphrase"/);
    assert.match(body, /id="qr-copy-link"/);
    assert.match(body, /id="qr-copy-image"/);
    assert.match(body, /id="qr-save-image"/);
    assert.match(body, /id="qr-copy-passphrase" hidden/);
    assert.doesNotMatch(body, /id="one-time-link"/);
  } finally {
    await server.stop();
  }
});

test("Note edits of an Encrypted Pad travel as ciphertext the server cannot read", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const pad = await createEncryptedPad(server.baseUrl, { slug: "cipher" });
    const alice = await SyncClient.connect(server.baseUrl, "cipher", { codec: createUpdateCodec(pad.key), proof: pad.proof });
    const bob = await SyncClient.connect(server.baseUrl, "cipher", { codec: createUpdateCodec(pad.key), proof: pad.proof });
    const spy = await eavesdropOn(server, "cipher", pad.proof);
    try {
      alice.editNote((note) => note.insert(0, SECRET));
      await waitFor(() => bob.noteText() === SECRET, "Bob decrypting Alice's edit");

      // The relayed bytes carry no plaintext…
      await waitFor(() => spy.frames().length >= 1, "the relay moving frames");
      const wire = spy.frames();
      assert.deepEqual(
        wire.filter((frame) => frame.includes(Buffer.from(SECRET, "utf8"))),
        [],
        "no plaintext on the wire",
      );
      // …yet a Key holder turns the very same bytes back into the Note.
      const witness = new Y.Doc();
      for (const frame of wire) {
        Y.applyUpdate(witness, await decryptBlob(pad.key, frame));
      }
      assert.equal(witness.getText("note").toString(), SECRET, "the relayed ciphertext decrypts to the Note");
    } finally {
      await Promise.all([alice.close(), bob.close(), spy.close()]);
    }
  } finally {
    await server.stop();
  }
});

test("a fresh client decrypts the replayed history, and server storage holds no plaintext", async () => {
  const dataDir = await makeTempDataDir();
  const first = await startServer({ dataDir });
  const pad = await createEncryptedPad(first.baseUrl, { slug: "secret-note" });
  const writer = await SyncClient.connect(first.baseUrl, "secret-note", { codec: createUpdateCodec(pad.key), proof: pad.proof });
  writer.editNote((note) => note.insert(0, SECRET));
  await writer.close();
  await first.stop(); // stopping flushes every queued append to disk

  // The plain-Pad control: the SAME secret written to a Plain Pad IS found
  // on disk — this proves the scan below can actually see plaintext.
  const second = await startServer({ dataDir });
  try {
    const plain = await fetch(`${second.baseUrl}/api/pads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "open-note" }),
    });
    assert.equal(plain.status, 201);
    const plainWriter = await SyncClient.connect(second.baseUrl, "open-note");
    plainWriter.editNote((note) => note.insert(0, SECRET));
    await plainWriter.close();

    const reader = await SyncClient.connect(second.baseUrl, "secret-note", { codec: createUpdateCodec(pad.key), proof: pad.proof });
    try {
      assert.equal(reader.noteText(), SECRET, "the fresh client decrypts the replayed ciphertext");
    } finally {
      await reader.close();
    }
  } finally {
    await second.stop();
  }

  // The whole data directory: the Plain Pad's log IS allowed to carry the
  // secret in plaintext (that is the point of Plain), but the Encrypted
  // Pad's own storage — and every other file — must not contain it.
  const hits = await dataDirContains(dataDir, SECRET);
  assert.ok(hits.length >= 1, "the Plain Pad control proves the scan can see plaintext");
  assert.ok(
    hits.every((file) => file.split(path.sep).includes("open-note")),
    "the only plaintext on disk belongs to the Plain Pad; the Encrypted Pad's storage is ciphertext-only",
  );
});

test("a client with the wrong Key cannot read an Encrypted Pad", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const pad = await createEncryptedPad(server.baseUrl, { slug: "locked" });
    const writer = await SyncClient.connect(server.baseUrl, "locked", { codec: createUpdateCodec(pad.key), proof: pad.proof });
    writer.editNote((note) => note.insert(0, SECRET));
    await writer.close();

    const wrongKey = await SyncClient.connect(server.baseUrl, "locked", {
      codec: createUpdateCodec(new Uint8Array(32).fill(7)),
      proof: pad.proof,
    });
    try {
      assert.equal(wrongKey.noteText(), "", "nothing is readable under the wrong Key");
      await waitFor(
        () => wrongKey.decryptFailures.length >= 1,
        "the replayed frames failing decryption under the wrong Key",
      );
    } finally {
      await wrongKey.close();
    }
  } finally {
    await server.stop();
  }
});

// Note: uploading raw plaintext to an Encrypted Pad is no longer refused
// server-side (that was the ticket-07 placeholder) — the server cannot
// inspect ciphertext to tell it apart, so it stores whatever a client
// seals. The working sealed flow and its ciphertext-only storage proof
// live in encrypted-attachments.test.ts.
