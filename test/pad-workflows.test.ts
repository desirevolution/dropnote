import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import { derivePadKey, presenceKey, verifyPadKey } from "../frontend/passphrase.js";
import { decodeBase64url, encodeBase64url, decryptBlob, encryptBlob } from "../frontend/crypto.js";
import { createEncryptedPad } from "./helpers/encrypted-pad.ts";
import { makeTempDataDir, startServer } from "./helpers/server.ts";
import { waitFor } from "./helpers/sync-client.ts";

test("the fixed Pad has a direct address, and browser start-pad lookups identify the generation", async () => {
  const server = await startServer({ dataDir: await makeTempDataDir() });
  try {
    const page = await fetch(`${server.baseUrl}/default`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /"path":"\/default"/);
    const metadata = await (await fetch(`${server.baseUrl}/api/pads/default`)).json();
    assert.equal(metadata.path, "/default");
    assert.equal(metadata.expiresAt, null);
    assert.equal(typeof metadata.createdAt, "string");
    const absent = await fetch(`${server.baseUrl}/api/pads/absent`);
    assert.equal(absent.status, 404);
  } finally {
    await server.stop();
  }
});

test("an empty encrypted Pad verifies the passphrase and separates its proof from the editing PIN", async () => {
  const server = await startServer({ dataDir: await makeTempDataDir() });
  try {
    const pad = await createEncryptedPad(server.baseUrl, { slug: "two-gates", pin: "3141" });
    assert.equal(pad.status, 201);
    const page = await (await fetch(pad.shareLink)).text();
    const metadata = JSON.parse(/id="pad-metadata">([^<]+)/.exec(page)![1]!);
    assert.equal(await verifyPadKey(pad.key, metadata.encryption.check), true);
    const wrong = await derivePadKey("a different passphrase", metadata.encryption.salt);
    await assert.rejects(() => verifyPadKey(wrong, metadata.encryption.check));
    assert.equal(metadata.encryption.proofHash, undefined);

    const api = `${server.baseUrl}/api/pads/${pad.slug}`;
    const badSocket = new WebSocket(server.syncUrl(pad.slug));
    await new Promise<void>((resolve, reject) => {
      badSocket.on("error", (error) => {
        try {
          assert.match(error.message, /403/);
          resolve();
        } catch (cause) {
          reject(cause);
        }
      });
      badSocket.on("open", () => {
        badSocket.close();
        reject(new Error("A proof is required for sync"));
      });
    });
    const pinHeaders = { "content-type": "application/json" };
    const pinRequest = { method: "POST", body: JSON.stringify({ pin: "3141" }) };
    assert.equal((await fetch(`${api}/pin`, { ...pinRequest, headers: pinHeaders })).status, 403);
    const pin = await fetch(`${api}/pin`, { ...pinRequest, headers: { ...pinHeaders, "x-pad-proof": pad.proof } });
    assert.equal(pin.status, 200);
    const { token } = await pin.json();
    for (const headers of [new Headers({ authorization: `Bearer ${token}` }), new Headers({ "x-pad-proof": pad.proof })]) {
      assert.equal((await fetch(api, { method: "DELETE", headers })).status, 403);
    }
    const authorized = { "x-pad-proof": pad.proof, authorization: `Bearer ${token}` };
    assert.equal((await fetch(api, { method: "DELETE", headers: authorized })).status, 204);
    assert.equal((await fetch(pad.shareLink)).status, 404);
  } finally {
    await server.stop();
  }
});

test("encrypted presence is relayed temporarily and disappears when the sender leaves", async () => {
  const server = await startServer({ dataDir: await makeTempDataDir() });
  const sockets: WebSocket[] = [];
  try {
    const pad = await createEncryptedPad(server.baseUrl, { slug: "presence" });
    async function connect() {
      const socket = new WebSocket(server.syncUrl(pad.slug), ["dropnote", `proof.${pad.proof}`]);
      sockets.push(socket);
      const messages: Array<{ type: string; peer?: string; data?: string }> = [];
      socket.on("message", (data, binary) => {
        if (!binary) messages.push(JSON.parse(data.toString()));
      });
      await waitFor(() => messages.some(({ type }) => type === "replay-done"), "initial replay");
      return { socket, messages };
    }
    const sender = await connect();
    const observer = await connect();
    const cursorKey = await presenceKey(pad.key);
    const position = new TextEncoder().encode(JSON.stringify({ tname: "note", assoc: 0 }));
    const data = encodeBase64url(await encryptBlob(cursorKey, position));
    sender.socket.send(JSON.stringify({ type: "presence", data }));
    await waitFor(() => observer.messages.some(({ type }) => type === "presence"), "relayed cursor");
    const presence = observer.messages.find(({ type }) => type === "presence")!;
    assert.equal(presence.data, data);
    assert.deepEqual(await decryptBlob(cursorKey, decodeBase64url(presence.data!)), position);
    sender.socket.close();
    await waitFor(() => observer.messages.some((message) =>
      message.type === "presence-left" && message.peer === presence.peer), "cursor removal");
    const late = await connect();
    assert.equal(late.messages.some(({ type }) => type === "presence"), false);
  } finally {
    for (const socket of sockets) socket.close();
    await server.stop();
  }
});

test("a retried upload keeps its blob ID and does not replace the first copy", async () => {
  const server = await startServer({ dataDir: await makeTempDataDir() });
  try {
    const api = `${server.baseUrl}/api/pads/default/attachments`;
    const headers = { "content-type": "application/octet-stream", "x-upload-id": "4".repeat(32) };
    for (const body of ["original", "different"]) {
      const response = await fetch(api, { method: "POST", headers, body });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { blobId: headers["x-upload-id"], size: 8 });
    }
    const download = await fetch(`${api}/${headers["x-upload-id"]}`);
    assert.equal(await download.text(), "original");
  } finally {
    await server.stop();
  }
});
