import { StateEffect, StateField, Prec } from "@codemirror/state";
import { Decoration, EditorView, keymap, showPanel, getPanel } from "@codemirror/view";
import { searchNote, replacementText } from "../src/note-search.ts";
import { t } from "./i18n.js";

export function createNoteSearch({ onEdit = run => run() } = {}) {
  const configure = StateEffect.define();
  const empty = { open: false, text: "", caseSensitive: false, wholeWord: false, regex: false };
  function calculate(state, query) {
    const result = query.open ? searchNote(state.doc.toString(), query) : { matches: [], error: false, limited: false };
    return { ...query, ...result, decorations: Decoration.set(result.matches.filter(m => m.from < m.to).map(m => Decoration.mark({ class: "smart-search-match" }).range(m.from, m.to)), true) };
  }
  const field = StateField.define({
    create: state => calculate(state, empty),
    update(value, tr) {
      let changed = tr.docChanged && value.open;
      for (const effect of tr.effects) if (effect.is(configure)) { value = { ...value, ...effect.value }; changed = true; }
      return changed ? calculate(tr.state, value) : value;
    },
    provide: f => [EditorView.decorations.from(f, v => v.decorations), showPanel.from(f, v => v.open ? panel : null)],
  });
  function set(view, value) { view.dispatch({ effects: configure.of(value) }); }
  function current(view) {
    const sel = view.state.selection.main;
    return view.state.field(field).matches.findIndex(m => m.from === sel.from && m.to === sel.to);
  }
  function navigate(view, direction = 1) {
    const { matches } = view.state.field(field);
    if (!matches.length) return false;
    const sel = view.state.selection.main, index = current(view);
    let next = index >= 0 ? (index + direction + matches.length) % matches.length : direction > 0 ? matches.findIndex(m => m.from >= sel.to) : matches.findLastIndex(m => m.to <= sel.from);
    if (next < 0) next = direction > 0 ? 0 : matches.length - 1;
    const m = matches[next];
    view.dispatch({ selection: { anchor: m.from, head: m.to }, scrollIntoView: true });
    return true;
  }
  function replace(view, value, all) {
    const state = view.state, query = state.field(field);
    if (state.readOnly || !query.matches.length || (all && query.limited)) return;
    let index = current(view);
    if (!all && index < 0) { navigate(view); index = current(view); if (index < 0) return; }
    const matches = all ? query.matches : [query.matches[index]];
    const text = state.doc.toString();
    const changes = matches.map(m => ({ from: m.from, to: m.to, insert: replacementText(text, m, value, query.regex) }));
    // Avoid merging Replace All into the user's previous typing in Yjs undo history.
    onEdit(() => view.dispatch({ changes, ...(all ? {} : { selection: { anchor: changes[0].from + changes[0].insert.length }, scrollIntoView: true }), userEvent: "input.replace" }));
  }
  function open(view, replacing = false) {
    const selected = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    const query = view.state.field(field);
    if (!query.open) set(view, { open: true, ...(selected && !selected.includes("\n") ? { text: selected } : {}) });
    const dom = getPanel(view, panel)?.dom;
    const input = dom?.querySelector(replacing && !view.state.readOnly ? "[data-replace]" : "[data-find]");
    input?.focus(); input?.select();
    return true;
  }
  function close(view) { set(view, { ...empty }); view.focus(); return true; }
  function panel(view) {
    const dom = document.createElement("div");
    dom.className = "smart-search-panel";
    dom.setAttribute("role", "search");
    const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
    const button = (text, run, label = text) => { const node = el("button", "", text); node.type = "button"; node.setAttribute("aria-label", label); node.title = label; node.addEventListener("click", run); return node; };
    const input = (label, attribute) => { const node = el("input", ""); node.type = "text"; node.setAttribute(attribute, ""); node.placeholder = t(label); node.setAttribute("aria-label", t(label)); node.autocomplete = "off"; node.spellcheck = false; return node; };
    const row = el("div", "smart-search-row"), replaceRow = el("div", "smart-search-row");
    const find = input("Find", "data-find"), withText = input("Replace with", "data-replace");
    const counter = el("span", "smart-search-count"); counter.setAttribute("role", "status");
    const previous = button("↑", () => navigate(view, -1), t("Previous match")), next = button("↓", () => navigate(view), t("Next match"));
    const dismiss = button("×", () => close(view), t("Close"));
    const replaceOne = button(t("Replace"), () => replace(view, withText.value, false)), replaceAll = button(t("Replace all"), () => replace(view, withText.value, true));
    row.append(find, previous, next, counter, dismiss); replaceRow.append(withText, replaceOne, replaceAll);
    const options = el("div", "smart-search-row");
    for (const [key, label] of [["caseSensitive", "Match case"], ["wholeWord", "Whole word"], ["regex", "Regular expression"]]) {
      const wrap = el("label", "smart-search-option"), check = el("input", ""); check.type = "checkbox"; check.checked = view.state.field(field)[key];
      check.addEventListener("change", () => set(view, { [key]: check.checked })); wrap.append(check, t(label)); options.append(wrap);
    }
    find.value = view.state.field(field).text;
    find.addEventListener("input", () => set(view, { text: find.value }));
    dom.append(row, options, replaceRow);
    dom.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(view); }
      else if (event.key === "Enter" && event.target === find) { event.preventDefault(); navigate(view, event.shiftKey ? -1 : 1); }
      else if (event.key === "Enter" && event.target === withText) { event.preventDefault(); replace(view, withText.value, false); }
      else if ((event.ctrlKey || event.metaKey) && ["f", "h"].includes(event.key.toLowerCase())) { event.preventDefault(); open(view, event.key.toLowerCase() === "h"); }
    });
    function refresh() {
      const q = view.state.field(field), index = current(view);
      counter.textContent = q.error ? t("Invalid regular expression") : q.limited ? t("More than 10,000 matches") : `${index >= 0 ? `${index + 1}/` : ""}${q.matches.length}`;
      previous.disabled = next.disabled = replaceOne.disabled = !q.matches.length;
      replaceAll.disabled = !q.matches.length || q.limited;
      replaceRow.hidden = view.state.readOnly;
    }
    refresh();
    return { dom, top: true, update: refresh };
  }
  return { open, extension: [field, Prec.high(keymap.of([
    { key: "Mod-f", run: view => open(view) }, { key: "Mod-h", run: view => open(view, true) },
    { key: "Escape", run: view => view.state.field(field).open ? close(view) : false },
    { key: "F3", run: view => view.state.field(field).open ? navigate(view) : open(view), shift: view => navigate(view, -1) },
  ]))] };
}
