/**
 * Pad pages: every Pad — the Default Pad at the site root and additional
 * Pads under the configured path prefix — renders the same editor (a Note
 * editor) and its file list. Pad creation and local navigation live in
 * dialogs, wired by /js/editor.bundle.js (see frontend/).
 */
import { DEFAULT_PAD_SLUG, isDefaultPad, publicPadSlug, type PadRecord } from "./store.ts";
import { PAD_CSS } from "./pad-styles.ts";
import type { Language } from "./locale.ts";
import { SHARE_FRAGMENT_SCRIPT } from "./share-fragment.ts";
import { translate } from "./translations.ts";
import { MAX_SLUG_LENGTH } from "./slug.ts";
import { MAX_DISPLAY_NAME_LENGTH, spaceLabel } from "./space-label.ts";

/**
 * Theme (Story 36): two palettes as CSS custom properties. By default the
 * page follows the operating system via prefers-color-scheme; a saved
 * choice (localStorage "theme") pins one palette via the data-theme
 * attribute. Deliberately dumb — two tiny inline scripts, no framework.
 */
const LIGHT_PROPERTIES =
  "--bg: #f7f8fa; --surface: #ffffff; --fg: #20262e; --muted: #545f6c; --border: #d9dee5; --border-strong: #8b98a8; --panel: #eef1f5; --accent: #305a83; --accent-hover: #244769; --on-accent: #fff; --accent-soft: #e7eff8; --error: #a12636; --positive: #226449;";
const DARK_PROPERTIES =
  "--bg: #181c21; --surface: #20252b; --fg: #e8edf2; --muted: #b3bfcc; --border: #39434e; --border-strong: #788899; --panel: #2a323b; --accent: #9ec2e4; --accent-hover: #bedbf5; --on-accent: #152536; --accent-soft: #283d52; --error: #ff9ca7; --positive: #94d5b2;";

const THEME_CSS = `
  :root { color-scheme: light; ${LIGHT_PROPERTIES} }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme]) { color-scheme: dark; ${DARK_PROPERTIES} }
  }
  :root[data-theme="dark"] { color-scheme: dark; ${DARK_PROPERTIES} }
  :root[data-theme="light"] { color-scheme: light; ${LIGHT_PROPERTIES} }
`;

/** Applies a saved theme choice before first paint, so there is no flash. */
const THEME_RESTORE_SCRIPT = `
  try {
    var theme = localStorage.getItem("theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (e) { /* storage unavailable — follow prefers-color-scheme */ }`;

/** The toggle button's behavior: swap the palette and persist the choice. */
const THEME_TOGGLE_SCRIPT = `
  (function () {
    var button = document.getElementById("theme-toggle");
    if (!button) return;
    var root = document.documentElement;
    var chosen = function () {
      var theme = root.getAttribute("data-theme");
      if (theme === "dark" || theme === "light") return theme;
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };
    var refresh = function () { button.title = chosen() === "dark" ? button.dataset.lightLabel : button.dataset.darkLabel; };
    button.addEventListener("click", function () {
      var next = chosen() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) { /* keep the choice for this visit only */ }
      refresh();
    });
    refresh();
  })();`;

export interface PadPageOptions {
  /** The TTL default offered in the creation form (from DEFAULT_TTL). */
  defaultTtlSeconds: number | null;
  /** The longest TTL this instance allows (from MAX_TTL); null means unbounded. */
  maxTtlSeconds: number | null;
  /** Whether creating a Pad requires the instance PIN (INSTANCE_PIN is set). */
  instancePinRequired: boolean;
  padPath: string;
  username?: string | null;
  canManage?: boolean;
  guestEnabled?: boolean;
  canEdit?: boolean;
  releaseTag?: string;
  language?: Language;
}

