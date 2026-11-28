import { THEME_CSS, THEME_RESTORE_SCRIPT } from "./theme.ts";
import { renderEditorHelp, EDITOR_HELP_CSS } from "./editor-help-page.ts";
import { SMART_NOTE_CSS } from "./smart-note-styles.ts";
import type { Language } from "./locale.ts";
import { SHARE_FRAGMENT_SCRIPT, STRIP_SHARE_FRAGMENT_SCRIPT } from "./share-fragment.ts";
import { translate } from "./translations.ts";

export function renderGuestPage(language: Language, opening?: { encryption?: { salt: string; check: string }; oneTime: boolean }): string {
  const t = (text: string) => translate(language, text);
  const data = opening ? JSON.stringify(opening).replace(/</g, "\\u003c") : "null";
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dropnote · ${t("Guest access")}</title>
<script>${opening && !opening.encryption ? SHARE_FRAGMENT_SCRIPT : STRIP_SHARE_FRAGMENT_SCRIPT}</script>
<script>${THEME_RESTORE_SCRIPT}</script>
<style>
${THEME_CSS}
${SMART_NOTE_CSS}
${EDITOR_HELP_CSS}
[hidden] { display: none !important; }
:root { font: 16px/1.5 system-ui, sans-serif; }
body { margin: 0; background: var(--bg); color: var(--fg); }
main { width: calc(100% - 2rem); margin: clamp(1rem, 6vh, 4rem) auto; }
header { border-bottom: 1px solid GrayText; padding-bottom: .75rem; }
header span { margin-inline-start: .6rem; color: GrayText; }
h1 { font-size: 1.45rem; overflow-wrap: anywhere; }
h2 { font-size: 1.15rem; }
label { display: block; margin-bottom: .3rem; }
input, button { font: inherit; padding: .5rem .7rem; }
input { box-sizing: border-box; width: min(22rem, 100%); margin-bottom: .5rem; }
button { cursor: pointer; }
.guest-view-options { display: inline-block; margin: .25rem .5rem; }
.guest-view-options summary { cursor: pointer; }
.guest-view-option input { width: auto; margin: 0; }
@font-face { font-family: "IBM Plex Mono"; src: url("/fonts/IBMPlexMono-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
.guest-editor-card { border: 1px solid var(--border); border-radius: .375rem; overflow: hidden; background: var(--surface); }
#guest-note { box-sizing: border-box; width: 100%; }
#guest-note .cm-editor { height: clamp(13rem, 60dvh, 40rem); }
#guest-note .cm-scroller { font: .96rem/1.5 "IBM Plex Mono", ui-monospace, monospace; }
.guest-editor-tools { display: flex; flex-wrap: nowrap; gap: .3rem; align-items: center; margin-block: .4rem; position: relative; }
.guest-editor-tools button, .guest-editor-tools summary { font-size: .875rem; border: 1px solid var(--border); border-radius: .25rem; padding: .4rem .6rem; background: var(--surface); color: var(--fg); }
.guest-editor-tools > details { margin: 0 0 0 auto; }
.guest-editor-tools > details > div { position: absolute; z-index: 3; inset-inline-end: 0; max-width: calc(100vw - 2rem); max-height: 60dvh; overflow: auto; padding: .6rem; background: var(--surface); border: 1px solid var(--border); border-radius: .25rem; box-sizing: border-box; }
.guest-editor-tools > details > div button { display: block; width: 100%; margin-top: .3rem; text-align: start; }
.guest-editor-tools label { display: flex; align-items: center; gap: .3rem; }
@media (max-width: 24rem) { .guest-editor-tools { gap: .15rem; } .guest-editor-tools button, .guest-editor-tools summary { font-size: .75rem; padding: .3rem; } }
ul { padding: 0; }
li { list-style: none; padding: .65rem 0; border-bottom: 1px solid GrayText; display: flex; align-items: center; justify-content: space-between; gap: .75rem; overflow-wrap: anywhere; }
li span { min-width: 0; }
</style>
</head>
<body>
<main>
<header><strong>Dropnote</strong><span>${t("Guest access")}</span></header>
${opening ? `<section id="guest-locked">
  <h1>${t(opening.encryption ? "Open encrypted space" : "Open shared space")}</h1>
  ${opening.oneTime ? `<p>${t("This link can be opened once. Keep this tab open to download files.")}</p>` : ""}
  <p>${t(opening.encryption ? "This link shares an encrypted snapshot. Later changes are not included." : "This link shows the current state when opened.")}</p>
  <form id="guest-form" autocomplete="off">
    <label for="guest-passphrase">${t(opening.encryption ? "Passphrase" : "Guest password")}</label>
    <input type="password" id="guest-passphrase" required autocomplete="off">
    <button id="guest-open" type="submit">${t("Open space")}</button>
  </form>
</section>
<section id="guest-content" hidden>
  <h1 id="guest-name"></h1>
  <p id="guest-expiry"></p>
  <p>${t(opening.encryption ? "This link shares an encrypted snapshot. Later changes are not included." : "This link shows the current state when opened.")}</p>
  <p id="guest-captured" hidden></p>
  <h2 id="guest-note-title">${t("Note")}</h2>
  <div class="guest-editor-tools">
    <button id="guest-find" type="button">${t("Find")}</button>
    <button id="guest-copy" type="button">${t("Copy text")}</button>
    <details class="guest-view-options" id="guest-more">
      <summary>${t("More actions")}</summary>
      <div>
        <button id="guest-help" type="button" aria-haspopup="dialog">${t("Editor help")}</button>
        <h3>${t("View options")}</h3>
        <label class="guest-view-option"><input id="guest-markdown" type="checkbox" checked> ${t("Markdown formatting")}</label>
        <label class="guest-view-option"><input id="guest-links" type="checkbox" checked> ${t("Clickable links")}</label>
        <label class="guest-view-option"><input id="guest-checklists" type="checkbox" checked> ${t("Interactive checklists")}</label>
        <label class="guest-view-option"><input id="guest-references" type="checkbox" checked> ${t("Internal references")}</label>
        <label class="guest-view-option"><input id="guest-status-option" type="checkbox" checked> ${t("Show status bar")}</label>
        <button id="guest-copy-readable" type="button">${t("Copy readable text")}</button>
        <button id="guest-download-readable" type="button">${t("Download readable text")}</button>
      </div>
    </details>
  </div>
  <div class="guest-editor-card">
    <div id="guest-note" role="region" aria-labelledby="guest-note-title"></div>
    <div id="guest-status-bar" class="editor-status-bar"><span class="editor-metrics"><span data-metric="words"></span><span data-metric="chars"></span></span></div>
  </div>
  <p id="guest-note-toast" class="editor-toast" role="status"></p>
  <h2>${t("Files")}</h2>
  <ul id="guest-files"></ul>
  <p id="guest-no-files" hidden>${t("No files yet.")}</p>
</section>
<p id="guest-message" role="status"></p>
${renderEditorHelp(language, true)}` : `<h1>${t("This guest link is unavailable.")}</h1>`}
</main>
<script type="application/json" id="guest-opening">${data}</script>
<script type="module" src="/g/client.js"></script>
</body>
</html>`;
}
