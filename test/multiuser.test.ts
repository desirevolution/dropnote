import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { WebSocket } from "ws";
import { loadConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { PadStore } from "../src/store.ts";
import { makeTempDataDir } from "./helpers/server.ts";

const origin = "https://dropnote.example.test";
const env = { PORT: "0", BASE_URL: origin, MULTIUSER: "true", TRUSTED_PROXIES: "127.0.0.0/8,::1" };
const owner = "alice";
const collaborator = "bob";
const slug = "private-space";
const api = `/api/pads/${slug}`;

async function setup(t: TestContext, overrides: NodeJS.ProcessEnv = {}) {
  const dataDir = await makeTempDataDir();
  const server = await startServer(loadConfig({ ...env, DATA_DIR: dataDir, ...overrides }));
  t.after(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.port}`;
  function request(path: string, username?: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (username) headers.set("X-Forwarded-User", username);
    return fetch(base + path, { ...options, headers, signal: AbortSignal.timeout(5_000) });
  }
  function json(path: string, username: string, method: string, data: object) {
    return request(path, username, { method, headers: { "content-type": "application/json", origin }, body: JSON.stringify(data) });
  }
  function socket(space: string, username?: string, options: { token?: string; proof?: string; origin?: string } = {}) {
    const headers = { ...(username ? { "x-forwarded-user": username } : {}), origin: options.origin ?? origin };
    const protocols = options.proof ? ["dropnote", `proof.${options.proof}`] : ["dropnote"];
    const url = `${base.replace("http:", "ws:")}${space === "/events" ? space : `/sync/${space}`}${options.token ? `?token=${options.token}` : ""}`;
    const ws = new WebSocket(url, protocols, { headers, handshakeTimeout: 3_000 });
    t.after(() => ws.terminate());
    return ws;
  }
  return { request, json, socket, dataDir };
}

function control(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", receive);
      reject(new Error(`Missing WebSocket message: ${type}`));
    }, 3_000);
    function receive(data: Buffer, binary: boolean) {
      if (binary) return;
      const message = JSON.parse(data.toString());
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off("message", receive);
      resolve(message);
    }
    socket.on("message", receive);
  });
}

async function rejected(socket: WebSocket, status: number) {
  await assert.rejects(once(socket, "open"), { message: `Unexpected server response: ${status}` });
}

test("multiuser validates trusted socket peers and usernames on HTTP and WebSocket", async (t) => {
  const { request, socket } = await setup(t);
  assert.equal((await request("/")).status, 403);
  assert.equal((await request("/", "alice, bob")).status, 403);
  assert.match(await (await request("/default", owner)).text(), /class="account-name" title="alice">alice</);
  assert.equal((await request("/default", collaborator)).status, 200);
  assert.equal((await request("/api/pads", owner, { method: "POST", headers: { origin: "https://other.test" } })).status, 403);
  await rejected(socket("default"), 403);
  await rejected(socket("default", owner, { origin: "null" }), 403);
  assert.equal((await control(socket("default", collaborator), "replay-done")).writable, true);

  const untrusted = await setup(t, { TRUSTED_PROXIES: "192.0.2.1" });
  const headers = { "x-forwarded-for": "192.0.2.1", "x-real-ip": "192.0.2.1" };
  assert.equal((await untrusted.request("/", owner, { headers })).status, 403);
  await rejected(untrusted.socket("default", owner), 403);
  assert.throws(() => loadConfig({ MULTIUSER: "true" }), /TRUSTED_PROXIES/);
  assert.throws(() => loadConfig({ MULTIUSER: "true", TRUSTED_PROXIES: "::1/129" }), /TRUSTED_PROXIES/);
});

test("private spaces have owner-only management and revocable read and edit roles", async (t) => {
  const { request, json, socket, dataDir } = await setup(t);
  const created = await json("/api/pads", owner, "POST", { slug, owner: collaborator });
  assert.equal(created.status, 201);
  const { path: createdPath } = await created.json();
  const ownerPage = await request(createdPath, owner);
  assert.equal(ownerPage.status, 200);
  const wrongCase = await request(createdPath, "Alice");
  assert.equal(wrongCase.status, 404);
  assert.match(await wrongCase.text(), /Signed in as Alice\./);
  assert.match(ownerPage.headers.get("cache-control") ?? "", /private, no-store/);
  const ownerBody = await ownerPage.text();
  assert.match(ownerBody, /data-open-dialog="owned-spaces-dialog"[^>]*>[^<]*<span id="access-request-badge"/);
  assert.match(ownerBody, /Manage access/);
  assert.match(ownerBody, /<button type="submit" class="primary" disabled>Grant access<\/button>/);
  assert.doesNotMatch(ownerBody, /id="remember-pad"/);
  const bytes = Buffer.from("private file");
  const uploaded = await request(`${api}/attachments`, owner, { method: "POST", body: bytes });
  assert.equal(uploaded.status, 201);
  const file = `${api}/attachments/${(await uploaded.json()).blobId}`;

  for (const path of [`/p/${slug}`, api, file, `${api}/access`]) {
    assert.equal((await request(path, collaborator)).status, 404);
  }
  await rejected(socket(slug, collaborator), 404);
  const list = async (username: string) => (await (await request("/api/my-spaces", username)).json()).spaces;
  assert.deepEqual((await list(owner)).map((space: { slug: string }) => space.slug), [slug]);
  assert.deepEqual(await list(collaborator), []);
  assert.equal((await json("/api/pads/default/access", owner, "PUT", { username: collaborator, role: "read" })).status, 403);

  await request("/default", collaborator);
  const grant = (role: "read" | "edit" | null) => json(`${api}/access`, owner, "PUT", { username: collaborator, role });
  assert.equal((await grant("read")).status, 200);
  assert.equal((await request(api, "Bob")).status, 404);
  const page = await (await request(`/p/${slug}`, collaborator)).text();
  assert.match(page, /"canEdit":false/);
  assert.match(page, /id="remember-pad"/);
  assert.ok(page.includes(`Shared by ${owner}`));
  assert.deepEqual((await list(owner))[0].sharedWith, [collaborator]);
  const received = await (await request(api, collaborator)).json();
  assert.equal(received.sharedBy, owner);
  assert.equal(received.canEdit, false);
  assert.doesNotMatch(page, /id="space-access-dialog"|id="delete-pad"/);
  assert.deepEqual(Buffer.from(await (await request(file, collaborator)).arrayBuffer()), bytes);
  assert.equal((await request(`${api}/attachments`, collaborator, { method: "POST", body: bytes })).status, 403);
  assert.equal((await request(file, collaborator, { method: "DELETE" })).status, 403);
  assert.equal((await json(`${api}/pin`, collaborator, "POST", { pin: "1234" })).status, 403);
  const reader = socket(slug, collaborator);
  assert.equal((await control(reader, "replay-done")).writable, false);
  const refusedWrite = control(reader, "write-rejected");
  reader.send(Buffer.from("bad edit"));
  await refusedWrite;

  const roleChanged = once(reader, "close");
  assert.equal((await grant("edit")).status, 200);
  assert.equal((await roleChanged)[0], 4003);
  const editor = socket(slug, collaborator);
  assert.equal((await control(editor, "replay-done")).writable, true);
  assert.deepEqual(await list(collaborator), []);
  const observer = socket(slug, owner);
  await control(observer, "replay-done");
  const presence = control(observer, "presence");
  editor.send(JSON.stringify({ type: "presence", username: "forged", data: "YQ" }));
  assert.equal((await presence).username, collaborator);
  const accepted = control(editor, "update-accepted");
  editor.send(Buffer.from("accepted edit"));
  await accepted;
  assert.equal((await request(`${api}/attachments`, collaborator, { method: "POST", body: bytes })).status, 201);
  assert.equal((await request(file, collaborator, { method: "DELETE" })).status, 204);
  assert.equal((await request(api, collaborator, { method: "DELETE" })).status, 403);
  assert.equal((await json(`${api}/ttl`, collaborator, "POST", { ttl: "never" })).status, 403);
  assert.equal((await json(`${api}/access`, collaborator, "PUT", { username: "charlie", role: "edit" })).status, 403);

  const stored = PadStore.open(dataDir, true).getLivePad(slug);
  assert.equal(stored?.owner, owner);
  assert.deepEqual(stored?.grants?.map(({ username, role }) => ({ username, role })), [{ username: collaborator, role: "edit" }]);
  assert.ok(stored?.grants?.[0]?.unreadId);
  assert.throws(() => PadStore.open(dataDir), /different MULTIUSER mode/);
  const revoked = once(editor, "close");
  assert.equal((await grant(null)).status, 200);
  assert.equal((await revoked)[0], 4004);
  await rejected(socket(slug, collaborator), 404);
  assert.equal((await request(api, collaborator)).status, 404);
  assert.equal((await json(`${api}/ttl`, owner, "POST", { ttl: "never" })).status, 200);
  assert.equal((await request(api, owner, { method: "DELETE" })).status, 204);
  assert.deepEqual(await list(owner), []);
});

test("multiuser grants layer with encryption proof and account-bound editing PIN", async (t) => {
  const { request, json, socket } = await setup(t);
  const { createHash, randomBytes } = await import("node:crypto");
  const proof = randomBytes(32).toString("base64url");
  const encryption = {
    salt: randomBytes(16).toString("base64url"),
    check: randomBytes(29).toString("base64url"),
    proofHash: createHash("sha256").update(proof).digest("base64url"),
  };
  assert.equal((await json("/api/pads", owner, "POST", { slug, encrypted: true, encryption, pin: "1234" })).status, 201);
  await rejected(socket(slug, collaborator, { proof }), 404);
  await request("/default", collaborator);
  assert.equal((await json(`${api}/access`, owner, "PUT", { username: collaborator, role: "edit" })).status, 200);
  await rejected(socket(slug, collaborator), 403);
  assert.equal((await control(socket(slug, collaborator, { proof }), "replay-done")).writable, false);
  const pin = await request(`${api}/pin`, owner, {
    method: "POST",
    headers: { "content-type": "application/json", "x-pad-proof": proof },
    body: JSON.stringify({ pin: "1234" }),
  });
  assert.equal(pin.status, 200);
  const { token } = await pin.json();
  assert.equal((await json(api, owner, "PATCH", { displayName: "Private" })).status, 403);
  assert.equal((await request(api, owner, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin, "x-pad-proof": proof },
    body: JSON.stringify({ displayName: "Private" }),
  })).status, 403);
  assert.equal((await request(api, owner, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin, "x-pad-proof": proof, authorization: `Bearer ${token}` },
    body: JSON.stringify({ displayName: "Private" }),
  })).status, 200);
  assert.equal((await control(socket(slug, owner, { token, proof }), "replay-done")).writable, true);
  assert.equal((await control(socket(slug, collaborator, { token, proof }), "replay-done")).writable, false);

  const deletionHeaders = { origin, "x-pad-proof": proof, authorization: `Bearer ${token}` };
  assert.equal((await request(api, collaborator, { method: "DELETE", headers: deletionHeaders })).status, 403);
  assert.equal((await request(api, "outsider", { method: "DELETE", headers: deletionHeaders })).status, 404);
  assert.equal((await request(api, owner, {
    method: "DELETE", headers: { origin, "x-pad-created-at": "stale" },
  })).status, 409);
  const pad = await (await request(api, owner)).json();
  assert.equal((await request(api, owner, {
    method: "DELETE", headers: { origin, "x-pad-created-at": pad.createdAt },
  })).status, 204);
  await rejected(socket(slug, collaborator, { proof }), 404);
});

test("single-user mode ignores identity headers and keeps links usable", async (t) => {
  const { request, json, dataDir } = await setup(t, { MULTIUSER: "false" });
  assert.equal((await json("/api/pads", owner, "POST", { slug })).status, 201);
  assert.equal((await request(api)).status, 200);
  assert.doesNotMatch(await (await request(`/p/${slug}`, owner)).text(), /class="account-name"/);
  const spaces = async () => (await (await request("/api/my-spaces")).json()).spaces;
  assert.deepEqual((await spaces()).map((space: { slug: string }) => space.slug), [slug]);
  assert.equal((await request(api, undefined, { method: "DELETE" })).status, 204);
  assert.deepEqual(await spaces(), []);
  assert.throws(() => PadStore.open(dataDir, true), /different MULTIUSER mode/);
});

test("signed-in visitors can request access privately and the owner can grant or decline", async (t) => {
  const { request, json, socket, dataDir } = await setup(t, { PAD_PATH: "/space" });
  assert.equal((await json("/api/pads", owner, "POST", { slug })).status, 201);
  const pagePath = `/space/${slug}`;
  const requestsPath = `${api}/access-requests`;
  const visitorPage = await request(pagePath, collaborator);
  assert.equal(visitorPage.status, 404);
  const requestPage = await visitorPage.text();
  assert.match(requestPage, /method="post".*Request access/);
  assert.doesNotMatch(requestPage, /id="check-space-access"/);
  const submit = (path: string, username?: string) => request(path, username, {
    method: "POST", headers: { origin }, redirect: "manual",
  });

  assert.equal((await submit(requestsPath)).status, 403);
  assert.equal((await request(requestsPath, collaborator, {
    method: "POST", headers: { origin: "https://elsewhere.test" }, redirect: "manual",
  })).status, 403);
  for (const [path, destination] of [
    [requestsPath, pagePath], ["/api/pads/missing/access-requests", "/space/missing"],
  ] as const) {
    const response = await submit(path, collaborator);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${destination}?access=requested`);
    const confirmation = await request(response.headers.get("location")!, collaborator);
    assert.equal(confirmation.status, 404);
    assert.match(await confirmation.text(), /If the space is available, your request has been sent to its owner\./);
  }

  const filesWaiting = await (await request(`${pagePath}?access=requested&view=files`, collaborator)).text();
  assert.ok(filesWaiting.includes(`id="check-space-access" href="${pagePath}?view=files" data-check-path="${api}"`));
  assert.equal((await request(api, collaborator, { method: "HEAD" })).status, 404);

  // A client cannot nominate a different user, and repeated submissions are deduplicated.
  const duplicate = await request(requestsPath, collaborator, {
    method: "POST", redirect: "manual", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ username: "someone-else" }),
  });
  assert.equal(duplicate.status, 303);
  const state = await (await request(`${api}/access`, owner)).json();
  assert.deepEqual(state.grants, []);
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].username, collaborator);
  assert.deepEqual(PadStore.open(dataDir, true).getLivePad(slug)?.accessRequests, state.requests);
  const ownerSpaces = await (await request("/api/my-spaces", owner)).json();
  assert.equal(ownerSpaces.spaces[0].accessRequestCount, 1);
  assert.equal((await request(api, collaborator)).status, 404);
  await rejected(socket(slug, collaborator), 404);

  const decision = `${requestsPath}/${state.requests[0].id}`;
  assert.equal((await json(decision, collaborator, "PUT", { role: "edit" })).status, 404);
  assert.equal((await json(decision, owner, "PUT", { role: "admin" })).status, 400);
  const declined = await json(decision, owner, "PUT", { role: null });
  assert.deepEqual(await declined.json(), { grants: [], requests: [], eligibleUsers: [collaborator] });
  assert.equal((await request(pagePath, collaborator)).status, 404);
  assert.equal((await submit(requestsPath, collaborator)).status, 303);
  assert.equal((await json(decision, owner, "PUT", { role: "edit" })).status, 404);

  const renewed = await (await request(`${api}/access`, owner)).json();
  const approved = await json(`${requestsPath}/${renewed.requests[0].id}`, owner, "PUT", { role: "read" });
  assert.deepEqual(await approved.json(), { grants: [{ username: collaborator, role: "read" }], requests: [], eligibleUsers: [] });
  assert.equal((await request(api, collaborator, { method: "HEAD" })).status, 200);
  assert.equal((await request(api, "charlie", { method: "HEAD" })).status, 404);
  assert.equal((await request(pagePath, collaborator)).status, 200);
  assert.equal((await control(socket(slug, collaborator), "replay-done")).writable, false);

  assert.equal((await submit(requestsPath, "charlie")).status, 303);
  assert.equal((await json(`${api}/access`, owner, "PUT", { username: "charlie", role: "edit" })).status, 409);
  const pending = await (await request(`${api}/access`, owner)).json();
  await json(`${requestsPath}/${pending.requests[0].id}`, owner, "PUT", { role: null });
  const manualGrant = await json(`${api}/access`, owner, "PUT", { username: "charlie", role: "edit" });
  assert.deepEqual((await manualGrant.json()).requests, []);
  assert.equal((await control(socket(slug, "charlie"), "replay-done")).writable, true);
  assert.equal((await submit(requestsPath, "charlie")).status, 303);
  const finalState = await (await request(`${api}/access`, owner)).json();
  assert.deepEqual(finalState.requests, []);
});

