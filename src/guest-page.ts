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
<style>
${SMART_NOTE_CSS}
[hidden] { display: none !important; }
:root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
body { margin: 0; background: Canvas; color: CanvasText; }
main { width: min(46rem, calc(100% - 2rem)); margin: clamp(1rem, 6vh, 4rem) auto; }
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
#guest-note { box-sizing: border-box; width: 100%; border: 1px solid GrayText; margin: 0 0 .5rem; }
#guest-note .cm-editor { height: min(45vh, 30rem); min-height: 9rem; }
#guest-note .cm-scroller { font: .95rem/1.65 ui-monospace, monospace; }
#guest-note .cm-content { padding: .5rem .7rem; }
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
  <div id="guest-note" role="region" aria-labelledby="guest-note-title"></div>
  <button id="guest-find" type="button">${t("Find")}</button>
  <details class="guest-view-options">
    <summary>${t("View options")}</summary>
    <label class="guest-view-option"><input id="guest-markdown" type="checkbox" checked> ${t("Markdown formatting")}</label>
    <label class="guest-view-option"><input id="guest-links" type="checkbox" checked> ${t("Clickable links")}</label>
    <label class="guest-view-option"><input id="guest-checklists" type="checkbox" checked> ${t("Interactive checklists")}</label>
  </details>
  <button id="guest-copy" type="button">${t("Copy text")}</button>
  <h2>${t("Files")}</h2>
  <ul id="guest-files"></ul>
  <p id="guest-no-files" hidden>${t("No files yet.")}</p>
</section>
<p id="guest-message" role="status"></p>` : `<h1>${t("This guest link is unavailable.")}</h1>`}
</main>
<script type="application/json" id="guest-opening">${data}</script>
<script type="module" src="/g/client.js"></script>
</body>
</html>`;
}
