import { formatReference, referenceLabel } from "../src/internal-references.ts";
import { spaceLabel } from "../src/space-label.ts";
import { referenceAddress } from "../src/reference-navigation.ts";
import { copyText } from "./pad-actions.js";
import { t } from "./i18n.js";

const $ = id => document.getElementById(id);
const targetKey = ref => ref.kind === "file" ? `${ref.spaceId}/${ref.blobId}` : ref.spaceId;

/** No background fetches: labels come only from the picker, local metadata or an explicit action. */
export function initReferenceActions({ metadata, editor, attachments, picker, canRead, canEdit, notice, navigate, onRestoreFocus }) {
  const dialog = $("reference-actions"), title = $("reference-action-title"), buttons = $("reference-action-buttons");
  const status = $("reference-action-status"), progress = $("reference-action-progress"), unlockForm = $("reference-action-unlock");
  const password = $("reference-action-password"), aliasForm = $("reference-alias-form"), alias = $("reference-alias");
  const names = new Map(), failures = new Map();
  let session, unlockFinish;
  const refresh = () => editor()?.refreshReferences();
  function remember(space) {
    if (!space?.spaceId || typeof space.slug !== "string" || space.slug.length > 200) return;
    names.delete(space.spaceId); names.set(space.spaceId, { name: spaceLabel(space.slug, space.displayName), at: Date.now() });
    while (names.size > 1000) names.delete(names.keys().next().value);
    failures.delete(space.spaceId); refresh();
  }
  function spaces(list) {
    names.clear();
    for (const space of list.slice(0, 1000)) if (space?.spaceId && typeof space.slug === "string") names.set(space.spaceId, { name: spaceLabel(space.slug, space.displayName), at: Date.now() });
    refresh();
  }
  function currentName(ref) {
    if (ref.kind === "file") return attachments()?.referenceName(ref.spaceId, ref.blobId);
    const cached = names.get(ref.spaceId);
    const knownName = cached && Date.now() - cached.at < 5 * 60_000 ? cached.name : undefined;
    return knownName || (ref.spaceId === metadata.spaceId ? spaceLabel(metadata.slug, metadata.displayName) : attachments()?.referenceName(ref.spaceId));
  }
  const label = ref => referenceLabel(ref, failures.get(targetKey(ref)) === "unavailable" || failures.get(ref.spaceId) === "unavailable" ? undefined : currentName(ref));
  function knownStatus(ref) {
    if (ref.kind === "file" && ref.spaceId === metadata.spaceId && canRead() && !attachments()?.localReferenceFiles().some(file => file.blobId === ref.blobId)) return "unavailable";
    return failures.get(targetKey(ref)) || failures.get(ref.spaceId);
  }
  function mark(ref, value) {
    failures.delete(targetKey(ref));
    if (value) failures.set(targetKey(ref), value);
    while (failures.size > 1000) failures.delete(failures.keys().next().value);
    refresh();
  }
  function close() {
    const old = session; session = undefined; old?.controller.abort(); unlockFinish?.(null);
    password.value = alias.value = ""; unlockForm.hidden = aliasForm.hidden = progress.hidden = true;
    buttons.replaceChildren(); status.textContent = ""; title.textContent = t("Reference");
    if (dialog.open) dialog.close();
  }
  function clear() { close(); names.clear(); failures.clear(); refresh(); }
  function alive(s) { return session === s && dialog.open && canRead() && editor() === s.editor; }
  function begin(ref) {
    if (!canRead() || document.querySelector("dialog[open]")) return null;
    const ed = editor(); if (!ed) return null;
    const anchor = canEdit() ? ed.captureInsertion(ref) : null;
    const s = { ref, anchor, editor: ed, controller: new AbortController(), busy: false };
    session = s; title.textContent = label(ref); dialog.showModal(); return s;
  }
  function add(text, action) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = t(text); button.addEventListener("click", action); buttons.append(button); return button;
  }
  function message(text) { status.textContent = text ? t(text) : ""; }
  function change(s, text) {
    if (!alive(s) || !canEdit() || !s.anchor || !s.editor.insertAtAnchor(s.anchor, text)) {
      close(); notice(t("The insertion position changed. Select the text again and retry.")); return;
    }
    close(); onRestoreFocus?.();
  }
  function applyToken(s, value) {
    try { change(s, formatReference(value)); }
    catch { message("The reference name is invalid or too long."); }
  }
  function menuItems(s) {
    if (!alive(s)) return;
    buttons.replaceChildren(); aliasForm.hidden = true;
    const ref = s.ref;
    add(ref.kind === "file" ? "Open / Preview" : "Open reference", () => run(s, "open"));
    if (ref.kind === "file") {
      add("Download", () => run(s, "download"));
      add("Show in Downloads", () => run(s, "files"));
    } else add("Open in new tab", () => run(s, "new-tab"));
    add("Copy reference", () => copyText(formatReference(ref), status, t("Reference copied.")));
    if (s.anchor && canEdit()) {
      add("Edit display name", () => { alias.value = label(ref); aliasForm.hidden = false; alias.focus(); alias.select(); });
      if (ref.alias) add("Reset display name", () => applyToken(s, { ...ref, alias: false, label: currentName(ref) || ref.label }));
      add("Change target", () => {
        const anchor = s.anchor; const alias = ref.alias ? ref.label : ""; close();
        if (!picker()?.open(undefined, { anchor, alias })) notice(t("The insertion position changed. Select the text again and retry."));
      });
      add("Remove reference", () => change(s, label(ref)));
    }
    add("Close", () => { close(); onRestoreFocus?.(); });
  }
  aliasForm.addEventListener("submit", event => {
    event.preventDefault(); const s = session; if (!s || !alive(s) || !canEdit()) return;
    applyToken(s, { ...s.ref, label: alias.value, alias: true });
  });
  function unlock(space, signal) {
    return new Promise(resolve => {
      if (signal.aborted) { resolve(null); return; }
      if (session) mark(session.ref, "locked");
      $("reference-action-unlock-label").textContent = t("Passphrase for {name}", { name: spaceLabel(space.slug, space.displayName) });
      password.value = ""; unlockForm.hidden = false; password.focus();
      const abort = () => done(null);
      function done(value) { signal.removeEventListener("abort", abort); unlockFinish = undefined; password.value = ""; unlockForm.hidden = true; resolve(value); }
      unlockFinish = done; signal.addEventListener("abort", abort, { once: true });
    });
  }
  unlockForm.addEventListener("submit", e => { e.preventDefault(); unlockFinish?.(password.value); });
  async function resolveSpace(ref, signal) {
    const response = await fetch(`/api/space-references/${encodeURIComponent(ref.spaceId)}`, { cache: "no-store", redirect: "error", signal });
    if (!response.ok) throw Object.assign(new Error("Reference data is unavailable"), { code: [403, 404].includes(response.status) ? "unavailable" : "request-failed" });
    const target = await response.json();
    if (target.spaceId !== ref.spaceId) throw Object.assign(new Error("Reference data is unavailable"), { code: "unavailable" });
    return target;
  }
  async function run(s, action) {
    if (!alive(s) || s.busy) return;
    const ref = s.ref, signal = s.controller.signal;
    // Open synchronously to avoid popup blocking; never give the target an opener.
    let newTab;
    if (action === "new-tab") {
      newTab = window.open("about:blank", "_blank");
      if (!newTab) { message("The new tab was blocked."); return; }
      newTab.opener = null;
    }
    s.busy = true; buttons.replaceChildren(); aliasForm.hidden = true; progress.hidden = false; progress.removeAttribute("value");
    message("Loading references…"); add("Cancel", () => { close(); onRestoreFocus?.(); });
    try {
      if (ref.kind === "file" && action !== "files") {
        await attachments().openReferencedFile(ref.spaceId, ref.blobId, { action, signal, unlock, onProgress(bytes, total) {
          if (alive(s) && total > 0) progress.value = Math.min(1, bytes / total);
        } });
      } else {
        let target;
        if (ref.kind === "file") {
          if (ref.spaceId === metadata.spaceId) {
            if (!attachments().localReferenceFiles().some(file => file.blobId === ref.blobId)) throw Object.assign(new Error("The referenced file is no longer available."), { code: "unavailable" });
            target = await resolveSpace(ref, signal);
          } else {
            const result = await attachments().browseReferences(ref.spaceId, { signal, unlock });
            if (!result.files.some(file => file.blobId === ref.blobId)) throw Object.assign(new Error("The referenced file is no longer available."), { code: "unavailable" });
            target = result.target;
          }
        } else target = await resolveSpace(ref, signal);
        if (!alive(s) || signal.aborted) return;
        const address = referenceAddress(target, ref, location.origin);
        remember(target); mark(ref);
        if (newTab) { newTab.location.replace(new URL(address, location.origin).href); newTab = null; }
        else { close(); navigate(ref, address); return; }
      }
      if (alive(s)) { mark(ref); close(); }
    } catch (error) {
      if (!alive(s) || signal.aborted) return;
      if (error.name === "AbortError") { close(); return; }
      if (["unavailable", "denied"].includes(error.code)) {
        if (ref.kind === "space" || error.code === "denied") names.delete(ref.spaceId);
        mark(ref, "unavailable"); close(); notice(t("Reference unavailable")); return;
      }
      if (["locked", "wrong-password"].includes(error.code)) mark(ref, "locked");
      message(error.message || "Reference data is unavailable");
      buttons.replaceChildren(); add("Retry", () => run(s, action)); add("Close", close);
    } finally { newTab?.close(); if (alive(s)) { s.busy = false; progress.hidden = true; refresh(); } }
  }
  dialog.addEventListener("cancel", e => { e.preventDefault(); close(); onRestoreFocus?.(); });
  dialog.addEventListener("close", () => { if (!dialog.open && session) close(); });
  return { label, currentName, status: knownStatus, remember, spaces, refresh, clear, close,
    open(ref) { const s = begin(ref); if (s) void run(s, "open"); },
    menu(ref) { const s = begin(ref); if (s) menuItems(s); },
  };
}
