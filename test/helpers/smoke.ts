import assert from "node:assert/strict";

export interface PadMetadata {
  slug: string;
  createdAt: string;
}

/** The part of an HTTP response the API smoke facts look at. */
export interface ProbeResponse {
  status: number;
  contentType: string;
  body: string;
}

/** A minimal request description, usable by fetch and by marshalled probes. */
export interface ProbeRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Performs one HTTP request and returns its marshalled response. The API
 * smoke facts are asserted over this seam, so the same facts can be driven
 * against a local server (fetchProbe) and against a Docker container
 * (an exec-based probe) without duplicating the assertions.
 */
export type Probe = (path: string, request?: ProbeRequest) => Promise<ProbeResponse>;

/** A probe that talks to a running server directly over HTTP. */
export function fetchProbe(baseUrl: string): Probe {
  return async (path, request = {}) => {
    const response = await fetch(`${baseUrl}${path}`, request);
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: await response.text(),
    };
  };
}

/** Reads the Pad metadata JSON every Pad page embeds. */
export function readPadMetadata(html: string): PadMetadata {
  const match = /<script type="application\/json" id="pad-metadata">(.*?)<\/script>/s.exec(html);
  const captured = match?.[1];
  assert.ok(captured, "the Pad page carries its Pad metadata");
  return JSON.parse(captured) as PadMetadata;
}

/**
 * Fact 1 of the API smoke facts: the site root serves the Default Pad page —
 * HTML naming the Default Pad, with an empty Note and no leaked stack traces.
 * Returns the page's Pad metadata (the deployment smoke test compares it
 * across a container replacement).
 */
export async function assertDefaultPadPage(probe: Probe): Promise<PadMetadata> {
  const response = await probe("/");
  assert.equal(response.status, 200, "site root must answer 200");

  assert.match(response.contentType, /^text\/html/, "the Default Pad page is HTML");

  assert.match(response.body, /<h1 class="visually-hidden">Default<\/h1>/, "the shared space has an accessible heading");
  assert.match(response.body, /<div id="note"><\/div>/, "the Note starts out empty");
  assert.doesNotMatch(response.body, /stack\s*at/i, "no stack traces leak into the page");
  return readPadMetadata(response.body);
}

/**
 * Fact 2 of the API smoke facts: an unknown path answers 404 as JSON with a
 * clear error — never an HTML error page or a stack trace.
 */
export async function assertJsonNotFound(probe: Probe): Promise<void> {
  const response = await probe("/no-such-route");
  assert.equal(response.status, 404);
  assert.match(response.contentType, /^application\/json/);
  const body = JSON.parse(response.body) as { error: string };
  assert.equal(typeof body.error, "string");
  assert.ok(body.error.length > 0);
}

/** Both API smoke facts in one pass, against any running instance. */
export async function assertApiSmokeFacts(probe: Probe): Promise<PadMetadata> {
  const metadata = await assertDefaultPadPage(probe);
  await assertJsonNotFound(probe);
  return metadata;
}
