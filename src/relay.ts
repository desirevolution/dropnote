/** Relays opaque Yjs updates and short-lived presence for each Pad. */
import { randomUUID } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { openUpdateLog, type UpdateLog } from "./update-log.ts";
import type { GrantRole, PadRecord, PadStore } from "./store.ts";
import { canEdit, hasPadProof, padRole } from "./pad-access.ts";
import type { PinAuthority } from "./pin.ts";

import { proxyUsername, validRequestOrigin } from "./proxy-user.ts";
import { isGuestHost } from "./guest.ts";
import type { Config } from "./config.ts";

const SYNC_PATH = /^\/sync\/([a-z0-9-]+)(?:\?.*)?$/;

export class SyncRelay {
  readonly #wss: WebSocketServer;
  readonly #store: PadStore;
  readonly #pins: PinAuthority;
  readonly #logs = new Map<string, UpdateLog>();
  readonly #rooms = new Map<string, Set<WebSocket>>();
  readonly #presence = new Map<WebSocket, string>();
  readonly #deliveredRevisions = new WeakMap<WebSocket, number>();
  readonly #accountRooms = new Map<string, Set<WebSocket>>();
  readonly #users = new WeakMap<WebSocket, string>();
  readonly #config: Pick<Config, "trustedProxies" | "baseUrl" | "guestOrigin">;
  readonly #heartbeat: NodeJS.Timeout;

