import * as Y from "yjs";
import QRCode from "qrcode";
import { decodeBase64url, encodeBase64url } from "./crypto.js";
import { derivePadKey, padProof, presenceKey, verifyPadKey } from "./passphrase.js";
import { initAttachments } from "./attachments.js";
import { initNoteEditor } from "./note-editor.js";
import { startLiveSync } from "./live-sync.js";
import { initPinUnlock } from "./pin.js";
import { copyText, initPadActions, ttlChoice } from "./pad-actions.js";
import { initSpaceAccess } from "./space-access.js";
import { dateLabel, forgetPad, initPadNavigation, localValue, notice, openPersonalStartPad, saveLocal, setStorageUser, storageKey } from "./pad-navigation.js";

const $ = (id) => document.getElementById(id);
const metadata = JSON.parse($("pad-metadata").textContent);
const encrypted = metadata.encrypted;
const workspace = $("workspace");
const syncStatus = $("sync-status");
const SYNC_STATUS_DELAY_MS = 500;
const syncError = $("sync-error");
const noteCopy = $("copy-note");
const fullWidth = $("full-width");
const encryption = metadata.encryption;
const unlockKey = encryption ? `dropnote:unlock:${encryption.salt}` : null;
const lockEvent = encryption ? `dropnote:lock:${encryption.salt}` : null;
const padUrl = new URL(metadata.path, location.origin).href;
const api = `/api/pads/${encodeURIComponent(metadata.slug)}`;

let doc;
let sync;
let note;
let attachments;
let writeToken = null;
let pinTimer;
let proof;
let generation = 0;
let writable = false;
let connectionState = "connecting";
let changesPending = false;
let pendingVisible = false;
let syncStatusTimer;
let noteText = "";
let fileCount = 0;
let clearing = false;
let managing = false;
let lockChannel;

setStorageUser(metadata.username);
initPadActions(metadata.username);
if (metadata.username) initSpaceAccess(api);
const navigation = initPadNavigation(metadata);

$("copy-link").addEventListener("click", () => copyText(padUrl, $("copy-status"), "Link copied."));
$("show-pad-qr").addEventListener("click", async () => {
  const canvas = $("pad-qr");
  const error = $("pad-qr-error");
  canvas.hidden = error.hidden = true;
  try {
    await QRCode.toCanvas(canvas, padUrl, { width: 280, margin: 4 });
    canvas.hidden = false;
  } catch {
    error.hidden = false;
  }
});
$("pad-qr-link").href = padUrl;
$("pad-qr-link").textContent = padUrl;
noteCopy.addEventListener("click", () => copyText(noteText, $("note-copy-status"), "Text copied."));
fullWidth.addEventListener("click", () => {
  const expanded = workspace.classList.toggle("is-wide");
  fullWidth.setAttribute("aria-pressed", String(expanded));
});
$("go-to-files").addEventListener("click", () => $("files-title").focus());

function writeHeaders() {
  const headers = {};
  if (proof) headers["x-pad-proof"] = proof;
  if (writeToken) headers.authorization = `Bearer ${writeToken}`;
  return headers;
}

function showExpiry(expiresAt) {
  metadata.expiresAt = expiresAt;
  const label = $("expires-at");
  if (label) {
    label.hidden = !expiresAt;
    label.dateTime = expiresAt ?? "";
    label.textContent = expiresAt ? `Expires ${dateLabel(expiresAt)}` : "";
  }
  navigation.refresh();
}

function updateActions() {
  noteCopy.disabled = !noteText;
  const states = {
    "clear-note": !writable || !noteText,
    "clear-files": !writable || !fileCount || clearing,
    "change-ttl": !writable || managing,
    "delete-pad": !writable || managing,
  };
  for (const [id, disabled] of Object.entries(states)) {
    if ($(id)) $(id).disabled = disabled;
  }
}

function setState(state) {
  writable = state === "writable";
  if (state === "readonly") {
    clearTimeout(pinTimer);
    writeToken = null;
  }
  const active = writable || state === "readonly";
  if (active) workspace.hidden = false;
  if (connectionState !== state) {
    clearTimeout(syncStatusTimer);
    pendingVisible = changesPending;
  }
  connectionState = state;
  updateSyncStatus();
  $("unlock-editing").hidden = state !== "readonly" || !metadata.pinProtected || metadata.canEdit === false;
  note?.setEditing(writable);
  attachments?.setEditing(writable);
  updateActions();
}

