import type { Language } from "./locale.ts";
import { SHARE_FRAGMENT_SCRIPT } from "./share-fragment.ts";
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
<script>${SHARE_FRAGMENT_SCRIPT}</script>
<style>
:root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
body { margin: 0; background: Canvas; color: CanvasText; }
main { width: min(46rem, calc(100% - 2rem)); margin: clamp(1rem, 6vh, 4rem) auto; }
header { border-bottom: 1px solid GrayText; padding-bottom: .75rem; }
header span { margin-inline-start: .6rem; color: GrayText; }
h1 { font-size: 1.45rem; overflow-wrap: anywhere; }
h2 { font-size: 1.15rem; }
label { display: block; margin-bottom: .3rem; }
input, button, textarea { font: inherit; padding: .5rem .7rem; }
input { box-sizing: border-box; width: min(22rem, 100%); margin-bottom: .5rem; }
button { cursor: pointer; }
textarea { box-sizing: border-box; width: 100%; min-height: 9rem; resize: vertical; font-family: ui-monospace, monospace; }
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
  <h2><label for="guest-note">${t("Note")}</label></h2>
  <textarea id="guest-note" readonly></textarea>
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
