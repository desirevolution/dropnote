/**
 * Live-Sync tests: two headless Yjs clients drive the real server over
 * HTTP/WebSocket (seam 1). The server is a dumb relay per ADR-0002 — it
 * stores and forwards opaque updates and never merges anything itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openUpdateLog } from "../src/update-log.ts";
import { makeTempDataDir, startServer } from "./helpers/server.ts";
import { SyncClient, waitFor } from "./helpers/sync-client.ts";

test("concurrent Note edits merge automatically without losing text from either side", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const alice = await SyncClient.connect(server.baseUrl, "default");
    const bob = await SyncClient.connect(server.baseUrl, "default");
    try {
      // Both insert at position 0 while connected: a genuine CRDT merge case.
      alice.editNote((note) => note.insert(0, "Alice's line\n"));
      bob.editNote((note) => note.insert(0, "Bob's line\n"));

      await waitFor(
        () => alice.noteText() === bob.noteText(),
        "both clients converging on the merged Note",
      );
      const merged = alice.noteText();
      assert.match(bob.noteText(), /Alice's line/, "Alice's keystrokes survive");
      assert.match(bob.noteText(), /Bob's line/, "Bob's keystrokes survive");
      assert.equal(bob.noteText(), merged, "the merged Note is identical on both sides");
    } finally {
      await Promise.all([alice.close(), bob.close()]);
    }
  } finally {
    await server.stop();
  }
});

test("the Default Pad's Note content survives a server restart", async () => {
  const dataDir = await makeTempDataDir();

  const first = await startServer({ dataDir });
  const writer = await SyncClient.connect(first.baseUrl, "default");
  writer.editNote((note) => note.insert(0, "# Survives restarts\n\npersisted via the sync log."));
  await writer.close();
  await first.stop();

  const second = await startServer({ dataDir });
  try {
    const reader = await SyncClient.connect(second.baseUrl, "default");
    try {
      assert.equal(
        reader.noteText(),
        "# Survives restarts\n\npersisted via the sync log.",
        "the restarted server replays the persisted Note",
      );
    } finally {
      await reader.close();
    }
  } finally {
    await second.stop();
  }
});

test("a client connecting mid-run receives the current Note, not a stale snapshot", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    // Like a browser refresh: someone edits, their socket goes away, and a
    // new connection opens while the server keeps running.
    const first = await SyncClient.connect(server.baseUrl, "default");
    first.editNote((note) => note.insert(0, "typed before the refresh"));
    await first.close();

    const refreshed = await SyncClient.connect(server.baseUrl, "default");
    try {
      assert.equal(
        refreshed.noteText(),
        "typed before the refresh",
        "a mid-run reconnect replays everything the server has stored",
      );
    } finally {
      await refreshed.close();
    }
  } finally {
    await server.stop();
  }
});

test("the relay forwards Pad traffic verbatim — no server-side merging logic", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    // Raw WebSocket clients, not Yjs: whatever one side sends, the other side
    // receives byte-for-byte on the binary channel, alongside text control frames.
    const listener = new WebSocket(server.syncUrl("default"));
    await open(listener);
    const sender = new WebSocket(`${server.syncUrl("default")}`);
    await open(sender);

    const received = new Promise<Buffer[]>((resolve) => {
      const chunks: Buffer[] = [];
      listener.on("message", (data: Buffer, isBinary) => {
        if (!isBinary) return;
        chunks.push(data);
        if (chunks.length === 2) resolve(chunks);
      });
    });

    const opaque = [Buffer.from([0x01, 0xfe, 0xff]), Buffer.from("not even valid anything")];
    for (const blob of opaque) {
      sender.send(blob);
    }
    const chunks = await received;
    assert.deepEqual(chunks.map((chunk) => Uint8Array.from(chunk)), opaque.map((blob) => Uint8Array.from(blob)));
  } finally {
    await server.stop();
  }
});

test("a sync attempt for a Slug with no Pad is refused", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const stranger = new WebSocket(server.syncUrl("no-such-pad"));
    const outcome = await new Promise<"open" | "refused">((resolve, reject) => {
      stranger.on("open", () => resolve("open"));
      stranger.on("error", (cause) => {
        assert.match(String(cause), /404/, "the upgrade is refused with a 404");
        resolve("refused");
      });
    });
    assert.equal(outcome, "refused", "only existing Pads have a sync endpoint");
  } finally {
    await server.stop();
  }
});

function open(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
}

test("two Yjs clients see each other's Note edits live on the Default Pad", async () => {
  const dataDir = await makeTempDataDir();
  const server = await startServer({ dataDir });
  try {
    const alice = await SyncClient.connect(server.baseUrl, "default");
    const bob = await SyncClient.connect(server.baseUrl, "default");
    try {
      alice.editNote((note) => note.insert(0, "hello from Alice"));
      await waitFor(
        () => bob.noteText() === "hello from Alice",
        "Bob seeing Alice's edit",
      );

      bob.editNote((note) => note.insert(0, "bob was here; "));
      await waitFor(
        () => alice.noteText() === "bob was here; hello from Alice",
        "Alice seeing Bob's edit",
      );
    } finally {
      await Promise.all([alice.close(), bob.close()]);
    }
  } finally {
    await server.stop();
  }
});

test("the revision log replays legacy updates and keeps attachment markers out of Yjs", async () => {
  const dir = await makeTempDataDir();
  const file = join(dir, "sync.log");
  await writeFile(file, Buffer.from([0, 0, 0, 1, 23]));
  let log = openUpdateLog(dir);
  assert.deepEqual(log.current(), { revision: 1, updatedAt: null });
  assert.equal(log.append(Buffer.alloc(0)).revision, 2);
  const last = log.append(Buffer.from([42]));
  assert.equal(last.revision, 3);
  assert.ok(last.updatedAt);
  await appendFile(file, Buffer.from([128, 0, 0, 3, 0]));
  log = openUpdateLog(dir);
  assert.deepEqual(log.current(), last);
  assert.deepEqual(log.updates(), [Buffer.from([23]), Buffer.from([42])]);
  assert.equal(log.append(Buffer.from([33])).revision, 4);
});
