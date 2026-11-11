/**
 * MAX_TTL (spec: Implementation Decisions — TTL is bounded by env config):
 * the longest lifetime a Pad may be given on this instance, in the same
 * duration formats as DEFAULT_TTL. Driven black-box over HTTP: accepted
 * TTLs, rejected TTLs with a clear error, the creation form's preset list
 * never offering above the bound, and boot failures on incoherent config.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTempDataDir, runServerUntilExit, startServer } from "./helpers/server.ts";

interface CreatedPad {
  createdAt: string;
  expiresAt: string | null;
}

async function createPad(baseUrl: string, body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/pads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test("MAX_TTL allows TTLs up to the bound and rejects anything above it", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { DEFAULT_TTL: "1h", MAX_TTL: "1h" } });
  try {
    const atBound = await createPad(server.baseUrl, { slug: "at-the-bound", ttl: 3_600 });
    assert.equal(atBound.status, 201, "a TTL exactly at MAX_TTL is accepted");
    const pad = atBound.body as unknown as CreatedPad;
    const expected = Date.parse(pad.createdAt!) + 3_600 * 1_000;
    assert.ok(Math.abs(Date.parse(pad.expiresAt!) - expected) < 5_000, `one hour, got ${pad.expiresAt}`);

    for (const above of [7_200, 2_592_000]) {
      const rejected = await createPad(server.baseUrl, { ttl: above });
      assert.equal(rejected.status, 400, `TTL ${above}s exceeds MAX_TTL and is rejected`);
      assert.match(String(rejected.body.error), /MAX_TTL|maximum/i, "the error names the bound");
    }

    const never = await createPad(server.baseUrl, { ttl: "never" });
    assert.equal(never.status, 400, '"never" exceeds any bound and is rejected');
    assert.match(String(never.body.error), /MAX_TTL|maximum/i);

    const extended = await fetch(`${server.baseUrl}/api/pads/at-the-bound/ttl`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ttl: 7_200 }),
    });
    assert.equal(extended.status, 400, "TTL extension is bounded too");
  } finally {
    await server.stop();
  }
});

test("MAX_TTL keeps the creation form from offering presets above the bound", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { DEFAULT_TTL: "1h", MAX_TTL: "1h" } });
  try {
    const body = await (await fetch(`${server.baseUrl}/`)).text();
    const options = /<select[^>]*id="new-pad-ttl"[^>]*>([\s\S]*?)<\/select>/.exec(body)?.[1] ?? "";
    assert.match(options, /value="3600"/, "the 1-hour preset at the bound is still offered");
    assert.doesNotMatch(options, /value="86400"/, "24 hours is above MAX_TTL and not offered");
    assert.doesNotMatch(options, /value="604800"/, "7 days is above MAX_TTL and not offered");
    assert.doesNotMatch(options, /value="2592000"/, "30 days is above MAX_TTL and not offered");
    assert.doesNotMatch(options, /value="never"/, '"never" is above MAX_TTL and not offered');
  } finally {
    await server.stop();
  }
});

test("without MAX_TTL, long presets and \"never\" keep working", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const long = await createPad(server.baseUrl, { slug: "long-lived", ttl: 2_592_000 });
    assert.equal(long.status, 201, "30 days is accepted by default");
    const never = await createPad(server.baseUrl, { slug: "immortal", ttl: "never" });
    assert.equal(never.status, 201, '"never" is accepted by default');
  } finally {
    await server.stop();
  }
});

test("an absurd MAX_TTL fails boot with a clear error", async () => {
  for (const value of ["0s", "banana"]) {
    const dataDir = await makeTempDataDir();
    const { code, stderr } = await runServerUntilExit({ dataDir, env: { MAX_TTL: value } });
    assert.notEqual(code, 0, `MAX_TTL=${value} refuses to boot`);
    assert.match(stderr, /MAX_TTL/, "the error names the variable");
  }
});

test("a MAX_TTL shorter than DEFAULT_TTL fails boot with a clear error", async () => {
  const dataDir = await makeTempDataDir();
  const { code, stderr } = await runServerUntilExit({ dataDir, env: { DEFAULT_TTL: "1h", MAX_TTL: "30m" } });
  assert.notEqual(code, 0, "an incoherent TTL config refuses to boot");
  assert.match(stderr, /MAX_TTL/, "the error names the variable");
});
