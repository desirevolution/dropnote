/**
 * Per-Pad PIN (ticket 05): an optional 4–10 digit PIN set at creation; a
 * Share Link alone is read-only (the relay rejects submitted updates);
 * entering the PIN unlocks editing plus management (TTL
 * extension). PIN checks are constant-time with a lockout after repeated
 * failures. Everything is driven black-box over HTTP + WebSocket (seam 1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { makeTempDataDir, startServer } from "./helpers/server.ts";
import { SyncClient, waitFor } from "./helpers/sync-client.ts";

/** Exchanges a Pad's PIN for a capability token (asserting success). */
async function tokenFor(baseUrl: string, slug: string, pin: string): Promise<string> {
  const result = await requestPin(baseUrl, slug, { pin });
  assert.equal(result.status, 200, `the PIN unlocks ${slug}`);
  return result.body.token as string;
}

/** The management endpoint that extends a Pad's TTL. */
async function extendTtl(baseUrl: string, slug: string, body: unknown, token?: string): Promise<RequestResult> {
  const response = await fetch(`${baseUrl}/api/pads/${encodeURIComponent(slug)}/ttl`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return toResult(response);
}

interface CreatedPad {
  slug: string;
  path: string;
  createdAt: string;
  expiresAt: string | null;
  pinProtected?: boolean;
}

interface RequestResult {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

async function createPad(baseUrl: string, body: unknown = {}): Promise<RequestResult> {
  const response = await fetch(`${baseUrl}/api/pads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return toResult(response);
}

async function requestPin(baseUrl: string, slug: string, body: unknown): Promise<RequestResult> {
  const response = await fetch(`${baseUrl}/api/pads/${encodeURIComponent(slug)}/pin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return toResult(response);
}

async function toResult(response: Response): Promise<RequestResult> {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text.length > 0) {
    body = JSON.parse(text) as Record<string, unknown>;
  }
  const headers: Record<string, string> = {};
  for (const name of ["retry-after"]) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return { status: response.status, body, headers };
}

function readPadMetadata(html: string): { slug: string; pinProtected: boolean } {
  const match = /<script type="application\/json" id="pad-metadata">(.*?)<\/script>/s.exec(html);
  const captured = match?.[1];
  assert.ok(captured, "the Pad page carries its Pad metadata");
  return JSON.parse(captured) as { slug: string; pinProtected: boolean };
}

test("creating a Pad can set an optional 4–10 digit PIN", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const created = await createPad(server.baseUrl, { slug: "vaulted", pin: "1234" });
    assert.equal(created.status, 201, "a Pad with a valid PIN is created");
    const pad = created.body as unknown as CreatedPad;
    assert.equal(pad.pinProtected, true, "the creation response marks the Pad PIN-protected");

    const page = await fetch(`${server.baseUrl}${pad.path}`);
    const html = await page.text();
    const metadata = readPadMetadata(html);
    assert.equal(metadata.pinProtected, true, "the page tells the frontend this Pad is PIN-protected");
    assert.match(html, /id="pin-unlock"/, "the page offers the PIN unlock form");
  } finally {
    await server.stop();
  }
});

test("the creation form offers an optional per-Pad PIN field", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const body = await (await fetch(`${server.baseUrl}/`)).text();
    const input = /<input[^>]*id="new-pad-pad-pin"[^>]*>/.exec(body)?.[0];
    assert.ok(input, "the form offers a per-Pad PIN field distinct from the instance PIN field");
    assert.match(input, /type="password"/, "the per-Pad PIN field does not echo what is typed");
    assert.match(input, /inputmode="numeric"/, "mobile browsers get a digits keyboard");
    assert.match(input, /maxlength="10"/, "the 4–10 digit length is hinted to the browser");
    assert.doesNotMatch(body, /id="new-pad-pin"/, "with creation open, the instance PIN field stays hidden");
  } finally {
    await server.stop();
  }
});

