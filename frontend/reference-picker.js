import { formatReference } from "../src/internal-references.ts";
import { referenceQuery } from "../src/reference-insertion.ts";
import { SPACE_ID_PATTERN } from "../src/space-identity.ts";
import { spaceLabel } from "../src/space-label.ts";
import { t } from "./i18n.js";

const $ = id => document.getElementById(id);
const nameOf = space => spaceLabel(space.slug, space.displayName);
const choiceName = space => `${nameOf(space)}${space.slug === "default" ? "" : ` · ${space.slug}`}`;
const validSpace = space => space && typeof space.slug === "string" && SPACE_ID_PATTERN.test(space.spaceId);

export function initReferencePicker({ metadata, editor, attachments, canInsert, create, cancelCreate, notice, onRestoreFocus, onSpaces, onMetadata }) {
  const dialog = $("reference-picker"), query = $("reference-query"), results = $("reference-results"), status = $("reference-status");
  const filters = [...dialog.querySelectorAll("[data-reference-filter]")];
  const unlockForm = $("reference-unlock"), password = $("reference-password");
  let session, filter = "all", spaces = [], target, foreignFiles = [], loading = false, browseController, unlockFinish;
  const alive = s => session === s && dialog.open && canInsert() && editor() === s.editor;
  function setStatus(message = "") { status.textContent = message ? t(message) : ""; }
  function cancelBrowse() { browseController?.abort(); browseController = undefined; unlockFinish?.(null); }
  function close() {
    const old = session;
    session = undefined;
    old?.controller.abort(); cancelBrowse(); cancelCreate();
    if (dialog.open) dialog.close();
    dialog.removeAttribute("data-anchored"); dialog.style.removeProperty("top"); dialog.style.removeProperty("left");
    query.value = ""; spaces = []; foreignFiles = []; target = undefined; loading = false;
    results.replaceChildren(); setStatus();
  }
  dialog.addEventListener("close", () => { if (!dialog.open) close(); });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); onRestoreFocus?.(); });
  function finish(value, s = session) {
    if (!s || !alive(s)) return;
    let token;
    try { token = formatReference({ ...value, ...(s.alias ? { label: s.alias, alias: true } : { alias: false }) }); }
    catch { setStatus("The reference name is invalid or too long."); return; }
    if (!s.editor.insertAtAnchor(s.anchor, token)) {
      close(); notice(t("The insertion position changed. Select the text again and retry.")); onRestoreFocus?.(); return;
    }
    close(); onRestoreFocus?.();
  }
  function add(text, action) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = text;
    button.addEventListener("click", action); results.append(button); return button;
  }
  function heading(text) { const h = document.createElement("h3"); h.textContent = text; results.append(h); }
  function render() {
    if (!session || !alive(session)) return;
    results.replaceChildren();
    for (const b of filters) b.setAttribute("aria-pressed", String(b.dataset.referenceFilter === filter));
    if (!unlockForm.hidden) return;
    if (loading) {
      add(t("Cancel"), () => { cancelBrowse(); loading = false; setStatus(); render(); query.focus(); });
      return;
    }
    const q = referenceQuery(query.value).query.trim().toLocaleLowerCase();
    const matches = text => text.toLocaleLowerCase().includes(q);
    const s = session;
    if (target) {
      add(t("Back to spaces"), () => { cancelBrowse(); target = undefined; foreignFiles = []; query.value = ""; setStatus(); render(); query.focus(); });
      heading(t("Files in {name}", { name: nameOf(target) }));
      for (const file of foreignFiles.filter(f => matches(f.name))) add(`📎 ${file.name}`, () => finish({ kind: "file", spaceId: target.spaceId, blobId: file.blobId, label: file.name }, s));
      if (!foreignFiles.some(f => matches(f.name))) heading(t("No matching references"));
      return;
    }
    const matchingSpaces = spaces.filter(space => matches(nameOf(space)) || matches(space.slug));
    if (filter !== "files") {
      heading(t("Pages"));
      for (const space of matchingSpaces) {
        add(s.preferredView === "files" ? `↳ ${t("Downloads in {name}", { name: nameOf(space) })}` : `▤ ${choiceName(space)}`, () => finish({ kind: "space", spaceId: space.spaceId, view: s.preferredView ?? "note", label: nameOf(space) }, s));
        if (s.preferredView !== "files") add(`↳ ${t("Downloads in {name}", { name: nameOf(space) })}`, () => finish({ kind: "space", spaceId: space.spaceId, view: "files", label: nameOf(space) }, s));
      }
      const name = referenceQuery(query.value).query.trim();
      if (name && name.length <= 80 && !matchingSpaces.length && !s.listFailed && !s.listLoading) add(t("Create space “{name}”", { name }), () => {
        if (!alive(s)) return;
        if (!create(name, pad => { if (alive(s)) { onMetadata?.(pad); finish({ kind: "space", spaceId: pad.spaceId, view: s.preferredView ?? "note", label: nameOf(pad) }, s); } })) setStatus("Could not create the space.");
      });
    }
    if (filter !== "pages") {
      heading(t("Files in current space"));
      for (const file of attachments()?.localReferenceFiles().filter(f => matches(f.name)) ?? []) add(`📎 ${file.name}`, () => finish({ kind: "file", spaceId: metadata.spaceId, blobId: file.blobId, label: file.name }, s));
      heading(t("Browse files in other spaces"));
      // Space names can be filtered, but no other file lists are loaded here.
      for (const space of spaces.filter(space => space.spaceId !== metadata.spaceId && matches(nameOf(space)))) add(`▸ ${choiceName(space)}`, () => browse(space, s));
    }
    if (!results.querySelector("button")) heading(t("No matching references"));
  }
  function unlock(space, signal) {
    return new Promise(resolve => {
      if (signal.aborted) { resolve(null); return; }
      $("reference-unlock-label").textContent = t("Passphrase for {name}", { name: nameOf(space) });
      password.value = ""; unlockForm.hidden = false; password.focus();
      const abort = () => done(null);
      function done(value) {
        signal.removeEventListener("abort", abort); unlockFinish = undefined;
        password.value = ""; unlockForm.hidden = true; resolve(value);
      }
      unlockFinish = done; signal.addEventListener("abort", abort, { once: true });
    });
  }
  unlockForm.addEventListener("submit", event => { event.preventDefault(); unlockFinish?.(password.value); });
  $("reference-unlock-cancel").addEventListener("click", () => { cancelBrowse(); loading = false; setStatus(); render(); query.focus(); });
  async function browse(space, s) {
    if (!alive(s)) return;
    cancelBrowse(); const controller = new AbortController(); browseController = controller;
    const signal = AbortSignal.any([controller.signal, s.controller.signal]);
    loading = true; setStatus("Loading references…"); render();
    try {
      const data = await attachments().browseReferences(space.spaceId, { signal, unlock });
      if (!alive(s) || signal.aborted) return;
      target = data.target; foreignFiles = data.files; onMetadata?.(data.target); query.value = ""; filter = "files"; setStatus();
    } catch (error) {
      if (alive(s) && !signal.aborted) setStatus(error.message || "Reference data is unavailable");
    } finally {
      if (alive(s) && browseController === controller) {
        browseController = undefined; loading = false; render(); query.focus();
        if (!target && status.textContent) add(t("Retry"), () => browse(space, s));
      }
    }
  }
  async function loadSpaces(s) {
    const signal = s.controller.signal;
    try {
      const response = await fetch("/api/my-spaces?references=1", { cache: "no-store", signal, redirect: "error" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!alive(s)) return;
      const all = [metadata, data.defaultSpace, ...data.spaces, ...(data.sharedSpaces ?? [])];
      spaces = [...new Map(all.filter(validSpace).map(space => [space.spaceId, space])).values()];
      onSpaces?.(spaces);
      if (!browseController) setStatus();
    } catch {
      if (!alive(s)) return;
      s.listFailed = true; if (!browseController) setStatus("Could not load spaces. Local references are still available.");
    } finally { if (alive(s)) { s.listLoading = false; if (!browseController) render(); } }
  }
  function open(range, options = {}) {
    if (!canInsert() || dialog.open || document.querySelector("dialog[open]")) return false;
    const ed = editor(), anchor = options.anchor ?? ed?.captureInsertion(range);
    if (!anchor) return false;
    const s = { editor: ed, anchor, alias: options.alias ?? (range?.trigger ? "" : anchor.original), controller: new AbortController(), listLoading: true, preferredView: options.view === "files" ? "files" : undefined };
    session = s; filter = options.filter === "files" || options.filter === "pages" ? options.filter : "all"; spaces = validSpace(metadata) ? [metadata] : []; target = undefined; foreignFiles = []; query.value = "";
    loading = false; setStatus("Loading references…");
    const coords = range?.trigger && matchMedia("(pointer: fine) and (min-width: 601px)").matches ? ed.insertionCoords() : null;
    if (coords) {
      dialog.setAttribute("data-anchored", "");
      dialog.style.left = `${Math.max(8, Math.min(coords.left, innerWidth - 560))}px`;
      dialog.style.top = `${Math.max(8, Math.min(coords.bottom + 5, innerHeight - Math.min(544, innerHeight - 16) - 8))}px`;
    }
    dialog.showModal(); query.focus(); render(); void loadSpaces(s); return true;
  }
  query.addEventListener("input", () => {
    const parsed = referenceQuery(query.value);
    if (parsed.filter !== "all") { filter = parsed.filter; if (filter === "pages") { cancelBrowse(); loading = false; target = undefined; foreignFiles = []; setStatus(); } }
    render();
  });
  for (const button of filters) button.addEventListener("click", () => {
    cancelBrowse(); loading = false; target = undefined; foreignFiles = []; filter = button.dataset.referenceFilter;
    query.value = referenceQuery(query.value).query; setStatus(); render(); query.focus();
  });
  dialog.addEventListener("keydown", event => {
    if (!unlockForm.hidden || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    const buttons = [...results.querySelectorAll("button:not(:disabled)")];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "Enter" && document.activeElement === query) { event.preventDefault(); buttons[0].click(); }
    else if (event.key !== "Enter" && (index >= 0 || document.activeElement === query)) {
      event.preventDefault(); buttons[index < 0 ? (event.key === "ArrowDown" ? 0 : buttons.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
  });
  return { open, close };
}
