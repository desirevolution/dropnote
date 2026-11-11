/**
 * The local "My Pads" list: a pure browser-storage module (frontend/
 * my-pads.js) that keeps Share Links — never Keys — in localStorage, with
 * per-entry removal and clear-all. Tested headless against an in-memory
 * storage stand-in with the same surface as window.localStorage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMyPad, clearMyPads, listMyPads, removeMyPad, STORAGE_KEY } from "../frontend/my-pads.js";

interface Entry {
  slug: string;
  url: string;
  encrypted: boolean;
  createdAt: string;
  expiresAt: string | null;
  createdHere?: boolean;
}

function memoryStorage(initial: Record<string, string> = {}): Storage & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    dump: () => Object.fromEntries(map),
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage & { dump(): Record<string, string> };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    slug: "amber-otter",
    url: "http://localhost:3000/p/amber-otter",
    encrypted: false,
    createdAt: "2026-11-11T10:00:00.000Z",
    expiresAt: null,
    ...overrides,
  };
}

test("a created Pad lands in the list as a Share Link without a Key", () => {
  const storage = memoryStorage();
  addMyPad(storage, entry());
  const pads = listMyPads(storage);
  assert.equal(pads.length, 1);
  assert.equal(pads[0]?.url, "http://localhost:3000/p/amber-otter", "the Share Link is stored");
  const serialized = storage.dump()[STORAGE_KEY] ?? "";
  assert.doesNotMatch(serialized, /"key"/, "no Key is ever persisted — not even an empty one");
  assert.ok(Array.isArray(JSON.parse(serialized)), "the list is a JSON array, ready for later ticket extensions");
});

test("adding the same Pad twice keeps one entry", () => {
  const storage = memoryStorage();
  addMyPad(storage, entry());
  addMyPad(storage, entry({ createdAt: "2026-11-11T11:00:00.000Z" }));
  assert.equal(listMyPads(storage).length, 1, "entries are deduplicated by Share Link");
});

test("a single entry can be removed", () => {
  const storage = memoryStorage();
  addMyPad(storage, entry({ slug: "one", url: "http://x/p/one" }));
  addMyPad(storage, entry({ slug: "two", url: "http://x/p/two" }));
  removeMyPad(storage, "http://x/p/one");
  const pads = listMyPads(storage);
  assert.equal(pads.length, 1);
  assert.equal(pads[0]?.slug, "two");
});

test("clearing bookmarks empties a bookmarks-only list", () => {
  const storage = memoryStorage();
  addMyPad(storage, entry({ slug: "one", url: "http://x/p/one" }));
  addMyPad(storage, entry({ slug: "two", url: "http://x/p/two" }));
  clearMyPads(storage);
  assert.deepEqual(listMyPads(storage), []);
});

test("clearing bookmarks keeps spaces created here and the start page", () => {
  const storage = memoryStorage();
  const created = entry({ createdHere: true });
  const start = entry({ slug: "start", url: "http://x/p/start" });
  const bookmark = entry({ slug: "bookmark", url: "http://x/p/bookmark" });
  for (const pad of [created, start, bookmark]) addMyPad(storage, pad);
  assert.deepEqual(clearMyPads(storage, start.url), [created, start]);
});

test("refreshing a space preserves its origin only for the same generation", () => {
  const storage = memoryStorage();
  addMyPad(storage, entry({ createdHere: true }));
  addMyPad(storage, entry({ expiresAt: "2026-11-12T10:00:00.000Z" }));
  assert.equal(listMyPads(storage)[0]?.createdHere, true);
  const replacement = entry({ createdAt: "2026-11-13T10:00:00.000Z" });
  addMyPad(storage, replacement);
  assert.deepEqual(removeMyPad(storage, replacement.url, entry().createdAt), [replacement]);
});

test("a corrupt or foreign list is tolerated as an empty one", () => {
  for (const raw of ["not json", '"a string"', '{"not":"an array"}', '[{"nonsense":true}]', ""]) {
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    assert.deepEqual(listMyPads(storage), [], `"${raw}" reads as an empty list`);
    // And the list still works afterwards.
    addMyPad(storage, entry());
    assert.equal(listMyPads(storage).length, 1);
  }
});
