import { noteCounts, toolbarOverflow } from "../src/editor-ui.ts";
import { t } from "./i18n.js";

// A live region with no layout footprint; restarting the timer also handles repeated copies.
export function initEditorToast(node) {
  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    if (node.textContent) timer = setTimeout(() => { node.textContent = ""; }, 5000);
  });
  observer.observe(node, { childList: true, characterData: true, subtree: true });
}

export function initEditorMetrics(root, { guest = false } = {}) {
  const number = new Intl.NumberFormat(document.documentElement.lang);
  let doc, counts;
  const set = (key, value) => { const node = root.querySelector(`[data-metric="${key}"]`); if (node) node.textContent = value; };
  return state => {
    if (!state) { doc = counts = undefined; for (const key of ["cursor", "words", "chars", "selection"]) set(key, ""); return; }
    if (doc !== state.doc) {
      doc = state.doc;
      counts = noteCounts(doc.toString());
      set("words", t("{count} words", { count: number.format(counts.words) }));
      set("chars", t("{count} chars", { count: number.format(counts.characters) }));
    }
    if (!guest) {
      const { head } = state.selection.main;
      const line = doc.lineAt(head);
      set("cursor", t("Ln {line}, Col {column}", { line: number.format(line.number), column: number.format(head - line.from + 1) }));
      let selected = 0;
      for (const range of state.selection.ranges) for (const _ of doc.sliceString(range.from, range.to)) selected++;
      set("selection", selected ? t("{count} selected", { count: number.format(selected) }) : "");
    }
  };
}

// Move original controls instead of duplicating IDs, event handlers or enabled state.
export function initEditorToolbar(root) {
  const direct = root.querySelector(".editor-direct-actions");
  const more = root.querySelector("#editor-more");
  const overflow = more.querySelector(".menu-items");
  const controls = ["undo-note", "redo-note", "copy-note", "paste-note", "insert-reference", "find-note", "note-view", "editor-help", "download-note", "readable-export"].map(id => document.getElementById(id));
  let previous;
  const layout = () => {
    const width = root.clientWidth;
    if (!width || root.hidden) return;
    const ids = toolbarOverflow(width);
    const signature = ids.join();
    if (signature === previous) return;
    previous = signature;
    const active = document.activeElement;
    more.open = false;
    for (const control of controls) {
      if (control.tagName === "DETAILS") control.open = false;
      (ids.includes(control.id) ? overflow : direct).append(control);
    }
    if (controls.some(control => control.contains(active))) {
      if (overflow.contains(active)) more.querySelector("summary").focus();
      else active.focus();
    }
  };
  new ResizeObserver(layout).observe(root);
  layout();
  return { close() { more.open = false; for (const control of controls) if (control.tagName === "DETAILS") control.open = false; },
    readOnly(value) { for (const id of ["undo-note", "redo-note", "paste-note", "insert-reference"]) document.getElementById(id).hidden = value; } };
}