test("access request rate limits are per account and independent of whether a space exists", async (t) => {
  const { request, json } = await setup(t);
  assert.equal((await json("/api/pads", owner, "POST", { slug })).status, 201);
  const missing = "/api/pads/missing/access-requests";
  const existing = `${api}/access-requests`;
  const submit = (path: string, username: string) => request(path, username, { method: "POST", redirect: "manual" });
  for (let i = 0; i < 10; i++) assert.equal((await submit(missing, collaborator)).status, 303);
  for (const path of [existing, missing]) {
    const limited = await submit(path, collaborator);
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
  }
  assert.equal((await submit(existing, "charlie")).status, 303);
});

test("an owner can rename a space without changing its address or access grants", async (t) => {
  const { request, json, dataDir } = await setup(t);
  const create = await json("/api/pads", owner, "POST", { slug });
  assert.equal(create.status, 201);
  const original = await create.json();
  await request("/default", collaborator);
  assert.equal((await json(`${api}/access`, owner, "PUT", { username: collaborator, role: "edit" })).status, 200);
  assert.equal((await json(api, collaborator, "PATCH", { displayName: "Other name" })).status, 403);
  assert.equal((await json(api, "charlie", "PATCH", { displayName: "Other name" })).status, 404);
  assert.equal((await json(api, owner, "PATCH", {})).status, 400);
  assert.equal((await json(api, owner, "PATCH", { displayName: "two\nlines" })).status, 400);
  assert.equal((await json(api, owner, "PATCH", { displayName: "a".repeat(81) })).status, 400);
  assert.equal((await json("/api/pads/default", owner, "PATCH", { displayName: "Other name" })).status, 403);
  const name = "Köln & <Team>";
  const renamed = await json(api, owner, "PATCH", { displayName: `  ${name}  ` });
  assert.deepEqual(await renamed.json(), { displayName: name });
  const received = await (await request(api, collaborator)).json();
  assert.equal(received.displayName, name);
  assert.equal(received.path, original.path);
  assert.equal(received.createdAt, original.createdAt);
  assert.equal(received.canEdit, true);
  const page = await (await request(original.path, collaborator)).text();
  assert.match(page, /<h1 id="space-heading">Köln &amp; &lt;Team&gt;<\/h1>/);
  const { spaces } = await (await request("/api/my-spaces", owner)).json();
  assert.equal(spaces[0].displayName, name);
  assert.equal(PadStore.open(dataDir, true).getLivePad(slug)?.displayName, name);
  assert.deepEqual(await (await json(api, owner, "PATCH", { displayName: "" })).json(), { displayName: null });
  assert.match(await (await request(original.path, collaborator)).text(), /<h1 id="space-heading">Private space<\/h1>/);
});