const PROJECT_URL = "https://github.com/desirevolution/dropnote";
const RELEASE_TAG_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export function renderPadPage(pad: PadRecord, options: PadPageOptions): string {
  const language = options.language ?? "en";
  const t = (message: string, values?: Record<string, string | number>) => escapeHtml(translate(language, message, values));
  const username = options.username && escapeHtml(options.username);
  const canManage = options.canManage ?? true;
  const fixed = isDefaultPad(pad.slug);
  const heading = spaceLabel(publicPadSlug(pad.slug), pad.displayName);
  const tag = options.releaseTag;
  const releaseTag = tag && tag.length <= 129 && RELEASE_TAG_PATTERN.test(tag) ? tag : null;
  const defaultSpace = `<div class="shared-space-entry">
      <a href="/default">${spaceLabel(DEFAULT_PAD_SLUG)}</a>
      <span id="shared-start-marker" class="start-marker" hidden>${icon("home")} ${t("Start page")}</span>
    </div>`;
  // The Note content lives in the Pad's Live-Sync document (ADR-0002) and is
  // replayed into the editor by the client; the page itself starts empty.
  const metadata = JSON.stringify({
    slug: publicPadSlug(pad.slug),
    displayName: pad.displayName ?? null,
    createdAt: pad.createdAt,
    expiresAt: pad.expiresAt,
    encrypted: pad.kind === "encrypted",
    guestEnabled: Boolean(options.guestEnabled),
    path: fixed ? "/default" : `${options.padPath}/${pad.slug}`,
    encryption: pad.encryption && { salt: pad.encryption.salt, check: pad.encryption.check },
    pinProtected: pad.pin !== undefined,
    ...(username ? { username: options.username, canEdit: options.canEdit } : {}),
    ...(username && !canManage && !fixed ? {
      sharedBy: pad.owner,
      unreadGrantId: pad.grants?.find((grant) => grant.username === options.username)?.unreadId,
    } : {}),
  }).replace(/</g, "\\u003c");
  const isEncrypted = pad.kind === "encrypted";
  const canShareWithGuests = options.guestEnabled && canManage && !fixed;
  const canManageAccess = Boolean(username && canManage && !fixed);
  const qrButton = `<button type="button" id="show-pad-qr" data-open-dialog="pad-qr-dialog" aria-haspopup="dialog">${t(canShareWithGuests || canManageAccess ? "Open on another device" : "QR code")}</button>`;
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)} – Dropnote</title>
<script>${SHARE_FRAGMENT_SCRIPT}</script>
<script>${THEME_RESTORE_SCRIPT}</script>
<style>
${THEME_CSS}
${PAD_CSS}
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand-group">
      <a class="brand" href="${PROJECT_URL}" title="${t("Dropnote on GitHub")}" aria-label="${t("Dropnote on GitHub")}"><span class="brand-mark">${icon("pad")}</span>Dropnote</a>
    </div>
    <nav class="actions" aria-label="${t("Spaces")}">
      <a href="/" id="home-link" class="home-link" aria-label="${t("Home")}">${icon("home")} ${t("Home")}</a>
      <button type="button" data-open-dialog="owned-spaces-dialog" aria-haspopup="dialog">${t("My spaces")}${username ? ` <span id="access-request-badge" class="request-count" role="img" hidden></span> <span id="shared-space-badge" class="request-count" role="img" hidden></span>` : ""}</button>
      <details class="pad-menu" id="appearance-menu" data-action-menu>
        <summary aria-label="${t("Appearance and version")}" title="${t("Appearance and version")}">${icon("view")}</summary>
        <div class="menu-items">
          <button type="button" id="theme-toggle" data-light-label="${t("Light mode")}" data-dark-label="${t("Dark mode")}" class="icon-button" aria-label="${t("Toggle dark or light mode")}">${icon("moon", "theme-moon")}${icon("sun", "theme-sun")}</button>
          <span class="release-version">${releaseTag ?? "dev"}</span>
        </div>
      </details>
      ${username ? `<span class="account-name" title="${username}">${username}</span>` : ""}
      <button type="button" class="primary" data-open-dialog="new-pad-dialog" aria-haspopup="dialog">${icon("plus")} ${t("New space")}</button>
    </nav>
  </div>