function setChangesPending(pending) {
  changesPending = pending;
  clearTimeout(syncStatusTimer);

  if (connectionState !== "writable") {
    pendingVisible = pending;
    updateSyncStatus();
  } else if (pending !== pendingVisible) {
    // Wait through short round trips and keep a visible status steady during bursts.
    syncStatusTimer = setTimeout(() => {
      pendingVisible = pending;
      updateSyncStatus();
    }, SYNC_STATUS_DELAY_MS);
  }
}

function updateSyncStatus() {
  const active = connectionState === "writable" || connectionState === "readonly";
  const failed = connectionState === "unreadable" || connectionState === "missing";
  syncStatus.dataset.state = failed ? "error" : active && !pendingVisible ? "live" : "pending";
  const label = {
    writable: "Synced",
    readonly: "Read only",
    connecting: "Connecting…",
    reconnecting: "Connection lost · reconnecting…",
    unreadable: "Sync unavailable",
    missing: "Space unavailable",
    locked: "Locked",
  }[connectionState];
  const pending = "Changes pending";
  const status = pendingVisible
    ? connectionState === "writable" ? pending : `${label} · ${pending}`
    : label;
  if (syncStatus.textContent !== status) syncStatus.textContent = status;
}

function showSyncError(message) {
  syncError.textContent = message;
  syncError.hidden = !message;
}

function onMissing() {
  if (unlockKey) saveLocal(unlockKey, null);
  closeWorkspace();
  // Let the home route remove an unavailable personal start pad and show its fallback notice.
  if (localValue("dropnote:start-pad")) {
    try {
      const chosen = JSON.parse(localValue("dropnote:start-pad"));
      if (chosen.slug === metadata.slug && chosen.createdAt === metadata.createdAt) {
        location.replace("/");
        return;
      }
    } catch {
      // A corrupted preference does not affect the current pad.
    }
  }
  if ($("key-prompt")) $("key-prompt").hidden = true;
  if ($("lock-pad")) $("lock-pad").hidden = true;
  setState("missing");
  showSyncError(metadata.username ? "This space is no longer available to you." : "This space has expired or was deleted.");
  if (!metadata.username) forgetPad(metadata);
  navigation.refresh();
}

async function openPad(key = null) {
  const current = generation;
  const [access, cursorKey] = key ? await Promise.all([padProof(key), presenceKey(key)]) : [null, null];
  if (current !== generation) return;
  proof = access;
  if (encrypted) {
    $("key-prompt").hidden = true;
    $("lock-pad").hidden = false;
  }
  showSyncError("");
  doc = new Y.Doc();
  note = initNoteEditor(doc.getText("note"), {
    onText(value) {
      noteText = value;
      updateActions();
    },
    onCursor(position) {
      sync?.presence(position);
    },
  });
  attachments = initAttachments(doc, metadata.slug, {
    key,
    writeHeaders,
    onCount(count) {
      fileCount = count;
      updateActions();
    },
  });
  sync = startLiveSync(doc, {
    metadata, key, proof, cursorKey,
    onState(state) {
      setState(state);
      if (state === "unreadable") showSyncError("The space data could not be read. Reload the page to try again.");
    },
    onPendingChange: setChangesPending,
    onPresence: (event) => note.presence(event),
    onExpiry: showExpiry,
    onMissing,
  });
}

function closeWorkspace() {
  generation += 1;
  clearTimeout(pinTimer);
  sync?.stop();
  note?.destroy();
  attachments?.destroy();
  doc?.destroy();
  sync = note = attachments = doc = undefined;
  noteText = "";
  fileCount = 0;
  proof = writeToken = null;
  for (const id of ["pin-dialog", "ttl-dialog"]) {
    if ($(id).open) $(id).close();
  }
  workspace.hidden = true;
  $("note-copy-status").textContent = "";
  clearTimeout(syncStatusTimer);
  changesPending = pendingVisible = false;
}

function lockPad(announce) {
  if (announce) {
    saveLocal(unlockKey, null);
    if (lockChannel) lockChannel.postMessage("lock");
    else {
      saveLocal(lockEvent, String(Date.now()) + Math.random());
      saveLocal(lockEvent, null);
    }
  }
  closeWorkspace();
  $("lock-pad").hidden = true;
  $("key-error").hidden = true;
  $("key-input").value = "";
  $("remember-unlock").checked = false;
  setState("locked");
  showSyncError("");
  showUnlock();
}

function showUnlock() {
  $("key-prompt").hidden = false;
  $("key-input").focus();
}