test("Default notes and attachments are isolated per account", async (t) => {
  const { request, json, socket, dataDir } = await setup(t);
  const defaultApi = "/api/pads/default";
  const ownerSocket = socket("default", owner);
  const otherSocket = socket("default", collaborator);
  const otherUpdates: string[] = [];
  otherSocket.on("message", (data, binary) => {
    if (binary) otherUpdates.push(data.toString());
  });
  await Promise.all([control(ownerSocket, "replay-done"), control(otherSocket, "replay-done")]);

  const saved = control(ownerSocket, "update-accepted");
  ownerSocket.send(Buffer.from("Alice's update"));
  await saved;
  const secondOwnerSocket = socket("default", owner);
  const replayed: string[] = [];
  secondOwnerSocket.on("message", (data, binary) => {
    if (binary) replayed.push(data.toString());
  });
  await control(secondOwnerSocket, "replay-done");
  assert.deepEqual(replayed, ["Alice's update"]);
  // A response on the other socket is a barrier for any earlier broadcasts.
  const otherSaved = control(otherSocket, "update-accepted");
  otherSocket.send(Buffer.from("Bob's update"));
  await otherSaved;
  assert.deepEqual(otherUpdates, []);

  const upload = await request(`${defaultApi}/attachments`, owner, { method: "POST", body: Buffer.from("Alice's file") });
  assert.equal(upload.status, 201);
  const { blobId } = await upload.json();
  const file = `${defaultApi}/attachments/${blobId}`;
  assert.equal(await (await request(file, owner)).text(), "Alice's file");
  assert.equal((await request(file, collaborator)).status, 404);
  assert.equal((await request(file, collaborator, { method: "DELETE" })).status, 404);
  const records = PadStore.open(dataDir, true).getIndex().pads;
  const personal = Object.values(records).find((pad) => pad.owner === owner);
  assert.ok(personal);
  assert.equal((await request(`/api/pads/${encodeURIComponent(personal.slug)}`, owner)).status, 404);
  assert.deepEqual(await (await request("/api/my-spaces", owner)).json(), { spaces: [], sharedSpaces: [] });
  assert.equal((await json(`${defaultApi}/ttl`, owner, "POST", { ttl: 60 })).status, 403);
  assert.equal((await request(defaultApi, owner, { method: "DELETE" })).status, 403);
});

