/** Canonical UUID v4, shared by storage and the browser-side reference codec. */
export const SPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Old slug-only clients remain compatible; supplied identities must match exactly. */
export function matchesSpaceId(actual: string, expected: unknown): boolean {
  return expected === undefined || (typeof expected === "string" && expected === actual);
}
