import { initEditorMetrics, initEditorToast, initEditorToolbar } from "./editor-ui.js";
import { initEditorHelp } from "./editor-help.js";
import { initReferenceActions } from "./reference-actions.js";
import { initReferenceHistory } from "./reference-history.js";
import { initReferencePicker } from "./reference-picker.js";
import { referenceDeleteMessage } from "./reference-deletion.js";
import { formatReference, readableReferences } from "../src/internal-references.ts";
import { workspaceViewKey, workspacePositionKey } from "../src/workspace-view.ts";
import { spaceLabel } from "../src/space-label.ts";
import * as Y from "yjs";
import { initGuestLinks } from "./guest-links.js";
import { initShareQr } from "./share-qr.js";
import { consumeOpeningSecret } from "./share-secret.js";
import { t } from "./i18n.js";
import { decodeBase64url, encodeBase64url } from "./crypto.js";
import { padProof, presenceKey, unlockPadKey, verifyPadKey } from "./passphrase.js";
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
let openingSecret = consumeOpeningSecret(metadata);
const workspace = $("workspace");
const syncStatus = $("sync-status");
const syncError = $("sync-error");
const noteCopy = $("copy-note");
const noteClipboardStatus = $("note-clipboard-status");
initEditorToast(noteClipboardStatus);
const editorMetrics = initEditorMetrics($("note-status-bar"));
const editorToolbar = initEditorToolbar($("note-tools"));
function placeSyncStatus(view) {
  const visible = $("show-status-bar").checked;
  $("note-status-bar").hidden = !visible;
  const slot = $(view === "note" && visible ? "note-sync-slot" : "files-sync-slot");
  if (syncStatus.parentNode !== slot) slot.append(syncStatus);
  $("files-sync-slot").hidden = slot.id !== "files-sync-slot";
}
const noteDownload = $("download-note");
const readableCopy = $("copy-readable-note"), readableDownload = $("download-readable-note");
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
const readModeKey = `dropnote:read-mode:${metadata.slug}:${metadata.createdAt}`;
const api = `/api/pads/${encodeURIComponent(metadata.slug)}`;

let doc;
let sync;
let note;
let attachments;
let writeToken = null;
let pinTimer;
let proof;
let guestKey;
let generation = 0;
let writable = false;
let readMode = false;
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
let enteringWorkspace = false;
const explicitView = new URLSearchParams(location.search).get("view");
let pendingFileHighlight = new URLSearchParams(location.search).get("file");
if (!/^[0-9a-f]{32}$/.test(pendingFileHighlight ?? "") || explicitView !== "files") pendingFileHighlight = null;
function highlightReferenceFile(final = false) {
  if (!pendingFileHighlight || workspace.hidden || tabs.selected !== "files" || !attachments) return;
  if (attachments.highlightReferenceFile(pendingFileHighlight)) pendingFileHighlight = null;
  else if (final) { pendingFileHighlight = null; referenceNotice(t("The referenced file is no longer available.")); }
}
let referenceNoticeTimer;
function referenceNotice(message) {
  clearTimeout(referenceNoticeTimer);
  $("reference-toast-text").textContent = message;
  $("reference-toast").hidden = false;
  referenceNoticeTimer = setTimeout(() => { $("reference-toast").hidden = true; }, 8000);
}
$("reference-toast-close").addEventListener("click", () => { clearTimeout(referenceNoticeTimer); $("reference-toast").hidden = true; });
function mayNavigate() {
  // Native beforeunload covers browser links and history as well.
  note?.saveScrollPosition();
  return true;
}
function navigateReference(ref, address) {
  if (ref.spaceId === metadata.spaceId) {
    if (ref.kind === "file") pendingFileHighlight = ref.blobId;
    if (ref.kind === "file" || ref.view === "files") tabs.showFiles();
    else tabs.showNote();
    highlightReferenceFile(true);
  } else if (mayNavigate()) location.assign(address);
}
const desktopPointer = window.matchMedia("(pointer: fine)");

