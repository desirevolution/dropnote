import { spaceLabel } from "../src/space-label.ts";
import { addMyPad, listMyPads, removeMyPad, STORAGE_KEY } from "./my-pads.js";
import { language, t } from "./i18n.js";

const startKey = "dropnote:start-pad";
const $ = (id) => document.getElementById(id);

export function dateLabel(value) {
  const date = new Date(value);
  return Number.isFinite(+date) ? new Intl.DateTimeFormat(language() || undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : "";
}

let storageUser = null;

export function setStorageUser(username) {
  storageUser = username ?? null;
}

export function storageKey(key) {
  return storageUser ? `dropnote:user:${storageUser}:${key}` : key;
}

export function localValue(key) {
  try {
    return localStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
}

export function saveLocal(key, value) {
  try {
    if (value === null) localStorage.removeItem(storageKey(key));
    else localStorage.setItem(storageKey(key), value);
    return true;
  } catch {
    return false;
  }
}

function localStore() {
  try {
    const storage = localStorage;
    return {
      getItem: (key) => storage.getItem(storageKey(key)),
      setItem: (key, value) => storage.setItem(storageKey(key), value),
    };
  } catch {
    return null;
  }
}

function startPad() {
  try {
    return JSON.parse(localValue(startKey));
  } catch {
    return null;
  }
}

function localPadAddress(address) {
  try {
    const url = new URL(address, location.origin);
    if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol)) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function samePad(left, right) {
  return left?.slug === right.slug && left?.createdAt === right.createdAt;
}

export function notice(message) {
  $("pad-notice").textContent = message;
  $("pad-notice").hidden = !message;
}

/** Resolve only the home route. Shared addresses and the fixed pad bypass this choice. */
export async function openPersonalStartPad() {
  if (location.pathname !== "/") return false;
  const selected = startPad();
  if (typeof selected?.slug !== "string" || selected.slug === "default") return false;
  try {
    const response = await fetch(`/api/pads/${encodeURIComponent(selected.slug)}`, { cache: "no-store" });
    if (response.status === 404) return forgetMissingStart();
    if (!response.ok) return false;
    const pad = await response.json();
    if (!samePad(selected, pad)) return forgetMissingStart();
    const path = localPadAddress(pad.path);
    if (path && path !== "/") {
      location.replace(path);
      return true;
    }
  } catch {
    // The fixed Pad is still useful if the lookup fails temporarily.
  }
  return false;
}

function forgetMissingStart() {
  saveLocal(startKey, null);
  notice(t("Your start page is unavailable. Default is open instead."));
  return false;
}

function rememberPad(pad) {
  const storage = localStore();
  const path = localPadAddress(pad.path);
  if (!storage || !path) return false;
  const entry = {
    slug: pad.slug, displayName: pad.displayName, url: new URL(path, location.origin).href, encrypted: pad.encrypted,
    createdAt: pad.createdAt, expiresAt: pad.expiresAt ?? null,
    sharedBy: pad.sharedBy, canEdit: pad.canEdit,
  };
  addMyPad(storage, entry);
  return listMyPads(storage).some((saved) => samePad(saved, entry));
}

export function isStartPad(pad) {
  const selected = startPad();
  return selected ? samePad(selected, pad) : pad.slug === "default";
}

export function startBadge(pad) {
  const badge = document.createElement("span");
  badge.className = "start-marker";
  badge.hidden = !isStartPad(pad);
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⌂";
  badge.append(icon, t("Start page"));
  return badge;
}

export function sharingLabel(pad) {
  return pad.sharedBy
    ? `${t("Shared by {name}", { name: pad.sharedBy })} · ${t(pad.canEdit ? "Can edit" : "Can read")}`
    : "";
}

export function forgetPad(pad) {
  const storage = localStore();
  if (storage) removeMyPad(storage, new URL(pad.path, location.origin).href, pad.createdAt);
  if (samePad(startPad(), pad)) saveLocal(startKey, null);
}

export function initPadNavigation(metadata) {
  const list = $("my-pads-list");
  const clear = $("clear-my-pads");
  const remember = $("remember-pad");
  const setStart = $("set-start-pad");
  const home = $("home-link");
  const sharedMarker = $("shared-start-marker");
  let checking = false;
  let bookmarkRevision = 0;

  function bookmarks(storage) {
    return storage ? listMyPads(storage).filter((pad) => pad.slug !== "default" && !pad.createdHere &&
      typeof pad.sharedBy === "string" && localPadAddress(pad.url)) : [];
  }

  function render() {
    const storage = localStore();
    if (list) {
      const pads = bookmarks(storage);
      pads.sort((a, b) => Number(isStartPad(b)) - Number(isStartPad(a)));
      list.replaceChildren(...pads.map((pad) => {
        const row = document.createElement("li");
        const info = document.createElement("div");
        info.className = "my-pad-info space-row-info";
        const link = document.createElement("a");
        link.href = localPadAddress(pad.url);
        link.textContent = spaceLabel(pad.slug, pad.displayName);
        const detail = document.createElement("span");
        detail.className = "my-pad-detail";
        detail.textContent = [
          sharingLabel(pad),
          pad.encrypted ? t("Encrypted") : "",
        ].filter(Boolean).join(" · ");
        info.append(link, startBadge(pad), detail);
        row.append(info);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = t("Remove bookmark");
        remove.setAttribute("aria-label", t("Remove bookmark for {name}", { name: spaceLabel(pad.slug, pad.displayName) }));
        remove.addEventListener("click", () => {
          bookmarkRevision += 1;
          removeMyPad(storage, pad.url, pad.createdAt);
          render();
        });
        const menu = document.createElement("details");
        menu.className = "pad-menu space-row-menu";
        menu.dataset.actionMenu = "";
        const trigger = document.createElement("summary");
        trigger.textContent = "⋯";
        trigger.setAttribute("aria-label", t("Actions for {name}", { name: link.textContent }));
        const actions = document.createElement("div");
        actions.className = "menu-items";
        actions.append(remove);
        menu.append(trigger, actions);
        row.append(menu);
        return row;
      }));
      $("my-pads-empty").hidden = pads.length > 0;
      clear.hidden = pads.length === 0;
      if (remember) {
        remember.disabled = pads.some((pad) => samePad(pad, metadata));
        remember.textContent = t(remember.disabled ? "Bookmarked" : "Bookmark space");
      }
    }
    const currentIsStart = isStartPad(metadata);
    $("start-pad-marker").hidden = !currentIsStart;
    sharedMarker.hidden = Boolean(startPad());
    if (currentIsStart) home.setAttribute("aria-current", "page");
    else home.removeAttribute("aria-current");
    setStart.disabled = metadata.slug === "default" && currentIsStart;
    setStart.textContent = t(currentIsStart && metadata.slug !== "default" ? "Reset start page" : "Set as start page");
  }

  home.addEventListener("click", (event) => {
    if (home.getAttribute("aria-current") === "page" &&
        !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) event.preventDefault();
  });

  remember?.addEventListener("click", () => {
    notice(t(rememberPad(metadata) ? "Bookmark added." : "This browser could not save the bookmark."));
    render();
  });
  setStart.addEventListener("click", () => {
    const value = metadata.slug === "default" || isStartPad(metadata) ? null : JSON.stringify({
      slug: metadata.slug, createdAt: metadata.createdAt, url: new URL(metadata.path, location.origin).href,
    });
    if (saveLocal(startKey, value)) {
      const name = value ? spaceLabel(metadata.slug, metadata.displayName) : spaceLabel("default");
      notice(t("{name} is now your start page in this browser.", { name }));
    } else {
      notice(t("This browser could not save the start page."));
    }
    render();
  });
  clear?.addEventListener("click", () => {
    bookmarkRevision += 1;
    saveLocal(STORAGE_KEY, null);
    render();
  });
  document.querySelector('[data-open-dialog="owned-spaces-dialog"]')?.addEventListener("click", async () => {
    const storage = localStore();
    if (!list || !storage || checking) return;
    checking = true;
    const revision = bookmarkRevision;
    try {
      for (const saved of listMyPads(storage)) {
        if (revision !== bookmarkRevision || !$("owned-spaces-dialog").open) break;
        if (saved.slug === "default" || !localPadAddress(saved.url)) continue;
        const response = await fetch(`/api/pads/${encodeURIComponent(saved.slug)}`, {
          cache: "no-store", signal: AbortSignal.timeout(5_000),
        });
        if (revision !== bookmarkRevision || response.status === 429) break;
        const pad = response.ok ? await response.json() : null;
        if (revision !== bookmarkRevision) break;
        if (pad?.sharedBy && samePad(saved, pad)) {
          rememberPad(pad);
        } else if (response.status === 404 || pad) {
          removeMyPad(storage, saved.url, saved.createdAt);
        }
        render();
      }
    } catch {
      // Keep bookmarks if the server cannot confirm their metadata.
    } finally {
      checking = false;
    }
  });
  window.addEventListener("storage", () => {
    bookmarkRevision += 1;
    render();
  });
  render();

  return { refresh: render };
}
