import { createHash, createHmac, randomBytes, scrypt } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router, json, type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import * as Y from "yjs";
import type { Config } from "./config.ts";
import { renderGuestPage } from "./guest-page.ts";
import { detectLanguage } from "./locale.ts";
import { hasPadProof, padRole } from "./pad-access.ts";
import { getPadOrAnswer404, requestUsername } from "./pad-request.ts";
import { RateLimitCounter, rateLimiter } from "./ratelimit.ts";
import { SHARE_FRAGMENT_SCRIPT } from "./share-fragment.ts";
import { secureEquals } from "./secure-compare.ts";
import { BLOB_ID_PATTERN, isDefaultPad, type GuestLink, type PadRecord, type PadStore } from "./store.ts";
import { openUpdateLog } from "./update-log.ts";

const credentialPattern = /^[A-Za-z0-9_-]{43}$/;
const maxSnapshotBytes = 1024 * 1024;
const durations = { "1h": 3_600, "24h": 86_400, "7d": 604_800 };
const fragmentScriptHash = createHash("sha256").update(SHARE_FRAGMENT_SCRIPT).digest("base64");
const bundle = fileURLToPath(new URL("../public/js/guest.bundle.js", import.meta.url));

function randomCredential(): string {
  return randomBytes(32).toString("base64url");
}

function hashCredential(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function isGuestHost(host: string | undefined, guestOrigin: string | undefined): boolean {
  return guestOrigin !== undefined && host?.toLowerCase() === new URL(guestOrigin).host;
}

function expiry(pad: PadRecord, link: GuestLink): number {
  return Math.min(Date.parse(link.expiresAt), pad.expiresAt ? Date.parse(pad.expiresAt) : Infinity);
}

export function guestStatus(pad: PadRecord) {
  const link = pad.guestLink;
  if (!link || (pad.kind === "encrypted" && !link.snapshot) || !(expiry(pad, link) > Date.now())) return null;
  return {
    expiresAt: new Date(expiry(pad, link)).toISOString(),
    oneTime: link.oneTime,
    capturedAt: link.snapshot?.capturedAt ?? null,
    redeemedAt: link.redemption?.at ?? null,
  };
}

function passwordOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 12 && value.length <= 256 && value.trim() ? value : undefined;
}

function passwordHash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 ** 2 }, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString("base64url"));
    });
  });
}

async function passwordMatches(link: GuestLink, value: unknown): Promise<boolean> {
  const password = passwordOf(value);
  return Boolean(password && link.passwordSalt && secureEquals(await passwordHash(password, link.passwordSalt), link.proofHash));
}

function durationStatus(pad: PadRecord, now = Date.now()) {
  const ends = pad.expiresAt === null ? Infinity : Date.parse(pad.expiresAt);
  return {
    now,
    padExpiresAt: pad.expiresAt,
    durations: Object.entries(durations).filter(([, seconds]) => now + seconds * 1_000 <= ends).map(([value]) => value),
  };
}