function focusDesktopNote() {
  if (desktopPointer.matches && writable && !workspace.hidden && tabs.selected === "note" &&
      !document.querySelector("dialog[open]")) note?.focus();
}

const tabKey = workspaceViewKey(metadata);
const positionKey = workspacePositionKey(metadata);
const tabs = initWorkspaceTabs({
  filesLink: explicitView === "files", noteLink: explicitView === "note",
  readSelection: () => localValue(tabKey),
  saveSelection: (view) => saveLocal(tabKey, view),
  onNoteClick: focusDesktopNote,
  beforeChange(previous) {
    $("image-paste-fallback").hidden = true;
    $("image-paste-status").hidden = true;
    $("image-paste-status").textContent = "";
    if (previous === "note") { note?.saveScrollPosition(); referencePicker.close(); referenceActions.close(); editorHelp.close(); }
  },
  afterChange(view) {
    placeSyncStatus(view);
    editorToolbar.close();
    if (view === "note") note?.restoreScrollPosition();
    else {
      hideUploadNotice();
      $("note-view").open = false;
      $("readable-export").open = false;
      highlightReferenceFile();
    }
  },
});

setStorageUser(metadata.username);
const padActions = initPadActions();
const guestLinks = initGuestLinks(api, encryption, () => proof, () => guestKey,
  () => connectionState === "writable" || connectionState === "readonly" ? doc : null, metadata.spaceId);
initSpaceAccess(api, deleteSpace, metadata.unreadGrantId, () => { attachments?.clearReferenceCache(); referenceActions.clear(); }, list => referenceActions.spaces(list));
const navigation = initPadNavigation(metadata);
const referenceActions = initReferenceActions({ metadata, editor: () => note, attachments: () => attachments,
  picker: () => referencePicker, canRead: () => !workspace.hidden && tabs.selected === "note" && ["writable", "readonly"].includes(connectionState),
  canEdit: () => writable, notice: referenceNotice, navigate: navigateReference, onRestoreFocus: focusDesktopNote });
function pendingBeforeUnload(event) { event.preventDefault(); event.returnValue = ""; }
function setPendingChanges(pending) {
  changesPending = pending;
  if (pending) window.addEventListener("beforeunload", pendingBeforeUnload);
  else window.removeEventListener("beforeunload", pendingBeforeUnload);
}
const referencePicker = initReferencePicker({ metadata, editor: () => note, attachments: () => attachments,
  canInsert: () => writable && tabs.selected === "note" && !workspace.hidden,
  create: padActions.createForReference, cancelCreate: padActions.cancelReferenceCreation,
  notice, onRestoreFocus: focusDesktopNote, onSpaces: list => referenceActions.spaces(list), onMetadata: space => referenceActions.remember(space) });
const editorHelp = initEditorHelp({ editor: () => note,
  canRead: () => !workspace.hidden && tabs.selected === "note" && ["writable", "readonly"].includes(connectionState),
  canEdit: () => writable, picker: () => referencePicker,
  readTab: () => localValue("dropnote:editor-help-tab"), saveTab: tab => saveLocal("dropnote:editor-help-tab", tab),
  notice: referenceNotice, restoreFocus: focusDesktopNote });
$("editor-help").addEventListener("click", () => editorHelp.open());
$("insert-reference").addEventListener("click", () => referencePicker.open());
for (const [id, view] of [["copy-space-reference", "note"], ["copy-downloads-reference", "files"]]) {
  $(id).addEventListener("click", () => copyText(formatReference({ kind: "space", spaceId: metadata.spaceId, view,
    label: spaceLabel(metadata.slug, metadata.displayName), alias: false }), $("copy-status"), t("Reference copied.")));
}

