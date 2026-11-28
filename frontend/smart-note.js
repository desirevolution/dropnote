import { StateEffect, StateField, Prec } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from "@codemirror/view";
import { smartLines, inlineFormats, listContinuation } from "../src/smart-note.ts";
import { noteReferences } from "../src/internal-references.ts";
import { t } from "./i18n.js";
import { copyText } from "./pad-actions.js";

export const smartDefaults = { links: true, markdown: true, checklists: true, activeLine: true };

export function createSmartNote({ onEdit = (run) => run(), status, options = smartDefaults, references } = {}) {
  const setOptions = StateEffect.define();
  const refreshReferences = StateEffect.define();
  function buildRefs(doc) { const text = doc.toString(); return text.includes("[[") ? (references?.parse ?? noteReferences)(text) : []; }
  const referenceModel = StateField.define({
    create: state => references ? buildRefs(state.doc) : [],
    update: (value, tr) => references && tr.docChanged ? buildRefs(tr.newDoc) : value,
  });
  function refAt(view, pos) {
    if (!references || !view.state.field(config).references) return null;
    const refs = view.state.field(referenceModel);
    return refs.find(r => r.from <= pos && pos < r.to) ?? refs.find(r => r.to === pos);
  }
  function currentRef(view, ref) {
    const current = refAt(view, ref.from);
    return current && current.from === ref.from && current.to === ref.to &&
      view.state.doc.sliceString(current.from, current.to) === ref.source ? current : null;
  }
  class ReferenceWidget extends WidgetType {
    constructor(ref, label, status, readOnly, source) { super(); Object.assign(this, { ref: { ...ref, source }, label, status, readOnly }); }
    eq(other) { return this.ref.from === other.ref.from && this.ref.source === other.ref.source && this.label === other.label && this.status === other.status && this.readOnly === other.readOnly; }
    toDOM(view) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "smart-reference"; button.dataset.status = this.status || "unknown";
      const ns = "http://www.w3.org/2000/svg";
      const icon = document.createElementNS(ns, "svg");
      for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) icon.setAttribute(key, value);
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", this.status === "unavailable" ? "M12 3 2 21h20L12 3zm0 6v5m0 3h.01" : this.status === "locked" ? "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" : ["file", "guest-file"].includes(this.ref.kind) ? "m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9m-6 13 8-8" : this.ref.view === "files" ? "M3 5h7l2 3h9v12H3z" : "M5 3h10l4 4v14H5zM9 11h6m-6 4h6");
      icon.append(path);
      const label = document.createElement("span"); label.textContent = this.label;
      button.append(icon, label);
      button.title = this.status === "unavailable" ? t("Reference unavailable") : t(this.readOnly ? "Open reference" : "Ctrl/Cmd-click or tap to open reference");
      const accessibleName = this.ref.kind === "space" && this.ref.view === "files" ? t("Downloads in {name}", { name: this.label }) : this.label;
      button.setAttribute("aria-label", `${button.title}: ${accessibleName}`);
      let hold, held = false, start;
      const stopHold = () => { clearTimeout(hold); hold = undefined; };
      button.addEventListener("pointerdown", e => {
        stopHold(); held = false;
        if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
        start = [e.clientX, e.clientY];
        hold = setTimeout(() => {
          const ref = currentRef(view, this.ref);
          if (references.menu && button.isConnected && ref) { held = true; references.menu?.(ref); }
        }, 550);
      });
      button.addEventListener("pointermove", e => { if (hold && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) stopHold(); });
      for (const type of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(type, stopHold);
      button.addEventListener("mousedown", e => e.preventDefault());
      button.addEventListener("click", e => {
        e.preventDefault(); e.stopPropagation();
        if (held) { held = false; return; }
        const ref = currentRef(view, this.ref); if (!ref) return;
        const touch = e.pointerType === "touch" || e.pointerType === "pen" || (!e.pointerType && matchMedia("(pointer: coarse)").matches);
        if (view.state.readOnly || e.ctrlKey || e.metaKey || touch || e.detail === 0) references.open(ref);
        else { view.dispatch({ selection: { anchor: ref.from + 2 } }); view.focus(); }
      });
      button.addEventListener("contextmenu", e => { if (!references.menu) return; e.preventDefault(); e.stopPropagation(); const ref = currentRef(view, this.ref); if (ref) references.menu?.(ref); });
      button.addEventListener("keydown", e => { if (references.menu && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) { e.preventDefault(); const ref = currentRef(view, this.ref); if (ref) references.menu?.(ref); } });
      return button;
    }
  }
  const config = StateField.define({
    create: () => ({ ...smartDefaults, references: Boolean(references), ...options }),
    update(value, tr) {
      for (const effect of tr.effects) if (effect.is(setOptions)) value = { ...value, ...effect.value };
      return value;
    },
  });
  const model = StateField.define({
    create: state => smartLines(state.doc.toString()),
    update: (value, tr) => tr.docChanged ? smartLines(tr.newDoc.toString()) : value,
  });
  const structure = StateField.define({
    create: state => blockDecorations(state),
    update(value, tr) {
      return tr.docChanged || tr.startState.field(config).markdown !== tr.state.field(config).markdown ? blockDecorations(tr.state) : value;
    },
    provide: field => EditorView.decorations.from(field),
  });
  function blockDecorations(state) {
    if (!state.field(config).markdown) return Decoration.none;
    return Decoration.set(state.field(model).filter(line => line.kind).map(line =>
      Decoration.line({ class: `smart-${line.kind}` }).range(line.from)), true);
  }
  function lineModel(view, pos) { return view.state.field(model)[view.state.doc.lineAt(pos).number - 1]; }
  function toggle(view, line) {
    if (view.state.readOnly || !view.state.field(config).checklists || !line?.task) return false;
    const from = line.from + line.task.from + 1;
    onEdit(() => view.dispatch({ changes: { from, to: from + 1, insert: line.task.checked ? " " : "x" }, userEvent: "input" }));
    return true;
  }
  class TaskWidget extends WidgetType {
    constructor(line, readOnly) { super(); this.line = line; this.readOnly = readOnly; }
    eq(other) { return this.line.from === other.line.from && this.line.task.from === other.line.task.from && this.line.task.checked === other.line.task.checked && this.readOnly === other.readOnly; }
    toDOM(view) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "smart-task";
      button.setAttribute("role", "checkbox");
      button.setAttribute("aria-checked", String(this.line.task.checked));
      button.setAttribute("aria-label", t("Toggle task"));
      button.disabled = this.readOnly;
      button.textContent = this.line.task.checked ? "✓" : "";
      button.addEventListener("mousedown", e => e.preventDefault());
      button.addEventListener("click", e => {
        e.preventDefault(); e.stopPropagation();
        const line = lineModel(view, Math.min(this.line.from, view.state.doc.length));
        if (line?.from === this.line.from && line.task?.from === this.line.task.from) toggle(view, line);
      });
      return button;
    }
  }
  class CodeCopy extends WidgetType {
    constructor(line) { super(); this.line = line; }
    eq(other) { return this.line.from === other.line.from && this.line.code.from === other.line.code.from && this.line.code.to === other.line.code.to; }
    toDOM(view) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "smart-code-copy";
      button.textContent = t("Copy code");
      button.addEventListener("mousedown", e => e.preventDefault());
      button.addEventListener("click", e => {
        e.preventDefault(); e.stopPropagation();
        const line = lineModel(view, Math.min(this.line.from, view.state.doc.length));
        if (line?.from === this.line.from && line.code && view.state.field(config).markdown) {
          void copyText(view.state.doc.sliceString(line.code.from, line.code.to), status ?? button, t("Code copied."));
        }
      });
      return button;
    }
  }
  class BulletWidget extends WidgetType {
    toDOM() {
      const span = document.createElement("span");
      span.textContent = "•";
      span.setAttribute("aria-hidden", "true");
      return span;
    }
  }
  const bullet = Decoration.replace({ widget: new BulletWidget() });
  const hidden = Decoration.replace({});
  function inlineDecorations(view) {
    const { state } = view;
    const prefs = state.field(config);
    const ranges = [], seen = new Set();
    const selection = state.selection.ranges;
    const refs = state.field(referenceModel);
    let refIndex = 0;
    const mark = (from, to, cls) => { if (from < to) ranges.push(Decoration.mark({ class: cls }).range(from, to)); };
    const hide = (from, to) => { if (from < to) ranges.push(hidden.range(from, to)); };
    const link = (from, to, href) => {
      if (from >= to) return;
      ranges.push(Decoration.mark({ tagName: "a", class: "note-link", attributes: {
        href, target: "_blank", rel: "noopener noreferrer", tabindex: state.readOnly ? "0" : "-1",
        title: t(state.readOnly ? "Open link in a new tab" : "Ctrl/Cmd-click or tap to open link"),
      } }).range(from, to));
    };
    for (const { from, to } of view.visibleRanges) {
      for (let docLine = state.doc.lineAt(from); ; docLine = state.doc.lineAt(docLine.to + 1)) {
        if (!seen.has(docLine.number)) {
          seen.add(docLine.number);
          const line = state.field(model)[docLine.number - 1];
          const active = selection.some(s => (!s.empty || (!state.readOnly && view.hasFocus)) && s.from <= line.to && s.to >= line.from);
          if (prefs.activeLine && view.hasFocus && selection.some(s => s.head >= line.from && s.head <= line.to)) {
            ranges.push(Decoration.line({ class: "smart-active-line" }).range(line.from));
          }
          if (line.kind === "fence" || line.kind === "code") {
            if (prefs.markdown && line.code) ranges.push(Decoration.widget({ widget: new CodeCopy(line), side: 1 }).range(line.to));
          } else {
            if (prefs.markdown && !active) {
              hide(line.from, line.from + line.prefix);
              if (line.bullet !== undefined) ranges.push(bullet.range(line.from + line.bullet, line.from + line.bullet + 1));
            }
            if (prefs.markdown && line.kind === "rule" && !active) mark(line.from, line.to, "smart-rule-text");
            if (prefs.checklists && line.task) {
              const start = line.from + line.task.from;
              const markerStart = line.from + /^\s*/.exec(line.text)[0].length;
              const editingMarker = active && selection.some(s => s.from <= start + 3 && s.to >= markerStart);
              if (!editingMarker) ranges.push(Decoration.replace({ widget: new TaskWidget(line, state.readOnly) }).range(markerStart, start + 3));
              if (line.task.checked) mark(start + 3, line.to, "smart-task-done");
            }
            while (refs[refIndex] && refs[refIndex].to <= line.from) refIndex++;
            const lineRefs = [];
            for (let i = refIndex; refs[i] && refs[i].from < line.to; i++) lineRefs.push(refs[i]);
            for (const ref of lineRefs) {
              if (!prefs.references) continue;
              const editing = !state.readOnly && selection.some(s => (view.hasFocus || !s.empty) && s.from <= ref.to && s.to >= ref.from);
              if (editing) mark(ref.from, ref.to, "smart-reference-source");
              else ranges.push(Decoration.replace({ widget: new ReferenceWidget(ref, references.label(ref), references.status(ref), state.readOnly, state.doc.sliceString(ref.from, ref.to)) }).range(ref.from, ref.to));
            }
            for (const f of inlineFormats(line.text)) {
              const start = line.from + f.from, end = line.from + f.to;
              const innerFrom = start + f.start, innerTo = end - f.end;
              // Canonical tokens are opaque even with reference formatting disabled.
              if (lineRefs.some(r => start < r.to && end > r.from)) continue;
              // Never overlap the checklist marker or a hidden heading prefix.
              if (line.task && f.from < line.task.from + 3) continue;
              if (f.kind === "link") {
                if (prefs.links) link(start, end, f.href);
              } else if (f.kind === "md-link") {
                if (prefs.markdown && !active && prefs.links) {
                  hide(start, innerFrom); hide(innerTo, end); link(innerFrom, innerTo, f.href);
                } else if (prefs.links) link(end - f.end + 2, end - 1, f.href);
                else if (prefs.markdown && !active) { hide(start, innerFrom); hide(innerTo, end); }
              } else if (prefs.markdown) {
                if (!active) { hide(start, innerFrom); hide(innerTo, end); }
                mark(innerFrom, innerTo, `smart-${f.kind}`);
              }
            }
          }
        }
        if (docLine.to >= to || docLine.to === state.doc.length) break;
      }
    }
    return Decoration.set(ranges, true);
  }
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = inlineDecorations(view); }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged ||
          update.transactions.some(tr => tr.effects.some(e => e.is(refreshReferences))) || update.startState.readOnly !== update.state.readOnly || update.startState.field(config) !== update.state.field(config)) {
        this.decorations = inlineDecorations(update.view);
      }
    }
  }, { decorations: value => value.decorations });
  function open(href) {
    if (href.startsWith("mailto:")) window.location.href = href;
    else window.open(href, "_blank", "noopener,noreferrer");
  }
  return {
    configure(view, options) { view.dispatch({ effects: setOptions.of(options) }); },
    refresh(view) { view.dispatch({ effects: refreshReferences.of(null) }); },
    extension: [config, model, referenceModel, structure, plugin,
      EditorView.domEventHandlers({
        contextmenu(event, view) {
          if (!references?.menu) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          const ref = pos == null ? null : refAt(view, pos);
          if (!ref) return false;
          event.preventDefault(); references.menu?.(ref); return true;
        },
        click(event, view) {
          const anchor = event.target.closest?.("a.note-link");
          if (!anchor || !view.contentDOM.contains(anchor)) return false;
          const touch = event.pointerType === "touch" || event.pointerType === "pen" || (!event.pointerType && window.matchMedia("(pointer: coarse)").matches);
          event.preventDefault();
          if (!view.state.readOnly && !event.ctrlKey && !event.metaKey && !touch && event.detail !== 0) return false;
          open(anchor.href); return true;
        },
      }),
      Prec.high(keymap.of([
        { key: "Shift-F10", run(view) { const ref = refAt(view, view.state.selection.main.head); if (!ref || !references?.menu) return false; references.menu(ref); return true; } },
        { key: "Mod-Enter", run(view) {
          const prefs = view.state.field(config), head = view.state.selection.main.head;
          const line = lineModel(view, head);
          if (["code", "fence"].includes(line.kind)) return false;
          const ref = refAt(view, head);
          if (ref) { references.open(ref); return true; }
          if (view.state.field(referenceModel).some(r => r.from <= head && head <= r.to)) return false;
          if (prefs.links) {
            const f = inlineFormats(line.text).find(f => f.href && head >= line.from + f.from && head <= line.from + f.to);
            if (f) { open(f.href); return true; }
          }
          return toggle(view, line);
        } },
        { key: "Enter", run(view) {
          const state = view.state, prefs = state.field(config), sel = state.selection.main;
          if (state.readOnly || view.composing || state.selection.ranges.length !== 1 || !sel.empty) return false;
          const line = lineModel(view, sel.head);
          if (["code", "fence"].includes(line.kind) || (!prefs.markdown && !(prefs.checklists && line.task))) return false;
          const result = listContinuation(state.doc.sliceString(line.from, sel.head), state.doc.sliceString(sel.head, line.to));
          if (!result) return false;
          const from = sel.head - result.remove;
          view.dispatch({ changes: { from, to: sel.head, insert: result.insert }, selection: { anchor: from + result.insert.length }, scrollIntoView: true, userEvent: "input" });
          return true;
        } },
      ])),
    ],
  };
}