function initPassphrase() {
  const form = $("key-form");
  const field = $("key-input");
  const error = $("key-error");
  const submit = form.querySelector('button[type="submit"]');
  $("lock-pad").addEventListener("click", () => lockPad(true));
  if (typeof BroadcastChannel === "function") {
    lockChannel = new BroadcastChannel(storageKey(lockEvent));
    lockChannel.addEventListener("message", ({ data }) => {
      if (data === "lock") lockPad(false);
    });
  }
  window.addEventListener("storage", (event) => {
    if ((event.key === storageKey(lockEvent) && event.newValue !== null) || event.key === null) lockPad(false);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const current = generation;
    const remember = $("remember-unlock").checked;
    const passphrase = field.value;
    error.hidden = true;
    submit.disabled = true;
    try {
      const key = await derivePadKey(passphrase, encryption.salt);
      if (current !== generation) return;
      if (!await verifyPadKey(key, encryption.check)) throw new Error("Invalid passphrase");
      if (current !== generation) return;
      if (remember && !saveLocal(unlockKey, encodeBase64url(key))) {
        notice("This browser could not save the unlock. The space is open for this visit.");
      }
      await openPad(key);
    } catch {
      if (current === generation) {
        error.textContent = "The passphrase could not unlock this space.";
        error.hidden = false;
      }
    } finally {
      field.value = "";
      submit.disabled = false;
    }
  });
}

initPinUnlock(metadata, {
  headers: writeHeaders,
  onUnlocked(token, expiresIn) {
    if (!sync) return;
    clearTimeout(pinTimer);
    writeToken = token;
    sync.setPin(token);
    if (Number.isFinite(expiresIn)) {
      pinTimer = setTimeout(() => {
        writeToken = null;
        sync?.setPin(null);
      }, expiresIn * 1_000);
    }
  },
});

$("clear-note")?.addEventListener("click", () => {
  if (writable && window.confirm("Clear all text in the shared space?")) note.clear();
});
$("clear-files")?.addEventListener("click", async () => {
  if (!writable || clearing || !window.confirm(`Remove all ${fileCount} files from the shared space?`)) return;
  clearing = true;
  updateActions();
  try {
    await attachments.clear();
  } finally {
    clearing = false;
    updateActions();
  }
});

$("delete-pad")?.addEventListener("click", async () => {
  if (!writable || managing || !window.confirm(`Delete “${metadata.slug}”, its note and all its files?`)) return;
  const current = generation;
  managing = true;
  updateActions();
  try {
    const response = await fetch(api, { method: "DELETE", headers: writeHeaders() });
    if (!response.ok) throw new Error(await responseError(response));
    if (unlockKey) saveLocal(unlockKey, null);
    forgetPad(metadata);
    location.assign("/default");
  } catch (error) {
    if (generation === current) notice(error.message || "Could not delete this space.");
  } finally {
    managing = false;
    updateActions();
  }
});

$("ttl-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!writable || managing) return;
  const current = generation;
  const submit = $("ttl-form").querySelector('button[type="submit"]');
  const errorLine = $("ttl-error");
  errorLine.hidden = true;
  submit.disabled = managing = true;
  updateActions();
  try {
    const response = await fetch(`${api}/ttl`, {
      method: "POST",
      headers: { "content-type": "application/json", ...writeHeaders() },
      body: JSON.stringify(ttlChoice($("manage-ttl"))),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.json();
    showExpiry(result.expiresAt);
    if (generation === current && $("ttl-dialog").open) $("ttl-dialog").close();
  } catch (error) {
    if (generation === current) {
      errorLine.textContent = error.message || "Could not change the expiry.";
      errorLine.hidden = false;
    }
  } finally {
    submit.disabled = managing = false;
    updateActions();
  }
});

async function responseError(response) {
  return (await response.json().catch(() => ({}))).error ?? "The request could not be completed.";
}

async function start() {
  if (await openPersonalStartPad()) return;
  navigation.refresh();
  showExpiry(metadata.expiresAt);
  if (!encrypted) return openPad();
  if (!crypto.subtle || !encryption) {
    showSyncError("Encrypted spaces require HTTPS or localhost.");
    return;
  }
  initPassphrase();
  const remembered = localValue(unlockKey);
  if (remembered) {
    const current = generation;
    try {
      const key = decodeBase64url(remembered);
      if (await verifyPadKey(key, encryption.check) && current === generation) {
        return openPad(key);
      }
    } catch {
      // A stale or invalid stored key falls back to the passphrase.
    }
    if (current === generation) saveLocal(unlockKey, null);
  }
  showUnlock();
}

if (encrypted || metadata.username) {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
}

start().catch(() => showSyncError("The space could not be opened. Reload the page to try again."));
