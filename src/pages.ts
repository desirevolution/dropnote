/**
 * Pad pages: every Pad — the Default Pad at the site root and additional
 * Pads under the configured path prefix — renders the same editor (a Note
 * editor) and its file list. Pad creation and local navigation live in
 * dialogs, wired by /js/editor.bundle.js (see frontend/).
 */
import { DEFAULT_PAD_SLUG, type PadRecord } from "./store.ts";
import { PAD_CSS } from "./pad-styles.ts";
import { spaceLabel } from "./space-label.ts";

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
    var refresh = function () { button.title = chosen() === "dark" ? "Light mode" : "Dark mode"; };
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
  canEdit?: boolean;
  releaseTag?: string;
}

const PROJECT_URL = "https://github.com/desirevolution/dropnote";
const RELEASE_TAG_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export function renderPadPage(pad: PadRecord, options: PadPageOptions): string {
  const username = options.username && escapeHtml(options.username);
  const canManage = options.canManage ?? true;
  const fixed = pad.slug === DEFAULT_PAD_SLUG;
  const heading = spaceLabel(pad.slug);
  const tag = options.releaseTag;
  const releaseTag = tag && tag.length <= 129 && RELEASE_TAG_PATTERN.test(tag) ? tag : null;
  const sharedSpace = `<div class="shared-space-entry">
      <a href="/default">${spaceLabel(DEFAULT_PAD_SLUG)}</a>
      <span id="shared-start-marker" class="my-pad-detail" hidden>Start page</span>
    </div>`;
  // The Note content lives in the Pad's Live-Sync document (ADR-0002) and is
  // replayed into the editor by the client; the page itself starts empty.
  const metadata = JSON.stringify({
    slug: pad.slug,
    createdAt: pad.createdAt,
    expiresAt: pad.expiresAt,
    encrypted: pad.kind === "encrypted",
    path: pad.slug === DEFAULT_PAD_SLUG ? "/default" : `${options.padPath}/${pad.slug}`,
    encryption: pad.encryption && { salt: pad.encryption.salt, check: pad.encryption.check },
    pinProtected: pad.pin !== undefined,
    ...(username ? { username: options.username, canEdit: options.canEdit } : {}),
  }).replace(/</g, "\\u003c");
  const isEncrypted = pad.kind === "encrypted";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)} – Dropnote</title>
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
      <a class="brand" href="${PROJECT_URL}" title="Dropnote on GitHub" aria-label="Dropnote on GitHub"><span class="brand-mark">${icon("pad")}</span>Dropnote</a>
      <span class="release-version">${releaseTag ?? "dev"}</span>
    </div>
    <nav class="actions" aria-label="Spaces">
      <a href="/" id="home-link" class="home-link">${icon("home")} Home</a>
      ${username ? '<button type="button" data-open-dialog="owned-spaces-dialog" aria-haspopup="dialog">My spaces</button>' : ""}
      <button type="button" data-open-dialog="my-pads-dialog" aria-haspopup="dialog">Saved spaces</button>
      <button type="button" id="theme-toggle" class="icon-button" aria-label="Toggle dark or light mode">${icon("moon", "theme-moon")}${icon("sun", "theme-sun")}</button>
      ${username ? `<span class="account-name" title="${username}">${username}</span>` : ""}
      <button type="button" class="primary" data-open-dialog="new-pad-dialog" aria-haspopup="dialog">${icon("plus")} New space</button>
    </nav>
  </div>