</header>
<main>
  <header class="pad-head${fixed ? " compact" : ""}">
    <div>
      <h1${fixed ? ' class="visually-hidden"' : ' id="space-heading"'}>${escapeHtml(heading)}</h1>
      <div class="pad-meta">
        <span class="pad-mode${isEncrypted ? " encrypted" : ""}">${icon(isEncrypted ? "lock" : "unlock")} ${t(isEncrypted ? "End-to-end encrypted" : "Unencrypted")}</span>
        ${pad.pin ? `<span>${t("Editing protected by PIN")}</span>` : ""}
        ${!fixed ? '<time id="expires-at" hidden></time>' : ""}
        ${username && !canManage && !fixed && pad.owner ? `<span>${t("Shared by {name}", { name: pad.owner })} · ${t(options.canEdit ? "Can edit" : "Can read")}</span>` : ""}
        <span id="start-pad-marker" class="start-marker" hidden>${icon("home")} ${t("Start page")}</span>
      </div>
    </div>
    <div class="pad-share-controls">
    <div class="actions">
      <button type="button" id="copy-link">${icon("link")} ${t("Copy link")}</button>
      ${canShareWithGuests || canManageAccess ? `<details class="pad-menu" data-action-menu>
        <summary>${t("Share")}</summary>
        <div class="menu-items">
          ${qrButton}
          ${canManageAccess ? `<button type="button" data-open-dialog="space-access-dialog" aria-haspopup="dialog">${t("Manage user access")}</button>` : ""}
          ${canShareWithGuests ? `<button type="button" data-open-dialog="guest-link-dialog" aria-haspopup="dialog">${t(pad.guestLink && Date.parse(pad.guestLink.expiresAt) > Date.now() && (!isEncrypted || pad.guestLink.snapshot) ? "Manage guest link" : "Create guest link")}</button>` : ""}
        </div>
      </details>` : qrButton}
      <details class="pad-menu" id="pad-menu" data-action-menu>
        <summary aria-label="${t("Space actions")}" title="${t("Space actions")}">⋯</summary>
        <div class="menu-items">
          ${username && !canManage && !fixed ? `<button type="button" id="remember-pad">${t("Bookmark space")}</button>` : ""}
          <button type="button" id="set-start-pad">${t("Set as start page")}</button>
          ${isEncrypted ? `<button type="button" id="lock-pad" hidden>${t("Lock space")}</button>` : ""}
          ${!fixed && canManage ? `<button type="button" id="rename-space" data-open-dialog="rename-dialog" aria-haspopup="dialog" disabled>${t("Rename space")}</button>` : ""}
          ${!fixed && canManage ? `<button type="button" id="change-ttl" data-open-dialog="ttl-dialog" disabled>${t("Change expiry")}</button>` : ""}
          ${fixed || canManage ? '<hr>' : ""}
          ${fixed
            ? `<button type="button" id="clear-note" class="danger" disabled>${t("Clear note")}</button><button type="button" id="clear-files" class="danger" disabled>${t("Remove all files")}</button>`
            : canManage ? `<button type="button" id="delete-pad" class="danger">${t("Delete space")}</button>` : ""}
        </div>
      </details>
    </div>
    <p id="copy-status" role="status"></p>
    </div>
  </header>

  ${isEncrypted ? `<section class="access-panel" id="key-prompt" aria-labelledby="key-title" hidden>
    <h2 id="key-title">${t("Unlock space")}</h2>
    <form id="key-form" class="passphrase-form">
      <label>${t("Passphrase")}
        <input name="passphrase" id="key-input" type="password" autocapitalize="none" spellcheck="false" required autocomplete="off">
      </label>
      <label class="checkbox-field"><input type="checkbox" id="remember-unlock"> ${t("Keep unlocked in this browser")}</label>
      <button type="submit" class="primary">${t("Unlock")}</button>
    </form>
    <p id="key-error" class="form-error" role="alert" hidden></p>
  </section>` : ""}

  <dialog id="pin-dialog" aria-labelledby="pin-title">
    <section id="pin-unlock"${pad.pin ? "" : " hidden"}>
      <header class="dialog-head">
        <h2 id="pin-title">${t("Unlock editing")}</h2>
        <button type="button" class="icon-button quiet" data-close-dialog aria-label="${t("Close")}">${icon("close")}</button>
      </header>
      <form id="pin-form" class="pin-form">
        <input name="pin" id="pin-input" aria-label="${t("Editing PIN")}" type="password" inputmode="numeric" autocomplete="off" required maxlength="10" placeholder="${t("Editing PIN")}">
        <button type="submit" class="primary">${t("Unlock editing")}</button>
      </form>
      <p id="pin-error" class="form-error" role="alert" hidden></p>
    </section>
  </dialog>

  <aside id="access-toast" class="access-toast" hidden>
    <span id="access-toast-text" role="status"></span>
    <a id="access-toast-action" href="/"></a>
    <button id="access-toast-close" type="button" class="icon-button quiet" aria-label="${t("Close")}">${icon("close")}</button>
  </aside>
  <p id="pad-notice" class="pad-notice" role="status" hidden></p>
  <p id="sync-error" role="alert" hidden></p>
  <div class="workspace" id="workspace"${isEncrypted ? " hidden" : ""}>
    <div class="workspace-toolbar" id="workspace-toolbar" hidden>
      <div class="workspace-tabs" role="tablist" aria-label="${t("Space content")}">
        <button type="button" id="note-tab" role="tab" aria-controls="note-panel" aria-selected="true">${t("Note")}</button>
        <button type="button" id="files-tab" role="tab" aria-controls="files-card" aria-selected="false" tabindex="-1">${t("Files (0)")}</button>
      </div>
      <div class="actions workspace-actions">
        <div class="actions" id="note-tools">
          <button type="button" class="quiet" id="paste-note" disabled>${icon("paste")} ${t("Append text")}</button>
          <button type="button" class="quiet" id="copy-note" disabled>${icon("copy")} ${t("Copy text")}</button>
          <button type="button" class="quiet" id="undo-note" aria-label="${t("Undo")}" title="${t("Undo")}" disabled>${icon("undo")}</button>
          <button type="button" class="quiet" id="redo-note" aria-label="${t("Redo")}" title="${t("Redo")}" disabled>${icon("redo")}</button>
          <button type="button" class="quiet" id="download-note" disabled>${t("Download text (.txt)")}</button>
          <details id="note-view" class="pad-menu">
            <summary>${icon("view")} ${t("View options")}</summary>
            <div class="menu-items">
              <label class="editor-font-option">
                ${t("Font size")}
                <select id="note-font-size">
                  <option value="small">${t("Small")}</option>
                  <option value="standard" selected>${t("Standard")}</option>
                  <option value="large">${t("Large")}</option>
                </select>
              </label>
              <label class="checkbox-field"><input type="checkbox" id="word-wrap" checked> ${t("Word wrap")}</label>
              <label class="checkbox-field"><input type="checkbox" id="line-numbers"> ${t("Line numbers")}</label>
            </div>
          </details>
        </div>
        <div id="files-tools" class="actions">
          <button type="button" id="choose-files" disabled>${icon("plus")} ${t("Add files")}</button>
          <button type="button" id="paste-image" disabled>${icon("paste")} ${t("Paste image")}</button>
          <button type="button" id="copy-files-link" class="quiet">${icon("link")} ${t("Copy files link")}</button>
        </div>
      </div>
      <input type="file" id="attachment-input" multiple disabled hidden aria-label="${t("Files to attach")}">
    </div>
    <div class="transfer-notice" id="upload-notice" hidden>
      <span role="status" id="upload-notice-text"></span>
      <button type="button" class="quiet" id="show-upload">${t("Show files")}</button>
    </div>
    <p id="image-paste-status" role="status" hidden></p>
    <p id="attachment-error" class="attachment-error" role="alert" hidden></p>
    <ul id="attachment-uploads" aria-label="${t("Transfers")}"></ul>
    <section class="card note-card" id="note-panel" role="tabpanel" aria-labelledby="note-tab" hidden>
      <p id="note-clipboard-status" role="status"></p>
      <h2 id="note-title" class="visually-hidden">${t("Note")}</h2>
      <div id="note"></div>
    </section>
    <section class="card files-pane" id="files-card" role="tabpanel" aria-labelledby="files-tab" tabindex="0" hidden>
      <div class="files-body">
        <button type="button" class="drop-zone" id="file-drop" hidden disabled>
          ${icon("plus")}
          <span class="drop-zone-title">${t("Choose files")}</span>
          <span class="drop-zone-hint">${t("Or drop files here")}</span>
        </button>
        <ul id="attachments" aria-label="${t("Uploaded files")}"></ul>
        <p class="files-empty" id="files-empty" hidden>${t("No files yet.")}</p>
      </div>
    </section>
    <footer class="workspace-footer">
      <span id="sync-status" role="status">${t("Connecting…")}</span>
      ${options.canEdit === false
        ? `<span>${t("Read-only access")}</span>`
        : `<label class="checkbox-field"><input type="checkbox" id="read-mode"> ${t("Read only")}</label>`}
      <button type="button" id="unlock-editing" class="quiet" data-open-dialog="pin-dialog" hidden>${t("Unlock editing")}</button>
    </footer>
  </div>

  <dialog id="replace-note-dialog" aria-labelledby="replace-note-title" aria-describedby="replace-note-description">
    <h2 id="replace-note-title">${t("Replace note?")}</h2>
    <p id="replace-note-description">${t("Replace the entire note with the text from your clipboard?")}</p>
    <form method="dialog" class="dialog-actions">
      <button type="submit" value="cancel" autofocus>${t("Cancel")}</button>
      <button type="submit" value="replace" class="primary">${t("Replace note")}</button>
    </form>
  </dialog>

  <dialog id="new-pad-dialog" aria-labelledby="new-pad-title">
    <header class="dialog-head">
      <h2 id="new-pad-title">${t("New space")}</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="${t("Close")}">${icon("close")}</button>
    </header>
    <form id="new-pad-form">
      <label>${t("Display name (optional)")}
        <input name="displayName" id="new-pad-name" maxlength="${MAX_DISPLAY_NAME_LENGTH}" autocomplete="off"
          aria-describedby="new-pad-name-hint" autofocus>
        <small id="new-pad-name-hint">${t("Leave empty to use the name from the address.")}</small>
      </label>
      <label class="new-pad-encrypted">
        <input type="checkbox" id="new-pad-encrypted">
        <span>${t("End-to-end encryption")} <small>${t("A passphrase is required to open this space.")}</small></span>
      </label>
      <div id="create-passphrase-field" hidden>
        <label>${t("Passphrase")}
          <input id="create-passphrase" type="password" autocapitalize="none" spellcheck="false" autocomplete="new-password" minlength="12" maxlength="1024">
          <small>${t("Use at least 12 characters. There is no reset.")}</small>
        </label>
        <div class="actions passphrase-actions">
          <button type="button" id="suggest-password">${t("Suggest password")}</button>
          <button type="button" id="suggest-passphrase">${t("Suggest six words")}</button>
          <button type="button" id="show-passphrase">${t("Show passphrase")}</button>
        </div>
        <p id="password-groups" title="${t("Password in groups. Spaces between groups are optional.")}" hidden></p>
      </div>
      <details class="advanced-options" id="new-pad-options">
        <summary>${t("More options")} <span id="new-pad-expiry-summary"></span></summary>
        <label>${t("URL address (optional)")}
          <input name="slug" id="new-pad-slug" placeholder="${t("Generated automatically")}" autocomplete="off"
            autocapitalize="none" spellcheck="false" maxlength="${MAX_SLUG_LENGTH}" aria-describedby="new-pad-url-preview">
          <small id="new-pad-url-preview"><code>${escapeHtml(options.padPath)}/<span id="new-pad-url-segment">…</span></code></small>
        </label>
        <label>${t("Expires after")}
          <select name="ttl" id="new-pad-ttl">${ttlOptions(options.defaultTtlSeconds, options.maxTtlSeconds, language)}</select>
        </label>
        <label>${t("Editing PIN (optional)")}
          <input name="padPin" id="new-pad-pad-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="4–10 digits">
        </label>
      </details>
      ${options.instancePinRequired ? `
      <label>${t("Instance PIN")}
        <input name="pin" id="new-pad-pin" type="password" required autocomplete="off">
      </label>` : ""}
      <p id="new-pad-error" class="form-error" role="alert" hidden></p>
      <button type="submit" class="primary">${t("Create space")}</button>
    </form>
  </dialog>

  <dialog id="owned-spaces-dialog" aria-labelledby="owned-spaces-title">
    <header class="dialog-head">
      <h2 id="owned-spaces-title">${t("My spaces")}</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="${t("Close")}">${icon("close")}</button>
    </header>
    ${defaultSpace}
    ${username ? `<h3 class="spaces-section-title">${t("Owned spaces")}</h3>` : ""}
    <label class="space-sort">${t("Sort by")}
      <select id="space-sort"><option value="created">${t("Creation date")}</option><option value="updated">${t("Last changed")}</option></select>
    </label>
    <ul class="account-list" id="owned-spaces-list"></ul>
    <p class="files-empty" id="owned-spaces-status" role="status"></p>
    ${username ? `<section class="shared-spaces" aria-labelledby="shared-spaces-title" hidden>
      <h3 id="shared-spaces-title">${t("Shared with me")}</h3>
      <ul class="account-list" id="shared-spaces-list"></ul>
      <p class="files-empty" id="shared-spaces-empty">${t("No spaces shared with you yet.")}</p>
    </section>` : ""}
    ${username ? `<section class="shared-spaces" aria-labelledby="my-pads-title">
      <h3 id="my-pads-title">${t("Bookmarks")}</h3>
    <p>${t("Bookmarks saved in this browser.")}</p>
    <ul id="my-pads-list"></ul>
    <p class="files-empty" id="my-pads-empty" hidden>${t("No bookmarks yet.")}</p>
    <div class="dialog-actions">
      <button type="button" id="clear-my-pads" hidden>${t("Clear bookmarks")}</button>
    </div>
    </section>` : ""}
  </dialog>

  ${username && canManage && !fixed ? `<dialog id="space-access-dialog" aria-labelledby="space-access-title">
    <header class="dialog-head">
      <h2 id="space-access-title">${t("Manage access")}</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="${t("Close")}">${icon("close")}</button>
    </header>
    <section id="space-access-requests" aria-labelledby="space-access-requests-title" hidden>
      <h3 id="space-access-requests-title">${t("Access requests")}</h3>
      <ul class="account-list" id="space-access-request-list"></ul>
    </section>
    <details><summary>${t("Add person")}</summary>
    <form id="space-access-form">
      <label>${t("Username")} <select name="username" required><option value="">${t("Choose an account")}</option></select></label>
      <label>${t("Permission")}
        <select name="role"><option value="read">${t("Can read")}</option><option value="edit">${t("Can edit")}</option></select>
      </label>
      <button type="submit" class="primary" disabled>${t("Grant access")}</button>
    </form>
    </details>
    <p id="space-access-status" role="status"></p>
    <ul class="account-list" id="space-access-list"></ul>
  </dialog>` : ""}

  ${!fixed && canManage ? `<dialog id="rename-dialog" aria-labelledby="rename-title">
    <header class="dialog-head">
      <h2 id="rename-title">${t("Rename space")}</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="${t("Close")}">${icon("close")}</button>
    </header>
    <form id="rename-form" class="passphrase-form">
      <label>${t("Display name")}
        <input id="display-name" autocomplete="off" maxlength="${MAX_DISPLAY_NAME_LENGTH}" value="${escapeHtml(pad.displayName ?? "")}"
          placeholder="${escapeHtml(spaceLabel(pad.slug))}" aria-describedby="rename-hint" autofocus>
      </label>
      <p id="rename-hint">${t("Leave empty to use the name from the address.")}</p>
      <p id="rename-error" class="form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button type="submit" class="primary">${t("Save name")}</button></div>
    </form>
  </dialog>` : ""}

  <dialog id="ttl-dialog" aria-labelledby="ttl-title">
    <header class="dialog-head">
      <h2 id="ttl-title">${t("Change expiry")}</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="${t("Close")}">${icon("close")}</button>
    </header>
    <form id="ttl-form">
      <label>${t("Expires after")}
        <select id="manage-ttl">${ttlOptions(options.defaultTtlSeconds, options.maxTtlSeconds, language)}</select>
      </label>
      <p id="ttl-error" class="form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button type="submit" class="primary">${t("Save expiry")}</button></div>
    </form>
  </dialog>

  ${canShareWithGuests ? `<dialog id="guest-link-dialog" aria-labelledby="guest-link-title">
    <header class="dialog-head">
      <h2 id="guest-link-title">${t("Manage guest link")}</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="${t("Close")}">${icon("close")}</button>
    </header>
    <p id="guest-link-description">${t(isEncrypted ? "Share an encrypted snapshot. Later changes are visible only after you replace the guest link." : "Guests see the current state each time they open this link. A guest password is required.")}</p>
    ${isEncrypted ? `<p>${t("Files deleted from the space also disappear from guest access.")}</p>` : ""}
    <p id="guest-link-state" role="status">${t("Loading…")}</p>
    <p id="guest-link-captured" hidden></p>
    <section id="guest-link-active" hidden>
      <div id="guest-link-share">
        <label for="guest-link-url">${t("Guest link")}</label>
        <input type="url" id="guest-link-url" readonly>
        <label class="checkbox-field"><input type="checkbox" id="guest-link-include"> ${t(isEncrypted ? "Include passphrase in link and QR code" : "Include password in link and QR code")}</label>
        <label id="guest-link-secret-label" hidden>${t(isEncrypted ? "Passphrase for this space" : "Password for this guest link")}
          <input type="password" id="guest-link-secret" autocomplete="off">
        </label>
        <p id="guest-link-warning" hidden>${t("Anyone with this link and its password can open the space while the link is valid.")}</p>
        <div class="dialog-actions">
          <button type="button" id="guest-link-copy">${t("Copy link")}</button>
          <button type="button" id="guest-link-show-qr" aria-controls="guest-link-qr" aria-expanded="false">${t("Show QR code")}</button>
          ${isEncrypted ? "" : `<button type="button" id="guest-link-copy-active-password" hidden>${t("Copy password")}</button>`}
        </div>
        <canvas id="guest-link-qr" aria-label="${t("QR code for this space")}" role="img" hidden></canvas>
      </div>
      <div class="dialog-actions guest-link-management">
        <button type="button" id="guest-link-replace">${t("Replace guest link")}</button>
        <button type="button" class="danger" id="guest-link-revoke">${t("Deactivate guest link")}</button>
      </div>
    </section>
    <section id="guest-link-confirm" aria-labelledby="guest-link-confirm-title" hidden>
      <h3 id="guest-link-confirm-title">${t("Deactivate guest link?")}</h3>
      <p>${t("The shared link will stop working. Guests will no longer be able to open the space or start downloads.")}</p>
      <div class="dialog-actions">
        <button type="button" id="guest-link-cancel-revoke">${t("Cancel")}</button>
        <button type="button" class="danger" id="guest-link-confirm-revoke">${t("Deactivate guest link")}</button>
      </div>
    </section>
    <form id="guest-link-form" hidden>
      <p id="guest-link-replace-hint" hidden>${t("Replacing this link also ends any active guest session.")}</p>
      <label for="guest-link-duration">${t("Guest link duration")}</label>
      <select id="guest-link-duration">
        <option value="1h">${t("1 hour")}</option>
        <option value="24h" selected>${t("24 hours")}</option>
        <option value="7d">${t("7 days")}</option>
      </select>
      <label class="checkbox-field"><input type="checkbox" id="guest-link-once"> ${t("One-time link")}</label>
      <p id="guest-link-ttl-hint" hidden>${t("This space expires in less than one hour. Extend its lifetime to create a guest link.")}</p>
      ${isEncrypted ? "" : `<label for="guest-link-password">${t("Password for the new guest link")}</label>
      <input type="text" id="guest-link-password" required minlength="12" maxlength="256" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button type="button" id="guest-link-suggest">${t("Suggest password")}</button>`}
      <p id="guest-link-sync-hint" hidden>${t("Wait for the space to finish syncing before creating a snapshot.")}</p>
      <p id="guest-link-lock-hint" hidden>${t("Unlock the encrypted space to create a guest link.")}</p>
      <div class="dialog-actions">
        <button type="button" id="guest-link-cancel-replace" hidden>${t("Cancel")}</button>
        <button type="submit" class="primary" id="guest-link-create" disabled>${t("Create guest link")}</button>
      </div>
    </form>
    <p id="guest-link-feedback" role="status"></p>
  </dialog>` : ""}

  <dialog id="pad-qr-dialog" aria-labelledby="pad-qr-title">
    <header class="dialog-head">
      <h2 id="pad-qr-title">${t("Open on another device")}</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="${t("Close")}">${icon("close")}</button>
    </header>
    <div id="share-secret-options" hidden>
      <label class="checkbox-field"><input type="checkbox" id="include-passphrase"> ${t("Include passphrase")}</label>
      <p id="share-secret-warning" hidden>${t("The link and QR code contain the passphrase. Share them only with people who should be able to unlock this space.")}</p>
    </div>
    ${(username || options.guestEnabled) ? `<p>${t("The other device may need to sign in to open this space.")}</p>` : ""}
    <canvas id="pad-qr" aria-label="${t("QR code for this space")}" role="img" hidden></canvas>
    <p id="pad-qr-error" class="form-error" role="alert" hidden>${t("Could not generate the QR code. You can still copy the link.")}</p>
    <a id="pad-qr-link"></a>
    ${isEncrypted ? `<p id="qr-passphrase-hint">${t("Enter the passphrase on the other device.")}</p>` : ""}
    <div class="dialog-actions qr-actions">
      <button type="button" id="qr-copy-link">${t("Copy link")}</button>
      <button type="button" id="qr-copy-image" disabled>${t("Copy QR image")}</button>
      <button type="button" id="qr-save-image" disabled>${t("Download PNG")}</button>
      <button type="button" id="qr-copy-passphrase" hidden>${t("Copy passphrase")}</button>
    </div>
    <p id="qr-status" role="status"></p>
  </dialog>

  <dialog id="image-dialog" aria-labelledby="image-title">
    <header class="dialog-head">
      <h2 id="image-title"></h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="${t("Close")}">${icon("close")}</button>
    </header>
    <img id="full-image" alt="">
    <div class="dialog-actions">
      <p id="image-copy-status" role="status"></p>
      <button type="button" id="copy-image" disabled>${t("Copy image")}</button>
    </div>
  </dialog>
