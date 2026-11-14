import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeOpeningSecret, openCreatedSpace, secretLink } from "../frontend/share-secret.js";

test("a creation handoff is consumed once and is tied to the space address and creation time", (t) => {
  const saved = new Map<string, string>();
  const pad = { path: "/p/private-space", createdAt: new Date().toISOString(), encrypted: true };
  const browser = {
    origin: "https://dropnote.example",
    pathname: pad.path,
    assign: t.mock.fn<(url: string) => void>(),
  };
  Object.defineProperty(globalThis, "location", { configurable: true, value: browser });
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => saved.get(key),
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  } });
  t.after(() => {
    Reflect.deleteProperty(globalThis, "location");
    if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  const passphrase = "eine sichere Übungs-Passphrase + % & #";
  openCreatedSpace(pad, passphrase);
  assert.equal(browser.assign.mock.calls[0]?.arguments[0], pad.path);
  assert.deepEqual(consumeOpeningSecret(pad), { passphrase, created: true });
  assert.equal(saved.size, 0);
  assert.equal(consumeOpeningSecret(pad), null);

  openCreatedSpace(pad, passphrase);
  assert.equal(consumeOpeningSecret({ ...pad, createdAt: new Date(0).toISOString() }), null);
  assert.equal(consumeOpeningSecret(pad), null);

  const link = new URL(secretLink(pad.path, passphrase));
  assert.equal(link.pathname, pad.path);
  assert.equal(link.search, "");
  const fragment = new URLSearchParams(link.hash.slice(1)).get("passphrase");
  assert.equal(fragment, passphrase);
  browser.assign.mock.resetCalls();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("storage unavailable"); } });
  openCreatedSpace(pad, passphrase);
  assert.equal(browser.assign.mock.calls[0]?.arguments[0], pad.path);
  assert.equal(consumeOpeningSecret(pad), null);
});