test("with an instance PIN required, the creation form carries both PIN fields", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { INSTANCE_PIN: "135790" } });
  try {
    const body = await (await fetch(`${server.baseUrl}/`)).text();
    assert.match(body, /id="new-pad-pad-pin"/, "the per-Pad PIN field is always offered");
    assert.match(body, /id="new-pad-pin"/, "the instance PIN field appears when one is required");
  } finally {
    await server.stop();
  }
});

test("a Pad created without a PIN is open: the Share Link implies editing", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const created = await createPad(server.baseUrl, { slug: "open-pad" });
    assert.equal(created.status, 201);
    const pad = created.body as unknown as CreatedPad;
    assert.equal(pad.pinProtected, false, "no PIN given means no PIN");

    const page = await fetch(`${server.baseUrl}${pad.path}`);
    const html = await page.text();
    const metadata = readPadMetadata(html);
    assert.equal(metadata.pinProtected, false, "the page marks the Pad as not PIN-protected");
    assert.match(html, /<section[^>]*id="pin-unlock"[^>]*hidden/, "the unlock form stays hidden without a PIN");
  } finally {
    await server.stop();
  }
});

test("a PIN must be a string of 4–10 digits", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    for (const pin of ["123", "12345678901", "12a4", "1 4", "", 1234, null]) {
      const result = await createPad(server.baseUrl, { slug: "shorty", pin });
      assert.equal(result.status, 400, `the PIN ${JSON.stringify(pin)} is rejected`);
      assert.match(String(result.body.error), /PIN/, "the error names the PIN");
    }
  } finally {
    await server.stop();
  }
});

test("the PIN endpoint exchanges a correct PIN for a short-lived capability token", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "2468" });
    const auth = await requestPin(server.baseUrl, "gated", { pin: "2468" });
    assert.equal(auth.status, 200, "the correct PIN is accepted");
    assert.match(String(auth.body.token), /^[0-9a-f]{32,}$/, "a capability token is issued");
    assert.equal(typeof auth.body.expiresIn, "number", "the token carries its lifetime");
    assert.ok((auth.body.expiresIn as number) > 0 && (auth.body.expiresIn as number) <= 3_600, "the token is short-lived");
  } finally {
    await server.stop();
  }
});

test("a wrong PIN is refused with the attempts that remain", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "2468" });
    const first = await requestPin(server.baseUrl, "gated", { pin: "0000" });
    assert.equal(first.status, 403, "a wrong PIN is refused");
    assert.equal(first.body.attemptsRemaining, 4, "the failure is counted");
    const second = await requestPin(server.baseUrl, "gated", { pin: "1111" });
    assert.equal(second.body.attemptsRemaining, 3, "each failure counts down");
  } finally {
    await server.stop();
  }
});

test("a successful PIN clears earlier failures", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "2468" });
    await requestPin(server.baseUrl, "gated", { pin: "0000" });
    const recovered = await requestPin(server.baseUrl, "gated", { pin: "2468" });
    assert.equal(recovered.status, 200, "the correct PIN still works after a failure");
    await requestPin(server.baseUrl, "gated", { pin: "2468" }); // token already held; must not error
    const fresh = await requestPin(server.baseUrl, "gated", { pin: "0000" });
    assert.equal(fresh.body.attemptsRemaining, 4, "the failure count restarted after the success");
  } finally {
    await server.stop();
  }
});

test("five failed attempts lock the client IP out for the lockout duration", async () => {
  const dataDir = await makeTempDataDir();
  // Injectable timing: the lockout duration comes from the environment so
  // the expiry can be observed in a test run (default: 15 minutes).
  const server = await startServer({ dataDir, env: { PIN_LOCKOUT_SECONDS: "1" } });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "2468" });
    for (let remaining = 4; remaining >= 1; remaining--) {
      const attempt = await requestPin(server.baseUrl, "gated", { pin: "0000" });
      assert.equal(attempt.status, 403, `failure ${5 - remaining} of 5 is refused`);
      assert.equal(attempt.body.attemptsRemaining, remaining);
    }
    const fifth = await requestPin(server.baseUrl, "gated", { pin: "0000" });
    assert.equal(fifth.status, 423, "the fifth failure locks the client IP out");
    assert.ok(Number(fifth.headers["retry-after"]) >= 1, "the answer says when to retry");

    const correctWhileLocked = await requestPin(server.baseUrl, "gated", { pin: "2468" });
    assert.equal(correctWhileLocked.status, 423, "even the correct PIN is refused while locked out");

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const afterLockout = await requestPin(server.baseUrl, "gated", { pin: "2468" });
    assert.equal(afterLockout.status, 200, "the lockout expires and the correct PIN works again");
  } finally {
    await server.stop();
  }
});

