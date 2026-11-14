/**
 * Persistent state: all server state lives under one data directory. A small
 * JSON index maps Slug → Pad and is rewritten atomically on every change
 * (write to a temp file, rename over the target).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SlugTakenError } from "./slug.ts";
import type { EncryptionParameters } from "./pad-access.ts";
import { isNotFound, messageOf } from "./errors.ts";

/**
 * A blob ID: 32 hex characters, server-generated (crypto.randomBytes) and
 * validated wherever one enters from the outside.
 */
export const BLOB_ID_PATTERN = /^[0-9a-f]{32}$/;

export interface BlobRecord {
  /** Size of the stored blob in bytes. */
  size: number;
  createdAt: string;
}

/** Server-side PIN material: scrypt salt and digest (hex) — never the PIN itself. */
export interface PinRecord {
  salt: string;
  hash: string;
}

export type GrantRole = "read" | "edit";

export interface PadGrant {
  username: string;
  role: GrantRole;
  unreadId?: string;
}

export interface PadAccessRequest {
  id: string;
  username: string;
}

export interface GuestLink {
  token: string;
  expiresAt: string;
  proofHash: string;
  passwordSalt?: string;
  snapshot?: { ciphertext: string; capturedAt: string; displayName: string; files: Record<string, string> };
  oneTime: boolean;
  redemption?: { at: string; sessionHash: string };
}

export interface PadRecord {
  guestLink?: GuestLink;
  seenRevisions?: Record<string, number>;
  owner?: string;
  grants?: PadGrant[];
  accessRequests?: PadAccessRequest[];
  slug: string;
  displayName?: string;
  kind: "plain" | "encrypted";
  encryption?: EncryptionParameters;
  createdAt: string;
  /**
   * When the Pad's TTL ends, as an ISO timestamp; null means the Pad never
   * expires. Persisted per Pad (spec: TTL and cleanup).
   */
  expiresAt: string | null;
  /**
   * The Pad's optional PIN, present only as salted scrypt material (spec:
   * PIN security). When set, a Share Link alone is read-only and the PIN
   * unlocks editing and management.
   */
  pin?: PinRecord;
  /**
   * Server-side blob bookkeeping for this Pad's Attachments: blob ID → size.
   * Blob IDs are visible metadata (they appear in the Pad's Yjs attachment
   * list); blob contents never are — see ADR-0002 and the ticket's scope.
   */
  blobs?: Record<string, BlobRecord>;
}

export interface PadIndex {
  multiuser?: boolean;
  knownUsers?: string[];
  version: 1;
  /** Maps Slug → Pad. */
  pads: Record<string, PadRecord>;
}

/**
 * The public address of the permanent, unencrypted entry Pad.
 */
export const DEFAULT_PAD_SLUG = "default";

// Underscores are excluded from public slugs.
const PERSONAL_DEFAULT_PREFIX = "default_";

export function isDefaultPad(slug: string): boolean {
  return slug === DEFAULT_PAD_SLUG || slug.startsWith(PERSONAL_DEFAULT_PREFIX);
}

export function publicPadSlug(slug: string): string {
  return isDefaultPad(slug) ? DEFAULT_PAD_SLUG : slug;
}

const INDEX_VERSION = 1;

export class PadStore {
  readonly dataDir: string;
  readonly #indexFile: string;
  #index: PadIndex;
  readonly #deleting = new Map<string, Promise<boolean>>();

  private constructor(dataDir: string, indexFile: string, index: PadIndex) {
    this.dataDir = dataDir;
    this.#indexFile = indexFile;
    this.#index = index;
  }

  /** Opens (or creates) the data directory and loads the JSON index. */
  static open(dataDir: string, multiuser = false): PadStore {
    try {
      mkdirSync(dataDir, { recursive: true });
    } catch (cause) {
      throw new Error(`Could not create the data directory DATA_DIR=${dataDir}: ${messageOf(cause)}`);
    }

    const indexFile = path.join(dataDir, "index.json");
    let index = readIndex(indexFile);
    if (index === null) {
      index = { version: INDEX_VERSION, pads: {}, ...(multiuser ? { multiuser } : {}) };
    } else if ((index.multiuser ?? false) !== multiuser) {
      throw new Error("DATA_DIR belongs to a different MULTIUSER mode. Use a separate data directory.");
    }
    const store = new PadStore(dataDir, indexFile, index);
    store.#normalize();
    store.ensureDefaultPad();
    return store;
  }

