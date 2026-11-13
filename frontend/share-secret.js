const handoffKey = "dropnote:new-space";

export function secretLink(url, passphrase) {
  const link = new URL(url, location.origin);
  link.hash = new URLSearchParams({ passphrase }).toString();
  return link.href;
}

export function openCreatedSpace(pad, passphrase) {
  if (passphrase) {
    try {
      sessionStorage.setItem(handoffKey, JSON.stringify({
        path: pad.path, createdAt: pad.createdAt, passphrase, time: Date.now(),
      }));
    } catch {
      location.assign(secretLink(pad.path, passphrase));
      return;
    }
  }
  location.assign(pad.path);
}

export function consumeOpeningSecret(metadata, fragment) {
  let handoff;
  try {
    const raw = sessionStorage.getItem(handoffKey);
    sessionStorage.removeItem(handoffKey);
    if (raw) handoff = JSON.parse(raw);
  } catch {
    // Links can still unlock the space without browser storage.
  }
  if (!metadata.encrypted) return null;
  if (fragment) return { passphrase: fragment, created: false };
  if (handoff?.path === location.pathname && handoff.createdAt === metadata.createdAt &&
      typeof handoff.passphrase === "string" && Date.now() - handoff.time < 60_000) {
    return { passphrase: handoff.passphrase, created: true };
  }
  return null;
}
