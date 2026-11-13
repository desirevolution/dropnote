export const MAX_DISPLAY_NAME_LENGTH = 80;

export function spaceLabel(slug: string, displayName?: string | null): string {
  if (typeof displayName === "string" && displayName) return displayName;
  if (slug === "default") return "Default";
  return slug.charAt(0).toUpperCase() + slug.slice(1).replaceAll("-", " ");
}

/** Returns null for an empty name and undefined for invalid input. */
export function parseDisplayName(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (name.length > MAX_DISPLAY_NAME_LENGTH || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(name)) return undefined;
  return name || null;
}