test("new shares are discoverable per account until opened and acknowledged", async (t) => {
  const { request, json, dataDir } = await setup(t);
  assert.equal((await json("/api/pads", owner, "POST", { slug })).status, 201);
  const shared = async (username: string) => (await (await request("/api/my-spaces", username)).json()).sharedSpaces;
  const grant = (role: "read" | "edit" | null) => json(`${api}/access`, owner, "PUT", { username: collaborator, role });
  const ack = (username: string, unreadId: string) => json(`${api}/access-seen`, username, "PUT", { unreadId });
  assert.deepEqual(await shared(collaborator), []);
  await request(`${api}/access-requests`, collaborator, { method: "POST", headers: { origin }, redirect: "manual" });
  const { requests } = await (await request(`${api}/access`, owner)).json();
  assert.equal((await json(`${api}/access-requests/${requests[0].id}`, owner, "PUT", { role: "read" })).status, 200);
  assert.deepEqual(await shared(owner), []);
  assert.deepEqual(await shared("charlie"), []);
  const [first] = await shared(collaborator);
  assert.equal(first.isNew, true);
  assert.equal(first.sharedBy, owner);
  assert.equal(first.canEdit, false);
  assert.equal(first.path, `/p/${slug}`);
  assert.equal((await request(api, collaborator, { method: "HEAD" })).status, 200);
  const page = await (await request(first.path, collaborator)).text();
  const unreadId = /"unreadGrantId":"([^"]+)"/.exec(page)?.[1];
  assert.ok(unreadId);
  assert.equal((await shared(collaborator))[0].isNew, true);
  assert.equal((await ack("charlie", unreadId)).status, 404);
  assert.equal((await ack(owner, unreadId)).status, 204);
  assert.equal((await shared(collaborator))[0].isNew, true);
  assert.equal((await ack(collaborator, unreadId)).status, 204);
  assert.equal((await shared(collaborator))[0].isNew, false);
  assert.equal(PadStore.open(dataDir, true).getLivePad(slug)?.grants?.[0]?.unreadId, undefined);
  await grant("edit");
  assert.equal((await shared(collaborator))[0].isNew, false);
  await grant(null);
  assert.deepEqual(await shared(collaborator), []);
  await grant("edit");
  await ack(collaborator, unreadId);
  assert.equal((await shared(collaborator))[0].isNew, true);
});

