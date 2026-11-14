import { parseDisplayName } from "./space-label.ts";
import { detectLanguage, type Language } from "./locale.ts";
import { fileURLToPath } from "node:url";
import express, { type Express, type ErrorRequestHandler, type RequestHandler } from "express";
import { isDefaultPad, publicPadSlug, type GrantRole, type PadRecord, type PadStore, type PinRecord } from "./store.ts";
import { renderNotFoundPage, renderPadPage } from "./pages.ts";
import { generateSlug, SlugTakenError, validateCustomSlug } from "./slug.ts";
import { attachmentsRouter } from "./attachments.ts";
import { PIN_PATTERN, hashPin } from "./pin.ts";
import type { PinAuthority } from "./pin.ts";
import { secureEquals } from "./secure-compare.ts";
import { RateLimitCounter, clientIpOf, rateLimiter } from "./ratelimit.ts";
import { getPadOrAnswer404, jsonNoPad, requestUsername } from "./pad-request.ts";
import { messageOf } from "./errors.ts";
import { canEdit, hasPadProof, padRole, parseEncryption, writeFailure } from "./pad-access.ts";
import { proxyUsername, USERNAME_PATTERN, validRequestOrigin } from "./proxy-user.ts";
import type { PadRevision } from "./update-log.ts";
import type { Config } from "./config.ts";

/** How often Pad creation retries a generated two-word Slug on collision. */
const GENERATED_SLUG_ATTEMPTS = 10;

export interface AppOptions {
  /** The PIN authority every gated route and the relay share. */
  pins: PinAuthority;
  /** Notified when a Pad is deleted early — the relay drops its room. */
  onPadDeleted?: (slug: string) => Promise<void> | void;
  onGrantChanged?: (slug: string, username: string, role: GrantRole | null) => void;
  notifyAccount?: (username: string) => void;
  onAttachmentChanged?: (slug: string) => void;
  padRevision?: (pad: PadRecord) => PadRevision;
  onExpiryChanged?: (slug: string, expiresAt: string | null) => void;
}

