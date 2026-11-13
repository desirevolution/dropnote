/**
 * Additional Pads (ticket 04): creation via POST /api/pads, two-word Slug
 * generation with custom-Slug override, reserved route names, the
 * env-configurable PAD_PATH prefix, the TTL choice with its persisted
 * expiry, the cleanup sweep, and the not-found page. Everything is driven
 * black-box over HTTP (seam 1); Live-Sync reuse is verified with the same
 * headless Yjs clients as the Default Pad.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import { makeTempDataDir, startServer } from "./helpers/server.ts";
import { SyncClient, waitFor } from "./helpers/sync-client.ts";

interface CreatedPad {
  slug: string;
  path: string;
  createdAt: string;
  expiresAt: string | null;
}

interface PadsRequestResult {
  status: number;
  body: Record<string, unknown>;
}

async function createPad(baseUrl: string, body: unknown = {}): Promise<PadsRequestResult> {
  const response = await fetch(`${baseUrl}/api/pads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function readPadMetadata(html: string): { slug: string; createdAt: string } {
  const match = /<script type="application\/json" id="pad-metadata">(.*?)<\/script>/s.exec(html);
  const captured = match?.[1];
  assert.ok(captured, "the Pad page carries its Pad metadata");
  return JSON.parse(captured) as { slug: string; createdAt: string };
}

test("creating a Pad generates a two-word Slug and opens its Share Link", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const first = await createPad(server.baseUrl);
    assert.equal(first.status, 201, "creation succeeds");
    const pad = first.body as unknown as CreatedPad;
    assert.match(pad.slug, /^[a-z]+-[a-z]+$/, "the generated Slug is two lowercase words joined by a hyphen");
    assert.equal(pad.path, `/p/${pad.slug}`, "the Share Link path sits under the default path prefix");

    const page = await fetch(`${server.baseUrl}${pad.path}`);
    assert.equal(page.status, 200, "the new Pad opens at its own URL");
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
    const metadata = readPadMetadata(await page.text());
    assert.equal(metadata.slug, pad.slug, "the page serves exactly the created Pad");
  } finally {
    await server.stop();
  }
});

test("every generated two-word Slug is unique", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const slugs = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const { status, body } = await createPad(server.baseUrl);
      assert.equal(status, 201);
      slugs.add((body as unknown as CreatedPad).slug);
    }
    assert.equal(slugs.size, 25, "no two creations share a Slug");
  } finally {
    await server.stop();
  }
});

test("a free custom Slug is accepted, a taken one is rejected with a clear error", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const first = await createPad(server.baseUrl, { slug: "project-notes" });
    assert.equal(first.status, 201, "a free custom Slug is accepted");
    assert.equal((first.body as unknown as CreatedPad).path, "/p/project-notes");

    const second = await createPad(server.baseUrl, { slug: "project-notes" });
    assert.equal(second.status, 409, "a taken Slug is rejected");
    assert.match(String(second.body.error), /project-notes/, "the error names the contested Slug");
    assert.match(String(second.body.error), /already/i, "the error says the Slug is taken");
  } finally {
    await server.stop();
  }
});

test("a custom Slug must be a valid address segment", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    for (const bad of ["UPPER", "with space", "-leading", "trailing-", "a".repeat(64), ""] ) {
      const { status, body } = await createPad(server.baseUrl, { slug: bad });
      assert.equal(status, 400, `"${bad}" is rejected`);
      assert.match(String(body.error), /slug/i, "the error talks about the Slug");
    }
  } finally {
    await server.stop();
  }
});

test("reserved route names cannot be used as a Slug", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    for (const reserved of ["default", "api", "sync", "js"]) {
      const { status, body } = await createPad(server.baseUrl, { slug: reserved });
      assert.equal(status, 400, `"${reserved}" is a reserved route name`);
      assert.match(String(body.error), /reserved/i, "the error says the name is reserved");
    }
  } finally {
    await server.stop();
  }
});

test("Pad URLs live under the env-configurable path prefix", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { PAD_PATH: "/notes" } });
  try {
    const { status, body } = await createPad(server.baseUrl);
    assert.equal(status, 201);
    const pad = body as unknown as CreatedPad;
    assert.match(pad.path, /^\/notes\//, "the Share Link uses the configured prefix");

    const page = await fetch(`${server.baseUrl}${pad.path}`);
    assert.equal(page.status, 200, "the Pad opens under the configured prefix");

    const oldPrefix = await fetch(`${server.baseUrl}/p/${pad.slug}`);
    assert.equal(oldPrefix.status, 404, "the default prefix does not serve the Pad");
  } finally {
    await server.stop();
  }
});

test("an invalid PAD_PATH fails boot with a clear error", async () => {
  const dataDir = await makeTempDataDir();
  const { code, stderr } = await import("./helpers/server.ts").then(({ runServerUntilExit }) =>
    runServerUntilExit({ dataDir, env: { PAD_PATH: "notes" } }),
  );
  assert.notEqual(code, 0, "boot fails");
  assert.match(stderr, /PAD_PATH/, "the error names the offending variable");
});

test("a nonexistent Slug shows a not-found page", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    for (const url of [`${server.baseUrl}/p/no-such-pad`, `${server.baseUrl}/p`]) {
      const response = await fetch(url);
      assert.equal(response.status, 404, `${url} answers 404`);
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/, "the not-found answer is a page, not a JSON error");
      const body = await response.text();
      assert.match(body, /not found/i, "the page says the Pad is not there");
      assert.doesNotMatch(body, /stack\s*at/i, "no stack traces leak into the page");
    }
  } finally {
    await server.stop();
  }
});

test("the Default Pad stays reachable while additional Pads exist", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await createPad(server.baseUrl, { slug: "side-topic" });
    const root = await fetch(`${server.baseUrl}/`);
    assert.equal(root.status, 200, "the site root still serves the Default Pad");
    assert.equal(readPadMetadata(await root.text()).slug, "default");
  } finally {
    await server.stop();
  }
});

test("the TTL is chosen at creation with the 7-day default and a never option", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await test("the default TTL is 7 days", async () => {
      const { status, body } = await createPad(server.baseUrl);
      assert.equal(status, 201);
      const pad = body as unknown as CreatedPad;
      assert.ok(pad.expiresAt, "a Pad without an explicit TTL expires");
      const expected = Date.parse(pad.createdAt) + 7 * 24 * 3_600 * 1_000;
      assert.ok(
        Math.abs(Date.parse(pad.expiresAt) - expected) < 5_000,
        `the expiry sits 7 days after creation, got ${pad.expiresAt}`,
      );
    });

    await test("an explicit TTL preset is honored", async () => {
      const { status, body } = await createPad(server.baseUrl, { ttl: 3_600 });
      assert.equal(status, 201);
      const pad = body as unknown as CreatedPad;
      const expected = Date.parse(pad.createdAt) + 3_600 * 1_000;
      assert.ok(Math.abs(Date.parse(pad.expiresAt!) - expected) < 5_000, `one hour TTL, got ${pad.expiresAt}`);
    });

    await test('"never" creates a Pad without expiry', async () => {
      const { status, body } = await createPad(server.baseUrl, { ttl: "never" });
      assert.equal(status, 201);
      assert.equal((body as unknown as CreatedPad).expiresAt, null, "no expiry is persisted");
    });

    await test("an invalid TTL is rejected with a clear error", async () => {
      for (const ttl of [0, -5, 1.5, "soon"]) {
        const { status, body } = await createPad(server.baseUrl, { ttl });
        assert.equal(status, 400, `TTL ${JSON.stringify(ttl)} is rejected`);
        assert.match(String(body.error), /ttl/i, "the error talks about the TTL");
      }
    });
  } finally {
    await server.stop();
  }
});

test("DEFAULT_TTL bounds the TTL default offered at creation", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { DEFAULT_TTL: "1h" } });
  try {
    const { status, body } = await createPad(server.baseUrl);
    assert.equal(status, 201);
    const pad = body as unknown as CreatedPad;
    const expected = Date.parse(pad.createdAt) + 3_600 * 1_000;
    assert.ok(Math.abs(Date.parse(pad.expiresAt!) - expected) < 5_000, `the env default TTL applies, got ${pad.expiresAt}`);
  } finally {
    await server.stop();
  }
});

test("the cleanup sweep deletes expired Pads including all their files", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { CLEANUP_SWEEP_SECONDS: "1" } });
  try {
    const fleeting = await createPad(server.baseUrl, { slug: "fleeting-pad", ttl: 1 });
    assert.equal(fleeting.status, 201);
    const lasting = await createPad(server.baseUrl, { slug: "lasting-pad", ttl: 3_600 });
    assert.equal(lasting.status, 201);

    // Give the fleeting Pad real stored content: a Note edit persisted in
    // its sync log — the sweep must take the files with the Pad.
    const writer = await SyncClient.connect(server.baseUrl, "fleeting-pad");
    writer.editNote((note) => note.insert(0, "doomed content"));
    await writer.close();

    const deadline = Date.now() + 10_000;
    let swept = false;
    while (Date.now() < deadline) {
      const response = await fetch(`${server.baseUrl}/p/fleeting-pad`);
      if (response.status === 404 && !existsSync(path.join(dataDir, "pads", "fleeting-pad"))) {
        swept = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(swept, "the expired Pad disappears without the test sleeping a fixed time");

    const page = await fetch(`${server.baseUrl}/p/fleeting-pad`);
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/, "the expired Pad shows the not-found page");

    const stillThere = await fetch(`${server.baseUrl}/p/lasting-pad`);
    assert.equal(stillThere.status, 200, "a Pad whose TTL has not ended survives the sweep");

    const root = await fetch(`${server.baseUrl}/`);
    assert.equal(root.status, 200, "the Default Pad (no TTL) survives the sweep");

    const stranger = new WebSocket(server.syncUrl("fleeting-pad"));
    const syncOutcome = await new Promise<"open" | "refused">((resolve) => {
      stranger.on("open", () => resolve("open"));
      stranger.on("error", () => resolve("refused"));
    });
    assert.equal(syncOutcome, "refused", "a deleted Pad no longer has a sync endpoint");

    assert.equal(
      existsSync(path.join(dataDir, "pads", "fleeting-pad")),
      false,
      "the expired Pad's files (its sync history) are deleted with it",
    );
  } finally {
    await server.stop();
  }
});

test("the Pad page offers Pad creation with the TTL choice and My spaces", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const body = await (await fetch(`${server.baseUrl}/`)).text();

    const form = /<form[^>]*id="new-pad-form"/.exec(body);
    assert.ok(form, "a creation form is on the page");
    assert.match(body, /id="new-pad-name"[\s\S]*?id="new-pad-options"[\s\S]*?id="new-pad-slug"[\s\S]*?id="new-pad-url-preview"/,
      "the display name appears before the advanced URL field and preview");
    const ttl = /<select[^>]*id="new-pad-ttl"[^>]*>([\s\S]*?)<\/select>/.exec(body)?.[1];
    assert.ok(ttl, "a TTL choice is offered");
    assert.match(ttl, /<option value="default" selected>Instance default \(7 days\)<\/option>/, "the 7-day instance default is preselected");
    assert.match(ttl, /<option value="604800">7 days<\/option>/, "a 7-day preset exists");
    assert.match(ttl, /<option value="never">Never<\/option>/, "a never option exists");
    assert.match(body, /<button[^>]*type="submit"[^>]*>\s*Create space\s*<\/button>/, "a create button submits the form");

    assert.match(body, /<ul[^>]*id="owned-spaces-list"/, "My spaces is available in single-user mode");
    assert.doesNotMatch(body, /id="my-pads-list"|id="clear-my-pads"/);
  } finally {
    await server.stop();
  }
});

test("creation accepts a display name independently of the URL address", async (t) => {
  const server = await startServer({ dataDir: await makeTempDataDir(), env: { PAD_PATH: "/spaces" } });
  t.after(() => server.stop());
  const name = "Meeting-Notizen Köln & <Team>";
  const named = await createPad(server.baseUrl, { displayName: `  ${name}  ` });
  assert.equal(named.status, 201);
  assert.equal(named.body.displayName, name);
  assert.match(String(named.body.path), /^\/spaces\/[a-z]+-[a-z]+$/);

  const custom = await createPad(server.baseUrl, { slug: "weekly-notes", displayName: name });
  assert.equal(custom.status, 201);
  assert.equal(custom.body.path, "/spaces/weekly-notes");
  const page = await (await fetch(`${server.baseUrl}${custom.body.path}`)).text();
  assert.match(page, /<h1 id="space-heading">Meeting-Notizen Köln &amp; &lt;Team&gt;<\/h1>/);
  assert.match(page, /id="new-pad-url-preview"><code>\/spaces\//);

  const addressOnly = await createPad(server.baseUrl, { slug: "address-only", displayName: " " });
  assert.equal(addressOnly.status, 201);
  assert.equal(addressOnly.body.displayName, null);
  assert.match(await (await fetch(`${server.baseUrl}${addressOnly.body.path}`)).text(), /<h1 id="space-heading">Address only<\/h1>/);
  for (const invalidName of [123, "First\nSecond", "a".repeat(81)]) {
    assert.equal((await createPad(server.baseUrl, { displayName: invalidName })).status, 400);
  }
});

test("an additional Pad's page carries the same tools as the Default Pad", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const created = await createPad(server.baseUrl, { slug: "project-notes" });
    assert.equal(created.status, 201);
    const body = await (await fetch(`${server.baseUrl}/p/project-notes`)).text();
    assert.match(body, /<h1[^>]*>\s*Project notes\s*<\/h1>/, "the page names the additional Pad");
    assert.match(body, /<form[^>]*id="new-pad-form"/, "Pad creation is offered here too");
    assert.match(body, /<ul[^>]*id="owned-spaces-list"/, "My spaces is here too");
  } finally {
    await server.stop();
  }
});

test("DEFAULT_TTL bounds the TTL default offered in the creation form", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { DEFAULT_TTL: "1h" } });
  try {
    const body = await (await fetch(`${server.baseUrl}/`)).text();
    const ttl = /<select[^>]*id="new-pad-ttl"[^>]*>([\s\S]*?)<\/select>/.exec(body)?.[1] ?? "";
    assert.match(ttl, /<option value="default" selected>Instance default \(1 hour\)<\/option>/, "the env-configured default is preselected");
  } finally {
    await server.stop();
  }
});

test("an additional Pad syncs, merges and persists like the Default Pad", async () => {
  const dataDir = await makeTempDataDir();
  const first = await startServer({ dataDir });
  let created: PadsRequestResult;
  try {
    created = await createPad(first.baseUrl, { slug: "team-scratch" });
    assert.equal(created.status, 201);

    const alice = await SyncClient.connect(first.baseUrl, "team-scratch");
    const bob = await SyncClient.connect(first.baseUrl, "team-scratch");
    try {
      alice.editNote((note) => note.insert(0, "Alice's line\n"));
      bob.editNote((note) => note.insert(0, "Bob's line\n"));
      await waitFor(() => alice.noteText() === bob.noteText(), "the additional Pad's clients converging");
      assert.match(alice.noteText(), /Alice's line/, "Alice's keystrokes survive");
      assert.match(bob.noteText(), /Bob's line/, "Bob's keystrokes survive");
    } finally {
      await Promise.all([alice.close(), bob.close()]);
    }
  } finally {
    await first.stop();
  }

  const second = await startServer({ dataDir });
  try {
    const page = await fetch(`${second.baseUrl}/p/team-scratch`);
    assert.equal(page.status, 200, "the additional Pad is still there after the restart");
    const reader = await SyncClient.connect(second.baseUrl, "team-scratch");
    try {
      assert.match(reader.noteText(), /Alice's line[\s\S]*Bob's line|Bob's line[\s\S]*Alice's line/, "the Note survived the restart");
    } finally {
      await reader.close();
    }
  } finally {
    await second.stop();
  }
});