  /** Fills in fields added after an index was written (older records first). */
  #normalize(): void {
    let changed = false;
    for (const pad of Object.values(this.#index.pads)) {
      if (pad.expiresAt === undefined) {
        pad.expiresAt = null;
        changed = true;
      }
    }
    if (changed) this.#save();
  }

  getPad(slug: string): PadRecord | undefined {
    return Object.hasOwn(this.#index.pads, slug) ? this.#index.pads[slug] : undefined;
  }

  getLivePad(slug: string): PadRecord | undefined {
    const pad = this.getPad(slug);
    if (this.#deleting.has(slug) || !pad || (pad.expiresAt !== null && Date.parse(pad.expiresAt) <= Date.now())) return undefined;
    return pad;
  }

  padForGuestToken(token: string): PadRecord | undefined {
    return Object.values(this.#index.pads).find((pad) => pad.guestLink?.token === token && this.getLivePad(pad.slug));
  }

  setGuestLink(pad: PadRecord, guestLink?: GuestLink): void {
    const previous = pad.guestLink;
    pad.guestLink = guestLink;
    try {
      this.#save();
    } catch (error) {
      pad.guestLink = previous;
      throw error;
    }
  }

  ownedPads(username: string | null): PadRecord[] {
    return Object.values(this.#index.pads)
      .filter((pad) => !isDefaultPad(pad.slug) && (username === null || pad.owner === username) && this.getLivePad(pad.slug))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  rememberUser(username: string): void {
    const previous = this.#index.knownUsers ?? [];
    if (previous.includes(username)) return;
    this.#index.knownUsers = [...previous, username];
    try { this.#save(); }
    catch (error) {
      this.#index.knownUsers = previous;
      throw error;
    }
  }

  eligibleUsers(pad: PadRecord): string[] {
    const excluded = new Set([pad.owner, ...(pad.grants ?? []).map((grant) => grant.username),
      ...(pad.accessRequests ?? []).map((request) => request.username)]);
    return (this.#index.knownUsers ?? []).filter((name) => !excluded.has(name)).sort();
  }

  seenRevision(pad: PadRecord, username: string | null): number | undefined {
    const key = ":" + (username ?? "");
    return pad.seenRevisions?.[key];
  }

  markRevisionSeen(pad: PadRecord, username: string | null, revision: number): boolean {
    const previous = pad.seenRevisions;
    if ((this.seenRevision(pad, username) ?? -1) >= revision) return false;
    const key = ":" + (username ?? "");
    pad.seenRevisions = { ...previous, [key]: revision };
    try { this.#save(); }
    catch (error) {
      pad.seenRevisions = previous;
      throw error;
    }
    return true;
  }

  sharedPads(username: string) {
    return Object.values(this.#index.pads).flatMap((pad) => {
      if (isDefaultPad(pad.slug) || !pad.owner || pad.owner === username || !this.getLivePad(pad.slug)) return [];
      const grant = pad.grants?.find((entry) => entry.username === username);
      return grant ? [{ pad, grant }] : [];
    });
  }

  markPadGrantSeen(pad: PadRecord, username: string, unreadId: unknown): void {
    const grant = pad.grants?.find((entry) => entry.username === username);
    if (!grant?.unreadId || grant.unreadId !== unreadId) return;
    const previous = grant.unreadId;
    delete grant.unreadId;
    try {
      this.#save();
    } catch (error) {
      grant.unreadId = previous;
      throw error;
    }
  }

  setPadGrant(pad: PadRecord, username: string, role: GrantRole | null): boolean {
    const previous = pad.grants;
    const current = previous?.find((grant) => grant.username === username);
    if ((current?.role ?? null) === role) return false;
    pad.grants = (previous ?? []).filter((grant) => grant.username !== username);
    const previousRequests = pad.accessRequests;
    if (role) {
      pad.grants.push({ username, role, unreadId: current ? current.unreadId : randomUUID() });
      pad.accessRequests = previousRequests?.filter((request) => request.username !== username);
    }
    try {
      this.#save();
    } catch (error) {
      pad.grants = previous;
      pad.accessRequests = previousRequests;
      throw error;
    }
    return true;
  }

  requestPadAccess(pad: PadRecord, username: string): boolean {
    const requests = pad.accessRequests ?? [];
    if (requests.some((request) => request.username === username)) return false;
    this.#saveAccessRequests(pad, [...requests, { id: randomUUID(), username }]);
    return true;
  }

  resolvePadAccessRequest(pad: PadRecord, id: string, role: GrantRole | null): PadAccessRequest | undefined {
    const requests = pad.accessRequests ?? [];
    const request = requests.find((item) => item.id === id);
    if (!request) return undefined;
    if (role) this.setPadGrant(pad, request.username, role);
    else this.#saveAccessRequests(pad, requests.filter((item) => item.id !== id));
    return request;
  }

  #saveAccessRequests(pad: PadRecord, requests: PadAccessRequest[]): void {
    const previous = pad.accessRequests;
    pad.accessRequests = requests;
    try {
      this.#save();
    } catch (error) {
      pad.accessRequests = previous;
      throw error;
    }
  }

  /** Total bytes of Attachment blobs stored across every Pad. */
  usageBytes(): number {
    let total = 0;
    for (const pad of Object.values(this.#index.pads)) {
      for (const blob of Object.values(pad.blobs ?? {})) {
        total += blob.size;
      }
    }
    return total;
  }

  /** Records a stored blob in the index (its size counts toward the global limit). */
  recordBlob(slug: string, blobId: string, size: number): void {
    const pad = this.#index.pads[slug];
    if (!pad) throw new Error(`Cannot record a blob for unknown Pad "${slug}"`);
    pad.blobs = pad.blobs ?? {};
    const previous = pad.blobs[blobId];
    pad.blobs[blobId] = { size, createdAt: new Date().toISOString() };
    try {
      this.#save();
    } catch (error) {
      if (previous) pad.blobs[blobId] = previous;
      else delete pad.blobs[blobId];
      throw error;
    }
  }

  /** Forgets a blob in the index; the caller removes the file itself. */
  forgetBlob(slug: string, blobId: string): void {
    const pad = this.#index.pads[slug];
    if (!pad?.blobs?.[blobId]) return;
    delete pad.blobs[blobId];
    this.#save();
  }

  /** The directory holding a Pad's Attachment blobs. */
  attachmentDir(slug: string): string {
    return path.join(this.padDir(slug), "attachments");
  }

  /** The file holding one Attachment blob. Blob IDs are server-generated hex. */
  blobPath(slug: string, blobId: string): string {
    if (!BLOB_ID_PATTERN.test(blobId)) {
      throw new Error(`Not a blob ID: "${blobId}"`);
    }
    return path.join(this.attachmentDir(slug), blobId);
  }

  /** The directory holding a Pad's data (sync log, later its Attachments). */
  padDir(slug: string): string {
    return path.join(this.dataDir, "pads", slug);
  }

  getIndex(): PadIndex {
    return structuredClone(this.#index);
  }

  /** Resolve a public address to the account's private storage key. */
  resolvePad(slug: string, username: string | null): PadRecord | undefined {
    if (slug === DEFAULT_PAD_SLUG) return this.ensureDefaultPad(username);
    if (isDefaultPad(slug)) return undefined;
    return this.getLivePad(slug);
  }

  ensureDefaultPad(username: string | null = null): PadRecord {
    const slug = username === null ? DEFAULT_PAD_SLUG :
      PERSONAL_DEFAULT_PREFIX + createHash("sha256").update(username).digest("hex");
    const existing = this.getPad(slug);
    if (existing) return existing;
    const pad: PadRecord = {
      slug,
      ...(username !== null ? { owner: username } : {}),
      kind: "plain",
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };
    this.#index.pads[slug] = pad;
    try {
      this.#save();
    } catch (error) {
      delete this.#index.pads[slug];
      throw error;
    }
    return pad;
  }

  /**
   * Adds a Pad to the index. The Slug must already be validated (format and
   * reserved names); uniqueness is enforced here — a taken Slug throws
   * SlugTakenError.
   */
  createPad(slug: string, options: { displayName?: string | null; ttlSeconds: number | null; kind?: "plain" | "encrypted"; pin?: PinRecord; encryption?: EncryptionParameters; owner?: string }): PadRecord {
    if (this.getPad(slug)) {
      throw new SlugTakenError(`The Slug "${slug}" is already taken by another Pad`);
    }
    const record: PadRecord = {
      slug,
      kind: options.kind ?? "plain",
      createdAt: new Date().toISOString(),
      expiresAt: options.ttlSeconds === null ? null : new Date(Date.now() + options.ttlSeconds * 1_000).toISOString(),
    };
    if (options.displayName) record.displayName = options.displayName;
    if (options.owner) record.owner = options.owner;
    if (options.encryption) record.encryption = options.encryption;
    if (options.pin) {
      record.pin = options.pin;
    }
    this.#index.pads[slug] = record;
    try {
      this.#save();
    } catch (error) {
      delete this.#index.pads[slug];
      throw error;
    }
    return structuredClone(record);
  }

  renamePad(pad: PadRecord, displayName: string | null): void {
    const previous = pad.displayName;
    if (displayName === null) delete pad.displayName;
    else pad.displayName = displayName;
    try {
      this.#save();
    } catch (error) {
      if (previous === undefined) delete pad.displayName;
      else pad.displayName = previous;
      throw error;
    }
  }

  /** Sets a new expiry for a still-live Pad (management: TTL extension). */
  extendPad(slug: string, ttlSeconds: number | null): PadRecord | undefined {
    const pad = this.#index.pads[slug];
    if (!pad) return undefined;
    pad.expiresAt = ttlSeconds === null ? null : new Date(Date.now() + ttlSeconds * 1_000).toISOString();
    this.#save();
    return structuredClone(pad);
  }

  /** Pads whose TTL has ended by `now` (the Default Pad never appears). */
  expiredPads(now: Date): PadRecord[] {
    return Object.values(this.#index.pads).filter(
      (pad) => pad.expiresAt !== null && Date.parse(pad.expiresAt) <= now.getTime(),
    );
  }

  /** Stops access before draining live writes and removing the Pad's data. */
  removePad(slug: string, onDelete?: (slug: string) => Promise<void> | void): Promise<boolean> {
    const pending = this.#deleting.get(slug);
    if (pending) return pending;
    if (!this.getPad(slug)) return Promise.resolve(false);
    const removal = Promise.resolve().then(async () => {
      await onDelete?.(slug);
      rmSync(this.padDir(slug), { recursive: true, force: true });
      const pad = this.#index.pads[slug]!;
      delete this.#index.pads[slug];
      try {
        this.#save();
      } catch (error) {
        this.#index.pads[slug] = pad;
        throw error;
      }
      return true;
    }).finally(() => this.#deleting.delete(slug));
    this.#deleting.set(slug, removal);
    return removal;
  }

  /** Atomic rewrite: write a temp file, then rename it over the index. */
  #save(): void {
    const tmpFile = `${this.#indexFile}.${process.pid}.tmp`;
    writeFileSync(tmpFile, `${JSON.stringify(this.#index, null, 2)}\n`, "utf8");
    renameSync(tmpFile, this.#indexFile);
  }
}

function readIndex(indexFile: string): PadIndex | null {
  let raw: string;
  try {
    raw = readFileSync(indexFile, "utf8");
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw new Error(`Could not read the data index at ${indexFile}: ${messageOf(cause)}`);
  }


  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`The data index at ${indexFile} is not valid JSON: ${messageOf(cause)}`);
  }
  const index = parsed as PadIndex;
  if (
    typeof index !== "object" ||
    index === null ||
    index.version !== INDEX_VERSION ||
    typeof index.pads !== "object" ||
    index.pads === null
  ) {
    throw new Error(`The data index at ${indexFile} has an unrecognized format (expected version ${INDEX_VERSION})`);
  }
  return index;
}

