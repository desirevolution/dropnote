import { spaceLabel } from "../src/space-label.ts";
import * as Y from "yjs";
import { initShareQr } from "./share-qr.js";
import { consumeOpeningSecret } from "./share-secret.js";
import { t } from "./i18n.js";
import { decodeBase64url, encodeBase64url } from "./crypto.js";
import { derivePadKey, padProof, presenceKey, verifyPadKey } from "./passphrase.js";
import { initAttachments } from "./attachments.js";
import { initNoteEditor } from "./note-editor.js";
import { startLiveSync } from "./live-sync.js";
import { initPinUnlock } from "./pin.js";
import { copyText, initPadActions, ttlChoice } from "./pad-actions.js";
import { initWorkspaceTabs } from "./workspace-tabs.js";
import { initSpaceAccess } from "./space-access.js";
import { dateLabel, forgetPad, initPadNavigation, localValue, notice, openPersonalStartPad, saveLocal, setStorageUser, storageKey } from "./pad-navigation.js";

const $ = (id) => document.getElementById(id);
const metadata = JSON.parse($("pad-metadata").textContent);
const encrypted = metadata.encrypted;
let openingSecret = consumeOpeningSecret(metadata, window.takeOpeningPassphrase?.());
const workspace = $("workspace");
const syncStatus = $("sync-status");
const syncError = $("sync-error");
const noteCopy = $("copy-note");
const noteClipboardStatus = $("note-clipboard-status");
const noteDownload = $("download-note");
const replaceNoteDialog = $("replace-note-dialog");
const uploadNotice = $("upload-notice");
const uploadNoticeText = $("upload-notice-text");
const showUpload = $("show-upload");
const encryption = metadata.encryption;
const unlockKey = encryption ? `dropnote:unlock:${encryption.salt}` : null;
const lockEvent = encryption ? `dropnote:lock:${encryption.salt}` : null;
const padUrl = new URL(metadata.path, location.origin).href;
const filesUrl = new URL(padUrl);
filesUrl.searchParams.set("view", "files");
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
let noteText = "";
let lastExportTime = 0;
let noteReplacement;
let fileCount = 0;
let clearing = false;
let managing = false;
let readingClipboard = false;
let canUndo = false;
let canRedo = false;
let lockChannel;
let uploadNoticeTimer;

const tabs = initWorkspaceTabs({
  filesLink: new URLSearchParams(location.search).get("view") === "files",
  beforeChange(previous) {
    if (previous === "note") note?.saveScrollPosition();
  },
  afterChange(view) {
    if (view === "note") note?.restoreScrollPosition();
    else {
      hideUploadNotice();
      $("note-view").open = false;
    }
  },
});

setStorageUser(metadata.username);
initPadActions();
initSpaceAccess(api);
const navigation = initPadNavigation(metadata);

$("copy-link").addEventListener("click", () => copyText(padUrl, $("copy-status"), t("Link copied.")));
$("copy-files-link").addEventListener("click", () => copyText(filesUrl.href, $("copy-status"), t("Files link copied.")));
showUpload.addEventListener("click", () => tabs.showFiles());
const qr = initShareQr(padUrl, metadata.slug);
const wordWrap = $("word-wrap");
const lineNumbers = $("line-numbers");
const noteView = $("note-view");
wordWrap.addEventListener("change", () => note?.setWordWrap(wordWrap.checked));
lineNumbers.addEventListener("change", () => note?.setLineNumbers(lineNumbers.checked));
document.addEventListener("click", (event) => {
  if (!noteView.contains(event.target)) noteView.open = false;
});
noteView.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && noteView.open) {
    noteView.open = false;
    noteView.querySelector("summary").focus();
  }
});
$("undo-note").addEventListener("click", () => note?.undo());
$("redo-note").addEventListener("click", () => note?.redo());
$("paste-note").addEventListener("click", async () => {
  if (!canReplaceNote() || readingClipboard) return;
  const editor = note;
  const mayPaste = () => note === editor && canReplaceNote() && !document.querySelector("dialog[open]");
  readingClipboard = true;
  noteClipboardStatus.textContent = "";
  updateActions();
  try {
    const text = await navigator.clipboard.readText();
    if (!mayPaste()) return;
    if (!text) {
      noteClipboardStatus.textContent = t("The clipboard contains no text.");
      return;
    }
    editor.appendText(text);
    noteClipboardStatus.textContent = t("Text pasted.");
  } catch {
    if (mayPaste()) {
      noteClipboardStatus.textContent = t("Use your device’s Paste action in the note.");
      editor.focusEnd();
    }
  } finally {
    readingClipboard = false;
    updateActions();
  }
});
noteCopy.addEventListener("click", () => copyText(noteText, noteClipboardStatus, t("Text copied.")));