export function createApp(store: PadStore, config: Config, options: AppOptions): Express {
  const pins = options.pins;
  const app = express();
  app.disable("x-powered-by");
  if (config.trustedProxies) {
    app.use((req, res, next) => {
      res.set("Cache-Control", "private, no-store");
      const username = proxyUsername(req, config.trustedProxies);
      if (!username) {
        res.status(403).json({ error: "Authentication through a trusted proxy is required" });
        return;
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !validRequestOrigin(req, config.baseUrl)) {
        res.status(403).json({ error: "Request origin is not allowed" });
        return;
      }
      res.locals.username = username;
      next();
    });
  }
  app.use((req, res, next) => {
    res.locals.language = detectLanguage(req.get("Accept-Language"));
    res.vary("Accept-Language");
    next();
  });
  app.use(express.json());
  app.get("/api/words/:language", (req, res) => {
    const language = req.params.language;
    if (language !== "en" && language !== "de") {
      res.sendStatus(404);
      return;
    }
    res.type("text").sendFile(fileURLToPath(new URL(`./wordlists/${language}.txt`, import.meta.url)));
  });

  // Always-on rate limiting (ticket 06): one shared per-client-IP budget
  // for the attempts that can be automated — Slug guessing (GETs under the
  // public Pad path), Pad creation and Attachment uploads (POSTs under the
  // API root). Reads of the site itself and Live-Sync are not counted.
  const limits = new RateLimitCounter({
    windowMs: config.rateLimitWindowSeconds * 1_000,
    max: config.rateLimitMax,
  });
  const limitLookups = rateLimiter(limits, { counts: (req) => req.method === "GET" || req.method === "HEAD" });
  const limitCreations = rateLimiter(limits, { counts: (req) => req.method === "POST" });
  app.use(config.padPath, limitLookups);
  app.use("/api/pads", limitCreations);

  const pageOptions = {
    releaseTag: process.env.DROPNOTE_RELEASE_TAG,
    defaultTtlSeconds: config.defaultTtlSeconds,
    maxTtlSeconds: config.maxTtlSeconds,
    instancePinRequired: config.instancePin !== null,
    padPath: config.padPath,
  };

  // Attachment bytes for any Pad (ticket 03); Pad creation lives at the
  // router's root (/api/pads) and is registered separately below.
  app.use("/api/pads", attachmentsRouter({ store, config, pins: options.pins, onAttachmentChanged: options.onAttachmentChanged }));

  app.get(["/", "/default"], (_req, res) => {
    const username = requestUsername(res);
    if (username !== null && _req.method === "GET") store.rememberUser(username);
    const pad = store.ensureDefaultPad(username);
    res.type("html").send(renderPadPage(pad, {
      ...pageOptions,
      language: res.locals.language,
      username: requestUsername(res),
      canManage: padRole(pad, requestUsername(res)) === "owner",
      canEdit: canEdit(pad, requestUsername(res)),
    }));
  });

  app.post("/api/pads", (req, res) => {
    const body = (req.body ?? {}) as { slug?: unknown; displayName?: unknown; ttl?: unknown; encrypted?: unknown; encryption?: unknown; pin?: unknown; instancePin?: unknown };

    // The instance PIN (if one is set) gates only Pad creation — reading and
    // editing existing Pads never require it (ticket 06). It travels as
    // `instancePin`; the request's `pin` is the optional per-Pad PIN.
    const pinFailure = instancePinFailureOf(body.instancePin, config.instancePin);
    if (pinFailure !== null) {
      res.status(403).json({ error: pinFailure });
      return;
    }

    const displayName = body.displayName === undefined ? null : parseDisplayName(body.displayName);
    if (displayName === undefined) {
      res.status(400).json({ error: "Enter a display name on one line with up to 80 characters." });
      return;
    }

    const ttlSeconds = ttlFrom(body.ttl, config.defaultTtlSeconds, config.maxTtlSeconds, res);
    if (ttlSeconds === undefined) return; // an invalid TTL was already answered

    if (body.encrypted !== undefined && typeof body.encrypted !== "boolean") {
      res.status(400).json({ error: "The encrypted flag must be a boolean" });
      return;
    }
    const kind = body.encrypted ? "encrypted" : "plain";
    const encryption = body.encrypted ? parseEncryption(body.encryption) : undefined;
    if (body.encrypted && !encryption) {
      res.status(400).json({ error: "Encrypted Pads require valid passphrase parameters" });
      return;
    }

    let pin: PinRecord | undefined;
    if (body.pin !== undefined) {
      if (typeof body.pin !== "string" || !PIN_PATTERN.test(body.pin)) {
        res.status(400).json({ error: "The PIN must be a string of 4–10 digits" });
        return;
      }
      pin = hashPin(body.pin); // only scrypt material is stored, never the PIN
    }

    let slug: string;
    if (body.slug === undefined) {
      const generated = generateUniqueSlug(store, res.locals.language);
      if (generated === null) {
        res.status(500).json({ error: "Could not find a free two-word Slug — try a custom one" });
        return;
      }
      slug = generated;
    } else if (typeof body.slug === "string") {
      try {
        validateCustomSlug(body.slug);
      } catch (cause) {
        res.status(400).json({ error: messageOf(cause) });
        return;
      }
      slug = body.slug;
    } else {
      res.status(400).json({ error: "The Slug must be a string (or left out to have one generated)" });
      return;
    }

    try {
      const pad = store.createPad(slug, { displayName, ttlSeconds, kind, pin, encryption, owner: requestUsername(res) ?? undefined });
      res.status(201).json({
        slug: pad.slug,
        path: `${config.padPath}/${pad.slug}`,
        displayName: pad.displayName ?? null,
        createdAt: pad.createdAt,
        expiresAt: pad.expiresAt,
        encrypted: pad.kind === "encrypted",
        pinProtected: pad.pin !== undefined,
      });
    } catch (cause) {
      if (cause instanceof SlugTakenError) {
        res.status(409).json({ error: messageOf(cause) });
        return;
      }
      throw cause;
    }
  });

  app.get("/api/my-spaces", (_req, res) => {
    const username = requestUsername(res);
    const summary = (pad: PadRecord) => {
      const { revision, updatedAt } = options.padRevision?.(pad) ?? { revision: 0, updatedAt: null };
      const seen = store.seenRevision(pad, username);
      return {
        slug: pad.slug,
        path: `${config.padPath}/${pad.slug}`,
        displayName: pad.displayName ?? null,
        createdAt: pad.createdAt,
        expiresAt: pad.expiresAt,
        encrypted: pad.kind === "encrypted",
        updatedAt,
        changed: seen !== undefined && revision > seen,
      };
    };
    const spaces = store.ownedPads(username).map((pad) => ({
      ...summary(pad),
      accessRequestCount: pad.accessRequests?.length ?? 0,
      sharedWith: (pad.grants ?? []).map((grant) => grant.username),
    }));
    res.set("Cache-Control", "private, no-store").json({
      spaces,
      ...(username !== null ? {
        sharedSpaces: store.sharedPads(username).map(({ pad, grant }) => ({
          ...summary(pad), sharedBy: pad.owner, canEdit: grant.role === "edit", isNew: Boolean(grant.unreadId),
        })),
      } : {}),
    });
  });

  if (config.trustedProxies) {
    const requestLimits = new RateLimitCounter({ windowMs: 60_000, max: 10 });
    app.post("/api/pads/:slug/access-requests", (req, res) => {
      const username = requestUsername(res)!;
      const verdict = requestLimits.hit(username);
      if (!verdict.allowed) {
        res.set("Retry-After", String(verdict.retryAfterSeconds))
          .status(429).type("text").send("Too many access requests. Try again in a minute.");
        return;
      }
      const slug = req.params.slug as string;
      const pad = isDefaultPad(slug) ? undefined : store.getLivePad(slug);
      if (pad?.owner && !padRole(pad, username)) {
        store.rememberUser(username);
        if (store.requestPadAccess(pad, username)) options.notifyAccount?.(pad.owner);
      }
      // Give the same response for missing, private and already accessible spaces.
      const filesView = req.query.view === "files" ? "&view=files" : "";
      res.redirect(303, `${config.padPath}/${encodeURIComponent(slug)}?access=requested${filesView}`);
    });

    app.put("/api/pads/:slug/access-seen", (req, res) => {
      const pad = getPadOrAnswer404(store, req.params.slug as string, res);
      if (!pad) return;
      const username = requestUsername(res)!;
      store.markPadGrantSeen(pad, username, req.body?.unreadId);
      options.notifyAccount?.(username);
      res.status(204).end();
    });

    const accessState = (pad: PadRecord) => ({
      grants: (pad.grants ?? []).map(({ username, role }) => ({ username, role })),
      requests: pad.accessRequests ?? [],
      eligibleUsers: store.eligibleUsers(pad),
    });
    const ownerAccess: RequestHandler = (req, res, next) => {
      const pad = getPadOrAnswer404(store, req.params.slug as string, res);
      if (!pad) return;
      if (isDefaultPad(pad.slug) || padRole(pad, requestUsername(res)) !== "owner") {
        res.status(403).json({ error: "Only the owner can manage access to this space" });
        return;
      }
      res.locals.ownedPad = pad;
      next();
    };
    app.get("/api/pads/:slug/access", ownerAccess, (_req, res) => {
      const pad: PadRecord = res.locals.ownedPad;
      res.json(accessState(pad));
    });
    app.put("/api/pads/:slug/access", ownerAccess, (req, res) => {
      const pad: PadRecord = res.locals.ownedPad;
      const { username, role, createOnly } = req.body ?? {};
      if (typeof username !== "string" || !USERNAME_PATTERN.test(username) || username === pad.owner ||
          (role !== "read" && role !== "edit" && role !== null)) {
        res.status(400).json({ error: "Provide another username and a read, edit or null role" });
        return;
      }
      const alreadyGranted = pad.grants?.some((grant) => grant.username === username);
      if (role && (alreadyGranted ? createOnly === true : !store.eligibleUsers(pad).includes(username))) {
        res.status(409).json({ error: "This account is no longer eligible for a direct share." });
        return;
      }
      if (store.setPadGrant(pad, username, role)) {
        options.onGrantChanged?.(pad.slug, username, role);
        if (pad.owner) options.notifyAccount?.(pad.owner);
      }
      res.json(accessState(pad));
    });
    app.put("/api/pads/:slug/access-requests/:id", ownerAccess, (req, res) => {
      const pad: PadRecord = res.locals.ownedPad;
      const { role } = req.body ?? {};
      if (role !== "read" && role !== "edit" && role !== null) {
        res.status(400).json({ error: "Choose read, edit or null to decline" });
        return;
      }
      const request = store.resolvePadAccessRequest(pad, req.params.id as string, role);
      if (!request) {
        res.status(404).json({ error: "This access request is no longer open" });
        return;
      }
      if (role) options.onGrantChanged?.(pad.slug, request.username, role);
      if (pad.owner) options.notifyAccount?.(pad.owner);
      res.json(accessState(pad));
    });
  }

  app.get("/api/pads/:slug", limitLookups, (req, res) => {
    const pad = getPadOrAnswer404(store, req.params.slug as string, res);
    if (!pad || (pad.kind === "encrypted" && !pad.encryption)) {
      if (pad) jsonNoPad(res);
      return;
    }
    const role = padRole(pad, requestUsername(res));
    res.set("Cache-Control", "private, no-store").json({
      slug: publicPadSlug(pad.slug),
      path: isDefaultPad(pad.slug) ? "/default" : `${config.padPath}/${pad.slug}`,
      displayName: pad.displayName ?? null,
      createdAt: pad.createdAt,
      expiresAt: pad.expiresAt,
      encrypted: pad.kind === "encrypted",
      ...(pad.owner && (role === "read" || role === "edit") ? { sharedBy: pad.owner, canEdit: role === "edit" } : {}),
    });
  });

  // The PIN gate (ticket 05): a correct PIN exchanges for a short-lived
  // capability token that unlocks relay writes and management on this Pad.
  // Failures are counted per client IP and Pad; five in a row lock out.
  app.post("/api/pads/:slug/pin", (req, res) => {
    const pad = getPadOrAnswer404(store, req.params.slug as string, res);
    if (!pad) return;
    if (!canEdit(pad, requestUsername(res))) {
      res.status(403).json({ error: "You have read-only access to this space" });
      return;
    }
    if (!hasPadProof(pad, req.headers["x-pad-proof"])) {
      res.status(403).json({ error: "Unlock the encrypted Pad before unlocking editing" });
      return;
    }
    if (!pad.pin) {
      res.status(400).json({ error: "This Pad has no PIN — its Share Link already grants editing and management" });
      return;
    }
    const pin = (req.body ?? {}) as { pin?: unknown };
    if (typeof pin.pin !== "string" || pin.pin.length === 0) {
      res.status(400).json({ error: "The PIN must be a string of 4–10 digits" });
      return;
    }
    const result = options.pins.authenticate(pad, pin.pin, clientIpOf(req), requestUsername(res));
    if (result.ok) {
      res.status(200).json({ token: result.token, expiresIn: result.expiresIn });
      return;
    }
    if (result.reason === "locked") {
      res.set("retry-after", String(result.retryAfterSeconds));
      res.status(423).json({ error: `Too many failed PIN attempts — try again in ${result.retryAfterSeconds} seconds` });
      return;
    }
    res.status(403).json({ error: "The PIN is wrong", attemptsRemaining: result.attemptsRemaining });
  });

  // Deletion only needs management rights. The stored contents can stay locked.
  app.delete("/api/pads/:slug", async (req, res) => {
    const slug = req.params.slug as string;
    const pad = getPadOrAnswer404(store, slug, res);
    if (!pad) return;
    if (isDefaultPad(pad.slug)) {
      res.status(403).json({ error: "The Default Pad cannot be deleted" });
      return;
    }
    if (padRole(pad, requestUsername(res)) !== "owner") {
      res.status(403).json({ error: "Only the owner can manage this space" });
      return;
    }
    const expectedCreation = req.get("x-pad-created-at");
    if (expectedCreation && expectedCreation !== pad.createdAt) {
      res.status(409).json({ error: "This address now belongs to a different space. Reopen My spaces and try again." });
      return;
    }
    if (!await store.removePad(slug, options.onPadDeleted)) {
      jsonNoPad(res);
      return;
    }
    res.status(204).end();
  });

  app.patch("/api/pads/:slug", (req, res) => {
    const pad = getPadOrAnswer404(store, req.params.slug as string, res);
    if (!pad) return;
    if (isDefaultPad(pad.slug)) {
      res.status(403).json({ error: "Default cannot be renamed." });
      return;
    }
    if (!requireCapability(req, res, pad, pins)) return;
    const name = parseDisplayName(req.body?.displayName);
    if (name === undefined) {
      res.status(400).json({ error: "Enter a display name on one line with up to 80 characters." });
      return;
    }
    store.renamePad(pad, name);
    res.json({ displayName: pad.displayName ?? null });
  });

  app.post("/api/pads/:slug/ttl", (req, res) => {
    const pad = getPadOrAnswer404(store, req.params.slug as string, res);
    if (!pad) return;
    if (isDefaultPad(pad.slug)) {
      res.status(403).json({ error: "The Default Pad does not expire" });
      return;
    }
    if (!requireCapability(req, res, pad, pins)) return;
    const body = (req.body ?? {}) as { ttl?: unknown };
    const ttlSeconds = ttlFrom(body.ttl, config.defaultTtlSeconds, config.maxTtlSeconds, res);
    if (ttlSeconds === undefined) return; // an invalid TTL was already answered
    const updated = store.extendPad(pad.slug, ttlSeconds);
    options.onExpiryChanged?.(pad.slug, updated?.expiresAt ?? null);
    res.status(200).json({ slug: pad.slug, expiresAt: updated?.expiresAt ?? null });
  });

  app.get("/fonts/IBMPlexMono-Regular.woff2", (_req, res) => {
    res.sendFile("IBMPlexMono-Regular.woff2", { root: publicDir("fonts") });
  });

  // Additional Pads live under the configured path prefix (PAD_PATH).
  const padPage: RequestHandler = (req, res) => {
    const username = requestUsername(res);
    if (username !== null && req.method === "GET") store.rememberUser(username);
    const slug = req.params.slug as string;
    const pad = getPadOrAnswer404(store, slug, res, (page) => {
      const filesView = req.query.view === "files" ? "?view=files" : "";
      const username = requestUsername(page);
      const access = username ? {
        username,
        action: `/api/pads/${encodeURIComponent(slug)}/access-requests${filesView}`,
        checkPath: `/api/pads/${encodeURIComponent(slug)}`,
        requested: req.query.access === "requested",
        spacePath: `${config.padPath}/${encodeURIComponent(slug)}${filesView}`,
      } : undefined;
      page.status(404).type("html").send(renderNotFoundPage(access, page.locals.language));
    });
    if (!pad) return;
    if (pad.kind === "encrypted" && !pad.encryption) {
      res.status(404).type("html").send(renderNotFoundPage(undefined, res.locals.language));
      return;
    }
    res.type("html").send(renderPadPage(pad, {
      ...pageOptions,
      language: res.locals.language,
      username: requestUsername(res),
      canManage: padRole(pad, requestUsername(res)) === "owner",
      canEdit: canEdit(pad, requestUsername(res)),
    }));
  };
  app.get(`${config.padPath}/:slug`, padPage);
  app.get(config.padPath, (_req, res) => {
    // The bare prefix addresses no Pad — show the not-found page.
    res.status(404).type("html").send(renderNotFoundPage(undefined, res.locals.language));
  });

  // The bundled editor frontend (vanilla JS + Yjs).
  app.use("/js", express.static(publicDir("js"), { fallthrough: false }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/**
 * Checks a creation request's PIN against the instance PIN. With no instance
 * PIN configured (the default), creation is open and any PIN field is
 * ignored; returns the error message when creation must be refused, null
 * otherwise. The comparison is constant-time.
 */
function instancePinFailureOf(provided: unknown, instancePin: string | null): string | null {
  if (instancePin === null) return null;
  if (typeof provided !== "string") return "Creating a Pad on this instance requires the instance PIN";
  if (!secureEquals(provided, instancePin)) return "The instance PIN is incorrect";
  return null;
}

/**
 * Parses the creation request's TTL: absent means the instance default,
 * a number is seconds, "never" means no expiry. The instance's MAX_TTL
 * bounds the answer: a TTL above it (or "never" when a bound is set) is
 * refused. Answers the request itself and returns undefined when the value
 * is invalid.
 */
function ttlFrom(ttl: unknown, defaultTtlSeconds: number | null, maxTtlSeconds: number | null, res: express.Response): number | null | undefined {
  if (ttl === undefined) return defaultTtlSeconds; // creation without a choice = instance default
  if (ttl === null || ttl === "never") {
    if (maxTtlSeconds !== null) {
      res.status(400).json({ error: 'The TTL is bounded by this instance\'s MAX_TTL — "never" is not allowed' });
      return undefined;
    }
    return null;
  }
  if (typeof ttl === "number" && Number.isInteger(ttl) && ttl >= 1) {
    if (maxTtlSeconds !== null && ttl > maxTtlSeconds) {
      res.status(400).json({ error: `The TTL exceeds this instance's MAX_TTL (${maxTtlSeconds} seconds)` });
      return undefined;
    }
    return ttl;
  }
  res.status(400).json({ error: 'The TTL must be a positive number of seconds or "never"' });
  return undefined;
}

/** Generates a two-word Slug and retries if it collides with an existing Pad. */
function generateUniqueSlug(store: PadStore, language: Language): string | null {
  for (let attempt = 0; attempt < GENERATED_SLUG_ATTEMPTS; attempt++) {
    const slug = generateSlug(language);
    if (!store.getPad(slug)) return slug;
  }
  return null;
}

const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
};

function publicDir(subdir: string): string {
  return fileURLToPath(new URL(`../public/${subdir}`, import.meta.url));
}

/**
 * Every error leaves the server as a clear JSON body — never an HTML page
 * with a stack trace.
 */
const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const failure = err as { status?: unknown; type?: unknown; message?: unknown };
  if (failure.type === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed request body: expected valid JSON" });
    return;
  }
  if (failure.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large" });
    return;
  }

  const status = typeof failure.status === "number" && failure.status >= 400 && failure.status < 500 ? failure.status : 500;
  if (status === 500) {
    // Details go to the server log only; clients get a clear, safe message.
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  res.status(status).json({ error: typeof failure.message === "string" ? failure.message : "Bad request" });
};

function requireCapability(req: express.Request, res: express.Response, pad: PadRecord, pins: PinAuthority): boolean {
  const username = requestUsername(res);
  if (padRole(pad, username) !== "owner") {
    res.status(403).json({ error: "Only the owner can manage this space" });
    return false;
  }
  const failure = writeFailure(pad, pins, req.headers, username);
  if (!failure) return true;
  res.status(403).json({ error: failure });
  return false;
}
