// Shared by the live editor and the read-only guest editor.
export const SMART_NOTE_CSS = `
  :is(#note, #guest-note) .smart-active-line { box-shadow: inset 0 0 0 999px color-mix(in srgb, currentColor 6%, transparent); }
  :is(#note, #guest-note) .smart-h1 { font-size: 1.45em; font-weight: 700; }
  :is(#note, #guest-note) .smart-h2 { font-size: 1.25em; font-weight: 700; }
  :is(#note, #guest-note) .smart-h3 { font-size: 1.12em; font-weight: 700; }
  :is(#note, #guest-note) :is(.smart-h4, .smart-h5, .smart-h6, .smart-bold) { font-weight: 700; }
  :is(#note, #guest-note) .smart-bold-italic { font-weight: 700; font-style: italic; }
  :is(#note, #guest-note) .smart-italic { font-style: italic; }
  :is(#note, #guest-note) :is(.smart-strike, .smart-task-done) { text-decoration: line-through; opacity: .7; }
  :is(#note, #guest-note) .smart-quote { border-inline-start: .2rem solid var(--border, GrayText); padding-inline-start: .6rem; color: var(--muted, GrayText); }
  :is(#note, #guest-note) :is(.smart-code, .smart-fence, .smart-inline-code) { background: color-mix(in srgb, currentColor 7%, transparent); }
  :is(#note, #guest-note) :is(.smart-code, .smart-fence) { padding-inline: .5rem; }
  :is(#note, #guest-note) .smart-fence { color: var(--muted, GrayText); }
  :is(#note, #guest-note) .smart-inline-code { border-radius: .2em; }
  :is(#note, #guest-note) .smart-rule-text { color: transparent; display: inline-block; width: 100%; background: linear-gradient(var(--border, GrayText), var(--border, GrayText)) center / 100% 1px no-repeat; }
  :is(#note, #guest-note) button.smart-task { display: inline-flex; vertical-align: middle; justify-content: center; align-items: center; width: 1.2em; height: 1.2em; min-height: 0; padding: 0; margin-inline-end: .15em; border: 1px solid currentColor; border-radius: .2em; color: var(--accent, LinkText); background: transparent; font: inherit; line-height: 1; cursor: pointer; }
  :is(#note, #guest-note) button.smart-task:disabled { opacity: .7; cursor: default; }
  :is(#note, #guest-note) button.smart-code-copy { min-height: 0; padding: .1rem .4rem; margin-inline-start: .6em; border: 1px solid var(--border, GrayText); border-radius: .25rem; font: .78rem/1.5 system-ui, sans-serif; background: var(--surface, Canvas); color: var(--fg, CanvasText); cursor: pointer; }
  :is(#note, #guest-note) .note-link { color: var(--accent, LinkText); text-decoration: underline; cursor: pointer; }
  #guest-note .guest-view-option input { width: auto; margin: 0; }
  :is(#note, #guest-note) .smart-search-match { background: #eab30855; outline: 1px solid #ca8a0466; }
  :is(#note, #guest-note) .cm-panels { background: var(--panel, Canvas); color: var(--fg, CanvasText); border-color: var(--border, GrayText); }
  .smart-search-panel { padding: .45rem .6rem; font: .85rem/1.4 system-ui, sans-serif; }
  .smart-search-row { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .45rem; margin-block: .2rem; }
  .smart-search-row[hidden] { display: none !important; }
  .smart-search-row input[type="text"] { flex: 1 1 9rem; min-width: 6rem; width: auto; margin: 0; padding: .35rem .5rem; border: 1px solid var(--border, GrayText); border-radius: .25rem; background: var(--surface, Canvas); color: inherit; }
  .smart-search-row button { min-height: 1.9rem; padding: .25rem .5rem; font: inherit; }
  .smart-search-option { display: inline-flex; align-items: center; gap: .25rem; margin: 0; cursor: pointer; }
  .smart-search-option input { width: auto; margin: 0; accent-color: var(--accent, LinkText); }
  .smart-search-count { flex: 0 1 auto; font-size: .8rem; color: var(--muted, GrayText); }
  @media (pointer: coarse) {
    :is(#note, #guest-note) button.smart-task { width: 1.45em; height: 1.45em; }
    .smart-search-row button { min-height: 2.4rem; }
    .smart-search-row input[type="text"] { font-size: 1rem; }
  }
`;
