// Shared by the live editor and the read-only guest editor.
export const SMART_NOTE_CSS = `
  :is(#note, #guest-note) { --editor-padding: 12px; --editor-active: color-mix(in srgb, var(--fg, CanvasText) 6%, var(--surface, Canvas)); background: var(--surface, Canvas); min-width: 0; }
  :is(#note, #guest-note) .cm-editor { background: var(--surface, Canvas); color: var(--fg, CanvasText); }
  :is(#note, #guest-note) .cm-scroller { background: inherit; }
  :is(#note, #guest-note) .cm-content { padding: var(--editor-padding) 0; caret-color: var(--fg, CanvasText); }
  :is(#note, #guest-note) .cm-line { padding-inline: var(--editor-padding); }
  :is(#note, #guest-note) .cm-gutters { background: var(--surface, Canvas); color: var(--muted, GrayText); border-color: var(--border, GrayText); }
  :is(#note, #guest-note) .cm-lineNumbers .cm-gutterElement { padding-inline: .55rem; }
  /* CodeMirror measures line blocks and aligns its own gutter, including vertical content padding. */
  :is(#note, #guest-note) .cm-activeLineGutter { background: transparent; }
  #note[data-active-line="true"] .cm-focused .cm-activeLineGutter { background: var(--editor-active); color: var(--fg); }
  .editor-status-bar { display: flex; align-items: center; justify-content: space-between; gap: .5rem; min-height: 2rem; padding: .3rem .75rem; border-top: 1px solid var(--border, GrayText); background: var(--surface, Canvas); color: var(--muted, GrayText); font: .75rem/1.4 system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  #note-sync-slot { min-width: 0; overflow: hidden; }
  #note-sync-slot #sync-status { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #note-sync-slot #sync-status::before { display: inline-block; margin-inline-end: .4em; }
  .editor-metrics { display: flex; align-items: center; justify-content: flex-end; gap: .8rem; margin-inline-start: auto; white-space: nowrap; }
  .editor-metrics > :empty { display: none; }
  .editor-toast { position: fixed; inset-inline-end: 1rem; inset-block-end: 1rem; z-index: 20; max-width: calc(100vw - 2rem); margin: 0; padding: .65rem .85rem; background: var(--surface, Canvas); border: 1px solid var(--border, GrayText); color: var(--fg, CanvasText); border-radius: .35rem; box-shadow: 0 .25rem 1rem #0003; font: .875rem/1.4 system-ui, sans-serif; pointer-events: none; }
  .editor-toast:empty { padding: 0; border: 0; box-shadow: none; }
  @media (max-width: 46rem), (pointer: coarse) {
    :is(#note, #guest-note) { --editor-padding: 8px; }
    .editor-metrics [data-metric="cursor"] { display: none; }
    .editor-metrics { gap: .45rem; }
  }
  @media (max-width: 32rem) { #note-status-bar .editor-metrics [data-metric="words"] { display: none; } }
  @media (max-width: 25rem) { #note-status-bar .editor-metrics [data-metric="chars"] { display: none; } }

  :is(#note, #guest-note) .smart-active-line { box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--fg, CanvasText) 6%, transparent); }
  :is(#note, #guest-note) .smart-h1 { font-size: 1.4em; font-weight: 700; }
  :is(#note, #guest-note) .smart-h2 { font-size: 1.25em; font-weight: 700; }
  :is(#note, #guest-note) .smart-h3 { font-size: 1.15em; font-weight: 700; }
  :is(#note, #guest-note) :is(.smart-h4, .smart-h5, .smart-h6, .smart-bold) { font-weight: 700; }
  :is(#note, #guest-note) .smart-bold-italic { font-weight: 700; font-style: italic; }
  :is(#note, #guest-note) .smart-italic { font-style: italic; }
  :is(#note, #guest-note) :is(.smart-strike, .smart-task-done) { text-decoration: line-through; opacity: .7; }
  :is(#note, #guest-note) .smart-quote { border-inline-start: .2rem solid var(--border, GrayText); padding-inline-start: calc(var(--editor-padding) + .4rem); color: var(--muted, GrayText); }
  :is(#note, #guest-note) :is(.smart-code, .smart-fence, .smart-inline-code) { background: color-mix(in srgb, currentColor 7%, transparent); }
  :is(#note, #guest-note) :is(.smart-code, .smart-fence) { padding-inline: var(--editor-padding); }
  :is(#note, #guest-note) .smart-fence { color: var(--muted, GrayText); }
  :is(#note, #guest-note) .smart-inline-code { border-radius: .2em; }
  :is(#note, #guest-note) .smart-rule-text { color: transparent; display: inline-block; width: 100%; background: linear-gradient(var(--border, GrayText), var(--border, GrayText)) center / 100% 1px no-repeat; }
  :is(#note, #guest-note) button.smart-task { box-sizing: border-box; display: inline-flex; vertical-align: -.1em; justify-content: center; align-items: center; width: 1.15em; height: 1.15em; min-height: 0; padding: 0; margin-inline-end: .15em; border: 1px solid currentColor; border-radius: .2em; color: var(--muted, GrayText); background: transparent; font: inherit; line-height: 1; cursor: pointer; }
  :is(#note, #guest-note) button.smart-task[aria-checked="true"] { color: var(--positive, LinkText); }
  :is(#note, #guest-note) button.smart-task:disabled { opacity: .7; cursor: default; }
  :is(#note, #guest-note) button.smart-code-copy { min-height: 0; padding: .1rem .4rem; margin-inline-start: .6em; border: 1px solid var(--border, GrayText); border-radius: .25rem; font: .78rem/1.5 system-ui, sans-serif; background: var(--surface, Canvas); color: var(--fg, CanvasText); cursor: pointer; }
  :is(#note, #guest-note) .note-link { color: var(--accent, LinkText); text-decoration: underline; cursor: pointer; }
  :is(#note, #guest-note) button.smart-reference { box-sizing: border-box; display: inline-flex; gap: .22em; align-items: baseline; vertical-align: baseline; max-width: 100%; padding: 0; min-height: 0; border: 0; border-radius: .25em; background: transparent; color: var(--accent, LinkText); font: inherit; line-height: inherit; text-align: start; white-space: normal; cursor: pointer; }
  :is(#note, #guest-note) button.smart-reference span:last-child { overflow-wrap: anywhere; min-width: 0; white-space: normal; }
  :is(#note, #guest-note) button.smart-reference[data-status="unavailable"], :is(#note, #guest-note) button.smart-reference[data-status="locked"] { color: var(--muted, GrayText); background: transparent; text-decoration: underline dotted; }
  :is(#note, #guest-note) :is(button.smart-reference, button.smart-task, a.note-link):is(:hover, :focus-visible) { background: var(--accent-soft, transparent); }
  :is(#note, #guest-note) button.smart-reference svg { width: 1em; height: 1em; flex: none; align-self: center; }
  #note .smart-reference-source { text-decoration: underline dotted; text-decoration-color: var(--accent); }
  .reference-action-buttons { display: flex; flex-direction: column; gap: .35rem; }
  #reference-actions h2 { overflow-wrap: anywhere; }
  #reference-actions progress { width: 100%; }
  #reference-actions form[hidden], #reference-actions progress[hidden] { display: none; }
  #attachments li.reference-file-highlight { outline: 2px solid var(--accent); outline-offset: -2px; background: var(--accent-soft); }
  #guest-note .guest-view-option input { width: auto; margin: 0; }
  :is(#note, #guest-note) .smart-search-match { background: #eab30855; outline: 1px solid #ca8a0466; }
  :is(#note, #guest-note) .cm-panels { background: var(--panel, Canvas); color: var(--fg, CanvasText); border-color: var(--border, GrayText); }
  :is(#note, #guest-note) .smart-search-protected { outline-style: dashed; }
  .smart-search-option[hidden] { display: none; }
  .smart-search-panel { padding: .45rem .6rem; font: .85rem/1.4 system-ui, sans-serif; }
  .smart-search-row { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .45rem; margin-block: .2rem; }
  .smart-search-row[hidden] { display: none !important; }
  .smart-search-row input[type="text"] { flex: 1 1 9rem; min-width: 6rem; width: auto; margin: 0; padding: .35rem .5rem; border: 1px solid var(--border, GrayText); border-radius: .25rem; background: var(--surface, Canvas); color: inherit; }
  .smart-search-row button { min-height: 1.9rem; padding: .25rem .5rem; font: inherit; }
  .smart-search-option { display: inline-flex; align-items: center; gap: .25rem; margin: 0; cursor: pointer; }
  .smart-search-option input { width: auto; margin: 0; accent-color: var(--accent, LinkText); }
  .smart-search-count { flex: 0 1 auto; font-size: .8rem; color: var(--muted, GrayText); }
  @media (pointer: coarse) {
    .smart-search-row button { min-height: 2.4rem; }
    .smart-search-row input[type="text"] { font-size: 1rem; }
  }
`;