</header>
<main>
  <header class="pad-head${fixed ? " compact" : ""}">
    <div>
      <h1${fixed ? ' class="visually-hidden"' : ""}>${escapeHtml(heading)}</h1>
      <div class="pad-meta">
        <span class="pad-mode${isEncrypted ? " encrypted" : ""}">${icon(isEncrypted ? "lock" : "unlock")} ${isEncrypted ? "End-to-end encrypted" : "Unencrypted"}</span>
        ${pad.pin ? '<span>Editing protected by PIN</span>' : ""}
        ${pad.slug !== DEFAULT_PAD_SLUG ? '<time id="expires-at" hidden></time>' : ""}
        <span id="start-pad-marker" hidden>Start page</span>
      </div>
    </div>
    <div class="actions">
      <span id="copy-status" role="status"></span>
      <button type="button" id="copy-link">${icon("link")} Copy link</button>
      <button type="button" id="show-pad-qr" data-open-dialog="pad-qr-dialog" aria-haspopup="dialog">QR code</button>
      <details class="pad-menu" id="pad-menu">
        <summary aria-label="Space actions" title="Space actions">⋯</summary>
        <div class="menu-items">
          <button type="button" id="download-note" disabled>Download text (.txt)</button>
          <button type="button" id="remember-pad">Save space</button>
          <button type="button" id="set-start-pad">Set as start page</button>
          ${isEncrypted ? '<button type="button" id="lock-pad" hidden>Lock space</button>' : ""}
          ${username && canManage && !fixed ? '<button type="button" data-open-dialog="space-access-dialog" aria-haspopup="dialog">Manage access</button>' : ""}
          ${pad.slug === DEFAULT_PAD_SLUG
            ? '<button type="button" id="clear-note" class="danger" disabled>Clear note</button><button type="button" id="clear-files" class="danger" disabled>Remove all files</button>'
            : canManage ? '<button type="button" id="change-ttl" data-open-dialog="ttl-dialog" disabled>Change expiry</button><button type="button" id="delete-pad" class="danger" disabled>Delete space</button>' : ""}
        </div>
      </details>
    </div>
  </header>

  ${isEncrypted ? `<section class="access-panel" id="key-prompt" aria-labelledby="key-title" hidden>
    <h2 id="key-title">Unlock this space</h2>
    <form id="key-form" class="passphrase-form">
      <label>Passphrase
        <input name="passphrase" id="key-input" type="password" required autocomplete="off">
      </label>
      <label class="checkbox-field"><input type="checkbox" id="remember-unlock"> Keep unlocked in this browser</label>
      <button type="submit" class="primary">Unlock</button>
    </form>
    <p id="key-error" class="form-error" role="alert" hidden></p>
  </section>` : ""}

  <dialog id="pin-dialog" aria-labelledby="pin-title">
    <section id="pin-unlock"${pad.pin ? "" : " hidden"}>
      <header class="dialog-head">
        <h2 id="pin-title">Unlock editing</h2>
        <button type="button" class="icon-button quiet" data-close-dialog aria-label="Close">${icon("close")}</button>
      </header>
      <form id="pin-form" class="pin-form">
        <input name="pin" id="pin-input" aria-label="Editing PIN" type="password" inputmode="numeric" autocomplete="off" required maxlength="10" placeholder="Editing PIN">
        <button type="submit" class="primary">Unlock editing</button>
      </form>
      <p id="pin-error" class="form-error" role="alert" hidden></p>
    </section>
  </dialog>

  <p id="pad-notice" class="pad-notice" role="status" hidden></p>
  <p id="sync-error" role="alert" hidden></p>
  <div class="workspace" id="workspace"${isEncrypted ? " hidden" : ""}>
    <div class="workspace-toolbar" id="workspace-toolbar" hidden>
      <div class="workspace-tabs" role="tablist" aria-label="Space content">
        <button type="button" id="note-tab" role="tab" aria-controls="note-panel" aria-selected="true">Note</button>
        <button type="button" id="files-tab" role="tab" aria-controls="files-card" aria-selected="false" tabindex="-1">Files (0)</button>
      </div>
      <div class="actions workspace-actions">
        <div class="actions" id="note-tools">
          <span id="note-copy-status" role="status"></span>
          <button type="button" class="quiet" id="copy-note" disabled>${icon("copy")} Copy text</button>
          <button type="button" id="choose-files" disabled>${icon("plus")} Add files</button>
        </div>
        <div id="files-tools">
          <button type="button" id="copy-files-link" class="quiet">${icon("link")} Copy files link</button>
        </div>
      </div>
      <input type="file" id="attachment-input" multiple disabled hidden aria-label="Files to attach">
    </div>
    <div class="transfer-notice" id="upload-notice" hidden>
      <span role="status" id="upload-notice-text"></span>
      <button type="button" class="quiet" id="show-upload">Show files</button>
    </div>
    <p id="attachment-error" class="attachment-error" role="alert" hidden></p>
    <ul id="attachment-uploads" aria-label="Transfers"></ul>
    <section class="card note-card" id="note-panel" role="tabpanel" aria-labelledby="note-tab" hidden>
      <h2 id="note-title" class="visually-hidden">Note</h2>
      <div id="note"></div>
    </section>
    <section class="card files-pane" id="files-card" role="tabpanel" aria-labelledby="files-tab" tabindex="0" hidden>
      <div class="files-body">
        <button type="button" class="drop-zone" id="file-drop" hidden disabled>
          ${icon("plus")}
          <span class="drop-zone-title">Choose files</span>
          <span class="drop-zone-hint">Or drop files here</span>
        </button>
        <ul id="attachments" aria-label="Uploaded files"></ul>
        <p class="files-empty" id="files-empty" hidden>No files yet.</p>
      </div>
    </section>
    <footer class="workspace-footer">
      <span id="sync-status" role="status">Connecting…</span>
      <button type="button" id="unlock-editing" class="quiet" data-open-dialog="pin-dialog" hidden>Unlock editing</button>
    </footer>
  </div>

  <dialog id="replace-note-dialog" aria-labelledby="replace-note-title" aria-describedby="replace-note-description">
    <h2 id="replace-note-title">Replace note?</h2>
    <p id="replace-note-description">Replace the entire note with the text from your clipboard?</p>
    <form method="dialog" class="dialog-actions">
      <button type="submit" value="cancel" autofocus>Cancel</button>
      <button type="submit" value="replace" class="primary">Replace note</button>
    </form>
  </dialog>

  <dialog id="new-pad-dialog" aria-labelledby="new-pad-title">
    <header class="dialog-head">
      <h2 id="new-pad-title">New space</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="Close">${icon("close")}</button>
    </header>
    <form id="new-pad-form">
      <label class="new-pad-encrypted">
        <input type="checkbox" id="new-pad-encrypted">
        <span>End-to-end encryption <small>A passphrase is required to open this space.</small></span>
      </label>
      <label id="create-passphrase-field" hidden>Passphrase
        <input id="create-passphrase" type="password" autocomplete="new-password" minlength="12" maxlength="1024">
        <small>Use at least 12 characters. There is no reset.</small>
      </label>
      <label>Expires after
        <select name="ttl" id="new-pad-ttl">${ttlOptions(options.defaultTtlSeconds, options.maxTtlSeconds)}</select>
      </label>
      <details class="advanced-options">
      <summary>More options</summary>
      <label>Name (optional)
        <input name="slug" id="new-pad-slug" placeholder="Generated automatically" autocomplete="off" spellcheck="false">
      </label>
      <label>Editing PIN (optional)
        <input name="padPin" id="new-pad-pad-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="4–10 digits">
      </label>
      </details>
      ${options.instancePinRequired ? `
      <label>Instance PIN
        <input name="pin" id="new-pad-pin" type="password" required autocomplete="off">
      </label>` : ""}
      <p id="new-pad-error" class="form-error" role="alert" hidden></p>
      <button type="submit" class="primary">Create space</button>
    </form>
  </dialog>

  <dialog id="my-pads-dialog" aria-labelledby="my-pads-title">
    <header class="dialog-head">
      <h2 id="my-pads-title">Saved spaces</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="Close">${icon("close")}</button>
    </header>
    <p>${username ? "Bookmarks saved in this browser." : "Spaces created in this browser and bookmarks. Encrypted spaces require their passphrase."}</p>
    ${username ? "" : sharedSpace}
    <ul id="my-pads-list"></ul>
    <p class="files-empty" id="my-pads-empty" hidden>No saved spaces yet.</p>
    <div class="dialog-actions">
      <button type="button" id="clear-my-pads" hidden>Clear bookmarks</button>
    </div>
  </dialog>

  ${username ? `<dialog id="owned-spaces-dialog" aria-labelledby="owned-spaces-title">
    <header class="dialog-head">
      <h2 id="owned-spaces-title">My spaces</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="Close">${icon("close")}</button>
    </header>
    ${sharedSpace}
    <ul class="account-list" id="owned-spaces-list"></ul>
    <p class="files-empty" id="owned-spaces-status" role="status"></p>
  </dialog>` : ""}

  ${username && canManage && !fixed ? `<dialog id="space-access-dialog" aria-labelledby="space-access-title">
    <header class="dialog-head">
      <h2 id="space-access-title">Manage access</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="Close">${icon("close")}</button>
    </header>
    <section id="space-access-requests" aria-labelledby="space-access-requests-title" hidden>
      <h3 id="space-access-requests-title">Access requests</h3>
      <ul class="account-list" id="space-access-request-list"></ul>
    </section>
    <form id="space-access-form" class="passphrase-form">
      <label>Username <input name="username" required maxlength="128" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <label>Permission
        <select name="role"><option value="read">Can read</option><option value="edit">Can edit</option></select>
      </label>
      <button type="submit" class="primary">Save access</button>
    </form>
    <p id="space-access-status" role="status"></p>
    <ul class="account-list" id="space-access-list"></ul>
  </dialog>` : ""}

  <dialog id="one-time-link" aria-labelledby="one-time-title">
    <h2 id="one-time-title">Space created</h2>
    ${username ? '<p>This space is private. Use Manage access in the space menu to share it.</p>' : ""}
    <p id="created-encrypted-hint" hidden>Share the passphrase separately. The passphrase cannot be recovered.</p>
    <input id="one-time-link-url" aria-label="Share link" readonly>
    <p id="one-time-status" role="status"></p>
    <div class="dialog-actions">
      <button type="button" id="one-time-copy">Copy link</button>
      <button type="button" id="one-time-password" hidden>Copy passphrase</button>
      <button type="button" class="primary" id="one-time-open">Open space</button>
    </div>
  </dialog>

  <dialog id="ttl-dialog" aria-labelledby="ttl-title">
    <header class="dialog-head">
      <h2 id="ttl-title">Change expiry</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="Close">${icon("close")}</button>
    </header>
    <form id="ttl-form">
      <label>Expires after
        <select id="manage-ttl">${ttlOptions(options.defaultTtlSeconds, options.maxTtlSeconds)}</select>
      </label>
      <p id="ttl-error" class="form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button type="submit" class="primary">Save expiry</button></div>
    </form>
  </dialog>

  <dialog id="pad-qr-dialog" aria-labelledby="pad-qr-title">
    <header class="dialog-head">
      <h2 id="pad-qr-title">Open on another device</h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="Close">${icon("close")}</button>
    </header>
    <canvas id="pad-qr" aria-label="QR code for this space" role="img" hidden></canvas>
    <p id="pad-qr-error" class="form-error" role="alert" hidden>Could not generate the QR code. Use the link below.</p>
    <a id="pad-qr-link"></a>
    ${isEncrypted ? '<p>Enter the passphrase on the other device.</p>' : ""}
  </dialog>

  <dialog id="image-dialog" aria-labelledby="image-title">
    <header class="dialog-head">
      <h2 id="image-title"></h2>
      <button type="button" class="icon-button quiet" data-close-dialog aria-label="Close">${icon("close")}</button>
    </header>
    <img id="full-image" alt="">
    <div class="dialog-actions">
      <p id="image-copy-status" role="status"></p>
      <button type="button" id="copy-image" disabled>Copy image</button>
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
function ttlOptions(defaultTtlSeconds: number | null, maxTtlSeconds: number | null): string {
  const presets: Array<{ value: number; label: string }> = [
    { value: 3_600, label: "1 hour" },
    { value: 86_400, label: "24 hours" },
    { value: 604_800, label: "7 days" },
    { value: 2_592_000, label: "30 days" },
  ];
  const defaultLabel = defaultTtlSeconds === null ? "Instance default (no expiry)" : `Instance default (${describeDuration(defaultTtlSeconds)})`;
  const options = [`<option value="default" selected>${defaultLabel}</option>`];
  for (const preset of presets) {
    if (maxTtlSeconds !== null && preset.value > maxTtlSeconds) continue;
    options.push(`<option value="${preset.value}">${preset.label}</option>`);
  }
  if (maxTtlSeconds === null) {
    options.push(`<option value="never">never</option>`);
  }
  return options.join("");
}

function describeDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return plural(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return plural(seconds / 3_600, "hour");
  if (seconds % 60 === 0) return plural(seconds / 60, "minute");
  return plural(seconds, "second");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** The page shown for a Slug that has no Pad (expired or never existed). */
export function renderNotFoundPage(access?: { action: string; requested: boolean; spacePath: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Space not found – Dropnote</title>
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
<h1>${access ? "Space unavailable" : "Space not found"}</h1>
${access
  ? access.requested
    ? `<p role="status">If the space is available, your request has been sent to its owner.</p>
<p><a href="${escapeHtml(access.spacePath)}">Try opening the space again</a></p>`
    : `<p>This space may be unavailable or require permission to open.</p>
<form method="post" action="${escapeHtml(access.action)}"><button type="submit">Request access</button></form>`
  : "<p>There’s no space at this address. It may have expired, been deleted, or never existed.</p>"}
<p><a href="/default">Open Default</a> or create a new space from there.</p>
</main>
</body>
</html>
`;
}

const ICON_PATHS = {
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
