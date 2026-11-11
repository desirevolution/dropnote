/**
 * Attachment tests: uploads, downloads, deletion and size limits are driven
 * through the HTTP API of the real server (seam 1, black box). The flat
 * attachment list itself lives in the Pad's Yjs document (ADR-0002) and is
 * observed with the same headless clients the Live-Sync tests use.
 */
import { randomBytes } from "node:crypto";
import http from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTempDataDir, startServer } from "./helpers/server.ts";
import { SyncClient, waitFor, type AttachmentEntry } from "./helpers/sync-client.ts";

const DEFAULT_SLUG = "default";

function attachmentsUrl(baseUrl: string, slug = DEFAULT_SLUG): string {
  return `${baseUrl}/api/pads/${slug}/attachments`;
}

test("an uploaded Attachment can be downloaded with its original bytes", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const original = randomBytes(256 * 1024); // binary, not a friendly text case
    const response = await fetch(attachmentsUrl(server.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: original,
    });
    assert.equal(response.status, 201, "upload succeeds and stores a new blob");
    const uploaded = await response.json() as { blobId?: unknown; size?: unknown };
    assert.equal(typeof uploaded.blobId, "string", "the upload names the stored blob");
    assert.equal(uploaded.size, original.length, "the upload reports the stored size");

    const download = await fetch(`${attachmentsUrl(server.baseUrl)}/${uploaded.blobId}`);
    assert.equal(download.status, 200, "the Attachment downloads");
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.deepEqual(bytes, original, "download delivers the original file bytes");
  } finally {
    await server.stop();
  }
});

test("uploads above the per-file limit are rejected with a clear error", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir, env: { MAX_FILE_SIZE: "1KB" } });
  try {
    await test("an unknown Slug answers a clear 404 instead of storing anything", async () => {
      const response = await fetch(attachmentsUrl(server.baseUrl, "no-such-pad"), {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: randomBytes(16),
      });
      assert.equal(response.status, 404);
      const body = await response.json() as { error?: unknown };
      assert.match(body.error as string, /No Pad/);
    });

    await test("a declared Content-Length above the limit is rejected before the body is read", async () => {
      const response = await fetch(attachmentsUrl(server.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: randomBytes(2048),
      });
      assert.equal(response.status, 413, "the oversized upload is rejected");
      const body = await response.json() as { error?: unknown };
      assert.equal(typeof body.error, "string");
      assert.match(body.error as string, /per-file/, "the error names the per-file limit");
    });

    await test("a chunked upload without Content-Length cannot dodge the limit", async () => {
      const status = await uploadChunked(server.baseUrl, DEFAULT_SLUG, randomBytes(2048));
      assert.equal(status, 413, "the streamed-oversized upload is rejected mid-stream");
    });

    await test("nothing oversized was stored; a small upload still works afterwards", async () => {
      const small = randomBytes(512);
      const ok = await fetch(attachmentsUrl(server.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: small,
      });
      assert.equal(ok.status, 201, "uploads below the limit still succeed");
      const { blobId } = await ok.json() as { blobId: string };
      const missing = await fetch(`${attachmentsUrl(server.baseUrl)}/ffffffffffffffffffffffffffffffff`);
      assert.equal(missing.status, 404, "the rejected oversized upload stored no blob");
    });
  } finally {
    await server.stop();
  }
});

test("uploads that would exceed the global instance limit are rejected with a clear error", async () => {
  const dataDir = await makeTempDataDir();
  // 1KB instance limit with the default 1GB per-file limit: only the global
  // limit can reject a 600-byte upload.
  const server = await startServer({ dataDir, env: { MAX_INSTANCE_SIZE: "1KB" } });
  try {
    const first = await fetch(attachmentsUrl(server.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: randomBytes(600),
    });
    assert.equal(first.status, 201, "the first upload fits inside the instance limit");

    const second = await fetch(attachmentsUrl(server.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: randomBytes(600),
    });
    assert.equal(second.status, 413, "the upload that would exceed the instance limit is rejected");
    const body = await second.json() as { error?: unknown };
    assert.equal(typeof body.error, "string");
    assert.match(body.error as string, /instance|storage/, "the error names the instance storage limit");
    assert.doesNotMatch(body.error as string, /per-file/, "the per-file limit is not the one complaining");
  } finally {
    await server.stop();
  }
});