test("the lockout lasts the configured 15 minutes by default", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "2468" });
    for (let i = 0; i < 5; i++) {
      await requestPin(server.baseUrl, "gated", { pin: "0000" });
    }
    const locked = await requestPin(server.baseUrl, "gated", { pin: "2468" });
    assert.equal(locked.status, 423, "still locked long after the test started");
    assert.ok(Number(locked.headers["retry-after"]) > 800, "roughly the full 15 minutes remain");
  } finally {
    await server.stop();
  }
});

test("the lockout is per client IP and Pad, and only counts PIN attempts", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "2468" });
    await createPad(server.baseUrl, { slug: "other", pin: "9876" });
    for (let i = 0; i < 5; i++) {
      await requestPin(server.baseUrl, "gated", { pin: "0000" });
    }
    const otherPad = await requestPin(server.baseUrl, "other", { pin: "9876" });
    assert.equal(otherPad.status, 200, "another Pad is not affected by this IP's lockout");

    const management = await fetch(`${server.baseUrl}/api/pads/gated/ttl`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ttl: 3600 }),
    });
    assert.equal(management.status, 403, "management is refused without a token — but is not counted as a PIN failure");
  } finally {
    await server.stop();
  }
});

test("the PIN endpoint answers unknown Pads and PIN-less Pads clearly", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const unknown = await requestPin(server.baseUrl, "no-such-pad", { pin: "1234" });
    assert.equal(unknown.status, 404, "an unknown Slug is a 404");

    await createPad(server.baseUrl, { slug: "open-pad" });
    const noPin = await requestPin(server.baseUrl, "open-pad", { pin: "1234" });
    assert.equal(noPin.status, 400, "a Pad without a PIN has nothing to exchange");
    assert.match(String(noPin.body.error), /no PIN/, "the error explains why");
  } finally {
    await server.stop();
  }
});

test("with a PIN set, a Share Link alone is read-only: the relay rejects submitted updates", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "1357" });
    const token = await tokenFor(server.baseUrl, "gated", "1357");

    // The Editor (PIN holder) writes; the Reader (Share Link only) reads it.
    const editor = await SyncClient.connect(server.baseUrl, "gated", { token });
    editor.editNote((note) => note.insert(0, "written with the PIN\n"));
    const reader = await SyncClient.connect(server.baseUrl, "gated");
    await waitFor(() => reader.noteText() === "written with the PIN\n", "the Reader receiving the Editor's Note");
    assert.equal(reader.noteText(), "written with the PIN\n", "reading needs no PIN");

    // The Reader's submitted update must go nowhere: not to the Editor,
    // not into the Pad's log.
    reader.editNote((note) => note.insert(0, "sneaky edit\n"));
    await waitFor(() => reader.writeRejections >= 1, "the relay rejecting the Reader's update");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(editor.noteText().includes("sneaky edit"), false, "the Editor never sees the Reader's edit");

    const fresh = await SyncClient.connect(server.baseUrl, "gated");
    try {
      assert.equal(
        fresh.noteText().includes("sneaky edit"),
        false,
        "the rejected update was never persisted into the Pad's log",
      );
      assert.equal(fresh.noteText(), "written with the PIN\n", "the Share Link still reads the Pad's real state");
    } finally {
      await fresh.close();
    }

    // Gating did not break the PIN holder's channel: later edits still reach
    // the Reader live (its own rejected edit stays a local artifact).
    editor.editNote((note) => note.insert(0, "more from the editor\n"));
    await waitFor(() => reader.noteText().includes("more from the editor\n"), "the Editor's later edit reaching the Reader");
  } finally {
    await server.stop();
  }
});

