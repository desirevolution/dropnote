import * as Y from "yjs";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";

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

export function initNoteEditor(note, { onText, onCursor }) {
  const setMarkers = StateEffect.define();
  const editing = new Compartment();
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
  let writable = false;
  let timer;
  let visibleCursor = false;
  const undoManager = new Y.UndoManager(note);
  const editor = new EditorView({
    parent: document.querySelector("#note"),
    doc: note.toString(),
    extensions: [
      editing.of(editingMode(false)),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-labelledby": "note-title", spellcheck: "false", tabindex: "0" }),
      placeholder("Write or paste text here…"),
      keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
      yCollab(note, null, { undoManager }),
      markers,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onText(update.state.doc.toString());
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          queueCursor();
          if (update.docChanged && cursors.size) queueMicrotask(draw);
        }
      }),
    ],
  });
  onText(note.toString());

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

  let scrollPosition;
  return {
    saveScrollPosition() {
      scrollPosition = [editor.scrollDOM.scrollLeft, editor.scrollDOM.scrollTop];
    },
    restoreScrollPosition() {
      if (!scrollPosition) return;
      editor.scrollDOM.scrollTo(...scrollPosition);
      editor.requestMeasure();
    },
    setEditing(enabled) {
      if (writable === enabled) return;
      writable = enabled;
      editor.dispatch({ effects: editing.reconfigure(editingMode(enabled)) });
      queueCursor();
    },
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
      clearTimeout(timer);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", queueCursor);
      window.removeEventListener("blur", queueCursor);
      editor.destroy();
      undoManager.destroy();
    },
  };
}