test("account events notify only the parties to a request or share", async (t) => {
  const { request, json, socket } = await setup(t);
  await rejected(socket("/events"), 403);
  await rejected(socket("/events", owner, { origin: "https://elsewhere.test" }), 403);
  await json("/api/pads", owner, "POST", { slug });
  const access = `${api}/access`;
  assert.equal((await json(access, owner, "PUT", { username: "unknown", role: "read" })).status, 409);
  await request("/default", "charlie");
  assert.deepEqual((await (await request(access, owner)).json()).eligibleUsers, ["charlie"]);
  const ownerEvents = socket("/events", owner);
  const recipientEvents = socket("/events", collaborator);
  const directEvents = socket("/events", "charlie");
  await Promise.all([ownerEvents, recipientEvents, directEvents].map((ws) => once(ws, "open")));
  const notices: string[] = [];
  directEvents.on("message", (message) => notices.push(message.toString()));
  const incoming = control(ownerEvents, "access-changed");
  await request(`${api}/access-requests`, collaborator, { method: "POST", redirect: "manual" });
  assert.deepEqual(await incoming, { type: "access-changed" });
  const { requests, eligibleUsers } = await (await request(access, owner)).json();
  assert.deepEqual(eligibleUsers, ["charlie"]);
  const approved = control(recipientEvents, "access-changed");
  await json(`${api}/access-requests/${requests[0].id}`, owner, "PUT", { role: "read" });
  assert.deepEqual(await approved, { type: "access-changed" });
  assert.deepEqual(notices, []);
  const direct = control(directEvents, "access-changed");
  await json(access, owner, "PUT", { username: "charlie", role: "edit" });
  assert.deepEqual(await direct, { type: "access-changed" });
  assert.deepEqual((await (await request(access, owner)).json()).eligibleUsers, []);
  assert.equal((await json(access, owner, "PUT", { username: "charlie", role: "read", createOnly: true })).status, 409);
});

