export function spaceLabel(slug: string): string {
  if (slug === "default") return "Shared space";
  return slug.charAt(0).toUpperCase() + slug.slice(1).replaceAll("-", " ");
}