test("a capability token unlocks relay writes on a PIN-protected Pad", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "1357" });
    const token = await tokenFor(server.baseUrl, "gated", "1357");
    const client = await SyncClient.connect(server.baseUrl, "gated", { token });
    try {
      client.editNote((note) => note.insert(0, "typed with the token"));
      await waitFor(() => client.noteText() === "typed with the token", "the token client's edit landing");
      const again = await SyncClient.connect(server.baseUrl, "gated", { token });
      assert.equal(again.noteText(), "typed with the token", "the tokened edit was persisted and is replayed");
      await again.close();
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test("a forged or expired token is treated like no token at all", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "1357" });
    const reader = await SyncClient.connect(server.baseUrl, "gated", { token: "f".repeat(64) });
    try {
      reader.editNote((note) => note.insert(0, "forged"));
      await waitFor(() => reader.writeRejections >= 1, "the relay rejecting the forged capability");
      const fresh = await SyncClient.connect(server.baseUrl, "gated");
      try {
        assert.equal(fresh.noteText(), "", "nothing the forger sent was persisted");
      } finally {
        await fresh.close();
      }
    } finally {
      await reader.close();
    }
  } finally {
    await server.stop();
  }
});

test("a token issued for one Pad is worthless on another", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "1357" });
    await createPad(server.baseUrl, { slug: "second", pin: "2468" });
    const token = await tokenFor(server.baseUrl, "gated", "1357");
    const intruder = await SyncClient.connect(server.baseUrl, "second", { token });
    try {
      intruder.editNote((note) => note.insert(0, "crossing pads"));
      await waitFor(() => intruder.writeRejections >= 1, "the relay rejecting the foreign token");
      const fresh = await SyncClient.connect(server.baseUrl, "second");
      try {
        assert.equal(fresh.noteText(), "", "the foreign token never wrote to the second Pad");
      } finally {
        await fresh.close();
      }
    } finally {
      await intruder.close();
    }
  } finally {
    await server.stop();
  }
});

test("Pads without a PIN keep accepting every client's updates", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "open-pad" });
    const client = await SyncClient.connect(server.baseUrl, "open-pad");
    try {
      client.editNote((note) => note.insert(0, "anyone may write here"));
      await waitFor(() => client.noteText() === "anyone may write here", "the unauthenticated edit sticking");
      const fresh = await SyncClient.connect(server.baseUrl, "open-pad");
      try {
        assert.equal(fresh.noteText(), "anyone may write here", "the edit was persisted");
      } finally {
        await fresh.close();
      }
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test("extending a TTL requires the Pad's PIN when one is set", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "1357", ttl: 3_600 });

    const noToken = await extendTtl(server.baseUrl, "gated", { ttl: 86_400 });
    assert.equal(noToken.status, 403, "extension is refused without a capability");
    const forged = await extendTtl(server.baseUrl, "gated", { ttl: 86_400 }, "f".repeat(64));
    assert.equal(forged.status, 403, "a forged capability is refused");
    assert.match(await (await fetch(`${server.baseUrl}/p/gated`)).text(), /id="note"/, "the refused Pad still exists");

    const token = await tokenFor(server.baseUrl, "gated", "1357");
    const extended = await extendTtl(server.baseUrl, "gated", { ttl: 86_400 }, token);
    assert.equal(extended.status, 200, "the PIN holder may extend the TTL");
    const expiresAt = Date.parse(extended.body.expiresAt as string);
    assert.ok(expiresAt > Date.now() + 86_000 * 1_000, "the expiry moved a day out");

    const never = await extendTtl(server.baseUrl, "gated", { ttl: "never" }, token);
    assert.equal(never.status, 200);
    assert.equal(never.body.expiresAt, null, '"never" clears the expiry');

    const invalid = await extendTtl(server.baseUrl, "gated", { ttl: 0 }, token);
    assert.equal(invalid.status, 400, "a TTL of 0 seconds is refused");
    const unknown = await extendTtl(server.baseUrl, "no-such-pad", { ttl: 60 }, token);
    assert.equal(unknown.status, 404, "an unknown Pad cannot be extended");
  } finally {
    await server.stop();
  }
});

