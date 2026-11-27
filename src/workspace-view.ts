export type WorkspaceView = "note" | "files";

export function workspaceViewKey(pad: { slug: string; createdAt: string }): string {
  return `dropnote:workspace-view:${pad.slug}:${pad.createdAt}`;
}

export function initialWorkspaceView(filesLink: boolean, saved: string | null, noteText: string, fileCount: number): WorkspaceView {
  if (filesLink) return "files";
  if (saved === "note" || saved === "files") return saved;
  return !noteText.trim() && fileCount > 0 ? "files" : "note";
}

export function workspacePositionKey(pad: { slug: string; createdAt: string }): string {
  return `dropnote:editor-position:${pad.slug}:${pad.createdAt}`;
}