  constructor(store: PadStore, pins: PinAuthority, config: Pick<Config, "trustedProxies" | "baseUrl" | "guestOrigin"> = { trustedProxies: null, baseUrl: "" }) {
    this.#store = store;
    this.#pins = pins;
    this.#config = config;
    this.#wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => protocols.has("dropnote") ? "dropnote" : false,
    });
    const heard = new WeakSet<WebSocket>();
    this.#wss.on("connection", (client: WebSocket) => {
      heard.add(client);
      client.on("pong", () => heard.add(client));
    });
    this.#heartbeat = setInterval(() => {
      for (const client of this.#wss.clients) {
        if (heard.delete(client)) client.ping();
        else client.terminate();
      }
    }, 15_000);
    this.#heartbeat.unref();
  }

  /** Takes over WebSocket upgrades for /sync/<Slug> on the HTTP server. */
  attach(server: HttpServer): void {
    server.on("upgrade", (request, socket, head) => {
      if (isGuestHost(request.headers.host, this.#config.guestOrigin)) {
        rejectUpgrade(socket, 404, "Unknown sync endpoint");
        return;
      }
      const username = proxyUsername(request, this.#config.trustedProxies);
      if (username === undefined || (username !== null && !validRequestOrigin(request, this.#config.baseUrl))) {
        rejectUpgrade(socket, 403, "Authentication through a trusted proxy and a valid origin are required");
        return;
      }
      if (request.url === "/events" && username !== null) {
        this.#wss.handleUpgrade(request, socket, head, (client) => {
          this.#wss.emit("connection", client);
          const room = this.#accountRooms.get(username) ?? new Set<WebSocket>();
          this.#accountRooms.set(username, room);
          room.add(client);
          client.on("message", () => client.close(1008, "Read-only event stream"));
          client.once("close", () => {
            room.delete(client);
            if (!room.size) this.#accountRooms.delete(username);
          });
        });
        return;
      }
      const slug = slugOf(request);
      if (!slug) {
        rejectUpgrade(socket, 404, "Unknown sync endpoint");
        return;
      }
      const pad = this.#store.resolvePad(slug, username);
      if (!pad || !padRole(pad, username)) {
        rejectUpgrade(socket, 404, `No Pad lives at this address`);
        return;
      }
      if (!hasPadProof(pad, proofOf(request))) {
        rejectUpgrade(socket, 403, "Unlock the encrypted Pad first");
        return;
      }
      const token = tokenOf(request);
      this.#wss.handleUpgrade(request, socket, head, (client) => {
        this.#wss.emit("connection", client);
        try {
          this.#serve(pad.slug, token, client, username);
        } catch (error) {
          console.error("Pad replay could not start:", error);
          client.close(1011, "Pad replay unavailable");
        }
      });
    });
  }

  notifyAccount(username: string): void {
    for (const client of this.#accountRooms.get(username) ?? []) {
      sendControl(client, { type: "access-changed" });
    }
  }

  guestUpdates(pad: PadRecord): Buffer[] {
    return this.#logFor(pad.slug).updates();
  }

  revision(pad: PadRecord) {
    return this.#logFor(pad.slug).current();
  }

  attachmentChanged(slug: string): void {
    try {
      const { revision } = this.#logFor(slug).append(Buffer.alloc(0));
      this.#announceRevision(slug, revision);
    } catch (error) {
      console.error("Attachment revision could not be stored:", error);
    }
  }

  #announceRevision(slug: string, revision: number, writer?: WebSocket): void {
    for (const client of this.#rooms.get(slug) ?? []) {
      this.#deliveredRevisions.set(client, revision);
      sendControl(client, { type: client === writer ? "update-accepted" : "revision", revision });
    }
  }

  accessChanged(slug: string, username: string, role: GrantRole | null): void {
    for (const client of this.#rooms.get(slug) ?? []) {
      if (this.#users.get(client) !== username) continue;
      client.close(role === null ? 4004 : 4003, role === null ? "Pad unavailable" : "Access changed");
    }
  }

  updateExpiry(slug: string, expiresAt: string | null): void {
    for (const client of this.#rooms.get(slug) ?? []) sendControl(client, { type: "expiry", expiresAt });
  }

  /** Stops accepting connections, disconnects clients and flushes the logs. */
  async close(): Promise<void> {
    clearInterval(this.#heartbeat);
    for (const client of this.#wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => this.#wss.close(() => resolve()));
    this.#logs.clear();
  }

  /** Disconnects clients and drops the log before the Pad's files are removed. */
  forget(slug: string): void {
    const room = this.#rooms.get(slug);
    if (room) {
      for (const client of room) client.close(4004, "Pad unavailable");
      this.#rooms.delete(slug);
    }
    this.#logs.delete(slug);
  }

  #serve(slug: string, token: string | undefined, client: WebSocket, username: string | null): void {
    if (username !== null) this.#users.set(client, username);
    const log = this.#logFor(slug);
    const room = this.#roomFor(slug);
    const peer = randomUUID();
    let lastPresence = 0;

    client.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (client.readyState !== WebSocket.OPEN) return;
      const pad = this.#store.getLivePad(slug);
      if (!pad || !padRole(pad, username)) {
        client.close(4004, "Pad unavailable");
        return;
      }
      if (!isBinary && data instanceof Buffer && data.length < 128) {
        const seen = /^seen:(\d+)$/.exec(data.toString());
        if (seen) {
          const revision = Number(seen[1]);
          if (Number.isSafeInteger(revision) && revision <= (this.#deliveredRevisions.get(client) ?? -1) &&
              revision >= 0) {
            try {
              this.#store.markRevisionSeen(pad, username, revision);
              sendControl(client, { type: "seen-accepted", revision });
            } catch (error) {
              console.error("Seen revision could not be stored:", error);
              client.close(1011, "Seen revision could not be stored");
            }
          }
          return;
        }
      }
      if (!canEdit(pad, username) || (pad.pin && !this.#pins.checkToken(slug, token, username))) {
        if (isBinary) sendControl(client, { type: "write-rejected" });
        return;
      }
      if (!isBinary) {
        if (!(data instanceof Buffer) || data.length > 2_048 || Date.now() - lastPresence < 25) return;
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (message?.type !== "presence" || typeof message.data !== "string" ||
            !/^[A-Za-z0-9_-]{1,1500}$/.test(message.data)) return;
        lastPresence = Date.now();
        const presence = JSON.stringify({ type: "presence", peer, ...(username !== null ? { username } : {}), data: message.data });
        this.#presence.set(client, presence);
        broadcast(room, client, presence);
        return;
      }
      const update = data as Buffer;
      if (!update.length) return;
      try {
        log.append(update);
      } catch (error) {
        console.error("Pad update could not be stored:", error);
        client.close(1011, "Pad update could not be stored");
        return;
      }
      broadcast(room, client, update);
      const revision = log.current().revision;
      this.#announceRevision(slug, revision, client);
    });
    const leave = () => {
      room.delete(client);
      if (this.#presence.delete(client)) broadcast(room, client, JSON.stringify({ type: "presence-left", peer }));
    };
    client.once("close", leave);
    client.on("error", leave);

    const pad = this.#store.getLivePad(slug);
    if (!pad) {
      client.close(4004, "Pad unavailable");
      return;
    }
    sendControl(client, { type: "pad-info", createdAt: pad.createdAt, expiresAt: pad.expiresAt });
    for (const update of log.updates()) client.send(update);
    const revision = log.current().revision;
    this.#deliveredRevisions.set(client, revision);
    sendControl(client, { type: "replay-done", revision, writable: canEdit(pad, username) && (!pad.pin || this.#pins.checkToken(slug, token, username)) });
    for (const other of room) {
      const presence = this.#presence.get(other);
      if (presence && other.readyState === WebSocket.OPEN) client.send(presence);
    }
    room.add(client);
  }

  #roomFor(slug: string): Set<WebSocket> {
    // Rooms are tracked per Pad; the map doubles as the room registry.
    let room = this.#rooms.get(slug);
    if (!room) {
      room = new Set();
      this.#rooms.set(slug, room);
    }
    return room;
  }

  #logFor(slug: string): UpdateLog {
    let log = this.#logs.get(slug);
    if (!log) {
      log = openUpdateLog(this.#store.padDir(slug));
      this.#logs.set(slug, log);
    }
    return log;
  }
}

function slugOf(request: IncomingMessage): string | null {
  const match = SYNC_PATH.exec(request.url ?? "");
  return match?.[1] ?? null;
}

/** The capability token a client presented on its sync connection, if any. */
function tokenOf(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? "/", "http://relay.invalid").searchParams.get("token") ?? undefined;
  } catch {
    return undefined;
  }
}

function proofOf(request: IncomingMessage): string | undefined {
  return request.headers["sec-websocket-protocol"]?.split(/,\s*/)
    .find((protocol) => protocol.startsWith("proof."))?.slice("proof.".length);
}

function sendControl(client: WebSocket, payload: object): void {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
}

function broadcast(room: Set<WebSocket>, sender: WebSocket, data: Buffer | string): void {
  for (const peer of room) {
    if (peer !== sender && peer.readyState === WebSocket.OPEN) peer.send(data);
  }
}

/** The reason phrases the relay answers upgrades with, matching its statuses. */
const REJECT_REASONS: Record<number, string> = { 403: "Forbidden", 404: "Not Found" };

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const reason = REJECT_REASONS[status] ?? "Unknown";
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ error: message })}`);
  socket.destroy();
}