$("copy-link").addEventListener("click", () => copyText(padUrl, $("copy-status"), t(metadata.guestEnabled ? "Internal link copied." : "Link copied.")));
$("copy-files-link").addEventListener("click", () => copyText(filesUrl.href, $("copy-status"), t("Files link copied.")));
showUpload.addEventListener("click", () => tabs.showFiles());
const qr = initShareQr(padUrl, metadata.slug);
const wordWrap = $("word-wrap");
const lineNumbers = $("line-numbers");
const noteView = $("note-view");
const noteFontSize = $("note-font-size");
const noteMount = $("note");
const viewPreferences = [
  {
    key: "dropnote:note-font-size",
    control: noteFontSize,
    read(value) {
      noteFontSize.value = value === "small" || value === "large" ? value : "standard";
    },
    value: () => noteFontSize.value,
    apply() {
      noteMount.dataset.fontSize = noteFontSize.value;
      note?.requestMeasure();
    },
  },
  {
    key: "dropnote:note-word-wrap",
    control: wordWrap,
    read(value) {
      wordWrap.checked = value !== "0";
    },
    value: () => wordWrap.checked ? "1" : "0",
    apply: () => note?.setWordWrap(wordWrap.checked),
  },
  {
    key: "dropnote:note-line-numbers",
    control: lineNumbers,
    read(value) {
      lineNumbers.checked = value === "1";
    },
    value: () => lineNumbers.checked ? "1" : "0",
    apply: () => note?.setLineNumbers(lineNumbers.checked),
  },
  { key: "dropnote:note-show-status-bar", control: $("show-status-bar"), read: value => { $("show-status-bar").checked = value !== "0"; }, value: () => $("show-status-bar").checked ? "1" : "0", apply: () => placeSyncStatus(tabs.selected) },
  ...[["links", "clickable-links"], ["markdown", "markdown-formatting"], ["checklists", "interactive-checklists"], ["activeLine", "highlight-active-line"], ["references", "internal-references"]].map(([name, id]) => {
    const control = $(id);
    return { key: `dropnote:note-${id}`, control, read: value => { control.checked = value !== "0"; },
      value: () => control.checked ? "1" : "0", apply: () => { if (name === "activeLine") noteMount.dataset.activeLine = String(control.checked); note?.setSmartOption(name, control.checked); } };
  }),
];
function restoreViewPreference(preference) {
  preference.read(localValue(preference.key));
  preference.apply();
}
for (const preference of viewPreferences) {
  restoreViewPreference(preference);
  preference.control.addEventListener("change", () => {
    preference.apply();
    saveLocal(preference.key, preference.value());
  });
}
const readModeOption = $("read-mode");
if (readModeOption) readModeOption.checked = readMode = localValue(readModeKey) === "1";
function setReadMode(enabled) {
  readMode = enabled;
  if (readModeOption) readModeOption.checked = enabled;
  applyEditingState();
}
function changeReadMode(enabled) {
  setReadMode(enabled);
  if (!saveLocal(readModeKey, enabled ? "1" : null)) {
    notice(t("This browser could not save the read-only preference."));
  }
}
readModeOption?.addEventListener("change", () => changeReadMode(readModeOption.checked));
window.addEventListener("storage", (event) => {
  if (event.storageArea !== localStorage) return;
  if (readModeOption && (event.key === storageKey(readModeKey) || event.key === null)) {
    setReadMode(localValue(readModeKey) === "1");
  }
  for (const preference of viewPreferences) {
    if (event.key === storageKey(preference.key) || event.key === null) restoreViewPreference(preference);
  }
});
document.addEventListener("click", (event) => {
  if (!noteView.contains(event.target)) noteView.open = false;
});
noteView.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && noteView.open) {
    noteView.open = false;
    noteView.querySelector("summary").focus();
  }
});
$("find-note").addEventListener("click", () => note?.openSearch());
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
function canExportNote() { return !!noteText && !workspace.hidden; }
function readableNote() { return readableReferences(noteText, referenceActions.label); }
noteCopy.addEventListener("click", () => { if (canExportNote()) void copyText(noteText, noteClipboardStatus, t("Text copied.")); });
readableCopy.addEventListener("click", () => { if (canExportNote()) void copyText(readableNote(), noteClipboardStatus, t("Readable text copied.")); });

