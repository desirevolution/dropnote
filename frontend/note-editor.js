import * as Y from "yjs";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, lineNumbers, highlightActiveLineGutter, placeholder } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";

import { t } from "./i18n.js";
import { createSmartNote } from "./smart-note.js";
import { createNoteSearch } from "./note-search.js";
import { captureInsertion, resolveInsertion } from "./insertion-anchor.js";
import { referenceTrigger } from "../src/reference-insertion.ts";
import { editorPosition } from "../src/smart-note.ts";

const colors = ["#cf4c73", "#478bf3", "#3d9b6d", "#cb7723", "#9061dd", "#2098a9"];

class Cursor extends WidgetType {
  constructor(color, username) {
    super();
    this.color = color;
    this.username = username;
  }
  eq(other) {
    return this.color === other.color && this.username === other.username;
  }
  toDOM() {
    const node = document.createElement("span");
    node.className = "remote-cursor";
    node.style.setProperty("--cursor", this.color);
    node.setAttribute("aria-hidden", "true");
    node.textContent = "\u200b";
    if (this.username) {
      const label = document.createElement("span");
      label.className = "remote-cursor-name";
      label.textContent = this.username;
      node.append(label);
    }
    return node;
  }
}

export function initNoteEditor(note, { onText, onCursor, onHistory, onMetrics, positionStorage, onReference, references }) {
  const setMarkers = StateEffect.define();
  const editing = new Compartment();
  const wrapping = new Compartment();
  const gutters = new Compartment();
  const editingMode = (enabled) => [EditorState.readOnly.of(!enabled), EditorView.editable.of(enabled)];
  const cursors = new Map();
  const markers = StateField.define({
    create: () => Decoration.none,
    update(previous, transaction) {
      let next = previous.map(transaction.changes);
      for (const effect of transaction.effects) {
        if (effect.is(setMarkers)) next = effect.value;
      }
      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  let writable = false, destroyed = false, referenceRefreshQueued = false;
  let timer;
  let visibleCursor = false;
  const undoManager = new Y.UndoManager(note);
  const isolatedEdit = run => {
    undoManager.stopCapturing();
    try { run(); } finally { undoManager.stopCapturing(); }
  };
  const smart = createSmartNote({ references, onEdit: isolatedEdit, status: document.getElementById("note-clipboard-status") });
  const search = createNoteSearch({ onEdit: isolatedEdit, referenceLabel: references?.label });
  let positionReady = false, positionTimer, restoring = false, scrollPosition = [0, 0], positionFrame;
  function visible() { return editor.dom.getClientRects().length > 0 && !editor.dom.closest("[hidden]"); }
  function captureScroll() {
    if (positionReady && !restoring && visible()) scrollPosition = [editor.scrollDOM.scrollLeft, editor.scrollDOM.scrollTop];
  }
  function persistPosition() {
    clearTimeout(positionTimer); positionTimer = undefined;
    if (!positionReady) return;
    captureScroll();
    const { anchor, head } = editor.state.selection.main;
    positionStorage?.write(JSON.stringify({ anchor, head, left: scrollPosition[0], top: scrollPosition[1] }));
  }
  function queuePosition() {
    if (positionReady && !restoring && !positionTimer) positionTimer = setTimeout(persistPosition, 180);
  }
  function restoreScroll() {
    if (!positionReady || !visible()) return;
    restoring = true;
    cancelAnimationFrame(positionFrame);
    editor.requestMeasure();
    positionFrame = requestAnimationFrame(() => {
      editor.requestMeasure({ read: () => null, write: () => {
        if (visible()) editor.scrollDOM.scrollTo(...scrollPosition);
        restoring = false;
      } });
    });
  }
  function activatePosition() {
    if (positionReady) return;
    const saved = editorPosition(positionStorage?.read() ?? null, editor.state.doc.length);
    if (saved) {
      scrollPosition = [saved.left, saved.top];
      editor.dispatch({ selection: { anchor: saved.anchor, head: saved.head } });
    }
    positionReady = true;
    restoreScroll();
  }
  function updateHistory() {
    onHistory(undoManager.canUndo(), undoManager.canRedo());
  }
  const historyEvents = ["stack-item-added", "stack-item-popped", "stack-cleared"];
  for (const event of historyEvents) undoManager.on(event, updateHistory);
  const visualViewport = window.visualViewport;
  const touchScreen = window.matchMedia("(pointer: coarse)");
  let normalHeight = visualViewport?.height ?? 0;
  let viewportWidth = visualViewport?.width ?? 0;
  let viewportFrame = 0;
  let keyboardHeight;

  function queueViewportUpdate() {
    if (visualViewport && touchScreen.matches && !viewportFrame) {
      viewportFrame = requestAnimationFrame(updateViewport);
    }
  }

  function updateViewport() {
    viewportFrame = 0;
    const { height, width, scale, offsetTop } = visualViewport;
    if (scale === 1) {
      if (width !== viewportWidth || !editor.hasFocus) {
        viewportWidth = width;
        normalHeight = height;
      } else {
        normalHeight = Math.max(normalHeight, height);
      }
    }
    const layoutHeight = document.documentElement.clientHeight;
    const nextHeight = writable && editor.hasFocus && scale === 1 &&
      Math.max(normalHeight, layoutHeight) - height > 120 ? Math.max(1, Math.floor(height - 16)) : undefined;
    if (nextHeight !== keyboardHeight) {
      keyboardHeight = nextHeight;
      if (nextHeight === undefined) editor.dom.style.removeProperty("--note-visible-height");
      else editor.dom.style.setProperty("--note-visible-height", `${nextHeight}px`);
      editor.requestMeasure();
    }
    if (nextHeight === undefined) return;

    editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.selection.main.head, { yMargin: 12 }) });
    editor.requestMeasure({
      read(view) {
        const caret = view.coordsAtPos(view.state.selection.main.head);
        if (!caret) return 0;
        const top = offsetTop + 8;
        const bottom = offsetTop + height - 8;
        if (caret.bottom > bottom) return caret.bottom - bottom;
        if (caret.top < top) return caret.top - top;
        return 0;
      },
      write(distance) {
        if (distance && editor.hasFocus && keyboardHeight !== undefined) window.scrollBy(0, distance);
      },
    });
  }

  visualViewport?.addEventListener("resize", queueViewportUpdate);
  visualViewport?.addEventListener("scroll", queueViewportUpdate);

  const editor = new EditorView({
    parent: document.querySelector("#note"),
    doc: note.toString(),
    extensions: [
      editing.of(editingMode(false)),
      wrapping.of(EditorView.lineWrapping),
      gutters.of([]),
      EditorView.contentAttributes.of({ "aria-labelledby": "note-title", spellcheck: "false", tabindex: "0" }),
      placeholder(t("Write or paste text here…")),
      smart.extension,
      search.extension,
      keymap.of([
        ...yUndoManagerKeymap.map((binding) => ({
          ...binding,
          run: (view) => !writable || binding.run(view),
        })),
        { key: "Mod-k", run: () => { if (!writable || !onReference) return false; onReference(); return true; } },
        ...defaultKeymap,
      ]),
      yCollab(note, null, { undoManager }),
      markers,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onText(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) onMetrics?.(update.state);
        if (writable && onReference && update.docChanged && update.transactions.some(tr => tr.isUserEvent("input.type"))) {
          const selection = update.state.selection.main;
          const from = selection.empty ? referenceTrigger(update.state.doc.toString(), selection.head) : null;
          if (from !== null) queueMicrotask(() => {
            if (writable && editor.state === update.state) onReference({ from, to: selection.head, trigger: true });
          });
        }
        if (update.docChanged || update.selectionSet) queuePosition();
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          queueCursor();
          if (update.focusChanged || (keyboardHeight !== undefined && (update.selectionSet || update.docChanged))) queueViewportUpdate();
          if (update.docChanged && cursors.size) queueMicrotask(draw);
        }
      }),
    ],
  });
  onText(note.toString());
  onMetrics?.(editor.state);
  editor.scrollDOM.addEventListener("scroll", queuePosition, { passive: true });
  window.addEventListener("pagehide", persistPosition);
  document.addEventListener("visibilitychange", persistPosition);

  function focusEnd() {
    if (!writable) return;
    editor.dispatch({ selection: { anchor: editor.state.doc.length }, scrollIntoView: true });
    editor.focus();
  }

  const notePanel = editor.dom.closest(".note-card");
  function focusBelowText(event) {
    if (!writable || event.defaultPrevented || event.button !== 0 ||
        event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target.closest(".cm-line, .cm-gutters, .smart-search-panel, .editor-status-bar, button, a, input, label")) return;

    const scroller = editor.scrollDOM;
    if (scroller.contains(target)) {
      const bounds = scroller.getBoundingClientRect();
      const x = event.clientX - bounds.left - scroller.clientLeft;
      const y = event.clientY - bounds.top - scroller.clientTop;
      if (x < 0 || x >= scroller.clientWidth || y < 0 || y >= scroller.clientHeight) return;
    }

    const lastLine = editor.lineBlockAt(editor.state.doc.length);
    if (event.clientY < editor.documentTop + lastLine.bottom) return;
    event.preventDefault();
    const selection = editor.state.selection.main;
    if (!editor.hasFocus || !selection.empty || selection.head !== editor.state.doc.length) focusEnd();
  }

  // Handle mouse focus before the browser can move it off the editor.
  function onNotePointerDown(event) {
    if (event.isPrimary && event.pointerType === "mouse") focusBelowText(event);
  }
  // Touch and pen still focus on tap, so scrolling gestures remain native.
  function onNoteClick(event) {
    if (event.detail > 0 && event.pointerType !== "mouse") focusBelowText(event);
  }
  notePanel.addEventListener("pointerdown", onNotePointerDown, true);
  notePanel.addEventListener("click", onNoteClick);

  function queueCursor() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      sendCursor();
    }, 70);
  }

  function sendCursor() {
    if (writable && editor.hasFocus && !document.hidden) {
      visibleCursor = true;
      onCursor(Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(note, editor.state.selection.main.head)));
    } else if (visibleCursor) {
      visibleCursor = false;
      onCursor(null);
    }
  }

  function draw() {
    const widgets = [];
    for (const [peer, cursor] of cursors) {
      try {
        const absolute = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cursor.position), note.doc);
        if (absolute?.type !== note || absolute.index > editor.state.doc.length) continue;
        const color = colors[parseInt(peer.slice(0, 4), 16) % colors.length] ?? colors[0];
        widgets.push(Decoration.widget({ widget: new Cursor(color, cursor.username), side: 1 }).range(absolute.index));
      } catch {
        // The sender may have left before its document state arrived.
      }
    }
    editor.dispatch({ effects: setMarkers.of(Decoration.set(widgets, true)) });
  }

  const heartbeat = setInterval(() => {
    sendCursor();
    for (const [peer, cursor] of cursors) {
      if (Date.now() - cursor.seen > 25_000) cursors.delete(peer);
    }
    draw();
  }, 8_000);
  document.addEventListener("visibilitychange", queueCursor);
  window.addEventListener("blur", queueCursor);

  return {
    captureInsertion(range) {
      if (!writable) return null;
      const { from, to } = range ?? editor.state.selection.main;
      if (note.toString() !== editor.state.doc.toString()) return null;
      return captureInsertion(note, from, to);
    },
    insertAtAnchor(anchor, text) {
      if (!writable || note.toString() !== editor.state.doc.toString()) return false;
      const range = resolveInsertion(anchor, note);
      if (!range) return false;
      if (typeof text === "function") text = text(note.toString(), range.from, range.to);
      if (typeof text !== "string") return false;
      isolatedEdit(() => editor.dispatch({ changes: { ...range, insert: text }, selection: { anchor: range.from + text.length }, scrollIntoView: true, userEvent: "input" }));
      return true;
    },
    refreshReferences() {
      if (destroyed || referenceRefreshQueued) return;
      referenceRefreshQueued = true;
      queueMicrotask(() => { referenceRefreshQueued = false; if (!destroyed) { smart.refresh(editor); search.refresh(editor); } });
    },
    insertionCoords() { return editor.coordsAtPos(editor.state.selection.main.head); },
    activatePosition,
    saveScrollPosition: persistPosition,
    restoreScrollPosition: restoreScroll,
    setSmartOption(name, enabled) { smart.configure(editor, { [name]: enabled }); },
    openSearch() { search.open(editor); },
    requestMeasure() {
      editor.requestMeasure();
    },
    setWordWrap(enabled) {
      editor.dispatch({ effects: wrapping.reconfigure(enabled ? EditorView.lineWrapping : []) });
    },
    setLineNumbers(enabled) {
      editor.dispatch({ effects: gutters.reconfigure(enabled ? [lineNumbers(), highlightActiveLineGutter()] : []) });
    },
    setEditing(enabled) {
      if (writable === enabled) return;
      writable = enabled;
      editor.dispatch({ effects: editing.reconfigure(editingMode(enabled)) });
      queueCursor();
      queueViewportUpdate();
    },
    undo() {
      if (writable) undoManager.undo();
    },
    redo() {
      if (writable) undoManager.redo();
    },
    appendText(text) {
      if (!writable || !text) return;
      const end = editor.state.doc.length;
      const separator = end && editor.state.doc.sliceString(end - 1, end) !== "\n" && !/^[\r\n]/.test(text) ? "\n" : "";
      undoManager.stopCapturing();
      editor.dispatch({ changes: { from: end, insert: separator + text }, userEvent: "input.paste" });
      undoManager.stopCapturing();
    },
    focus() {
      if (writable) editor.focus();
    },
    focusEnd,
    replaceText(text) {
      if (!writable || editor.state.doc.toString() === text) return;
      // Separate this paste from typing on both sides of the undo history.
      undoManager.stopCapturing();
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: text },
        userEvent: "input.paste",
      });
      undoManager.stopCapturing();
    },
    clear() {
      if (!writable || !editor.state.doc.length) return;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length } });
    },
    presence({ type, peer, position, username }) {
      if (type === "reset") cursors.clear();
      else if (type === "presence-left" || !position) cursors.delete(peer);
      else cursors.set(peer, { position, username, seen: Date.now() });
      draw();
    },
    destroy() {
      destroyed = true;
      persistPosition();
      cancelAnimationFrame(positionFrame);
      editor.scrollDOM.removeEventListener("scroll", queuePosition);
      window.removeEventListener("pagehide", persistPosition);
      document.removeEventListener("visibilitychange", persistPosition);
      clearTimeout(timer);
      clearInterval(heartbeat);
      cancelAnimationFrame(viewportFrame);
      visualViewport?.removeEventListener("resize", queueViewportUpdate);
      visualViewport?.removeEventListener("scroll", queueViewportUpdate);
      document.removeEventListener("visibilitychange", queueCursor);
      window.removeEventListener("blur", queueCursor);
      notePanel.removeEventListener("pointerdown", onNotePointerDown, true);
      notePanel.removeEventListener("click", onNoteClick);
      writable = false;
      editor.destroy();
      for (const event of historyEvents) undoManager.off(event, updateHistory);
      undoManager.destroy();
    },
  };
}