export function guestManagement(store: PadStore, config: Config) {
  const router = Router();
  const path = "/:slug/guest-link";
  const owner: RequestHandler = (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    const pad = getPadOrAnswer404(store, req.params.slug as string, res);
    if (!pad) return;
    if (padRole(pad, requestUsername(res)) !== "owner" || isDefaultPad(pad.slug) || (pad.kind === "encrypted" && !pad.encryption)) {
      res.sendStatus(403);
      return;
    }
    const origin = req.get("Origin");
    if (req.method !== "GET" && req.method !== "HEAD" && origin !== new URL(config.baseUrl).origin) {
      res.sendStatus(403);
      return;
    }
    res.locals.guestPad = pad;
    next();
  };
  function sendLink(res: Response, pad: PadRecord) {
    const status = guestStatus(pad);
    res.json({ ...durationStatus(pad), link: status && { ...status, url: `${config.guestOrigin}/g/${pad.guestLink!.token}` } });
  }

  router.get(path, owner, (_req, res) => sendLink(res, res.locals.guestPad));
  router.put(path, owner, json({ limit: "2mb" }), async (req, res) => {
    const pad: PadRecord = res.locals.guestPad;
    const previous = pad.guestLink;
    const { duration, proofHash, oneTime, password: input } = req.body ?? {};
    if (!hasPadProof(pad, req.get("X-Pad-Proof"))) {
      res.status(403).json({ error: "Unlock the encrypted space to create a guest link." });
      return;
    }
    if (typeof duration !== "string" || !Object.hasOwn(durations, duration) || typeof oneTime !== "boolean") {
      res.sendStatus(400);
      return;
    }
    const rejectDuration = () => res.status(409).json({
      error: "The selected duration no longer fits the space's lifetime.",
      ...durationStatus(pad),
    });
    if (!durationStatus(pad).durations.includes(duration)) return void rejectDuration();
    let credentials: Pick<GuestLink, "proofHash" | "passwordSalt">;
    let snapshot: GuestLink["snapshot"];
    if (pad.kind === "plain") {
      const password = passwordOf(input);
      if (!password) return void res.status(400).json({ error: "Use a guest password with 12–256 characters." });
      const passwordSalt = randomBytes(16).toString("base64url");
      credentials = { passwordSalt, proofHash: await passwordHash(password, passwordSalt) };
    } else {
      if (typeof proofHash !== "string" || !credentialPattern.test(proofHash)) return void res.sendStatus(400);
      const { ciphertext, fileIds } = req.body?.snapshot ?? {};
      if (typeof ciphertext !== "string" || ciphertext.length > Math.ceil(maxSnapshotBytes * 4 / 3) ||
          !/^[A-Za-z0-9_-]+$/.test(ciphertext) || Buffer.from(ciphertext, "base64url").length < 29 ||
          !Array.isArray(fileIds) || fileIds.length > 10_000 ||
          fileIds.some((id) => typeof id !== "string" || !BLOB_ID_PATTERN.test(id))) {
        return void res.status(400).json({ error: "A valid encrypted snapshot is required." });
      }
      const files: Record<string, string> = {};
      for (const id of fileIds) {
        const blob = pad.blobs?.[id];
        if (blob) files[id] = blob.createdAt;
      }
      snapshot = { ciphertext, files, capturedAt: new Date().toISOString(), displayName: pad.displayName ?? pad.slug };
      credentials = { proofHash };
    }
    if (store.getLivePad(pad.slug) !== pad) return void res.sendStatus(404);
    const availability = durationStatus(pad);
    if (!availability.durations.includes(duration)) return void rejectDuration();
    if (pad.guestLink?.token !== previous?.token) {
      return void res.status(409).json({ error: "The guest link changed. Reopen the dialog to refresh it." });
    }
    const expiresAt = new Date(availability.now + durations[duration as keyof typeof durations] * 1_000).toISOString();
    store.setGuestLink(pad, { ...credentials, ...(snapshot ? { snapshot } : {}), token: randomCredential(), expiresAt, oneTime });
    sendLink(res, pad);
  });
  const checkPasswordLimit = rateLimiter(new RateLimitCounter({
    max: config.rateLimitMax, windowMs: config.rateLimitWindowSeconds * 1_000,
  }));
  router.post(path + "/check-password", owner, checkPasswordLimit, json({ limit: "4kb" }), async (req, res) => {
    const pad: PadRecord = res.locals.guestPad;
    const link = pad.guestLink;
    if (pad.kind !== "plain" || !link || !guestStatus(pad) || link.redemption) return void res.sendStatus(404);
    const ok = await passwordMatches(link, req.body?.password);
    res.sendStatus(ok && pad.guestLink === link && guestStatus(pad) ? 204 : 403);
  });
  router.delete(path, owner, (_req, res) => {
    const pad: PadRecord = res.locals.guestPad;
    if (pad.guestLink) store.setGuestLink(pad);
    res.sendStatus(204);
  });
  return router;
}

function plainSnapshot(updates: Buffer[]) {
  const doc = new Y.Doc();
  try {
    for (const update of updates) Y.applyUpdate(doc, update);
    return {
      note: doc.getText("note").toString(),
      files: doc.getArray<{ blobId: string; name: string; size: number }>("attachments").toArray()
        .filter((entry) => entry && typeof entry.name === "string" && typeof entry.blobId === "string" && BLOB_ID_PATTERN.test(entry.blobId))
        .map(({ blobId, name, size }) => ({ blobId, name, size })),
    };
  } finally {
    doc.destroy();
  }
}

