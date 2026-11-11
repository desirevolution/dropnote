import * as Y from "yjs";
import { createUpdateCodec } from "./encrypted-sync.js";
import { decodeBase64url, encodeBase64url, decryptBlob, encryptBlob } from "./crypto.js";

const ACK_TIMEOUT_MS = 10_000;
const remote = Symbol("remote");
const encode = new TextEncoder();
const decode = new TextDecoder();

export function startLiveSync(doc, { metadata, key, proof, cursorKey, onState, onPendingChange, onPresence, onExpiry, onMissing }) {
  const codec = key ? createUpdateCodec(key) : null;
  const pending = [];
  let socket;
  let ready = false;
  let writable = false;
  let pin = null;
  let retry;
  let attempts = 0;
  let stopped = false;
  let reconnecting = false;
  let flush = () => {};

  doc.on("update", (update, origin) => {
    if (origin === remote || stopped) return;
    pending.push({ update });
    if (pending.length === 1) onPendingChange(true);
    flush();
  });

  function connect() {
    if (stopped) return;
    clearTimeout(retry);
    socket?.close();
    ready = writable = false;
    onPresence({ type: "reset" });
    onState(attempts ? "reconnecting" : "connecting");
    if (!navigator.onLine) return;
    const url = new URL(`/sync/${encodeURIComponent(metadata.slug)}`, location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    if (pin) url.searchParams.set("token", pin);
    const connection = new WebSocket(url, proof ? ["dropnote", `proof.${proof}`] : ["dropnote"]);
    socket = connection;
    connection.binaryType = "arraybuffer";
    let incoming = Promise.resolve();
    let sending = false;
    let ackTimer;
    const active = () => !stopped && socket === connection && connection.readyState === WebSocket.OPEN;
    const timer = setTimeout(() => connection.close(), 12_000);

    flush = async () => {
      if (!active() || !ready || !writable || sending || !pending.length) return;
      sending = true;
      try {
        const item = pending[0];
        item.frame ??= codec ? await codec.seal(item.update) : item.update;
        if (!active()) return;
        connection.send(item.frame);
        // Reconnect and replay if the server stops acknowledging writes.
        ackTimer = setTimeout(() => connection.close(), ACK_TIMEOUT_MS);
      } catch {
        connection.close();
      }
    };

    connection.addEventListener("message", ({ data }) => {
      if (!active()) return;
      const message = typeof data === "string" ? JSON.parse(data) : null;
      if (message?.type === "replay-done") clearTimeout(timer);
      incoming = incoming.then(async () => {
        if (!active()) return;
        if (data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(data);
          const update = codec ? await codec.open(bytes) : bytes;
          if (active()) Y.applyUpdate(doc, update, remote);
          return;
        }
        if (!message) return;
        if (message.type === "pad-info") {
          if (message.createdAt !== metadata.createdAt) return unavailable();
          onExpiry(message.expiresAt);
        } else if (message.type === "replay-done") {
          attempts = 0;
          ready = true;
          writable = message.writable;
          if (!writable) pin = null;
          onState(writable ? "writable" : "readonly");
          flush();
        } else if (message.type === "update-accepted" && sending) {
          clearTimeout(ackTimer);
          pending.shift();
          if (pending.length === 0) onPendingChange(false);
          sending = false;
          flush();
        } else if (message.type === "write-rejected") {
          pin = null;
          connect();
        } else if (message.type === "expiry") {
          onExpiry(message.expiresAt);
        } else if (message.type === "presence-left") {
          onPresence(message);
        } else if (message.type === "presence") {
          try {
            const bytes = decodeBase64url(message.data);
            const raw = cursorKey ? await decryptBlob(cursorKey, bytes) : bytes;
            if (active()) onPresence({ type: "cursor", peer: message.peer, username: message.username, position: JSON.parse(decode.decode(raw)) });
          } catch {
            // One invalid cursor cannot interrupt document sync.
          }
        }
      }).catch(() => {
        if (socket === connection && !stopped) {
          stop();
          onState("unreadable");
        }
      });
    });

    connection.addEventListener("close", ({ code }) => {
      clearTimeout(timer);
      clearTimeout(ackTimer);
      if (socket !== connection || stopped) return;
      ready = writable = false;
      onState("reconnecting");
      onPresence({ type: "reset" });
      if (code === 4004) return unavailable();
      if (code === 4003) return location.reload();
      const delay = Math.min(10_000, 500 * 2 ** attempts++);
      retry = setTimeout(checkAndReconnect, delay);
    });
  }

  async function checkAndReconnect() {
    if (stopped || reconnecting || !navigator.onLine) return;
    reconnecting = true;
    try {
      const response = await fetch(`/api/pads/${encodeURIComponent(metadata.slug)}`, {
        cache: "no-store", signal: AbortSignal.timeout(3_000),
      });
      if (stopped) return;
      if (response.status === 404) return unavailable();
    } catch {
      // The socket retry handles temporary network failures.
    } finally {
      reconnecting = false;
    }
    connect();
  }

  function unavailable() {
    stop();
    onMissing();
  }

  function offline() {
    if (stopped) return;
    clearTimeout(retry);
    socket?.close();
    socket = null;
    ready = writable = false;
    onPresence({ type: "reset" });
    onState("reconnecting");
  }

  function stop() {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
    window.removeEventListener("online", checkAndReconnect);
    window.removeEventListener("offline", offline);
  }

  let outgoingPresence = Promise.resolve();
  window.addEventListener("online", checkAndReconnect);
  window.addEventListener("offline", offline);
  connect();
  return {
    stop,
    setPin(token) {
      pin = token;
      connect();
    },
    presence(position) {
      if (!ready || !writable || socket?.readyState !== WebSocket.OPEN) return;
      const connection = socket;
      outgoingPresence = outgoingPresence.then(async () => {
        if (connection !== socket || !ready || !writable || stopped) return;
        const raw = encode.encode(JSON.stringify(position));
        const data = encodeBase64url(cursorKey ? await encryptBlob(cursorKey, raw) : raw);
        if (connection === socket && !stopped && connection.readyState === WebSocket.OPEN) {
          connection.send(JSON.stringify({ type: "presence", data }));
        }
      }).catch(() => {});
    },
  };
}
