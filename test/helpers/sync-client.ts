/**
 * A headless Yjs client for Live-Sync tests: a real Y.Doc driven over a real
 * WebSocket connection to the running server — the same protocol the browser
 * frontend speaks (ADR-0002). For Encrypted Pads the client speaks the
 * wrapped protocol: updates are sealed before sending and incoming frames
 * opened with the Pad's Key (frontend/encrypted-sync.js, ADR-0001).
 */
import { WebSocket } from "ws";
import * as Y from "yjs";
import type { UpdateCodec } from "../../frontend/encrypted-sync.js";

/**
 * The Yjs type holding a Pad's Note text, shared by every client of the
 * sync protocol.
 */
export const NOTE_TYPE = "note";

/** The Yjs type holding the Pad's flat attachment list (one entry per Attachment). */
export const ATTACHMENTS_TYPE = "attachments";

/** The metadata entry every client records for one Attachment (ADR-0002: visible metadata). */
export interface AttachmentEntry {
  blobId: string;
  name: string;
  size: number;
  contentType: string;
  addedAt: string;
}

/** Marker origin for updates received from the server; never echoed back. */
const REMOTE_ORIGIN = Symbol("remote");

export class SyncClient {
  readonly doc = new Y.Doc();
  /** Frames that could not be decrypted (e.g. a wrong Key) — for assertions. */
  readonly decryptFailures: unknown[] = [];
  readonly #socket: WebSocket;
  readonly #codec: UpdateCodec | null;
  readonly #open: Promise<void>;
  readonly #replayed: Promise<void>;
  /** Sealed updates still waiting to leave the socket. */
  #pendingSends = 0;
  /** Incoming frames still waiting to be opened and applied. */
  #pendingFrames = 0;
  /** How often the relay refused this client's submitted updates. */
  #rejections = 0;

  private constructor(url: string, codec: UpdateCodec | null, proof?: string) {
    this.#codec = codec;
    this.#socket = new WebSocket(url, proof ? ["dropnote", `proof.${proof}`] : undefined);
    this.#socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        const frame = new Uint8Array(data as Buffer);
        if (this.#codec) {
          // Opening is async and strictly ordered; count the frame as pending
          // until its update has been applied (or refused) locally.
          this.#pendingFrames += 1;
          this.#codec.open(frame).then(
            (update) => Y.applyUpdate(this.doc, update, REMOTE_ORIGIN),
            (cause) => this.decryptFailures.push(cause),
          ).finally(() => {
            this.#pendingFrames -= 1;
          });
        } else {
          Y.applyUpdate(this.doc, frame, REMOTE_ORIGIN);
        }
      } else if (JSON.parse((data as Buffer).toString()).type === "write-rejected") {
        this.#rejections += 1;
      }
    });
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) {
        return;
      }
      if (this.#codec) {
        // Sealing is async: keep count so close() waits for the wire.
        this.#pendingSends += 1;
        this.#codec.seal(update).then(
          (frame) => this.#sendWhenOpen(frame),
          (cause) => this.decryptFailures.push(cause),
        ).finally(() => {
          this.#pendingSends -= 1;
        });
      } else {
        this.#sendWhenOpen(update);
      }
    });
    this.#open = new Promise((resolve, reject) => {
      this.#socket.on("open", resolve);
      this.#socket.on("error", reject);
    });
    // Attached up front: a fast replay may finish before `connect` resumes.
    this.#replayed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no replay-done from ${url}`)), 5_000);
      this.#socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
        if (!isBinary && JSON.parse(data.toString()).type === "replay-done") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  /**
   * Connects to a Pad's sync endpoint and waits until the server has replayed
   * the Pad's persisted state, so the local Y.Doc reflects everything the
   * server knows before the test proceeds. `options.codec` wraps the
   * protocol for an Encrypted Pad (seal on send, open on receive); a
   * `token` (capability issued by the PIN endpoint) is presented on the
   * connection itself.
   */
  static async connect(baseUrl: string, slug: string, options: { codec?: UpdateCodec; token?: string; proof?: string } = {}): Promise<SyncClient> {
    const query = options.token === undefined ? "" : `?token=${encodeURIComponent(options.token)}`;
    const url = `${baseUrl.replace(/^http/, "ws")}/sync/${slug}${query}`;
    const client = new SyncClient(url, options.codec ?? null, options.proof);
    await client.#open;
    await client.#replayed;
    // Opening the replayed frames is async; wait until they all landed.
    await client.#drain();
    return client;
  }

  /** Resolves once no sealed sends or pending frame opens remain. */
  async #drain(): Promise<void> {
    await new Promise<void>((resolve) => {
      const check = () => (this.#pendingSends === 0 && this.#pendingFrames === 0 ? resolve() : setTimeout(check, 5));
      check();
    });
  }

  /** How often the relay answered this client's submitted update with a rejection. */
  get writeRejections(): number {
    return this.#rejections;
  }

  /** Edits the Note like a typist would: a local change propagated to the server. */
  editNote(transform: (text: Y.Text) => void): void {
    transform(this.note());
  }

  note(): Y.Text {
    return this.doc.getText(NOTE_TYPE);
  }

  noteText(): string {
    return this.note().toString();
  }

  /** The Pad's flat attachment list, as the Yjs CRDT shares it. */
  attachments(): Y.Array<AttachmentEntry> {
    return this.doc.getArray<AttachmentEntry>(ATTACHMENTS_TYPE);
  }

  /** Snapshot of the attachment list as this client currently sees it. */
  attachmentList(): AttachmentEntry[] {
    return this.attachments().toArray().map((entry) => ({ ...entry }));
  }

  /** Records an uploaded Attachment in the shared list (a local change). */
  addAttachment(entry: AttachmentEntry): void {
    this.attachments().push([entry]);
  }

  /** Removes an Attachment from the shared list (a local change). */
  removeAttachment(blobId: string): void {
    const list = this.attachments();
    const index = list.toArray().findIndex((entry) => entry.blobId === blobId);
    if (index >= 0) {
      list.delete(index, 1);
    }
  }

  async close(): Promise<void> {
    // Sealed updates must reach the wire before the socket shuts down.
    await this.#drain();
    this.#socket.close();
    await new Promise<void>((resolve) => {
      if (this.#socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.#socket.on("close", () => resolve());
    });
  }

  #sendWhenOpen(data: Uint8Array): void {
    if (this.#socket.readyState === WebSocket.OPEN) {
      this.#socket.send(data);
    }
  }
}

/** Polls until `predicate` holds, for live-propagation timing independence. */
export async function waitFor(predicate: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