</main>
<script type="application/json" id="pad-metadata">${metadata}</script>
<script type="module" src="/js/editor.bundle.js"></script>
<script>${THEME_TOGGLE_SCRIPT}</script>
</body>
</html>
`;
}

/**
 * TTL choices at creation: the instance default (DEFAULT_TTL) plus fixed
 * presets and "never". The instance default is preselected; MAX_TTL caps
 * the list — presets above the bound and "never" are not offered.
 */
function ttlOptions(defaultTtlSeconds: number | null, maxTtlSeconds: number | null, language: Language): string {
  const t = (message: string, values?: Record<string, string | number>) => escapeHtml(translate(language, message, values));
  const presets: Array<{ value: number; label: string }> = [
    { value: 3_600, label: "1 hour" },
    { value: 86_400, label: "24 hours" },
    { value: 604_800, label: "7 days" },
    { value: 2_592_000, label: "30 days" },
  ];
  const defaultLabel = defaultTtlSeconds === null ? t("Instance default (no expiry)") : t("Instance default ({duration})", { duration: describeDuration(defaultTtlSeconds, language) });
  const options = [`<option value="default" selected>${defaultLabel}</option>`];
  for (const preset of presets) {
    if (maxTtlSeconds !== null && preset.value > maxTtlSeconds) continue;
    options.push(`<option value="${preset.value}">${t(preset.label)}</option>`);
  }
  if (maxTtlSeconds === null) {
    options.push(`<option value="never">${t("Never")}</option>`);
  }
  return options.join("");
}

function describeDuration(seconds: number, language: Language): string {
  const format = (value: number, unit: string) =>
    new Intl.NumberFormat(language, { style: "unit", unit, unitDisplay: "long" }).format(value);
  if (seconds % 86_400 === 0) return format(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return format(seconds / 3_600, "hour");
  if (seconds % 60 === 0) return format(seconds / 60, "minute");
  return format(seconds, "second");
}

const ACCESS_WAIT_SCRIPT = `
  (() => {
    const link = document.getElementById("check-space-access");
    const destination = new URL(link.href);
    destination.hash = location.hash;
    link.href = destination.href;
    let running = false;
    let timer;
    let nextCheck = 0;
    let blockedUntil = 0;

    function schedule() {
      clearTimeout(timer);
      if (running || document.hidden || (connected && nextCheck > Date.now())) return;
      timer = setTimeout(checkAccess, Math.max(0, Math.max(blockedUntil, nextCheck) - Date.now()));
    }

    async function checkAccess() {
      if (running || document.hidden) return;
      running = true;
      let delay = 10_000;
      nextCheck = Infinity;
      try {
        const response = await fetch(link.dataset.checkPath, {
          method: "HEAD",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(8_000),
        });
        if (response.ok) {
          location.replace(link.href);
          return;
        }
        if (response.status === 429) {
          const seconds = Number(response.headers.get("retry-after"));
          if (Number.isFinite(seconds)) blockedUntil = Date.now() + Math.max(delay, seconds * 1_000);
        }
      } catch {
        // The manual link remains available while the network or session recovers.
      }
      if (nextCheck !== 0) nextCheck = Date.now() + delay;
      running = false;
      schedule();
    }

    let socket;
    let retry;
    let connected = false;
    function connect() {
      if (socket || document.hidden) return;
      const url = new URL("/events", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url, "dropnote");
      socket.onopen = () => { connected = true; wake(); };
      socket.onmessage = wake;
      socket.onclose = () => {
        socket = null;
        connected = false;
        wake();
        retry = setTimeout(connect, 5000);
      };
    }
    function wake() {
      nextCheck = 0;
      schedule();
    }
    document.addEventListener("visibilitychange", () => { connect(); wake(); });
    window.addEventListener("pagehide", () => {
      clearTimeout(retry);
      clearTimeout(timer);
      if (socket) { socket.onclose = null; socket.close(); socket = null; connected = false; }
    });
    window.addEventListener("pageshow", () => { connect(); wake(); });
    connect();
    schedule();
  })();
