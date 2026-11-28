import type { ReferenceTarget } from "./internal-references.ts";
import { SPACE_ID_PATTERN } from "./space-identity.ts";

/** Only use an authorized, identity-matched same-origin address; no secrets or inherited query. */
export function referenceAddress(target: { spaceId: string; path: string }, ref: ReferenceTarget, origin: string): string {
  if (!SPACE_ID_PATTERN.test(ref.spaceId) || target.spaceId !== ref.spaceId || typeof target.path !== "string" || !target.path.startsWith("/")) throw new Error("Reference data is unavailable");
  const url = new URL(target.path, origin);
  if (url.origin !== origin || url.username || url.password) throw new Error("Reference data is unavailable");
  url.search = ""; url.hash = "";
  url.searchParams.set("spaceId", ref.spaceId);
  if (ref.kind === "space" && ref.view !== "note" && ref.view !== "files") throw new Error("Reference data is unavailable");
  url.searchParams.set("view", ref.kind === "file" ? "files" : ref.view);
  if (ref.kind === "file") {
    if (!/^[0-9a-f]{32}$/.test(ref.blobId)) throw new Error("Reference data is unavailable");
    url.searchParams.set("file", ref.blobId);
  }
  return url.pathname + url.search;
}

export interface SpaceHistoryEntry { trail: string; index: number }
export interface SpaceHistoryState extends SpaceHistoryEntry { max: number; left: { path: string } | null }
function validEntry(value: unknown): value is SpaceHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as SpaceHistoryEntry;
  return typeof entry.trail === "string" && entry.trail.length > 0 && entry.trail.length <= 100 && Number.isSafeInteger(entry.index) && entry.index >= 0;
}
function validState(value: unknown): value is SpaceHistoryState {
  if (!validEntry(value)) return false;
  const state = value as SpaceHistoryState;
  return Number.isSafeInteger(state.max) && state.max >= state.index && (state.left === null || typeof state.left?.path === "string");
}
/** Track contiguous DropNote documents; never infer a previous Space from history.length. */
export function spaceHistoryState(previous: unknown, old: unknown, type: string | undefined, referrerPath: string | undefined, freshTrail: string): SpaceHistoryState {
  if (validState(previous)) {
    if (validEntry(old) && previous.trail === old.trail && old.index <= previous.max && (type === "reload" || type === "back_forward")) {
      return { trail: old.trail, index: old.index, max: previous.max, left: null };
    }
    if (type === "navigate" && referrerPath && previous.left?.path === referrerPath && previous.index < Number.MAX_SAFE_INTEGER) {
      const index = previous.index + 1;
      return { trail: previous.trail, index, max: index, left: null };
    }
  }
  return { trail: freshTrail, index: 0, max: 0, left: null };
}
