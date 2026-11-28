export type WorkspaceView = "note" | "files";

export function workspaceViewKey(pad: { slug: string; createdAt: string }): string {
  return `dropnote:workspace-view:${pad.slug}:${pad.createdAt}`;
}

export function initialWorkspaceView(filesLink: boolean | WorkspaceView, saved: string | null, noteText: string, fileCount: number): WorkspaceView {
  if (filesLink === "note") return "note";
  if (filesLink === true || filesLink === "files") return "files";
  if (saved === "note" || saved === "files") return saved;
  return !noteText.trim() && fileCount > 0 ? "files" : "note";
}

export function workspacePositionKey(pad: { slug: string; createdAt: string }): string {
  return `dropnote:editor-position:${pad.slug}:${pad.createdAt}`;
}