`;

/** The page shown for a Slug that has no Pad (expired or never existed). */
export function renderNotFoundPage(access?: { username: string; action: string; checkPath: string; requested: boolean; spacePath: string }, language: Language = "en"): string {
  const t = (message: string, values?: Record<string, string>) => escapeHtml(translate(language, message, values));
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t("Space not found")} – Dropnote</title>
<script>${THEME_RESTORE_SCRIPT}</script>
<style>
${THEME_CSS}
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 60rem; padding: 1rem; background: var(--bg); color: var(--fg); }
  a { color: var(--accent); }
  button { font: inherit; background: var(--accent); color: var(--on-accent); border: 0; border-radius: .25rem; padding: .5rem .85rem; cursor: pointer; }
</style>
</head>
<body>
<main>
<h1>${t(access ? "Space unavailable" : "Space not found")}</h1>
${access ? `<p>${t("Signed in as {name}.", { name: access.username })}</p>` : ""}
${access
  ? access.requested
    ? `<p role="status">${t("If the space is available, your request has been sent to its owner.")}</p>
<p>${t("This page checks for access and opens the space once it is available.")}</p>
<p><a id="check-space-access" href="${escapeHtml(access.spacePath)}" data-check-path="${escapeHtml(access.checkPath)}">${t("Try opening the space again")}</a></p>
<script>${ACCESS_WAIT_SCRIPT}</script>`
    : `<p>${t("This space may be unavailable or require permission to open.")}</p>
