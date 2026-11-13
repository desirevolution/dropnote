import { spaceLabel } from "../src/space-label.ts";
import { dateLabel, isStartPad, startBadge } from "./pad-navigation.js";

import { t } from "./i18n.js";

const $ = (id) => document.getElementById(id);

async function getJson(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ? t(result.error) : t("The request failed."));
  return result;
}

export function initSpaceAccess(api) {
  const openAccess = document.querySelector('[data-open-dialog="space-access-dialog"]');
  const owned = $("owned-spaces-list");
  const ownedStatus = $("owned-spaces-status");
  let loadNumber = 0;
  document.querySelector('[data-open-dialog="owned-spaces-dialog"]').addEventListener("click", async () => {
    const load = ++loadNumber;
    owned.replaceChildren();
    ownedStatus.textContent = t("Loading…");
    try {
      const { spaces } = await getJson("/api/my-spaces");
      if (load !== loadNumber) return;
      ownedStatus.textContent = spaces.length ? "" : t("You haven't created any spaces yet.");
      spaces.sort((a, b) => Number(isStartPad(b)) - Number(isStartPad(a)));
      for (const space of spaces) {
        const row = document.createElement("li");
        const link = document.createElement("a");
        const detail = document.createElement("span");
        link.href = space.path;
        link.textContent = spaceLabel(space.slug, space.displayName);
        detail.className = "my-pad-detail";
        detail.textContent = [
          space.sharedWith.length ? t("Shared with {name}", {
            name: space.sharedWith[0] + (space.sharedWith.length > 1 ? ` +${space.sharedWith.length - 1}` : ""),
          }) : "",
          space.encrypted ? t("Encrypted") : "",
          space.expiresAt ? t("Expires {date}", { date: dateLabel(space.expiresAt) }) : "",
        ].filter(Boolean).join(" · ");
        row.append(link, startBadge(space), detail);
        if (space.accessRequestCount > 0) {
          const requests = document.createElement("a");
          requests.href = `${space.path}#space-access-dialog`;
          requests.textContent = t(space.accessRequestCount === 1 ? "{count} access request" : "{count} access requests", { count: space.accessRequestCount });
          requests.setAttribute("aria-label", t("{label} for {name}", { label: requests.textContent, name: link.textContent }));
          if (openAccess && location.pathname === space.path) {
            requests.addEventListener("click", (event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              owned.closest("dialog").close();
              openAccess.click();
            });
          }
          row.append(requests);
        }
        owned.append(row);
      }
    } catch {
      if (load === loadNumber) ownedStatus.textContent = t("My spaces could not be loaded.");
    }
  });

  const form = $("space-access-form");
  if (!form) return;
  const list = $("space-access-list");
  const requestList = $("space-access-request-list");
  const requestSection = $("space-access-requests");
  const status = $("space-access-status");
  const submit = form.querySelector('button[type="submit"]');
  const accessApi = `${api}/access`;
  let busy = false;

  async function manage(operation, success) {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    status.textContent = t("Working…");
    try {
      const { grants, requests } = await operation();
      requestList.replaceChildren(...requests.map(({ id, username }) => {
        const row = document.createElement("li");
        const name = document.createElement("span");
        const actions = document.createElement("div");
        name.textContent = username;
        actions.className = "dialog-actions";
        for (const [label, role] of [["Allow reading", "read"], ["Allow editing", "edit"], ["Decline", null]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = t(label);
          button.setAttribute("aria-label", t("{label} for {name}", { label: t(label), name: username }));
          button.addEventListener("click", () => {
            void manage(() => getJson(`${api}/access-requests/${encodeURIComponent(id)}`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ role }),
            }), role ? t("Access granted to {name}.", { name: username }) : t("Request from {name} declined.", { name: username }));
          });
          actions.append(button);
        }
        row.append(name, actions);
        return row;
      }));
      requestSection.hidden = requests.length === 0;
      list.replaceChildren(...grants.map(({ username, role }) => {
        const row = document.createElement("li");
        const name = document.createElement("span");
        const remove = document.createElement("button");
        name.textContent = `${username} · ${t(role === "edit" ? "Can edit" : "Can read")}`;
        remove.type = "button";
        remove.textContent = t("Remove");
        remove.setAttribute("aria-label", t("Remove access for {name}", { name: username }));
        remove.addEventListener("click", () => setGrant(username, null));
        row.append(name, remove);
        return row;
      }));
      status.textContent = success || (grants.length ? "" : t("No one else has access."));
    } catch (error) {
      status.textContent = error.message || t("Access could not be updated.");
    } finally {
      busy = false;
      submit.disabled = false;
    }
  }

  function setGrant(username, role) {
    return manage(() => getJson(accessApi, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, role }),
    }), role ? t("Access saved for {name}.", { name: username }) : t("Access removed for {name}.", { name: username }));
  }

  openAccess.addEventListener("click", () => {
    if (busy) return;
    list.replaceChildren();
    requestList.replaceChildren();
    requestSection.hidden = true;
    void manage(() => getJson(accessApi));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    void setGrant(data.get("username").trim(), data.get("role"));
  });
  if (location.hash === "#space-access-dialog") openAccess.click();
}
