import { t } from "./i18n.js";
export function initWorkspaceTabs({ filesLink, beforeChange, afterChange }) {
  const toolbar = document.getElementById("workspace-toolbar");
  const views = ["note", "files"];
  const tabs = views.map((view) => document.getElementById(`${view}-tab`));
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
  const tools = views.map((view) => document.getElementById(`${view}-tools`));
  let selected;

  function select(view, focus = false) {
    if (selected !== view) {
      beforeChange(selected);
      selected = view;
      for (const [index, tab] of tabs.entries()) {
        const active = views[index] === view;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        panels[index].hidden = !active;
        tools[index].hidden = !active;
      }
      afterChange(view);
    }
    if (focus) tabs[views.indexOf(view)].focus();
  }

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => select(views[index]));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") next = 1 - index;
      else if (event.key === t("Home")) next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      select(views[next], true);
    });
  }

  return {
    get selected() { return selected; },
    showInitial(noteText, fileCount) {
      toolbar.hidden = false;
      if (selected) return;
      select(filesLink || (!noteText.trim() && fileCount > 0) ? "files" : "note");
    },
    showFiles() {
      select("files", true);
    },
    setFileCount(count) {
      tabs[1].textContent = t("Files ({count})", { count });
    },
  };
}