test("seen revisions are account-scoped, monotonic and bounded by socket delivery", async (t) => {
  const { request, json, socket } = await setup(t);
  await json("/api/pads", owner, "POST", { slug });
  await request("/default", collaborator);
  await json(`${api}/access`, owner, "PUT", { username: collaborator, role: "read" });
  const reader = socket(slug, collaborator);
  const writer = socket(slug, owner);
  await Promise.all([control(reader, "replay-done"), control(writer, "replay-done")]);
  const seen = async (revision: number) => {
    const accepted = control(reader, "seen-accepted");
    reader.send(`seen:${revision}`);
    assert.equal((await accepted).revision, revision);
  };
  const shared = async () => (await (await request("/api/my-spaces", collaborator)).json()).sharedSpaces[0];
  reader.send("seen:9999");
  await seen(0);
  const revision = control(reader, "revision");
  writer.send(Buffer.from([7, 8]));
  assert.equal((await revision).revision, 1);
  assert.equal((await shared()).changed, true);
  assert.ok((await shared()).updatedAt);
  await seen(1);
  await seen(0);
  assert.equal((await shared()).changed, false);
  const fileRevision = control(reader, "revision");
  const uploaded = await request(`${api}/attachments`, owner, { method: "POST", body: Buffer.from("file") });
  assert.equal(uploaded.status, 201);
  assert.equal((await fileRevision).revision, 2);
  assert.equal((await shared()).changed, true);
});
