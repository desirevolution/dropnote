import { HELP_EXAMPLES, HELP_TABS, GUEST_FILE_EXAMPLE } from "./editor-help.ts";
import { translate } from "./translations.ts";
import type { Language } from "./locale.ts";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export function renderEditorHelp(language: Language, guest = false): string {
  const t = (message: string) => escape(translate(language, message));
  const labels = ["Markdown", "Checklists", "References", "Shortcuts"];
  const explanations = {
    markdown: "Markdown Light displays supported syntax directly in the editor. Move the cursor into formatted text to edit its source. Code blocks have a copy button; no syntax highlighting or HTML rendering is provided. Headings support one to six # characters. Edit the example link destination after inserting it.",
    checklists: "Click a checkbox or use Ctrl/Cmd+Enter to toggle it when editing. Enter continues a list; Enter on an empty item ends it. In read-only mode tasks cannot be changed.",
    references: guest ? "Only files included in this guest share can be opened. Other references are not available. The file ID below is an example." : "Type [[ or use Insert reference to choose a page or file. Example IDs below are illustrative; Insert opens the picker. Names update when known unless an alias is set. References do not grant access. Select text before inserting to use it as an alias, or edit the display name later.",
  };
  return `<dialog id="editor-help-dialog" aria-labelledby="editor-help-title">
    <header class="editor-help-head"><h2 id="editor-help-title">${t("Editor help")}</h2><button type="button" id="editor-help-close" aria-label="${t("Close")}">×</button></header>
    <div class="editor-help-tabs" role="group" aria-label="${t("Editor help")}">${HELP_TABS.map((tab, i) => `<button type="button" data-help-tab="${tab}" aria-pressed="${i === 0}">${t(labels[i]!)}</button>`).join("")}</div>
    ${Object.entries(HELP_EXAMPLES).map(([tab, examples]) => `<section data-help-panel="${tab}"${tab === "markdown" ? "" : " hidden"}>
      <p>${t(explanations[tab as keyof typeof explanations])}</p>
      ${tab === "references" && guest ? `<p>${t("Private reference names may still appear as plain text.")}</p>` : ""}
      ${(tab === "references" && guest ? [GUEST_FILE_EXAMPLE] : examples).map(example => `<div class="editor-help-row"><div><strong>${t(example.title)}</strong><pre class="editor-help-source">${escape(example.syntax)}</pre></div><div class="editor-help-preview">${example.preview}</div><div class="editor-help-actions"><button type="button" data-help-copy="${example.id}" aria-label="${t("Copy example")}: ${t(example.title)}">${t("Copy text")}</button>${guest ? "" : `<button type="button" data-help-insert="${example.id}" aria-label="${t("Insert example")}: ${t(example.title)}" hidden>${t("Insert")}</button>`}</div></div>`).join("")}
    </section>`).join("")}
    <section data-help-panel="shortcuts" hidden>
      <p>${t("View options switch formatting on or off without changing the note. Search works on the source text and known reference names; replacing is available only when editing.")}</p>
      <dl class="editor-help-shortcuts">${[
        ["Ctrl/Cmd + F", "Find"], ["Enter / Shift + Enter", "Next / previous search match"], ["Esc", "Close search or dialog"],
        ...(guest ? [] : [["Ctrl/Cmd + H", "Find and replace"], ["Ctrl/Cmd + K", "Insert reference"], ["Ctrl/Cmd + Z", "Undo"], ["Shift + F10", "Reference context menu"]]),
        ["Ctrl/Cmd + Click", "Open link"], ["F3 / Shift + F3", "Next / previous search match"], ["Ctrl/Cmd + Enter", guest ? "Open link" : "Open link or toggle task"],
      ].map(([key, label]) => `<dt><kbd>${escape(key!)}</kbd></dt><dd>${t(label!)}</dd>`).join("")}</dl>
      <p>${t("On touch devices, tap a link to open it. Read-only links can also be opened with a normal click.")}</p>
      ${guest ? "" : `<p>${t("Cursor and scroll position are remembered per space. Internal references are protected from replacement by default.")}</p>`}
    </section><p id="editor-help-status" role="status" aria-live="polite"></p>
  </dialog>`;
}

export const EDITOR_HELP_CSS = `
#editor-help-dialog { box-sizing: border-box; width: min(52rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow: auto; padding: 1rem; border: 1px solid var(--border, GrayText); border-radius: .5rem; background: var(--surface, Canvas); color: var(--fg, CanvasText); }
#editor-help-dialog::backdrop { background: #0007; }
#editor-help-dialog [hidden] { display: none !important; }
.editor-help-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; border: 0; padding: 0; }
.editor-help-head h2 { margin: 0; }
.editor-help-tabs { display: flex; gap: .35rem; flex-wrap: wrap; margin-block: .8rem; }
.editor-help-tabs button[aria-pressed=true] { outline: 2px solid var(--accent, LinkText); outline-offset: -2px; }
.editor-help-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: .75rem; align-items: center; padding: .65rem 0; border-top: 1px solid var(--border, GrayText); }
.editor-help-source, .editor-help-preview { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.editor-help-source { font-size: .85rem; margin: .25rem 0 0; }
.editor-help-actions { display: flex; gap: .35rem; flex-wrap: wrap; }
.editor-help-preview { padding: .4rem; font-family: ui-monospace, monospace; }
.help-h1 { font-size: 1.4em; } .help-h2 { font-size: 1.25em; }
.help-quote { border-inline-start: .2rem solid var(--border, GrayText); padding-inline-start: .6rem; }
.help-code { background: color-mix(in srgb, currentColor 7%, transparent); border-radius: .2rem; white-space: pre-wrap; }
.help-link, .help-ref { color: var(--accent, LinkText); } .help-link { text-decoration: underline; }
.editor-help-shortcuts { display: grid; grid-template-columns: auto 1fr; gap: .55rem; } .editor-help-shortcuts dd { margin: 0; }
#editor-help-status { min-height: 1.3em; }
@media (max-width: 600px) { #editor-help-dialog { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0; border-radius: 0; } .editor-help-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .editor-help-actions { grid-column: 1 / -1; } .editor-help-tabs button, .editor-help-actions button { min-height: 44px; } }
`;