export function guestRouter(
  store: PadStore,
  config: Config,
  origin: string,
  updates = (pad: PadRecord) => openUpdateLog(store.padDir(pad.slug)).updates(),
) {
  const router = Router({ caseSensitive: true });
  // Regular password sessions are scoped to an individual link and process.
  const sessionKey = randomBytes(32);
  function signSession(link: GuestLink, nonce: string) {
    return createHmac("sha256", sessionKey).update(link.token).update(nonce).digest("base64url");
  }
  router.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": `default-src 'none'; script-src 'self' 'sha256-${fragmentScriptHash}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
    next();
  });
  router.get("/g/client.js", (_req, res) => res.sendFile(bundle, { cacheControl: false }));
  router.use(rateLimiter(new RateLimitCounter({
    max: config.rateLimitMax, windowMs: config.rateLimitWindowSeconds * 1_000,
  })));

  const snapshots = new WeakMap<PadRecord, { frames: Buffer[]; count: number; content: ReturnType<typeof plainSnapshot> }>();
  function currentContent(pad: PadRecord) {
    const frames = updates(pad);
    let cached = snapshots.get(pad);
    if (!cached || cached.frames !== frames || cached.count !== frames.length) {
      cached = { frames, count: frames.length, content: plainSnapshot(frames) };
      snapshots.set(pad, cached);
    }
    return cached.content;
  }

  function find(token: string) {
    if (!credentialPattern.test(token)) return;
    const pad = store.padForGuestToken(token);
    const link = pad?.guestLink;
    const status = pad && guestStatus(pad);
    if (!pad || !link || !status || (pad.kind === "encrypted" ? !pad.encryption : !link.passwordSalt)) return;
    return { pad, link, status, encryption: pad.encryption };
  }

  router.get("/g/:token", (req, res) => {
    const guest = find(req.params.token);
    const available = guest && !guest.link.redemption;
    const language = detectLanguage(req.get("Accept-Language"));
    res.status(available ? 200 : 404).type("html").send(renderGuestPage(language, available ? {
      encryption: guest.encryption && { salt: guest.encryption.salt, check: guest.encryption.check }, oneTime: guest.link.oneTime,
    } : undefined));
  });

  router.post("/g/:token/open", json({ limit: "4kb" }), async (req, res) => {
    let guest = find(req.params.token);
    if (!guest || guest.link.redemption) return void res.sendStatus(404);
    if (req.get("Origin") !== origin) return void res.sendStatus(403);
    if (guest.encryption) {
      if (!verifyProof(guest.link, req.get("X-Guest-Proof"))) return void res.sendStatus(403);
    } else {
      const link = guest.link;
      if (!await passwordMatches(link, req.body?.password)) return void res.sendStatus(403);
      guest = find(req.params.token);
      if (!guest || guest.link !== link || guest.link.redemption) return void res.sendStatus(404);
    }
    const plain = guest.encryption ? null : currentContent(guest.pad);
    const response = {
      displayName: guest.link.snapshot?.displayName ?? guest.pad.displayName ?? guest.pad.slug,
      expiresAt: guest.status.expiresAt,
      ...(plain
        ? { note: plain.note, files: plain.files.filter(({ blobId }) => guest.pad.blobs?.[blobId]) }
        : { snapshot: guest.link.snapshot!.ciphertext, capturedAt: guest.link.snapshot!.capturedAt,
            fileIds: Object.entries(guest.link.snapshot!.files).filter(([id, createdAt]) =>
              guest.pad.blobs?.[id]?.createdAt === createdAt).map(([id]) => id) }),
    };
    if (guest.link.oneTime) {
      const session = randomCredential();
      store.setGuestLink(guest.pad, {
        ...guest.link, redemption: { at: new Date().toISOString(), sessionHash: hashCredential(session) },
      });
      res.json({ ...response, session });
    } else if (!guest.encryption) {
      const nonce = randomCredential();
      res.json({ ...response, session: nonce + "." + signSession(guest.link, nonce) });
    } else {
      res.json(response);
    }
  });

  router.get("/g/:token/files/:blobId", (req, res) => {
    const guest = find(req.params.token);
    const id = req.params.blobId;
    const blob = guest?.pad.blobs?.[id];
    if (!guest || !BLOB_ID_PATTERN.test(id) || !blob) return void res.sendStatus(404);
    const session = req.get("X-Guest-Session");
    const authorized = guest.link.oneTime
      ? Boolean(session && credentialPattern.test(session) && guest.link.redemption &&
          secureEquals(hashCredential(session), guest.link.redemption.sessionHash))
      : guest.encryption
        ? verifyProof(guest.link, req.get("X-Guest-Proof"))
        : Boolean(session && /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(session) &&
          secureEquals(session.slice(44), signSession(guest.link, session.slice(0, 43))));
    if (!authorized) return void res.sendStatus(404);
    const listed = guest.encryption ? guest.link.snapshot?.files[id] === blob.createdAt :
      currentContent(guest.pad).files.some((file) => file.blobId === id);
    if (!listed) return void res.sendStatus(404);
    res.type("application/octet-stream").sendFile(resolve(store.blobPath(guest.pad.slug, id)), { cacheControl: false });
  });

  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.status === 404 || error.status === 400 || error.status === 413) return void res.sendStatus(error.status);
    console.error("Guest request failed:", error.code ?? error.name);
    res.sendStatus(500);
  };
  router.use(onError);
  router.use((_req, res) => res.sendStatus(404));
  return router;
}

function verifyProof(link: GuestLink, proof: string | undefined): boolean {
  return Boolean(proof && credentialPattern.test(proof) && secureEquals(hashCredential(proof), link.proofHash));
}