function downloadNote(readable = false) {
  if (!canExportNote()) return;

  lastExportTime = Math.max(Date.now(), lastExportTime + 1);
  const blob = new Blob([readable ? readableNote() : noteText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${metadata.slug}-${lastExportTime}${readable ? "-readable" : ""}.txt`;
  try {
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
noteDownload.addEventListener("click", () => downloadNote());
readableDownload.addEventListener("click", () => downloadNote(true));

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
  const headers = metadata.spaceId ? { "x-space-id": metadata.spaceId } : {};
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
  noteCopy.disabled = noteDownload.disabled = readableCopy.disabled = readableDownload.disabled = !canExportNote();
  const states = {
    "insert-reference": !writable,
    "editor-help": connectionState !== "writable" && connectionState !== "readonly",
    "find-note": connectionState !== "writable" && connectionState !== "readonly",
    "paste-note": !writable || readingClipboard,
    "undo-note": !writable || !canUndo,
    "redo-note": !writable || !canRedo,
    "rename-space": !writable || managing,
    "clear-note": !writable || !noteText,
    "clear-files": !writable || !fileCount || clearing,
    "change-ttl": !writable || managing,
    "delete-pad": managing,
  };
  for (const [id, disabled] of Object.entries(states)) {
    if ($(id)) $(id).disabled = disabled;
  }
}

function setState(state) {
  if (state === "readonly") {
    clearTimeout(pinTimer);
    writeToken = null;
  }
  const active = state === "writable" || state === "readonly";
  if (active) {
    workspace.hidden = false;
    tabs.showInitial(noteText, fileCount);
  }
  connectionState = state;
  if (!active) referenceActions.close();
  else { highlightReferenceFile(true); referenceActions.refresh(); }
  guestLinks?.refreshControls();
  applyEditingState();

  if (active && enteringWorkspace) {
    enteringWorkspace = false;
    note?.activatePosition();
    const focused = document.activeElement;
    if (focused === document.body || focused === document.documentElement || focused?.closest("#key-prompt[hidden]")) {
      focusDesktopNote();
    }
  }
}

function applyEditingState() {
  const wasWritable = writable;
  writable = connectionState === "writable" && !readMode;
  if (!writable) { cancelNoteReplacement(); referencePicker.close(); if (wasWritable) referenceActions.close(); }
  $("unlock-editing").hidden = readMode || connectionState !== "readonly" || !metadata.pinProtected || metadata.canEdit === false;
  updateSyncStatus();
  note?.setEditing(writable);
  editorToolbar.readOnly(connectionState === "readonly" || readMode);
  editorHelp.refresh();
  attachments?.setEditing(writable);
  updateActions();
}

function updateSyncStatus() {
  const active = connectionState === "writable" || connectionState === "readonly";
  const failed = connectionState === "unreadable" || connectionState === "missing";
  const showPending = changesPending;
  syncStatus.dataset.state = failed ? "error" : active && !showPending ? "live" : "pending";
  const label = {
    writable: t(readMode ? "Read only" : "Synced"),
    readonly: t("Read only"),
    connecting: t("Connecting…"),
    reconnecting: t("Connection lost · reconnecting…"),
    unreadable: t("Sync unavailable"),
    missing: t("Space unavailable"),
    locked: t("Locked"),
  }[connectionState];
  const status = showPending ? (writable ? t("Changes pending") : `${label} · ${t("Changes pending")}`) : label;
  if (syncStatus.textContent !== status) { syncStatus.textContent = status; syncStatus.title = status; }
}

function showSyncError(message) {
  syncError.textContent = message;
  syncError.hidden = !message;
}

function onMissing() {
  if (unlockKey) saveLocal(unlockKey, null);
  closeWorkspace();
  saveLocal(positionKey, null);
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
  guestKey = key;
  guestLinks?.refreshControls();
  if (encrypted) {
    $("key-prompt").hidden = true;
    $("lock-pad").hidden = false;
  }
  showSyncError("");
  doc = new Y.Doc();
  note = initNoteEditor(doc.getText("note"), {
    onReference: range => referencePicker.open(range),
    references: referenceActions,
    positionStorage: { read: () => localValue(positionKey), write: value => saveLocal(positionKey, value) },
    onMetrics: editorMetrics,
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
  for (const preference of viewPreferences) preference.apply();
  attachments = initAttachments(doc, metadata.slug, {
    key, spaceId: metadata.spaceId,
    writeHeaders,
    onUploaded: showUploadNotice,
    onCount(count) {
      fileCount = count;
      tabs.setFileCount(count);
      referenceActions.refresh();
      highlightReferenceFile();
      updateActions();
    },
  });
  enteringWorkspace = true;
  sync = startLiveSync(doc, {
    metadata, key, proof, cursorKey,
    onState(state) {
      setState(state);
      if (state === "unreadable") showSyncError(t("The space data could not be read. Reload the page to try again."));
    },
    onPendingChange(pending) {
      setPendingChanges(pending);
      updateSyncStatus();
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
  referencePicker.close();
  editorHelp.close();
  referenceActions.clear();
  clearTimeout(referenceNoticeTimer); $("reference-toast").hidden = true; $("reference-toast-text").textContent = "";
  cancelNoteReplacement();
  clearTimeout(pinTimer);
  sync?.stop();
  note?.destroy();
  attachments?.destroy();
  doc?.destroy();
  sync = note = attachments = doc = undefined;
  noteText = "";
  editorMetrics(null);
  fileCount = 0;
  tabs.setFileCount(0);
  hideUploadNotice();
  proof = writeToken = guestKey = null;
  guestLinks?.refreshControls();
  for (const id of ["pin-dialog", "ttl-dialog", "rename-dialog"]) {
    if ($(id)?.open) $(id).close();
  }
  workspace.hidden = true;
  editorToolbar.close();
  noteClipboardStatus.textContent = "";
  canUndo = canRedo = false;
  updateActions();
  setPendingChanges(false);
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
      const key = await unlockPadKey(passphrase, encryption);
      if (current !== generation) return;
      if (!key) throw new Error("Invalid passphrase");
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
  if (!writable || clearing) return;
  const ids = new Set(attachments.localReferenceFiles().map(file => file.blobId));
  if (!window.confirm(referenceDeleteMessage(t("Remove all {count} files from Default?", { count: fileCount }),
    doc.getText("note").toString(), metadata.spaceId, ids))) return;
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
  if (managing) return;
  const current = generation;
  managing = true;
  updateActions();
  try {
    await deleteSpace(metadata);
  } catch (error) {
    if (generation === current) notice(error.message || t("Could not delete this space."));
  } finally {
    managing = false;
    updateActions();
  }
});

async function deleteSpace(space) {
  const text = !workspace.hidden && ["writable", "readonly"].includes(connectionState) ? doc?.getText("note").toString() ?? "" : "";
  if (!window.confirm(referenceDeleteMessage(t("Delete “{name}”, its note and all its files?", { name: spaceLabel(space.slug, space.displayName) }), text, space.spaceId))) return false;
  const response = await fetch(`/api/pads/${encodeURIComponent(space.slug)}`, {
    method: "DELETE",
    headers: { "x-pad-created-at": space.createdAt, ...(space.spaceId ? { "x-space-id": space.spaceId } : {}) },
  });
  if (!response.ok) throw new Error(await responseError(response));
  if (space.slug === metadata.slug && space.createdAt === metadata.createdAt) closeWorkspace();
  forgetPad(space);
  if (space.slug === metadata.slug && space.createdAt === metadata.createdAt) {
    if (unlockKey) saveLocal(unlockKey, null);
    location.assign("/default");
  }
  return true;
}

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
    referenceActions.remember(metadata);
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
  initReferenceHistory({ beforeNavigate: mayNavigate, key: storageKey("dropnote:reference-history") });
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
      const key = await unlockPadKey(incoming.passphrase, encryption);
      if (current !== generation) return;
      if (key) {
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

window.addEventListener("pagehide", () => { referencePicker.close(); editorHelp.close(); attachments?.clearReferenceCache(); referenceActions.clear(); });

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
