/**
 * Instance hardening (ticket 06): the optional instance PIN gates only the
 * creation of additional Pads, while reading and editing existing Pads never
 * requires it; rate limiting is always on and throttles Slug guessing,
 * creation attempts and upload bursts. Everything is driven black-box over
 * HTTP (seam 1); every gate and limit is env-configurable.
 */
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTempDataDir, startServer } from "./helpers/server.ts";
import { SyncClient, waitFor } from "./helpers/sync-client.ts";

interface PadsRequestResult {
  status: number;
  body: Record<string, unknown>;
}

interface HttpResponse {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

async function request(url: string, init?: RequestInit): Promise<HttpResponse> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, headers: response.headers, body };
}

async function createPad(baseUrl: string, body: unknown = {}): Promise<PadsRequestResult> {
  const response = await fetch(`${baseUrl}/api/pads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test("with the instance PIN set, creating a Pad requires it", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { INSTANCE_PIN: "123456" } });
  try {
    await test("a creation without a PIN is rejected", async () => {
      const { status, body } = await createPad(server.baseUrl, { slug: "first-try" });
      assert.equal(status, 403, "the instance refuses Pad creation without its PIN");
      assert.match(String(body.error), /pin/i, "the error talks about the instance PIN");
    });

    await test("a wrong PIN is rejected", async () => {
      const { status, body } = await createPad(server.baseUrl, { slug: "first-try", instancePin: "000000" });
      assert.equal(status, 403);
      assert.match(String(body.error), /incorrect|wrong/i, "the error says the PIN is wrong");
    });

    await test("the correct PIN creates the Pad", async () => {
      const { status, body } = await createPad(server.baseUrl, { slug: "first-try", instancePin: "123456" });
      assert.equal(status, 201, "the correct instance PIN unlocks creation");
      assert.equal(body.slug, "first-try");
    });
  } finally {
    await server.stop();
  }
});

test("without an instance PIN (the default), creation stays open", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const { status } = await createPad(server.baseUrl, { slug: "open-creation" });
    assert.equal(status, 201, "the default instance needs no PIN to create Pads");
  } finally {
    await server.stop();
  }
});

test("reading and editing existing Pads never requires the instance PIN", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { INSTANCE_PIN: "246810" } });
  try {
    const created = await createPad(server.baseUrl, { slug: "shared-topic", instancePin: "246810" });
    assert.equal(created.status, 201);

    const root = await fetch(`${server.baseUrl}/`);
    assert.equal(root.status, 200, "the Default Pad is readable without the instance PIN");

    const padPage = await fetch(`${server.baseUrl}/p/shared-topic`);
    assert.equal(padPage.status, 200, "an existing Pad is readable without the instance PIN");

    const editor = await SyncClient.connect(server.baseUrl, "shared-topic");
    try {
      editor.editNote((note) => note.insert(0, "edited without any PIN\n"));
      await waitFor(() => editor.noteText().includes("edited without any PIN"), "the Note edit propagating");
    } finally {
      await editor.close();
    }

    const upload = await fetch(`${server.baseUrl}/api/pads/shared-topic/attachments`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: randomBytes(64),
    });
    assert.equal(upload.status, 201, "attaching to an existing Pad needs no instance PIN");
  } finally {
    await server.stop();
  }
});

test("the creation form asks for the instance PIN only when one is set", async () => {
  const dataDir = await makeTempDataDir();
  const pinned = await startServer({ dataDir, env: { INSTANCE_PIN: "135790" } });
  try {
    const body = await (await fetch(`${pinned.baseUrl}/`)).text();
    const input = /<input[^>]*id="new-pad-pin"[^>]*>/.exec(body)?.[0];
    assert.ok(input, "the form offers an instance-PIN field");
    assert.match(input, /type="password"/, "the PIN field does not echo what is typed");
  } finally {
    await pinned.stop();
  }

  const open = await startServer({ dataDir: await makeTempDataDir() });
  try {
    const body = await (await fetch(`${open.baseUrl}/`)).text();
    assert.doesNotMatch(body, /id="new-pad-pin"/, "with creation open, no PIN field is offered");
  } finally {
    await open.stop();
  }
});

test("rate limiting is on by default and throttles repeated Slug guessing", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    // Default budget: 120 requests per window (RATE_LIMIT_MAX, RATE_LIMIT_WINDOW).
    for (let guess = 0; guess < 120; guess++) {
      const answer = await request(`${server.baseUrl}/p/guess-${guess}`);
      assert.equal(answer.status, 404, `guess #${guess + 1} is answered before the limit`);
    }
    const blocked = await request(`${server.baseUrl}/p/guess-121`);
    assert.equal(blocked.status, 429, "the 121st guess from one client is throttled");
    assert.match(String(blocked.body.error), /too many/i, "the error says the client is throttled");
    assert.match(blocked.headers.get("retry-after") ?? "", /^\d+$/, "Retry-After names the wait in seconds");
  } finally {
    await server.stop();
  }
});

