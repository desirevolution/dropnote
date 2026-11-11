import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getFreePort, makeTempDataDir, runServerUntilExit, startServer } from "./helpers/server.ts";
import { assertDefaultPadPage, assertJsonNotFound, fetchProbe, readPadMetadata } from "./helpers/smoke.ts";

test("site root serves the Default Pad page with an empty Note", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await assertDefaultPadPage(fetchProbe(server.baseUrl));
  } finally {
    await server.stop();
  }
});

test("behavior-relevant settings come from environment variables", async () => {
  await test("the server stores its data in the configured DATA_DIR", async () => {
    const dataDir = await makeTempDataDir();
    const server = await startServer({ dataDir });
    try {
      assert.ok(existsSync(dataDir), "the configured data directory exists");
      assert.ok(readdirSync(dataDir).length >= 1, "the server keeps its state inside the data directory");
    } finally {
      await server.stop();
    }
  });

  await test("the server listens on the configured PORT", async () => {
    const dataDir = await makeTempDataDir();
    const port = await getFreePort();
    const server = await startServer({ dataDir, env: { PORT: String(port) } });
    try {
      assert.equal(server.port, port, "the server honors PORT instead of picking one");
      const response = await fetch(`${server.baseUrl}/`);
      assert.equal(response.status, 200);
    } finally {
      await server.stop();
    }
  });

  await test("an invalid PORT fails boot with a clear error", async () => {
    const dataDir = await makeTempDataDir();
    const { code, stderr } = await runServerUntilExit({ dataDir, env: { PORT: "not-a-port" } });
    assert.notEqual(code, 0, "boot fails");
    assert.match(stderr, /PORT/, "the error names the offending variable");
  });

  await test("a DATA_DIR that cannot be used fails boot with a clear error", async () => {
    const dataDir = await makeTempDataDir();
    const filePath = path.join(dataDir, "occupied");
    writeFileSync(filePath, "a file, not a directory");
    const { code, stderr } = await runServerUntilExit({ dataDir: filePath, env: {} });
    assert.notEqual(code, 0, "boot fails");
    assert.match(stderr, /DATA_DIR/, "the error names the offending variable");
    assert.ok(statSync(filePath).isFile(), "the failing path itself is untouched");
  });
});

test("malformed requests receive clear JSON errors instead of stack traces", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    await test("an unknown path answers 404 as JSON", async () => {
      await assertJsonNotFound(fetchProbe(server.baseUrl));
    });

    await test("a malformed JSON body answers 400 as JSON", async () => {
      const response = await fetch(`${server.baseUrl}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"broken',
      });
      assert.equal(response.status, 400);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
      const text = await response.text();
      const body = JSON.parse(text) as { error: string };
      assert.match(body.error, /malformed/i, "the error says what is wrong with the request");
      assert.doesNotMatch(text, /stack|at\s+\S+:\d+/, "no stack trace leaks into the response");
    });

    await test("an unsupported method answers as JSON, not HTML", async () => {
      const response = await fetch(`${server.baseUrl}/`, { method: "DELETE" });
      assert.equal(response.status, 404);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    });
  } finally {
    await server.stop();
  }
});

test("the Default Pad persists across a server restart", async () => {
  const dataDir = await makeTempDataDir();

  const first = await startServer({ dataDir });
  const firstPage = await (await fetch(`${first.baseUrl}/`)).text();
  const firstPad = readPadMetadata(firstPage);
  await first.stop();

  const second = await startServer({ dataDir });
  try {
    const secondPage = await (await fetch(`${second.baseUrl}/`)).text();
    const secondPad = readPadMetadata(secondPage);
    assert.equal(secondPad.slug, firstPad.slug, "the same Default Pad is served after the restart");
    assert.equal(secondPad.createdAt, firstPad.createdAt, "the persisted Default Pad record is reused, not recreated");
  } finally {
    await second.stop();
  }

  // Guard against the assertion passing trivially: a fresh data directory
  // really does get a fresh Default Pad record.
  const fresh = await startServer({ dataDir: await makeTempDataDir() });
  try {
    const freshPage = await (await fetch(`${fresh.baseUrl}/`)).text();
    const freshPad = readPadMetadata(freshPage);
    assert.notEqual(freshPad.createdAt, firstPad.createdAt, "a fresh data directory seeds a new Default Pad");
  } finally {
    await fresh.stop();
  }
});
