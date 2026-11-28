// Counts refer to the original note, not the rendered Markdown or aliases.
export function noteCounts(text: string) {
  let characters = 0;
  let words = 0;
  let inWord = false;
  for (const char of text) {
    characters++;
    if (/\s/u.test(char)) inWord = false;
    else if (!inWord) { words++; inWord = true; }
  }
  return { words, characters };
}

// Keep the toolbar on one row, even in narrow embedded layouts.
export function toolbarOverflow(width: number): string[] {
  const ids = ["download-note", "readable-export"];
  if (width < 400) ids.push("redo-note", "paste-note", "note-view", "editor-help");
  if (width < 240) ids.push("undo-note", "copy-note");
  if (width < 160) ids.push("insert-reference", "find-note");
  return ids;
}