test("deleting an Attachment removes its bytes and frees storage", async () => {
  const dataDir = await makeTempDataDir();
  // The instance only ever fits one of the two 600-byte blobs: the second
  // upload succeeding proves the first one's bytes are really gone.
  const server = await startServer({ dataDir, env: { MAX_INSTANCE_SIZE: "1KB" } });
  try {
    const upload = await fetch(attachmentsUrl(server.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: randomBytes(600),
    });
    assert.equal(upload.status, 201);
    const { blobId } = await upload.json() as { blobId: string };

    const deleted = await fetch(`${attachmentsUrl(server.baseUrl)}/${blobId}`, { method: "DELETE" });
    assert.equal(deleted.status, 204, "deletion succeeds");

    const gone = await fetch(`${attachmentsUrl(server.baseUrl)}/${blobId}`);
    assert.equal(gone.status, 404, "the deleted Attachment no longer downloads");

    const again = await fetch(attachmentsUrl(server.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: randomBytes(600),
    });
    assert.equal(again.status, 201, "the deleted blob's storage was freed");

    await test("deleting an unknown or malformed blob answers a clear 404", async () => {
      const unknown = await fetch(`${attachmentsUrl(server.baseUrl)}/${"f".repeat(32)}`, { method: "DELETE" });
      assert.equal(unknown.status, 404);
      const malformed = await fetch(`${attachmentsUrl(server.baseUrl)}/..%2Fetc%2Fpasswd`, { method: "DELETE" });
      assert.equal(malformed.status, 404, "malformed blob IDs cannot escape the Pad's directory");
      const download = await fetch(`${attachmentsUrl(server.baseUrl)}/..%2Fetc%2Fpasswd`);
      assert.equal(download.status, 404, "malformed blob IDs cannot escape on download either");
    });
  } finally {
    await server.stop();
  }
});

test("attachment additions and removals appear live on the other connected side", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const uploader = await SyncClient.connect(server.baseUrl, DEFAULT_SLUG);
    const observer = await SyncClient.connect(server.baseUrl, DEFAULT_SLUG);
    try {
      const bytes = randomBytes(1024);
      const upload = await fetch(attachmentsUrl(server.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      });
      assert.equal(upload.status, 201);
      const { blobId } = await upload.json() as { blobId: string };

      const entry: AttachmentEntry = {
        blobId,
        name: "photo.bin",
        size: bytes.length,
        contentType: "application/octet-stream",
        addedAt: new Date().toISOString(),
      };
      uploader.addAttachment(entry);

      await waitFor(() => observer.attachmentList().length === 1, "the Attachment appearing on the other side");
      assert.deepEqual(observer.attachmentList()[0], entry, "the other side sees the same visible metadata");

      // Deletion: blob server-side plus the metadata entry in the CRDT.
      const removed = await fetch(`${attachmentsUrl(server.baseUrl)}/${blobId}`, { method: "DELETE" });
      assert.equal(removed.status, 204);
      uploader.removeAttachment(blobId);

      await waitFor(() => observer.attachmentList().length === 0, "the removal propagating to the other side");
    } finally {
      await Promise.all([uploader.close(), observer.close()]);
    }
  } finally {
    await server.stop();
  }
});

test("a client joining later sees the Pad's current attachment list from the replay", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const first = await SyncClient.connect(server.baseUrl, DEFAULT_SLUG);
    const bytes = randomBytes(64);
    const upload = await fetch(attachmentsUrl(server.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    });
    const { blobId } = await upload.json() as { blobId: string };
    first.addAttachment({ blobId, name: "tiny.txt", size: bytes.length, contentType: "text/plain", addedAt: new Date().toISOString() });

    const latecomer = await SyncClient.connect(server.baseUrl, DEFAULT_SLUG);
    try {
      await waitFor(
        () => latecomer.attachmentList().length === 1 && latecomer.attachmentList()[0]?.blobId === blobId,
        "the latecomer replaying the attachment list",
      );
    } finally {
      await Promise.all([first.close(), latecomer.close()]);
    }
  } finally {
    await server.stop();
  }
});

/**
 * Uploads bytes with chunked transfer encoding (no Content-Length), the way
 * a streaming client would; resolves with the HTTP status. Write errors that
 * follow the server's early rejection are tolerated.
 */function uploadChunked(baseUrl: string, slug: string, payload: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}/api/pads/${slug}/attachments`, { method: "POST" }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
      response.on("error", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", (error: NodeJS.ErrnoException) => {
      // The server may cut the connection once it rejects mid-stream.
      if (error.code === "EPIPE" || error.code === "ECONNRESET") return;
      reject(error);
    });
    request.end(payload);
  });
}
