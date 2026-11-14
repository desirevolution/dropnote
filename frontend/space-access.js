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
  let previousShares;
  let previousRequests;
  let socket;
  let retry;
  let toastTimer;
  let refreshAccessDialog = () => {};
  let latestOwned = [];
  const ownedDetails = new Map();
  const guestControls = new Map();
  const sorter = $("space-sort");
  const toast = $("access-toast");
  $("access-toast-close").addEventListener("click", () => { toast.hidden = true; });

  function sortSpaces(spaces) {
    const date = (space) => sorter.value === "updated" ? space.updatedAt ?? space.createdAt : space.createdAt;
    return spaces.sort((a, b) => Number(isStartPad(b)) - Number(isStartPad(a)) || date(b).localeCompare(date(a)));
  }

  function showToast(message, target, action, section) {
    const link = $("access-toast-action");
    $("access-toast-text").textContent = message;
    link.href = target ?? "#";
    link.textContent = action;
    link.onclick = target ? null : (event) => {
      event.preventDefault();
      document.querySelector('[data-open-dialog="owned-spaces-dialog"]').click();
      if (section) $(section).scrollIntoView({ block: "nearest" });
      toast.hidden = true;
    };
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 10_000);
  }

  function showChangeDetails(detail, space, labels) {
    detail.textContent = [space.changed ? t("Changed") : "",
      space.updatedAt ? t("Last changed {date}", { date: dateLabel(space.updatedAt) }) : "",
      ...labels].filter(Boolean).join(" · ");
  }
  let loadNumber = 0;
  let requestNumber = 0;
  let appliedRequest = 0;
  let refreshing = false;
  let refreshAgain = false;
  const requestLinks = new Map();
  let requestCounts = new Map();
  let latestShared = [];

  function showRequestCount(link, name, count) {
    link.hidden = count === 0;
    link.textContent = count ? requestLabel(count) : "";
    if (count) link.setAttribute("aria-label", t("{label} for {name}", { label: link.textContent, name }));
  }

  async function loadOwnedSpaces() {
    const request = ++requestNumber;
    const { spaces, sharedSpaces = [] } = await getJson("/api/my-spaces", { signal: AbortSignal.timeout(10_000) });
    if (request > appliedRequest) {
      latestOwned = spaces;
      for (const space of spaces) {
        const detail = ownedDetails.get(space.slug);
        if (detail) showChangeDetails(detail, space, ownedLabels(space));
        guestControls.get(space.slug)?.(space.guestStatus);
      }
    }
    if (badge && request > appliedRequest) {
      appliedRequest = request;
      requestCounts = new Map(spaces.map((space) => [space.slug, space.accessRequestCount]));
      const unseen = sharedSpaces.filter((space) => space.isNew);
      const fresh = previousShares ? unseen.filter((space) => !previousShares.has(space.slug)) : [];
      const requested = previousRequests ? spaces.filter((space) =>
        space.accessRequestCount > (previousRequests.get(space.slug) ?? 0)) : [];
      previousShares = new Set(unseen.map((space) => space.slug));
      previousRequests = requestCounts;
      if (!document.hidden) {
        if (fresh.length === 1 && !requested.length) {
          const space = fresh[0];
          showToast(t("New share for {name}", { name: spaceLabel(space.slug, space.displayName) }), space.path, t("Open space"));
        } else if (requested.length === 1 && !fresh.length) {
          showToast(t("New access request"), `${requested[0].path}#space-access-dialog`, t("View request"));
        } else if (fresh.length > 1 && !requested.length) {
          showToast(t("{count} new shares", { count: fresh.length }), null, t("Shared with me"), "shared-spaces-title");
        } else if (fresh.length || requested.length) {
          showToast(t("New sharing activity"), null, t("My spaces"));
        }
      }
      latestShared = sharedSpaces;
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
    appliedRequest = Math.max(appliedRequest, request);
    return latestOwned;
  }

  function updateSharedSpaces(spaces) {
    const count = spaces.filter((space) => space.isNew).length;
    sharedBadge.hidden = count === 0;
    sharedBadge.textContent = count ? String(count) : "";
    sharedBadge.title = t(count === 1 ? "{count} new share" : "{count} new shares", { count });
    sharedBadge.setAttribute("aria-label", sharedBadge.title);
    spaces = sortSpaces([...spaces]);
    const snapshot = JSON.stringify(spaces.map((space) => ({ ...space, start: isStartPad(space) })));
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
      showChangeDetails(detail, space, [sharingLabel(space)]);
      const info = document.createElement("div");
      info.className = "space-row-info";
      info.append(link, startBadge(space));
      if (space.isNew) {
        const marker = document.createElement("span");
        marker.className = "request-count";
        marker.textContent = t("New");
        info.append(marker);
      }
      info.append(detail);
      row.append(info);
      return row;
    }));
    if (focused) [...sharedList.querySelectorAll("a")].find((link) => link.href === focused)?.focus();
  }

  async function refreshBadge() {
    if (document.hidden) return;
    if (refreshing) { refreshAgain = true; return; }
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
      if (refreshAgain) {
        refreshAgain = false;
        void refreshBadge();
      }
    }
  }

  function connectEvents() {
    if (socket || document.hidden) return;
    clearTimeout(retry);
    const url = new URL("/events", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const connection = new WebSocket(url, "dropnote");
    socket = connection;
    connection.onopen = () => {
      void refreshBadge();
      if ($("space-access-dialog")?.open) refreshAccessDialog();
    };
    connection.onmessage = () => {
      void refreshBadge();
      if ($("space-access-dialog")?.open) refreshAccessDialog();
    };
    connection.onclose = () => {
      if (socket !== connection) return;
      socket = null;
      retry = setTimeout(connectEvents, 5000);
    };
  }

  if (badge) {
    void refreshBadge();
    connectEvents();
    window.addEventListener("pagehide", () => {
      clearTimeout(retry);
      const connection = socket;
      socket = null;
      connection?.close();
    });
    document.addEventListener("visibilitychange", connectEvents);
    document.addEventListener("visibilitychange", refreshBadge);
    window.addEventListener("focus", refreshBadge);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) { connectEvents(); void refreshBadge(); }
    });
    window.setInterval(() => {
      const disconnected = socket?.readyState !== WebSocket.OPEN;
      if (disconnected || $("owned-spaces-dialog").open) void refreshBadge();
      if (disconnected && !document.hidden && $("space-access-dialog")?.open) refreshAccessDialog();
    }, 10_000);
  }
  function ownedLabels(space) {
    return [
      space.sharedWith.length ? t("Shared with {name}", {
        name: space.sharedWith[0] + (space.sharedWith.length > 1 ? ` +${space.sharedWith.length - 1}` : ""),
      }) : "",
      space.encrypted ? t("Encrypted") : "",
      space.expiresAt ? t("Expires {date}", { date: dateLabel(space.expiresAt) }) : "",
    ];
  }

  if (!badge) window.setInterval(() => {
    if ($("owned-spaces-dialog").open) void refreshBadge();
  }, 10_000);
  const openSpaces = document.querySelector('[data-open-dialog="owned-spaces-dialog"]');
  openSpaces.addEventListener("click", renderOwned);
  sorter.addEventListener("change", () => {
    if (sharedList) updateSharedSpaces(latestShared);
    void renderOwned();
  });

  async function renderOwned() {
    const load = ++loadNumber;
    owned.replaceChildren();
    requestLinks.clear();
    ownedDetails.clear();
    guestControls.clear();
    ownedStatus.textContent = t("Loading…");
    try {
      const spaces = await loadOwnedSpaces();
      if (load !== loadNumber) return;
      ownedStatus.textContent = spaces.length ? "" : t("You haven't created any spaces yet.");
      for (const space of sortSpaces([...spaces])) {
        const row = document.createElement("li");
        const link = document.createElement("a");
        const detail = document.createElement("span");
        link.href = space.path;
        link.textContent = spaceLabel(space.slug, space.displayName);
        detail.className = "my-pad-detail";
        ownedDetails.set(space.slug, detail);
        showChangeDetails(detail, space, ownedLabels(space));
        const info = document.createElement("div");
        info.className = "space-row-info";
        info.append(link, startBadge(space), detail);
        const menu = document.createElement("details");
        menu.className = "pad-menu space-row-menu";
        menu.dataset.actionMenu = "";
        const trigger = document.createElement("summary");
        trigger.textContent = "⋯";
        trigger.setAttribute("aria-label", t("Actions for {name}", { name: link.textContent }));
        const actions = document.createElement("div");
        actions.className = "menu-items";
        menu.append(trigger, actions);
        row.append(info, menu);
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
          info.append(requests);
        }
        if (Object.hasOwn(space, "guestStatus")) {
          const guest = document.createElement("a");
          guest.href = `${space.path}?guest=1`;

          const currentGuest = document.querySelector('[data-open-dialog="guest-link-dialog"]');
          if (currentGuest && location.pathname === space.path) {
            guest.addEventListener("click", (event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              owned.closest("dialog").close();
              currentGuest.click();
            });
          }
          const showGuest = (status) => {
            guest.textContent = t(status ? (status.redeemedAt ? "Guest link redeemed" : "Guest link active") : "Create guest link");
            const parent = status ? info : actions;
            if (guest.parentElement !== parent) {
              if (status) info.append(guest);
              else actions.prepend(guest);
            }
          };
          guest.className = "space-guest-action";
          guestControls.set(space.slug, showGuest);
          showGuest(space.guestStatus);
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
            guestControls.delete(space.slug);
            ownedDetails.delete(space.slug);
            void loadOwnedSpaces().catch(() => {});
            ownedStatus.textContent = owned.children.length ? "" : t("You haven't created any spaces yet.");
          } catch (error) {
            if (load === loadNumber) ownedStatus.textContent = error.message || t("Could not delete this space.");
          } finally {
            remove.disabled = false;
          }
        });
        actions.append(remove);
        owned.append(row);
      }
    } catch {
      if (load === loadNumber) ownedStatus.textContent = t("My spaces could not be loaded.");
    }
  }

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
  usernameInput.addEventListener("change", updateSubmit);
  updateSubmit();

  async function manage(operation, success) {
    if (busy) return;
    busy = true;
    updateSubmit();
    status.textContent = t("Working…");
    try {
      const { grants, requests, eligibleUsers } = await operation();
      const chosen = usernameInput.value;
      const placeholder = new Option(t("Choose an account"), "");
      usernameInput.replaceChildren(placeholder, ...eligibleUsers.map((user) => new Option(user, user)));
      usernameInput.value = eligibleUsers.includes(chosen) ? chosen : "";
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
        name.textContent = username;
        const permission = document.createElement("select");
        permission.setAttribute("aria-label", t("{label} for {name}", { label: t("Permission"), name: username }));
        permission.append(new Option(t("Can read"), "read"), new Option(t("Can edit"), "edit"));
        permission.value = role;
        permission.addEventListener("change", async () => {
          const next = permission.value;
          permission.value = role;
          await setGrant(username, next);
        });
        remove.type = "button";
        remove.textContent = t("Remove");
        remove.setAttribute("aria-label", t("Remove access for {name}", { name: username }));
        remove.addEventListener("click", () => setGrant(username, null));
        row.append(name, permission, remove);
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

  function setGrant(username, role, createOnly = false) {
    return manage(() => getJson(accessApi, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, role, createOnly }),
    }), role ? t("Access saved for {name}.", { name: username }) : t("Access removed for {name}.", { name: username }));
  }

  refreshAccessDialog = () => { if (!busy) void manage(() => getJson(accessApi)); };
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
    void setGrant(username, form.elements.namedItem("role").value, true);
  });
  if (location.hash === "#space-access-dialog") openAccess.click();
}
