export function spaceLabel(slug: string): string {
  if (slug === "default") return "Default";
  return slug.charAt(0).toUpperCase() + slug.slice(1).replaceAll("-", " ");
}
