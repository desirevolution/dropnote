import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { request } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { encryptBlob } from "../frontend/crypto.js";
import { decryptAttachment, encryptAttachment } from "../frontend/encrypted-attachments.js";
import { openGuestSnapshot, sealGuestSnapshot } from "../frontend/guest-snapshot.js";
import { createEncryption, derivePadKey, guestProof, guestProofHash, padProof } from "../frontend/passphrase.js";
import { loadConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { PadStore } from "../src/store.ts";
import { openUpdateLog } from "../src/update-log.ts";
import { makeTempDataDir } from "./helpers/server.ts";

const internal = "https://dropnote.example.test";
const guest = "https://guest.example.test";
const slug = "guest-test";
const guestPath = `/api/pads/${slug}/guest-link`;
const displayName = "Name visible only once opened";
const credentials = async () => {
  const passphrase = "sicherer test passphrase";
  const encryption = await createEncryption(passphrase);
  const key = await derivePadKey(passphrase, encryption.salt);
  return { encryption, key, proof: await padProof(key), guestProof: await guestProof(key), hash: await guestProofHash(key) };
};

async function setup(t: TestContext, { multiuser = false, enabled = true, ttlSeconds = 90_000, plain = false, legacy = false } = {}) {
  const dataDir = await makeTempDataDir();
  const store = PadStore.open(dataDir, multiuser);
  const access = await credentials();
  store.createPad(slug, { kind: plain ? "plain" : "encrypted", encryption: plain ? undefined : access.encryption, displayName, ttlSeconds, owner: multiuser ? "alice" : undefined });
  const pad = store.getPad(slug)!;
  if (multiuser) store.setPadGrant(pad, "bob", "edit");
  const doc = new Y.Doc();
  {
    doc.getText("note").insert(0, "deleted private draft");
    const draft = Y.encodeStateAsUpdate(doc);
    openUpdateLog(store.padDir(slug)).append(Buffer.from(plain ? draft : await encryptBlob(access.key, draft)));
    doc.getText("note").delete(0, "deleted private draft".length);
  }
  doc.getText("note").insert(0, "client-only note");
  const ids = ["a".repeat(32), "b".repeat(32)];
  for (const id of ids) doc.getArray("attachments").push([{ blobId: id, name: id + ".txt", size: ("guest file " + id).length }]);
  const snapshot = await sealGuestSnapshot(access.key, doc);
  const log = openUpdateLog(store.padDir(slug));
  const update = Y.encodeStateAsUpdate(doc);
  log.append(Buffer.from(plain ? update : await encryptBlob(access.key, update)));
  doc.destroy();
  const orphan = "c".repeat(32);
  await mkdir(store.attachmentDir(slug));
  for (const id of [...ids, orphan]) {
    const stream = encryptAttachment(access.key, new Blob(["guest file " + id]));
    const ciphertext = plain ? Buffer.from("guest file " + id) : Buffer.from(await new Response(stream).arrayBuffer());
    store.recordBlob(slug, id, ciphertext.length);
    await writeFile(store.blobPath(slug, id), ciphertext);
  }

  if (legacy) store.setGuestLink(pad, {
    token: "a".repeat(43), proofHash: access.hash, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), oneTime: false,
  });

  const server = await startServer(loadConfig({
    PORT: "0", BASE_URL: internal, DATA_DIR: dataDir, GUEST_LINKS: String(enabled),
    GUEST_BASE_URL: guest, MULTIUSER: String(multiuser), TRUSTED_PROXIES: "127.0.0.1",
  }));
  t.after(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  function send(path: string, {
    host = internal, method = "GET", headers = {}, body,
  }: { host?: string; method?: string; headers?: Record<string, string>; body?: object } = {}) {
    // node:http preserves the Host override so the test can exercise both vhosts.
    return new Promise<{ status: number; text: string; bytes: Buffer; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
      const req = request({
        hostname: "127.0.0.1", port: server.port, path, method,
        headers: { Host: new URL(host).host, ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      }, (res) => {
        const parts: Buffer[] = [];
        res.on("data", (data) => parts.push(data));
        res.on("error", reject);
        res.on("end", () => {
          const bytes = Buffer.concat(parts);
          resolve({ status: res.statusCode!, bytes, text: bytes.toString(), headers: res.headers });
        });
      });
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  const alice = { "X-Forwarded-User": "alice", Origin: internal };
  function put(oneTime: boolean, headers: Record<string, string> = { ...alice, "X-Pad-Proof": access.proof }, duration = "24h") {
    return send(guestPath, { method: "PUT", headers, body: { duration, proofHash: access.hash, oneTime, snapshot } });
  }
  function open(path: string, proof: string = access.guestProof, origin = guest) {
    return send(`${path}/open`, { method: "POST", host: guest, headers: { Origin: origin, "X-Guest-Proof": proof } });
  }
  return { access, pad, ids, orphan, server, send, put, open, alice, dataDir };
}

test("guest links are opt-in and require a distinct HTTPS origin", async (t) => {
  assert.throws(() => loadConfig({ GUEST_LINKS: "true" }), /GUEST_BASE_URL/);
  assert.throws(() => loadConfig({ GUEST_LINKS: "true", GUEST_BASE_URL: guest + "/g" }), /GUEST_BASE_URL/);
  assert.throws(() => loadConfig({ GUEST_LINKS: "true", GUEST_BASE_URL: guest, BASE_URL: guest + ":8443" }), /GUEST_BASE_URL/);
  const app = await setup(t, { enabled: false });
  assert.equal((await app.put(false)).status, 404);
  assert.doesNotMatch((await app.send(`/p/${slug}`)).text, /id="guest-link-dialog"/);
});

test("only an unlocked owner can issue a link and public HTTP and WS expose guest endpoints only", async (t) => {
  const app = await setup(t, { multiuser: true });
  assert.equal((await app.put(false, app.alice)).status, 403);
  assert.equal((await app.put(false, { Origin: internal, "X-Forwarded-User": "bob", "X-Pad-Proof": app.access.proof })).status, 403);
  const created = await app.put(false);
  assert.equal(created.status, 200, created.text);
  const link = JSON.parse(created.text).link;
  assert.ok(Date.parse(link.expiresAt) < Date.parse(app.pad.expiresAt!));
  assert.equal((await app.send(guestPath, { headers: app.alice })).status, 200);
  assert.equal((await app.send(guestPath, { headers: { "X-Forwarded-User": "bob" } })).status, 403);
  const ownerPage = (await app.send(`/p/${slug}`, { headers: app.alice })).text;
  assert.match(ownerPage, /id="guest-link-dialog"/);
  assert.doesNotMatch(ownerPage, /id="guest-link-include"|id="include-passphrase"/);
  assert.doesNotMatch((await app.send(`/p/${slug}`, { headers: { "X-Forwarded-User": "bob" } })).text, /id="guest-link-dialog"/);
  const listing = JSON.parse((await app.send("/api/my-spaces", { headers: app.alice })).text);
  assert.equal(listing.spaces[0].guestStatus.expiresAt, link.expiresAt);
  assert.doesNotMatch(JSON.stringify(listing), new RegExp(link.url));

  const path = new URL(link.url).pathname;
  assert.equal((await app.send(path, { headers: app.alice })).status, 404);
  for (const blocked of ["/", "/events", "/api/my-spaces", `/p/${slug}`, guestPath, "/js/editor.bundle.js"]) {
    assert.equal((await app.send(blocked, { host: guest, headers: app.alice })).status, 404, blocked);
  }
  assert.equal((await app.send("/g/client.js", { host: guest })).status, 200);
  const ws = new WebSocket(`ws://127.0.0.1:${app.server.port}/sync/${slug}`, ["dropnote", `proof.${app.access.proof}`], {
    headers: { Host: new URL(guest).host, ...app.alice },
  });
  await assert.rejects(once(ws, "open"), /Unexpected server response: 404/);

  const page = await app.send(path, { host: guest, headers: { "Accept-Language": "de" } });
  assert.equal(page.status, 200);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.match(page.text, /Verschlüsselte Ablage öffnen/);
  assert.doesNotMatch(page.text, /window\.takeOpeningPassphrase/);
  const script = page.text.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  assert.ok(String(page.headers["content-security-policy"]).includes("'sha256-" + createHash("sha256").update(script).digest("base64") + "'"));
  assert.ok(!page.text.includes(displayName) && !page.text.includes("client-only note") && !page.text.includes(link.expiresAt));
  assert.equal((await app.open(path, app.access.proof)).status, 403);
  assert.equal((await app.open(path, app.access.guestProof, internal)).status, 403);
  const opened = await app.open(path);
  assert.equal(opened.status, 200, opened.text);
  const snapshot = JSON.parse(opened.text);
  assert.equal(snapshot.displayName, displayName);
  assert.ok(!opened.text.includes("client-only note"));
  assert.ok(!("updates" in snapshot));
  const content = await openGuestSnapshot(app.access.key, snapshot.snapshot);
  assert.equal(content.note, "client-only note");
  assert.ok(!JSON.stringify(content).includes("deleted private draft"));
  assert.deepEqual(snapshot.fileIds, app.ids);
  const orphan = await app.send(`${path}/files/${app.orphan}`, {
    host: guest, headers: { "X-Guest-Proof": app.access.guestProof },
  });
  assert.equal(orphan.status, 404);
  const latest = new Y.Doc();
  latest.getText("note").insert(0, "later confidential edit");
  openUpdateLog(PadStore.open(app.dataDir, true).padDir(slug))
    .append(Buffer.from(await encryptBlob(app.access.key, Y.encodeStateAsUpdate(latest))));
  latest.destroy();
  const openedAgain = await app.open(path);
  assert.equal(openedAgain.status, 200);
  assert.equal(JSON.parse(openedAgain.text).snapshot, snapshot.snapshot);

  const replacement = JSON.parse((await app.put(false)).text).link;
  assert.notEqual(replacement.url, link.url);
  assert.equal((await app.open(path)).status, 404);
});

test("a one-time guest link redeems once and supports multiple downloads until revoked", async (t) => {
  const app = await setup(t);
  const link = JSON.parse((await app.put(true)).text).link;
  const path = new URL(link.url).pathname;
  for (const method of ["HEAD", "GET", "GET"]) assert.equal((await app.send(path, { host: guest, method })).status, 200);
  assert.equal((await app.open(path, "x".repeat(43))).status, 403);
  const results = await Promise.all([app.open(path), app.open(path), app.open(path)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 404, 404]);
  assert.equal((await app.send(path, { host: guest })).status, 404);
  const session = JSON.parse(results.find((result) => result.status === 200)!.text).session;
  const saved = PadStore.open(app.dataDir).getPad(slug)!.guestLink!;
  assert.ok(saved.redemption?.at);
  assert.notEqual(saved.redemption?.sessionHash, session);
  const status = JSON.parse((await app.send(guestPath)).text).link;
  assert.equal(status.redeemedAt, saved.redemption?.at);
  const file = (id: string, headers: Record<string, string>) => app.send(`${path}/files/${id}`, { host: guest, headers });
  assert.equal((await file(app.ids[0]!, { "X-Guest-Proof": app.access.guestProof })).status, 404);
  for (const id of app.ids) {
    const response = await file(id, { "X-Guest-Session": session });
    assert.equal(response.status, 200, response.text);
    const plaintext = [];
    const stream = new Response(new Uint8Array(response.bytes)).body!;
    for await (const chunk of decryptAttachment(app.access.key, stream)) {
      assert.ok(chunk.ok);
      plaintext.push(chunk.bytes);
    }
    assert.equal(Buffer.concat(plaintext).toString(), "guest file " + id);
  }
  assert.equal((await app.send(guestPath, { method: "DELETE", headers: { Origin: internal } })).status, 204);
  assert.equal((await file(app.ids[0]!, { "X-Guest-Session": session })).status, 404);
});

test("an elapsed guest TTL blocks both opening and downloads while the space stays active", async (t) => {
  const app = await setup(t, { ttlSeconds: 86_400 });
  const issued = JSON.parse((await app.put(false, undefined, "1h")).text).link;
  const path = new URL(issued.url).pathname;
  const filePath = `${path}/files/${app.ids[0]}`;
  const headers = { "X-Guest-Proof": app.access.guestProof };
  assert.equal((await app.send(filePath, { host: guest, headers })).status, 200);
  t.mock.method(Date, "now", () => Date.parse(issued.expiresAt));
  assert.equal((await app.open(path)).status, 404);
  assert.equal((await app.send(filePath, { host: guest, headers })).status, 404);
  assert.equal(JSON.parse((await app.send(guestPath)).text).link, null);
  assert.equal((await app.send(`/p/${slug}`)).status, 200);
});

test("normal spaces require a separate password, serve the current content and issue revocable download sessions", async (t) => {
  const app = await setup(t, { plain: true, multiuser: true });
  const password = "example guest password";
  assert.match((await app.send(`/p/${slug}`, { headers: app.alice })).text, /id="guest-link-include"/);
  const create = (oneTime: boolean) => app.send(guestPath, {
    method: "PUT", headers: app.alice, body: { duration: "24h", password, oneTime },
  });
  assert.equal((await app.put(false)).status, 400);
  const issued = await create(false);
  assert.equal(issued.status, 200, issued.text);
  const path = new URL(JSON.parse(issued.text).link.url).pathname;
  const page = await app.send(path, { host: guest });
  assert.match(page.text, /Guest password/);
  assert.match(page.text, /window\.takeOpeningPassphrase/);
  assert.ok(!page.text.includes(password) && !page.text.includes(displayName));
  const open = (where: string, value: string) => app.send(where + "/open", {
    host: guest, method: "POST", headers: { Origin: guest }, body: { password: value },
  });
  assert.equal((await open(path, "incorrect guest password")).status, 403);
  assert.equal((await app.send(guestPath + "/check-password", { method: "POST", headers: app.alice, body: { password } })).status, 204);
  assert.equal((await app.send(guestPath + "/check-password", { method: "POST", headers: { ...app.alice, "X-Forwarded-User": "bob" }, body: { password } })).status, 403);
  const opened = await open(path, password);
  assert.equal(opened.status, 200);
  const data = JSON.parse(opened.text);
  assert.equal(data.note, "client-only note");
  assert.ok(!("updates" in data) && !opened.text.includes("deleted private draft"));
  const filePath = path + "/files/" + app.ids[0];
  assert.equal((await app.send(filePath, { host: guest })).status, 404);
  assert.equal((await app.send(path + "/files/" + app.orphan, { host: guest, headers: { "X-Guest-Session": data.session } })).status, 404);
  assert.equal((await app.send(filePath, { host: guest, headers: { "X-Guest-Session": data.session } })).text, "guest file " + app.ids[0]);
  assert.doesNotMatch(JSON.stringify(PadStore.open(app.dataDir, true).getPad(slug)?.guestLink), /example guest password/);
  const replacement = new URL(JSON.parse((await create(true)).text).link.url).pathname;
  assert.equal((await app.send(filePath, { host: guest, headers: { "X-Guest-Session": data.session } })).status, 404);
  const results = await Promise.all([open(replacement, password), open(replacement, password)]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 404]);
});

test("guest link duration must fit without silently shortening or replacing an existing link", async (t) => {
  const app = await setup(t, { ttlSeconds: 7_200 });
  const status = await app.send(guestPath);
  assert.deepEqual(JSON.parse(status.text).durations, ["1h"]);
  const issued = await app.put(false, undefined, "1h");
  assert.equal(issued.status, 200, issued.text);
  const created = JSON.parse(issued.text);
  assert.ok(Math.abs(Date.parse(created.link.expiresAt) - created.now - 3_600_000) < 1_000);
  assert.equal((await app.put(false)).status, 409);
  assert.equal(JSON.parse((await app.send(guestPath)).text).link.url, created.link.url);
  t.mock.method(Date, "now", () => Date.parse(app.pad.expiresAt!) - 3_599_999);
  assert.deepEqual(JSON.parse((await app.send(guestPath)).text).durations, []);
  assert.equal((await app.put(false, undefined, "1h")).status, 409);
  assert.equal((await app.send(guestPath, { method: "DELETE", headers: { Origin: internal } })).status, 204);
  assert.equal((await app.send("/api/pads/default/guest-link")).status, 403);
});

test("old encrypted guest links cannot serve the historical update log", async (t) => {
  const app = await setup(t, { legacy: true });
  const path = "/g/" + "a".repeat(43);
  assert.equal((await app.send(path, { host: guest })).status, 404);
  assert.equal((await app.open(path)).status, 404);
  assert.equal(JSON.parse((await app.send(guestPath)).text).link, null);
  assert.equal((await app.put(false)).status, 200);
});