noteDownload.addEventListener("click", () => {
  if (!noteText || workspace.hidden) return;

  lastExportTime = Math.max(Date.now(), lastExportTime + 1);
  const blob = new Blob([noteText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${metadata.slug}-${lastExportTime}.txt`;
  try {
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
});

document.addEventListener("paste", (event) => {
  if (!canReplaceNote() || event.defaultPrevented || document.querySelector("dialog[open]")) return;
  const target = event.target;
  if ($("note").contains(target) || (target instanceof Element &&
      (target.isContentEditable || target.closest("input, textarea, select, dialog")))) return;
  const clipboard = event.clipboardData;
  if (clipboard?.files.length || Array.from(clipboard?.items ?? []).some((item) => item.kind === "file")) return;
  const text = clipboard?.getData("text/plain");
  if (!text) return;

  event.preventDefault();
  if (!noteText) {
    note.replaceText(text);
    return;
  }
  noteReplacement = { text, original: noteText };
  replaceNoteDialog.showModal();
});

replaceNoteDialog.querySelector("form").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "replace" || !canReplaceNote() || !noteReplacement) return;
  if (noteReplacement.original !== noteText) {
    notice(t("The note changed while you were confirming. Paste again to replace it."));
    return;
  }
  note.replaceText(noteReplacement.text);
});
replaceNoteDialog.addEventListener("close", () => {
  if (!replaceNoteDialog.open) noteReplacement = undefined;
});

function canReplaceNote() {
  return writable && note && !workspace.hidden && tabs.selected === "note";
}

function cancelNoteReplacement() {
  noteReplacement = undefined;
  if (replaceNoteDialog.open) replaceNoteDialog.close();
}
function hideUploadNotice() {
  clearTimeout(uploadNoticeTimer);
  uploadNotice.hidden = true;
  uploadNoticeText.textContent = "";
}

function showUploadNotice() {
  if (tabs.selected !== "note") return;
  clearTimeout(uploadNoticeTimer);
  uploadNotice.hidden = false;
  uploadNoticeText.textContent = t("File added.");
  uploadNoticeTimer = setTimeout(() => {
    if (document.activeElement !== showUpload) hideUploadNotice();
  }, 8_000);
}

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
    label.textContent = expiresAt ? t("Expires {date}", { date: dateLabel(expiresAt) }) : "";
  }
  navigation.refresh();
}

function updateActions() {
  noteCopy.disabled = noteDownload.disabled = !noteText;
  const states = {
    "paste-note": !writable || readingClipboard,
    "undo-note": !writable || !canUndo,
    "redo-note": !writable || !canRedo,
    "rename-space": !writable || managing,
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
  if (!writable) cancelNoteReplacement();
  if (state === "readonly") {
    clearTimeout(pinTimer);
    writeToken = null;
  }
  const active = writable || state === "readonly";
  if (active) {
    workspace.hidden = false;
    tabs.showInitial(noteText, fileCount);
  }
  connectionState = state;
  updateSyncStatus();
  $("unlock-editing").hidden = state !== "readonly" || !metadata.pinProtected || metadata.canEdit === false;
  note?.setEditing(writable);
  attachments?.setEditing(writable);
  updateActions();
}

function updateSyncStatus() {
  const active = connectionState === "writable" || connectionState === "readonly";
  const failed = connectionState === "unreadable" || connectionState === "missing";
  const showPending = !writable && changesPending;
  syncStatus.dataset.state = failed ? "error" : active && !showPending ? "live" : "pending";
  const label = {
    writable: t("Connected"),
    readonly: t("Read only"),
    connecting: t("Connecting…"),
    reconnecting: t("Connection lost · reconnecting…"),
    unreadable: t("Sync unavailable"),
    missing: t("Space unavailable"),
    locked: t("Locked"),
  }[connectionState];
  const status = showPending ? `${label} · ${t("Changes pending")}` : label;
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
  showSyncError(metadata.username ? t("This space is no longer available to you.") : t("This space has expired or was deleted."));
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
    onHistory(undo, redo) {
      canUndo = undo;
      canRedo = redo;
      updateActions();
    },
    onCursor(position) {
      sync?.presence(position);
    },
  });
  note.setWordWrap(wordWrap.checked);
  note.setLineNumbers(lineNumbers.checked);
  attachments = initAttachments(doc, metadata.slug, {
    key,
    writeHeaders,
    onUploaded: showUploadNotice,
    onCount(count) {
      fileCount = count;
      tabs.setFileCount(count);
      updateActions();
    },
  });
  sync = startLiveSync(doc, {
    metadata, key, proof, cursorKey,
    onState(state) {
      setState(state);
      if (state === "unreadable") showSyncError(t("The space data could not be read. Reload the page to try again."));
    },
    onPendingChange(pending) {
      changesPending = pending;
      if (!writable) updateSyncStatus();
    },
    onPresence: (event) => note.presence(event),
    onExpiry: showExpiry,
    onMissing,
  });
}

function closeWorkspace() {
  openingSecret = null;
  qr.setPassphrase(null);
  generation += 1;
  cancelNoteReplacement();
  clearTimeout(pinTimer);
  sync?.stop();
  note?.destroy();
  attachments?.destroy();
  doc?.destroy();
  sync = note = attachments = doc = undefined;
  noteText = "";
  fileCount = 0;
  tabs.setFileCount(0);
  hideUploadNotice();
  proof = writeToken = null;
  for (const id of ["pin-dialog", "ttl-dialog", "rename-dialog"]) {
    if ($(id)?.open) $(id).close();
  }
  workspace.hidden = true;
  noteClipboardStatus.textContent = "";
  canUndo = canRedo = false;
  changesPending = false;
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
        notice(t("This browser could not save the unlock. The space is open for this visit."));
      }
      await openPad(key);
    } catch {
      if (current === generation) {
        error.textContent = t("The passphrase could not unlock this space.");
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
  if (writable && window.confirm(t("Clear all text in Default?"))) note.clear();
});
$("clear-files")?.addEventListener("click", async () => {
  if (!writable || clearing || !window.confirm(t("Remove all {count} files from Default?", { count: fileCount }))) return;
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
  if (!writable || managing || !window.confirm(t("Delete “{name}”, its note and all its files?", { name: spaceLabel(metadata.slug, metadata.displayName) }))) return;
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
    if (generation === current) notice(error.message || t("Could not delete this space."));
  } finally {
    managing = false;
    updateActions();
  }
});

$("rename-space")?.addEventListener("click", () => {
  $("display-name").value = metadata.displayName ?? "";
  $("rename-error").hidden = true;
});
$("rename-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!writable || managing) return;
  const current = generation;
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  const errorLine = $("rename-error");
  const displayName = $("display-name").value.trim();
  errorLine.hidden = true;
  submit.disabled = managing = true;
  updateActions();
  try {
    const response = await fetch(api, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...writeHeaders() },
      body: JSON.stringify({ displayName }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.json();
    metadata.displayName = result.displayName;
    const name = spaceLabel(metadata.slug, metadata.displayName);
    $("space-heading").textContent = name;
    document.title = `${name} – Dropnote`;
    if (generation === current && $("rename-dialog").open) $("rename-dialog").close();
  } catch (error) {
    if (generation === current) {
      errorLine.textContent = error.message || t("Could not rename this space.");
      errorLine.hidden = false;
    }
  } finally {
    submit.disabled = managing = false;
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
      errorLine.textContent = error.message || t("Could not change the expiry.");
      errorLine.hidden = false;
    }
  } finally {
    submit.disabled = managing = false;
    updateActions();
  }
});

async function responseError(response) {
  const { error } = await response.json().catch(() => ({}));
  return t(error ?? "The request could not be completed.");
}

async function start() {
  if (await openPersonalStartPad()) return;
  navigation.refresh();
  showExpiry(metadata.expiresAt);
  if (!encrypted) return openPad();
  if (!crypto.subtle || !encryption) {
    showSyncError(t("Encrypted spaces require HTTPS or localhost."));
    return;
  }
  initPassphrase();
  const incoming = openingSecret;
  openingSecret = null;
  if (incoming) {
    const current = generation;
    try {
      const key = await derivePadKey(incoming.passphrase, encryption.salt);
      const valid = await verifyPadKey(key, encryption.check);
      if (current !== generation) return;
      if (valid) {
        if (incoming.created) qr.setPassphrase(incoming.passphrase);
        return openPad(key);
      }
    } catch {
      if (current !== generation) return;
    }
    $("key-error").textContent = t("The passphrase could not unlock this space.");
    $("key-error").hidden = false;
  }
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

if (encrypted) window.addEventListener("pagehide", () => {
  openingSecret = null;
  if ($("pad-qr-dialog").open) $("pad-qr-dialog").close();
  qr.setPassphrase(null);
});

if (encrypted || metadata.username) {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
}

start().catch(() => showSyncError(t("The space could not be opened. Reload the page to try again.")));