test("the env-configurable limit throttles repeated creation attempts", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { RATE_LIMIT_MAX: "3" } });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const answer = await createPad(server.baseUrl, { slug: `attempt-${attempt}` });
      assert.equal(answer.status, 201, `creation #${attempt + 1} succeeds within the limit`);
    }
    const blocked = await createPad(server.baseUrl, { slug: "attempt-4" });
    assert.equal(blocked.status, 429, "the 4th creation attempt in the window is throttled");
    assert.match(String(blocked.body.error), /too many/i);
  } finally {
    await server.stop();
  }
});

test("upload bursts get rate-limited", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { RATE_LIMIT_MAX: "4" } });
  try {
    const created = await createPad(server.baseUrl, { slug: "burst-pad" });
    assert.equal(created.status, 201, "the Pad itself is created within the limit");

    for (let upload = 0; upload < 3; upload++) {
      const answer = await request(`${server.baseUrl}/api/pads/burst-pad/attachments`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: randomBytes(32),
      });
      assert.equal(answer.status, 201, `upload #${upload + 1} succeeds within the limit`);
    }

    const blocked = await request(`${server.baseUrl}/api/pads/burst-pad/attachments`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: randomBytes(32),
    });
    assert.equal(blocked.status, 429, "the burst is throttled once the window budget is spent");
    assert.match(String(blocked.body.error), /too many/i);
  } finally {
    await server.stop();
  }
});

test("the env-configurable window reopens after it passes", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { RATE_LIMIT_MAX: "1", RATE_LIMIT_WINDOW: "1s" } });
  try {
    const first = await createPad(server.baseUrl, { slug: "window-1" });
    assert.equal(first.status, 201, "the first creation in the window succeeds");

    const second = await createPad(server.baseUrl, { slug: "window-2" });
    assert.equal(second.status, 429, "the next creation in the same window is throttled");

    // Poll instead of sleeping a fixed time: as soon as the 1s window has
    // rolled over, creation works again.
    const deadline = Date.now() + 5_000;
    for (;;) {
      const retry = await createPad(server.baseUrl, { slug: "window-3" });
      if (retry.status === 201) break;
      assert.equal(retry.status, 429, "the request stays throttled until the window passes");
      assert.ok(Date.now() < deadline, "the window reopens on its own");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    await server.stop();
  }
});

test("an invalid rate-limit setting fails boot with a clear error", async () => {
  const dataDir = await makeTempDataDir();
  const { runServerUntilExit } = await import("./helpers/server.ts");

  await test("RATE_LIMIT_MAX=0 is rejected", async () => {
    const { code, stderr } = await runServerUntilExit({ dataDir, env: { RATE_LIMIT_MAX: "0" } });
    assert.notEqual(code, 0, "boot fails");
    assert.match(stderr, /RATE_LIMIT_MAX/, "the error names the offending variable");
  });

  await test('RATE_LIMIT_WINDOW=0s is rejected', async () => {
    const { code, stderr } = await runServerUntilExit({ dataDir, env: { RATE_LIMIT_WINDOW: "0s" } });
    assert.notEqual(code, 0, "boot fails");
    assert.match(stderr, /RATE_LIMIT_WINDOW/, "the error names the offending variable");
  });
});
