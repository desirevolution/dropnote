/**
 * One lookup-and-answer path for requests addressed to a Slug: every
 * Pad-scoped endpoint loads its Pad here, so a missing or expired Pad is
 * answered the same way (404) everywhere instead of each site re-deciding.
 */
import { padRole } from "./pad-access.ts";
import type { Response } from "express";
import type { PadRecord, PadStore } from "./store.ts";

/** How an endpoint answers "no Pad at this address" (JSON for the API, HTML for pages). */
export type NoPadAnswer = (res: Response) => void;

/** The API's standard JSON answer for a Slug that has no Pad. */
export const jsonNoPad: NoPadAnswer = (res) => {
  res.status(404).json({ error: "No Pad lives at this address" });
};

/**
 * Loads the Pad a request addresses, or answers 404 itself and returns
 * undefined when there is none (the caller must then stop handling).
 */
export function requestUsername(res: Response): string | null {
  return res.locals.username ?? null;
}

export function getPadOrAnswer404(
  store: PadStore,
  slug: string,
  res: Response,
  answer: NoPadAnswer = jsonNoPad,
): PadRecord | undefined {
  const username = requestUsername(res);
  const pad = store.resolvePad(slug, username);
  if (!pad || !padRole(pad, username)) {
    answer(res);
    return undefined;
  }
  return pad;
}
