import { Decoration, EditorView, ViewPlugin, keymap } from "@codemirror/view";
import { noteLinks } from "../src/note-links.ts";
import { t } from "./i18n.js";

function decorations(view) {
  const ranges = [];
  const seen = new Set();
  for (const { from, to } of view.visibleRanges) {
    for (let line = view.state.doc.lineAt(from); ; line = view.state.doc.lineAt(line.to + 1)) {
      if (!seen.has(line.number)) {
        seen.add(line.number);
        for (const link of noteLinks(line.text)) {
          ranges.push(Decoration.mark({
            tagName: "a",
            class: "note-link",
            attributes: {
              href: link.href, target: "_blank", rel: "noopener noreferrer",
              tabindex: view.state.readOnly ? "0" : "-1",
              title: t(view.state.readOnly ? "Open link in a new tab" : "Ctrl/Cmd-click or tap to open link"),
            },
          }).range(line.from + link.from, line.from + link.to));
        }
      }
      if (line.to >= to || line.to === view.state.doc.length) break;
    }
  }
  return Decoration.set(ranges, true);
}

function openLink(href) {
  window.open(href, "_blank", "noopener,noreferrer");
}

const links = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = decorations(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged || update.startState.readOnly !== update.state.readOnly) {
      this.decorations = decorations(update.view);
    }
  }
}, { decorations: (plugin) => plugin.decorations });

export const noteLinkExtension = [
  links,
  EditorView.domEventHandlers({
    click(event, view) {
      const anchor = event.target.closest?.("a.note-link");
      if (!anchor || !view.contentDOM.contains(anchor)) return false;
      const touch = event.pointerType === "touch" || event.pointerType === "pen" ||
        (!event.pointerType && window.matchMedia("(pointer: coarse)").matches);
      // Plain mouse clicks in an editable note must still position the caret.
      event.preventDefault();
      if (!view.state.readOnly && !event.ctrlKey && !event.metaKey && !touch && event.detail !== 0) return false;
      openLink(anchor.href);
      return true;
    },
  }),
  keymap.of([{
    key: "Mod-Enter",
    run(view) {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      const link = noteLinks(line.text).find(({ from, to }) => head >= line.from + from && head <= line.from + to);
      if (!link) return false;
      openLink(link.href);
      return true;
    },
  }]),
];
