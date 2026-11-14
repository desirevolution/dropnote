import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { loadConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { PadStore } from "../src/store.ts";
import { makeTempDataDir } from "./helpers/server.ts";

async function setup(t: TestContext, env: NodeJS.ProcessEnv = {}, seed?: (store: PadStore) => void) {
  const dataDir = await makeTempDataDir();
  seed?.(PadStore.open(dataDir, env.MULTIUSER !== "false"));
  const server = await startServer(loadConfig({
    PORT: "0", DATA_DIR: dataDir, MULTIUSER: "true", TRUSTED_PROXIES: "127.0.0.1", ...env,
  }));
  t.after(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.port}`;
  const identity = (user: string) => ({ "X-Forwarded-User": user });
  const send = (slug: string, action: string, body: string | Uint8Array<ArrayBuffer>, user?: string, headers = {}) =>
    fetch(`${base}/api/pads/${slug}/script/${action}`, {
      method: "POST", body, headers: { ...(user ? identity(user) : {}), ...headers },
    });
  async function open(slug: string, user: string) {
    const ws = new WebSocket(`${base.replace("http:", "ws:")}/sync/${slug}`, { headers: identity(user) });
    t.after(() => ws.terminate());
    const doc = new Y.Doc();
    t.after(() => doc.destroy());
    const ready = new Promise<void>((resolve) => {
      ws.on("message", (data, binary) => {
        if (binary) Y.applyUpdate(doc, data as Buffer, "relay");
        else if (JSON.parse(data.toString()).type === "replay-done") resolve();
      });
    });
    await once(ws, "open");
    await ready;
    return { ws, doc };
  }
  return { base, send, open, dataDir, identity };
}

test("script writes update a live space and persist bytes, name and display name", async (t) => {
  const app = await setup(t);
  const created = await app.send("build", "text", "first", "alice", { "X-Space-Name": "Build logs" });
  assert.equal(created.status, 204);
  const { doc } = await app.open("build", "alice");
  assert.equal(doc.getText("note").toString(), "---\nfirst");

  const browser = await app.open("build", "alice");
  browser.doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "relay") browser.ws.send(update);
  });
  const browserEdit = new Promise<void>((resolve) => doc.once("update", () => resolve()));
  browser.doc.getText("note").insert(0, "browser ");
  await browserEdit;

  const observed = new Promise<void>((resolve) => doc.once("update", () => resolve()));
  assert.equal((await app.send("build", "text", "next\n", "alice")).status, 204);
  await observed;
  assert.equal(doc.getText("note").toString(), "browser ---\nfirst\n---\nnext\n");

  const listed = new Promise<void>((resolve) => doc.once("update", () => resolve()));
  const bytes = new Uint8Array([0, 255, 42]);
  const uploaded = await app.send("build", "files", bytes, "alice", {
    "X-Filename": "binary.dat", "Content-Type": "application/octet-stream", "X-Space-Name": "Ignored",
  });
  assert.equal(uploaded.status, 201);
  assert.equal(await uploaded.text(), "");
  await listed;
  const file = doc.getArray<{ name: string; blobId: string }>("attachments").get(0);
  assert.equal(file.name, "binary.dat");
  const download = await fetch(`${app.base}/api/pads/build/attachments/${file.blobId}`, { headers: app.identity("alice") });
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  const saved = PadStore.open(app.dataDir, true).getPad("build")!;
  assert.equal(saved.displayName, "Build logs");
  assert.equal(saved.owner, "alice");
  assert.ok(saved.expiresAt);
  const replay = await app.open("build", "alice");
  assert.deepEqual(replay.doc.getArray("attachments").toJSON(), doc.getArray("attachments").toJSON());
});

test("script access uses proxy identity, edit grants and personal defaults", async (t) => {
  const app = await setup(t, {}, (store) => {
    store.createPad("shared", { ttlSeconds: null, owner: "alice" });
    const shared = store.getPad("shared")!;
    store.setPadGrant(shared, "bob", "edit");
    store.setPadGrant(shared, "reader", "read");
    store.createPad("locked", { ttlSeconds: null, owner: "alice", pin: { salt: "test", hash: "test" } });
    store.createPad("sealed", { ttlSeconds: null, owner: "alice", kind: "encrypted" });
  });
  assert.equal((await app.send("shared", "text", "x")).status, 403);
  assert.equal((await app.send("shared", "text", "x", "stranger")).status, 404);
  assert.equal((await app.send("shared", "files", "x", "reader", { "X-Filename": "x" })).status, 403);
  assert.equal((await app.send("shared", "text", "yes", "bob")).status, 204);
  assert.equal((await app.send("locked", "text", "x", "alice")).status, 403);
  assert.equal((await app.send("sealed", "text", "x", "alice")).status, 403);
  assert.equal((await app.send("default", "text", "private default", "alice")).status, 204);
  assert.equal((await app.open("default", "alice")).doc.getText("note").toString(), "---\nprivate default");
  assert.equal((await app.open("default", "bob")).doc.getText("note").toString(), "");
});

test("concurrent writes recreate an expired space once and use the current instance TTL", async (t) => {
  const app = await setup(t, { DEFAULT_TTL: "1h" }, (store) => {
    store.createPad("expired", { ttlSeconds: -60, owner: "alice", displayName: "Old" });
  });
  const responses = await Promise.all(["one", "two"].map((value) =>
    app.send("expired", "text", value, "bob", { "X-Space-Name": "New" })));
  assert.deepEqual(responses.map(({ status }) => status), [204, 204]);
  const note = (await app.open("expired", "bob")).doc.getText("note").toString();
  assert.deepEqual(note.split("\n---\n").map((part) => part.replace(/^---\n/, "")).sort(), ["one", "two"]);
  const pad = PadStore.open(app.dataDir, true).getPad("expired")!;
  assert.equal(pad.owner, "bob");
  assert.equal(pad.displayName, "New");
  assert.equal(Date.parse(pad.expiresAt!) - Date.parse(pad.createdAt), 3_600_000);
});

test("instance PIN blocks auto-creation and file and text limits still apply", async (t) => {
  const app = await setup(t, { INSTANCE_PIN: "1234", MAX_FILE_SIZE: "2" }, (store) => {
    store.createPad("existing", { ttlSeconds: null, owner: "alice" });
  });
  assert.equal((await app.send("missing", "text", "x", "alice")).status, 403);
  assert.equal((await app.send("existing", "text", "x", "alice")).status, 204);
  assert.equal((await app.send("existing", "files", "abc", "alice", { "X-Filename": "small.txt" })).status, 413);
  assert.equal((await app.send("existing", "text", new Uint8Array([255]), "alice")).status, 400);
  assert.equal((await app.send("existing", "text", "x".repeat(1024 * 1024 + 1), "alice")).status, 413);
  const single = await setup(t, { MULTIUSER: "false" });
  assert.equal((await single.send("default", "text", "x", "alice")).status, 404);
  const untrusted = await setup(t, { TRUSTED_PROXIES: "192.0.2.1" });
  assert.equal((await untrusted.send("default", "text", "x", "alice")).status, 403);
});
