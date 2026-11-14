import { isUtf8 } from "node:buffer";
import { raw, type Request, type Response } from "express";
import type { Doc } from "yjs";
import type { Config } from "./config.ts";
import { messageOf } from "./errors.ts";
import { canEdit, padRole } from "./pad-access.ts";
import { jsonNoPad, requestUsername } from "./pad-request.ts";
import { validateCustomSlug } from "./slug.ts";
import { parseDisplayName } from "./space-label.ts";
import { DEFAULT_PAD_SLUG, type PadRecord, type PadStore } from "./store.ts";

export interface ScriptIngest {
  update: (pad: PadRecord, apply: (doc: Doc) => void) => void;
  onPadDeleted?: (slug: string) => Promise<void> | void;
  notifyAccount?: (username: string) => void;
}

export function scriptIngest(store: PadStore, config: Config, options: ScriptIngest) {
  function allowed(res: Response, pad: PadRecord): boolean {
    const username = requestUsername(res);
    if (!padRole(pad, username)) {
      jsonNoPad(res);
      return false;
    }
    if (!canEdit(pad, username) || pad.kind !== "plain" || pad.pin) {
      res.status(403).json({ error: "Script writes require editing access to a space without encryption or a write PIN" });
      return false;
    }
    return true;
  }

  async function target(req: Request, res: Response): Promise<PadRecord | undefined> {
    const slug = req.params.slug as string;
    const username = requestUsername(res);
    if (username === null) {
      res.status(403).json({ error: "Script writes require a user from the trusted proxy" });
      return;
    }
    if (slug === DEFAULT_PAD_SLUG) return store.ensureDefaultPad(username);
    try {
      validateCustomSlug(slug);
    } catch (error) {
      res.status(400).json({ error: messageOf(error) });
      return;
    }

    const existing = store.getLivePad(slug);
    if (existing) return allowed(res, existing) ? existing : undefined;
    if (config.instancePin !== null) {
      res.status(403).json({ error: "Automatic creation is unavailable when an instance PIN is set" });
      return;
    }

    const name = req.get("X-Space-Name");
    const displayName = name === undefined ? null : parseDisplayName(headerText(name));
    if (displayName === undefined) {
      res.status(400).json({ error: "Enter a display name on one line with up to 80 characters." });
      return;
    }

    const old = store.getPad(slug);
    if (old?.expiresAt && Date.parse(old.expiresAt) <= Date.now()) {
      await store.removePad(slug, options.onPadDeleted);
    }
    if (res.destroyed) return;
    const current = store.getLivePad(slug);
    if (current) return allowed(res, current) ? current : undefined;
    if (store.getPad(slug)) {
      res.status(409).json({ error: "This space is being removed. Try again shortly." });
      return;
    }
    store.createPad(slug, { displayName, ttlSeconds: config.defaultTtlSeconds, owner: username });
    options.notifyAccount?.(username);
    return store.getPad(slug);
  }

  const readText = raw({ type: () => true, limit: "1mb", inflate: false });
  async function append(req: Request, res: Response): Promise<void> {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || !body.length || !isUtf8(body)) {
      res.status(400).json({ error: "Send non-empty UTF-8 text" });
      return;
    }
    const value = body.toString("utf8");
    const pad = await target(req, res);
    if (!pad || res.destroyed) return;
    if (store.getLivePad(pad.slug) !== pad) return jsonNoPad(res);
    if (!allowed(res, pad)) return;
    options.update(pad, (doc) => {
      const note = doc.getText("note");
      const lineBreak = note.length && !note.toString().endsWith("\n") ? "\n" : "";
      note.insert(note.length, lineBreak + "---\n" + value);
    });
    res.status(204).end();
  }

  return { target, allowed, readText, append, update: options.update };
}

/** Node exposes HTTP header bytes as Latin-1. Decode UTF-8 when supplied by curl. */
export function headerText(value: string): string {
  const bytes = Buffer.from(value, "latin1");
  return isUtf8(bytes) ? bytes.toString("utf8") : value;
}
