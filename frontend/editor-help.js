import { helpExample, helpInsertion, helpTab } from "../src/editor-help.ts";
import { copyText } from "./pad-actions.js";
import { t } from "./i18n.js";

export function initEditorHelp({ editor = () => null, canRead, canEdit = () => false, picker, readTab, saveTab, notice = () => {}, restoreFocus = () => {} }) {
  const dialog = document.getElementById("editor-help-dialog");
  const status = document.getElementById("editor-help-status");
  const buttons = [...dialog.querySelectorAll("[data-help-tab]")];
  const panels = [...dialog.querySelectorAll("[data-help-panel]")];
  const inserts = [...dialog.querySelectorAll("[data-help-insert]")];
  let session = null;
  function select(value) {
    const tab = helpTab(value);
    buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.helpTab === tab)));
    panels.forEach(panel => { panel.hidden = panel.dataset.helpPanel !== tab; });
    saveTab?.(tab);
  }
  function refresh() {
    if (!dialog.open) return;
    if (!canRead()) { close(); return; }
    if (!canEdit() || session?.editor !== editor()) session = null;
    inserts.forEach(button => { button.hidden = !canEdit() || !session; });
  }
  function close() {
    session = null;
    if (dialog.open) dialog.close();
  }
  function open() {
    if (!canRead() || dialog.open || document.querySelector("dialog[open]")) return false;
    const ed = editor();
    const anchor = canEdit() && ed?.captureInsertion();
    session = anchor ? { editor: ed, anchor } : null;
    status.textContent = "";
    select(readTab?.() ?? null);
    dialog.showModal(); refresh();
    buttons.find(button => button.getAttribute("aria-pressed") === "true")?.focus();
    return true;
  }
  function insert(id) {
    const s = session, example = helpExample(id);
    if (!example || !s || !dialog.open || !canRead() || !canEdit() || s.editor !== editor()) return;
    if (example.kind === "reference") {
      close();
      if (!picker?.().open(undefined, { anchor: s.anchor, alias: s.anchor.original, filter: id === "file" ? "files" : "pages", view: id === "downloads" ? "files" : undefined })) {
        notice(t("The insertion position changed. Select the text again and retry.")); restoreFocus();
      }
      return;
    }
    let unsupported = false;
    const ok = s.editor.insertAtAnchor(s.anchor, (text, from, to) => {
      const value = helpInsertion(id, text, from, to);
      unsupported = value === null;
      return value;
    });
    if (unsupported) { status.textContent = t("This selection cannot be formatted with this example. Choose simpler text or place the cursor without a selection."); return; }
    close();
    if (!ok) notice(t("The insertion position changed. Select the text again and retry."));
    restoreFocus();
  }
  buttons.forEach(button => button.addEventListener("click", () => { select(button.dataset.helpTab); status.textContent = ""; }));
  dialog.querySelectorAll("[data-help-copy]").forEach(button => button.addEventListener("click", () => {
    const example = helpExample(button.dataset.helpCopy);
    if (canRead() && example) void copyText(example.syntax, status, t("Text copied."));
  }));
  inserts.forEach(button => button.addEventListener("click", () => insert(button.dataset.helpInsert)));
  document.getElementById("editor-help-close").addEventListener("click", close);
  dialog.addEventListener("close", () => { if (!dialog.open) session = null; });
  return { open, close, refresh };
}
