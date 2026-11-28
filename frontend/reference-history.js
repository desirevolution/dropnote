import { spaceHistoryState } from "../src/reference-navigation.ts";

/** Cross-document, tab-local history. The browser remains the source of truth.
 * Only adjacent DropNote navigations are tracked; no note content or keys are stored. */
export function initReferenceHistory({ beforeNavigate, key = "dropnote:reference-history" }) {
  const back = document.getElementById("space-back"), forward = document.getElementById("space-forward");
  const read = () => { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } };
  const write = value => { try { sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const current = () => ({ path: location.pathname });
  const previous = read();
  const navigationType = performance.getEntriesByType("navigation")[0]?.type;
  let referrerPath;
  try { const url = new URL(document.referrer); if (url.origin === location.origin) referrerPath = url.pathname; } catch { /* external or direct */ }
  const { trail, index, max: initialMax } = spaceHistoryState(previous, history.state?.dropnoteHistory, navigationType, referrerPath,
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const entry = { trail, index };
  let max = initialMax;
  const save = left => write({ ...entry, max, left });
  function render() {
    const ok = save(null);
    back.disabled = !ok || entry.index <= 0;
    forward.disabled = !ok || entry.index >= max;
  }
  try { history.replaceState({ ...history.state, dropnoteHistory: entry }, ""); } catch { return; }
  render();
  window.addEventListener("pagehide", () => save(current()));
  window.addEventListener("pageshow", event => {
    if (event.persisted) { const saved = read(); if (saved?.trail === entry.trail && Number.isSafeInteger(saved.max)) max = Math.max(entry.index, saved.max); render(); }
  });
  back.addEventListener("click", () => { if (!back.disabled && beforeNavigate()) history.back(); });
  forward.addEventListener("click", () => { if (!forward.disabled && beforeNavigate()) history.forward(); });
}
