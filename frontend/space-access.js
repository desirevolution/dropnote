import { spaceLabel } from "../src/space-label.ts";
import { dateLabel, isStartPad, sharingLabel, startBadge } from "./pad-navigation.js";

import { t } from "./i18n.js";

const $ = (id) => document.getElementById(id);

async function getJson(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ? t(result.error) : t("The request failed."));
  return result;
}

function requestLabel(count) {
  return t(count === 1 ? "{count} access request" : "{count} access requests", { count });
}

export function initSpaceAccess(api, deleteSpace, unreadGrantId) {
  const openAccess = document.querySelector('[data-open-dialog="space-access-dialog"]');
  const owned = $("owned-spaces-list");
  const ownedStatus = $("owned-spaces-status");
  const badge = $("access-request-badge");
  const sharedBadge = $("shared-space-badge");
  const sharedList = $("shared-spaces-list");
  let renderedShared;
  let loadNumber = 0;
  let requestNumber = 0;
  let appliedRequest = 0;
  let refreshing = false;
  const requestLinks = new Map();
  let requestCounts = new Map();

  function showRequestCount(link, name, count) {
    link.hidden = count === 0;
    link.textContent = count ? requestLabel(count) : "";
    if (count) link.setAttribute("aria-label", t("{label} for {name}", { label: link.textContent, name }));
  }

  async function loadOwnedSpaces() {
    const request = ++requestNumber;
    const { spaces, sharedSpaces = [] } = await getJson("/api/my-spaces", { signal: AbortSignal.timeout(10_000) });
    if (badge && request > appliedRequest) {
      appliedRequest = request;
      requestCounts = new Map(spaces.map((space) => [space.slug, space.accessRequestCount]));
      for (const [slug, { link, name }] of requestLinks) {
        showRequestCount(link, name, requestCounts.get(slug) ?? 0);
      }
      const count = spaces.reduce((total, space) => total + space.accessRequestCount, 0);
      badge.hidden = count === 0;
      badge.textContent = count ? `? ${count}` : "";
      badge.title = requestLabel(count);
      badge.setAttribute("aria-label", badge.title);
      updateSharedSpaces(sharedSpaces);
    }
    return spaces;
  }

  function updateSharedSpaces(spaces) {
    const count = spaces.filter((space) => space.isNew).length;
    sharedBadge.hidden = count === 0;
    sharedBadge.textContent = count ? String(count) : "";
    sharedBadge.title = t(count === 1 ? "{count} new share" : "{count} new shares", { count });
    sharedBadge.setAttribute("aria-label", sharedBadge.title);
    const snapshot = JSON.stringify(spaces);
    if (renderedShared === snapshot) return;
    renderedShared = snapshot;
    sharedList.closest("section").hidden = false;
    $("shared-spaces-empty").hidden = spaces.length > 0;
    const focused = document.activeElement?.closest("#shared-spaces-list a")?.href;
    sharedList.replaceChildren(...spaces.map((space) => {
      const row = document.createElement("li");
      const link = document.createElement("a");
      link.href = space.path;
      link.textContent = spaceLabel(space.slug, space.displayName);
      const detail = document.createElement("span");
      detail.className = "my-pad-detail";
      detail.textContent = sharingLabel(space);
      row.append(link, startBadge(space));
      if (space.isNew) {
        const marker = document.createElement("span");
        marker.className = "request-count";
        marker.textContent = t("New");
        row.append(marker);
      }
      row.append(detail);
      return row;
    }));
    if (focused) [...sharedList.querySelectorAll("a")].find((link) => link.href === focused)?.focus();
  }

  async function refreshBadge() {
    if (!badge || document.hidden || refreshing) return;
    refreshing = true;
    try {
      if (unreadGrantId) {
        const response = await fetch(`${api}/access-seen`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unreadId: unreadGrantId }),
          signal: AbortSignal.timeout(8_000),
        }).catch(() => null);
        if (response?.ok || response?.status === 404) unreadGrantId = null;
      }
      await loadOwnedSpaces();
    } catch {
      // Keep the last known count and retry on the next refresh.
    } finally {
      refreshing = false;
    }
  }

  if (badge) {
    void refreshBadge();
    document.addEventListener("visibilitychange", refreshBadge);
    window.addEventListener("focus", refreshBadge);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) void refreshBadge();
    });
    window.setInterval(refreshBadge, 10_000);
  }
  document.querySelector('[data-open-dialog="owned-spaces-dialog"]').addEventListener("click", async () => {
    const load = ++loadNumber;
    owned.replaceChildren();
    requestLinks.clear();
    ownedStatus.textContent = t("Loading…");
    try {
      const spaces = await loadOwnedSpaces();
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
        if (badge) {
          const requests = document.createElement("a");
          requests.href = `${space.path}#space-access-dialog`;
          showRequestCount(requests, link.textContent, requestCounts.get(space.slug) ?? 0);
          requestLinks.set(space.slug, { link: requests, name: link.textContent });
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
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = t("Delete space");
        remove.setAttribute("aria-label", t("Delete space {name}", { name: link.textContent }));
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            if (!await deleteSpace(space) || load !== loadNumber) return;
            row.remove();
            requestLinks.delete(space.slug);
            void loadOwnedSpaces().catch(() => {});
            ownedStatus.textContent = owned.children.length ? "" : t("You haven't created any spaces yet.");
          } catch (error) {
            if (load === loadNumber) ownedStatus.textContent = error.message || t("Could not delete this space.");
          } finally {
            remove.disabled = false;
          }
        });
        row.append(remove);
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
  const usernameInput = form.elements.namedItem("username");

  function updateSubmit() {
    submit.disabled = busy || !usernameInput.value.trim();
  }
  usernameInput.addEventListener("input", updateSubmit);
  updateSubmit();

  async function manage(operation, success) {
    if (busy) return;
    busy = true;
    updateSubmit();
    status.textContent = t("Working…");
    try {
      const { grants, requests } = await operation();
      requestList.replaceChildren(...requests.map(({ id, username }) => {
        const row = document.createElement("li");
        const name = document.createElement("span");
        const actions = document.createElement("div");
        name.textContent = username;
        actions.className = "request-actions";
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
      if (success) void loadOwnedSpaces().catch(() => {});
      status.textContent = success || (grants.length ? "" : t("No one else has access."));
    } catch (error) {
      status.textContent = error.message || t("Access could not be updated.");
    } finally {
      busy = false;
      updateSubmit();
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
    const username = usernameInput.value.trim();
    if (busy || !username) return;
    void setGrant(username, form.elements.namedItem("role").value);
  });
  if (location.hash === "#space-access-dialog") openAccess.click();
}
