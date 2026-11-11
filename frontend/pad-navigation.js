import { spaceLabel } from "../src/space-label.ts";
import { addMyPad, clearMyPads, listMyPads, removeMyPad } from "./my-pads.js";

const startKey = "share-tool:start-pad";
const $ = (id) => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function dateLabel(value) {
  const date = new Date(value);
  return Number.isFinite(+date) ? dateFormat.format(date) : "";
}

let storageUser = null;

export function setStorageUser(username) {
  storageUser = username ?? null;
}

export function storageKey(key) {
  return storageUser ? `share-tool:user:${storageUser}:${key}` : key;
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
    if (response.status === 404) return forgetMissingStart(selected);
    if (!response.ok) return false;
    const pad = await response.json();
    if (!samePad(selected, pad)) return forgetMissingStart(selected);
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

function forgetMissingStart(selected) {
  saveLocal(startKey, null);
  const storage = localStore();
  if (!storageUser && storage && selected.url) removeMyPad(storage, selected.url, selected.createdAt);
  notice("Your start page is unavailable. The shared space is open instead.");
  return false;
}

export function rememberPad(pad, createdHere = false) {
  const storage = localStore();
  const path = localPadAddress(pad.path);
  if (!storage || !path) return false;
  const url = new URL(path, location.origin).href;
  const entry = {
    slug: pad.slug,
    url,
    encrypted: pad.encrypted === true,
    createdAt: pad.createdAt,
    expiresAt: pad.expiresAt ?? null,
    ...(createdHere ? { createdHere: true } : {}),
  };
  addMyPad(storage, entry);
  return listMyPads(storage).some((saved) => samePad(saved, entry));
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
  let checking = false;

  function render() {
    const storage = localStore();
    const selected = startPad();
    const pads = storage ? listMyPads(storage).filter((pad) => localPadAddress(pad.url)) : [];
    pads.sort((a, b) => Number(samePad(selected, b)) - Number(samePad(selected, a)));
    list.replaceChildren(...pads.map((pad) => {
      const row = document.createElement("li");
      const info = document.createElement("div");
      info.className = "my-pad-info";
      const link = document.createElement("a");
      link.href = localPadAddress(pad.url);
      link.textContent = spaceLabel(pad.slug);
      const detail = document.createElement("span");
      detail.className = "my-pad-detail";
      const expiry = pad.expiresAt && dateLabel(pad.expiresAt);
      detail.textContent = [
        samePad(selected, pad) ? "Start page" : "",
        pad.createdHere ? "Created here" : "",
        pad.encrypted ? "Encrypted" : "",
        expiry ? (Date.parse(pad.expiresAt) <= Date.now() ? `Expired ${expiry}` : `Expires ${expiry}`) : "",
      ].filter(Boolean).join(" · ");
      info.append(link, detail);
      row.append(info);
      if (!pad.createdHere) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove bookmark";
        remove.setAttribute("aria-label", `Remove bookmark for ${spaceLabel(pad.slug)}`);
        remove.addEventListener("click", () => {
          removeMyPad(storage, pad.url, pad.createdAt);
          if (samePad(startPad(), pad)) saveLocal(startKey, null);
          render();
        });
        row.append(remove);
      }
      return row;
    }));
    $("my-pads-empty").hidden = pads.length > 0;
    clear.hidden = !pads.some((pad) => !pad.createdHere && !samePad(selected, pad));
    remember.disabled = pads.some((pad) => samePad(pad, metadata));
    const personal = samePad(selected, metadata);
    $("start-pad-marker").hidden = !personal;
    setStart.disabled = personal || (metadata.slug === "default" && !selected);
    setStart.textContent = personal ? "Current start page" : "Set as start page";
  }

  remember.addEventListener("click", () => {
    notice(rememberPad(metadata) ? "Added to Saved spaces." : "This browser could not save the space.");
    render();
  });
  setStart.addEventListener("click", () => {
    const value = metadata.slug === "default" ? null : JSON.stringify({
      slug: metadata.slug, createdAt: metadata.createdAt, url: new URL(metadata.path, location.origin).href,
    });
    if (saveLocal(startKey, value)) {
      if (value) rememberPad(metadata);
      notice("Start page updated for this browser.");
    } else {
      notice("This browser could not save the start page.");
    }
    render();
  });
  clear.addEventListener("click", () => {
    const storage = localStore();
    if (storage) {
      const known = listMyPads(storage).find((pad) => samePad(startPad(), pad));
      clearMyPads(storage, known?.url);
    }
    render();
  });
  document.querySelector('[data-open-dialog="my-pads-dialog"]').addEventListener("click", checkCreatedSpaces);
  async function checkCreatedSpaces() {
    const storage = localStore();
    if (checking || !storage) return;
    checking = true;
    try {
      for (const saved of listMyPads(storage)) {
        if (!saved.createdHere || !localPadAddress(saved.url) || !$("my-pads-dialog").open) continue;
        const response = await fetch(`/api/pads/${encodeURIComponent(saved.slug)}`, {
          cache: "no-store", signal: AbortSignal.timeout(5_000),
        });
        if (response.status === 429) break;
        const actual = response.ok ? await response.json() : null;
        if (response.status === 404 || (actual && !samePad(saved, actual))) {
          removeMyPad(storage, saved.url, saved.createdAt);
          if (samePad(startPad(), saved)) saveLocal(startKey, null);
          render();
        }
      }
    } catch {
      // Keep entries when the server could not confirm their state.
    } finally {
      checking = false;
    }
  }
  window.addEventListener("storage", render);
  render();

  return {
    refresh() {
      const storage = localStore();
      if (storage && listMyPads(storage).some((pad) => samePad(pad, metadata))) rememberPad(metadata);
      render();
    },
  };
}
