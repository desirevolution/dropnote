/**
 * Persistent state: all server state lives under one data directory. A small
 * JSON index maps Slug → Pad and is rewritten atomically on every change
 * (write to a temp file, rename over the target).
 */
import { randomUUID } from "node:crypto";
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
}

export interface PadAccessRequest {
  id: string;
  username: string;
}

export interface PadRecord {
  owner?: string;
  grants?: PadGrant[];
  accessRequests?: PadAccessRequest[];
  slug: string;
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
  version: 1;
  /** Maps Slug → Pad. */
  pads: Record<string, PadRecord>;
}

/**
 * The instance's built-in entry Pad: Plain, no TTL, always present, served at
 * the site root. It is seeded on first boot and never regenerated.
 */
export const DEFAULT_PAD_SLUG = "default";

const INDEX_VERSION = 1;

export class PadStore {
  readonly dataDir: string;
  readonly #indexFile: string;
  #index: PadIndex;
  readonly #deleting = new Set<string>();

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

  ownedPads(username: string | null): PadRecord[] {
    return Object.values(this.#index.pads)
      .filter((pad) => pad.slug !== DEFAULT_PAD_SLUG && (username === null || pad.owner === username) && this.getLivePad(pad.slug))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  setPadGrant(pad: PadRecord, username: string, role: GrantRole | null): boolean {
    const previous = pad.grants;
    const current = previous?.find((grant) => grant.username === username)?.role ?? null;
    if (current === role) return false;
    pad.grants = (previous ?? []).filter((grant) => grant.username !== username);
    const previousRequests = pad.accessRequests;
    if (role) {
      pad.grants.push({ username, role });
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

  requestPadAccess(pad: PadRecord, username: string): void {
    const requests = pad.accessRequests ?? [];
    if (requests.some((request) => request.username === username)) return;
    this.#saveAccessRequests(pad, [...requests, { id: randomUUID(), username }]);
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
    pad.blobs[blobId] = { size, createdAt: new Date().toISOString() };
    this.#save();
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

  ensureDefaultPad(): void {
    if (this.#index.pads[DEFAULT_PAD_SLUG]) return;
    this.#index.pads[DEFAULT_PAD_SLUG] = {
      slug: DEFAULT_PAD_SLUG,
      kind: "plain",
      createdAt: new Date().toISOString(),
      expiresAt: null, // the Default Pad has no TTL and is always present
    };
    this.#save();
  }

  /**
   * Adds a Pad to the index. The Slug must already be validated (format and
   * reserved names); uniqueness is enforced here — a taken Slug throws
   * SlugTakenError.
   */
  createPad(slug: string, options: { ttlSeconds: number | null; kind?: "plain" | "encrypted"; pin?: PinRecord; encryption?: EncryptionParameters; owner?: string }): PadRecord {
    if (this.getPad(slug)) {
      throw new SlugTakenError(`The Slug "${slug}" is already taken by another Pad`);
    }
    const record: PadRecord = {
      slug,
      kind: options.kind ?? "plain",
      createdAt: new Date().toISOString(),
      expiresAt: options.ttlSeconds === null ? null : new Date(Date.now() + options.ttlSeconds * 1_000).toISOString(),
    };
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
  async removePad(slug: string, onDelete?: (slug: string) => Promise<void> | void): Promise<boolean> {
    if (!this.getPad(slug) || this.#deleting.has(slug)) return false;
    this.#deleting.add(slug);
    try {
      await onDelete?.(slug);
      delete this.#index.pads[slug];
      this.#save();
      rmSync(this.padDir(slug), { recursive: true, force: true });
      return true;
    } finally {
      this.#deleting.delete(slug);
    }
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