<form method="post" action="${escapeHtml(access.action)}"><button type="submit">${t("Request access")}</button></form>`
  : `<p>${t("There’s no space at this address. It may have expired, been deleted, or never existed.")}</p>`}
<p><a href="/default">${t("Open Default")}</a> ${t("or create a new space from there.")}</p>
</main>
</body>
</html>
`;
}

const ICON_PATHS = {
  undo: '<path d="M9 15 4 10l5-5M4 10h10a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 15 5-5-5-5m5 5H10a5 5 0 0 0 0 10h3"/>',
  paste: '<path d="M9 4H6a2 2 0 0 0-2 2v14h16V6a2 2 0 0 0-2-2h-3"/><rect x="9" y="2" width="6" height="5" rx="1"/><path d="M8 12h8m-8 4h8"/>',
  view: '<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
  pad: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h3"/>',
  note: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  link: '<path d="M10 13a4 4 0 0 0 6 .4l3-3a4 4 0 1 0-5.7-5.7l-1.7 1.7m2.4 4.6a4 4 0 0 0-6-.4l-3 3a4 4 0 1 0 5.7 5.7l1.7-1.7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/>',
  moon: '<path d="M20.9 13.3A9 9 0 0 1 10.7 3.1 9 9 0 1 0 20.9 13.3Z"/>',
};

function icon(name: keyof typeof ICON_PATHS, className = ""): string {
  return `<svg class="${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
