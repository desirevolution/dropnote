/**
 * Attachment HTTP endpoints (slug-scoped, so they generalize to future
 * Pads): chunked, streamed upload to disk, download of the original bytes
 * and deletion. Blob contents live in the Pad's directory; the flat
 * attachment list itself is metadata in the Pad's Yjs document (ADR-0002)
 * and is maintained by the clients — this router only handles the bytes.
 *
 * Uploads stream: the request body is piped to disk chunk by chunk, so a
 * 1 GB-class file never sits in memory whole. Size limits are enforced from
 * the Content-Length header when present and by counting streamed bytes
 * otherwise (chunked transfer encoding), so a lying or missing length
 * cannot smuggle an oversized blob past the limits.
 */
import { createReadStream, createWriteStream, mkdirSync, unlink, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { BLOB_ID_PATTERN, type PadStore } from "./store.ts";
import type { Config } from "./config.ts";
import type { PinAuthority } from "./pin.ts";
import { hasPadProof, writeFailure } from "./pad-access.ts";
import { getPadOrAnswer404, requestUsername, type NoPadAnswer } from "./pad-request.ts";

/** The Attachment endpoints' answer for a Slug or blob that does not exist. */
const noSuchAttachment: NoPadAnswer = (res) => {
  res.status(404).json({ error: "No such Attachment" });
};

export interface AttachmentDeps {
  store: PadStore;
  config: Config;
  pins: PinAuthority;
}

/** The per-file or global-instance limit that rejected an upload. */
export class AttachmentLimitViolation extends Error {
  readonly kind: "file" | "global";
  readonly status = 413;

  constructor(kind: "file" | "global", config: Config) {
    super(
      kind === "file"
        ? `The file exceeds the per-file size limit (${formatBytes(config.maxFileSizeBytes)})`
        : `The upload would exceed this instance's storage limit (${formatBytes(config.maxInstanceSizeBytes)})`,
    );
    this.kind = kind;
  }
}

export function attachmentsRouter({ store, config, pins }: AttachmentDeps): Router {
  const router = Router();
  const activeUploads = new Set<string>();

  // Upload: a streamed body of raw bytes becomes one blob of the Pad.
  router.post("/:slug/attachments", upload);
  // Download: the original bytes exactly as they were uploaded.
  router.get("/:slug/attachments/:blobId", download);
  // Deletion: removes the blob server-side; the deleting client removes the
  // list entry from the Pad's Yjs document (visible metadata, ADR-0002).
  router.delete("/:slug/attachments/:blobId", remove);

  return router;

  function upload(req: Request, res: Response): void {
    const pad = getPadOrAnswer404(store, req.params.slug as string, res);
    if (!pad) return;
    const { slug } = pad;
    // On a PIN-protected Pad, attaching is editing — it needs the capability
    // (a Reader only ever downloads). Answered before any byte is read.
    const failure = writeFailure(pad, pins, req.headers, requestUsername(res));
    if (failure) {
      rejectUnauthorizedWrite(req, res, failure);
      return;
    }

    // The body is stored exactly as it arrives, on Plain and Encrypted Pads
    // alike: on an Encrypted Pad the client seals it chunk-wise before any
    // byte is sent (ADR-0001), so the server relays a container it cannot
    // read — Zero-Knowledge means it never inspects the bytes to tell.
    const requestedId = req.get("x-upload-id");
    if (requestedId !== undefined && !BLOB_ID_PATTERN.test(requestedId)) {
      res.status(400).json({ error: "The upload ID is invalid" });
      return;
    }
    const blobId = requestedId ?? randomBytes(16).toString("hex");
    const stored = pad.blobs?.[blobId];
    if (stored) {
      req.pause();
      res.once("finish", () => req.destroy());
      res.status(201).json({ blobId, size: stored.size });
      return;
    }
    const uploadKey = `${slug}/${blobId}`;
    if (activeUploads.has(uploadKey)) {
      req.pause();
      res.once("finish", () => req.destroy());
      res.status(409).json({ error: "This file is still uploading. Try again shortly." });
      return;
    }

    const declaredSize = contentLengthOf(req);
    if (declaredSize !== null) {
      const tooBig = limitViolated(declaredSize);
      if (tooBig) {
        reject(req, res, tooBig);
        return;
      }
    }

    const partialPath = `${store.blobPath(slug, blobId)}.${randomBytes(8).toString("hex")}.part`;
    mkdirSync(store.attachmentDir(slug), { recursive: true });
    const blobStream = createWriteStream(partialPath, { flags: "wx" });

    activeUploads.add(uploadKey);
    blobStream.once("close", () => activeUploads.delete(uploadKey));
    let received = 0;
    let finished = false;

    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      const tooBig = limitViolated(received);
      if (tooBig) {
        // Stop reading: an oversized stream must not keep flowing.
        req.pause();
        req.unpipe(blobStream);
        blobStream.destroy();
        discard();
        reject(req, res, tooBig);
      }
    });

    req.on("aborted", () => {
      // The client went away mid-upload; the partial bytes never count.
      blobStream.destroy();
      discard();
    });

    // A socket error mid-upload (e.g. ECONNRESET) must not surface as an
    // unhandled stream error — clean up and answer what is still answerable.
    req.on("error", () => {
      blobStream.destroy();
      discard();
    });

    blobStream.on("error", (error) => {
      discard();
      fail(error);
    });

    blobStream.on("finish", () => finalize());

    req.pipe(blobStream);

    /** The body arrived whole: promote the partial blob to a real one. */
    function finalize(): void {
      if (finished) return;
      finished = true;
      const tooBig = limitViolated(received);
      if (tooBig) {
        discard();
        reject(req, res, tooBig);
        return;
      }
      const livePad = store.getLivePad(slug);
      if (!livePad || livePad !== pad) {
        discard();
        noSuchAttachment(res);
        return;
      }
      const username = requestUsername(res);
      if (username !== null) {
        const failure = writeFailure(livePad, pins, req.headers, username);
        if (failure) {
          discard();
          res.status(403).json({ error: failure });
          return;
        }
      }
      try {
        // Promote and book the bytes together before another upload can finish.
        renameSync(partialPath, store.blobPath(slug, blobId));
        store.recordBlob(slug, blobId, received);
        res.status(201).json({ blobId, size: received });
      } catch (error) {
        discard();
        unlink(store.blobPath(slug, blobId), () => {});
        fail(error);
      }
    }

    /** Deletes the partial blob; aborted bytes never count toward storage. */
    function discard(): void {
      unlink(partialPath, () => {});
    }

    function fail(cause: unknown): void {
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        return;
      }
      console.error("attachment upload failed:", cause);
      res.status(500).json({ error: "Attachment upload failed" });
    }
  }

  function download(req: Request, res: Response): void {
    const pad = getPadOrAnswer404(store, req.params.slug as string, res, noSuchAttachment);
    if (!pad) return;
    const { slug } = pad;
    if (!hasPadProof(pad, req.headers["x-pad-proof"])) {
      res.status(403).json({ error: "Unlock the encrypted Pad before downloading files" });
      return;
    }
    if (pad.kind === "encrypted") res.set("Cache-Control", "no-store");
    const blobId = req.params.blobId as string | undefined;
    if (typeof blobId !== "string" || !BLOB_ID_PATTERN.test(blobId) || !pad.blobs?.[blobId]) {
      noSuchAttachment(res);
      return;
    }

    // The filename lives in the Pad's Yjs attachment list (client metadata);
    // a sanitized `name` query parameter lets the browser save a useful name.
    res.attachment(sanitizeFilename(pad.kind === "encrypted" ? undefined : req.query.name));
    res.status(200);
    // Opened lazily, after the response status is already decided, so an
    // error (e.g. disk loss) still lands as a clean JSON 404.
    const blob = createReadStream(store.blobPath(slug, blobId));
    blob.on("error", () => {
      // The index lists the blob but its bytes are gone (e.g. disk loss).
      if (res.headersSent) {
        res.destroy();
      } else {
        res.status(404).json({ error: "No such Attachment" });
      }
    });
    blob.pipe(res);
    // A client that walks away mid-download must not leave the read stream open.
    res.on("close", () => blob.destroy());
  }

  function remove(req: Request, res: Response): void {
    const pad = getPadOrAnswer404(store, req.params.slug as string, res, noSuchAttachment);
    if (!pad) return;
    const { slug } = pad;
    const blobId = req.params.blobId as string | undefined;
    if (typeof blobId !== "string" || !BLOB_ID_PATTERN.test(blobId) || !pad.blobs?.[blobId]) {
      noSuchAttachment(res);
      return;
    }
    const failure = writeFailure(pad, pins, req.headers, requestUsername(res));
    if (failure) {
      rejectUnauthorizedWrite(req, res, failure);
      return;
    }
    unlink(store.blobPath(slug, blobId), (unlinkError) => {
      if (unlinkError && unlinkError.code !== "ENOENT") {
        console.error("attachment deletion failed:", unlinkError);
        res.status(500).json({ error: "Attachment deletion failed" });
        return;
      }
      if (store.getPad(slug) === pad) store.forgetBlob(slug, blobId);
      res.status(204).end();
    });
  }

  function limitViolated(size: number): AttachmentLimitViolation | null {
    if (size > config.maxFileSizeBytes) return new AttachmentLimitViolation("file", config);
    if (store.usageBytes() + size > config.maxInstanceSizeBytes) {
      return new AttachmentLimitViolation("global", config);
    }
    return null;
  }

  function reject(req: Request, res: Response, violation: AttachmentLimitViolation): void {
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }
    // The (possibly oversized) body is not consumed; once the error is out,
    // the socket must go so a still-streaming client cannot stall the server.
    req.pause();
    res.status(violation.status).json({ error: violation.message });
    res.once("finish", () => req.destroy());
  }

  /** Refuses an upload or removal on a PIN-protected Pad without a capability. */
  function rejectUnauthorizedWrite(req: Request, res: Response, message: string): void {
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }
    // The (unauthorized) body is not consumed either; same socket discipline.
    req.pause();
    res.status(403).json({ error: message });
    res.once("finish", () => req.destroy());
  }
}

function contentLengthOf(req: Request): number | null {
  const raw = req.headers["content-length"];
  if (raw === undefined) return null;
  const size = Number(raw);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function sanitizeFilename(raw: unknown): string {
  const name = typeof raw === "string" ? raw : "";
  const cleaned = name.replace(/[\\/\r\n"\u0000-\u001f]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "attachment";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${bytes / 1024 ** 3} GB`;
  if (bytes >= 1024 ** 2) return `${bytes / 1024 ** 2} MB`;
  if (bytes >= 1024) return `${bytes / 1024} KB`;
  return `${bytes} bytes`;
}