test("deleting a PIN-protected Pad in single-user mode needs no PIN", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "doomed", pin: "1357" });
    const deleted = await fetch(`${server.baseUrl}/api/pads/doomed`, { method: "DELETE" });
    assert.equal(deleted.status, 204, "the instance user may delete the Pad early");
    assert.equal((await fetch(`${server.baseUrl}/p/doomed`)).status, 404, "the Pad's page is gone");

    const stranger = new WebSocket(server.syncUrl("doomed"));
    const outcome = await new Promise<"open" | "refused">((resolve, reject) => {
      stranger.on("open", () => resolve("open"));
      stranger.on("error", () => resolve("refused"));
    });
    assert.equal(outcome, "refused", "the deleted Pad has no sync endpoint anymore");

    const recreated = await createPad(server.baseUrl, { slug: "doomed" });
    assert.equal(recreated.status, 201, "the freed Slug can be used again");
    assert.equal((recreated.body as unknown as CreatedPad).pinProtected, false, "the new Pad is a different Pad");
  } finally {
    await server.stop();
  }
});

test("when no PIN is set, the Share Link implies management too", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "open-pad", ttl: 3_600 });
    const extended = await extendTtl(server.baseUrl, "open-pad", { ttl: 86_400 });
    assert.equal(extended.status, 200, "extension needs no capability without a PIN");

    const deleted = await fetch(`${server.baseUrl}/api/pads/open-pad`, { method: "DELETE" });
    assert.equal(deleted.status, 204, "deletion needs no capability without a PIN");
  } finally {
    await server.stop();
  }
});

test("the Default Pad cannot be deleted", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const deleted = await fetch(`${server.baseUrl}/api/pads/default`, { method: "DELETE" });
    assert.equal(deleted.status, 403, "the Default Pad is out of reach for early deletion");
    assert.equal((await fetch(`${server.baseUrl}/`)).status, 200, "the site root still serves the Default Pad");
  } finally {
    await server.stop();
  }
});

test("on a PIN-protected Pad, attaching and removing Attachments requires the PIN too", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "gated", pin: "1357" });
    const token = await tokenFor(server.baseUrl, "gated", "1357");
    const bytes = "attachment bytes";

    const refused = await fetch(`${server.baseUrl}/api/pads/gated/attachments`, {
      method: "POST",
      headers: { "content-length": String(bytes.length) },
      body: bytes,
    });
    assert.equal(refused.status, 403, "uploading is refused without a capability");

    const attached = await fetch(`${server.baseUrl}/api/pads/gated/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-length": String(bytes.length) },
      body: bytes,
    });
    assert.equal(attached.status, 201, "the PIN holder may attach");
    const { blobId } = (await attached.json()) as { blobId: string };

    const download = await fetch(`${server.baseUrl}/api/pads/gated/attachments/${blobId}`);
    assert.equal(download.status, 200, "a Reader downloads without a capability");
    assert.equal(await download.text(), bytes, "the bytes survive the gate");

    const removeRefused = await fetch(`${server.baseUrl}/api/pads/gated/attachments/${blobId}`, { method: "DELETE" });
    assert.equal(removeRefused.status, 403, "removal is refused without a capability");

    const removed = await fetch(`${server.baseUrl}/api/pads/gated/attachments/${blobId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(removed.status, 204, "the PIN holder may remove the Attachment");
    assert.equal((await fetch(`${server.baseUrl}/api/pads/gated/attachments/${blobId}`)).status, 404, "the blob is gone");
  } finally {
    await server.stop();
  }
});
