import { spaceLabel } from "../src/space-label.ts";
import { dateLabel } from "./pad-navigation.js";

const $ = (id) => document.getElementById(id);

async function getJson(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}

export function initSpaceAccess(api) {
  const owned = $("owned-spaces-list");
  const ownedStatus = $("owned-spaces-status");
  let loadNumber = 0;
  document.querySelector('[data-open-dialog="owned-spaces-dialog"]').addEventListener("click", async () => {
    const load = ++loadNumber;
    owned.replaceChildren();
    ownedStatus.textContent = "Loading…";
    try {
      const { spaces } = await getJson("/api/my-spaces");
      if (load !== loadNumber) return;
      ownedStatus.textContent = spaces.length ? "" : "You haven't created any spaces yet.";
      for (const space of spaces) {
        const row = document.createElement("li");
        const link = document.createElement("a");
        const detail = document.createElement("span");
        link.href = space.path;
        link.textContent = spaceLabel(space.slug);
        detail.className = "my-pad-detail";
        detail.textContent = [
          space.encrypted ? "Encrypted" : "",
          space.expiresAt ? `Expires ${dateLabel(space.expiresAt)}` : "",
        ].filter(Boolean).join(" · ");
        row.append(link, detail);
        owned.append(row);
      }
    } catch {
      if (load === loadNumber) ownedStatus.textContent = "My spaces could not be loaded.";
    }
  });

  const form = $("space-access-form");
  if (!form) return;
  const list = $("space-access-list");
  const status = $("space-access-status");
  const submit = form.querySelector('button[type="submit"]');
  const accessApi = `${api}/access`;
  let busy = false;

  async function manage(operation, success) {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    status.textContent = "Working…";
    try {
      const { grants } = await operation();
      list.replaceChildren(...grants.map(({ username, role }) => {
        const row = document.createElement("li");
        const name = document.createElement("span");
        const remove = document.createElement("button");
        name.textContent = `${username} · ${role === "edit" ? "Can edit" : "Can read"}`;
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove access for ${username}`);
        remove.addEventListener("click", () => setGrant(username, null));
        row.append(name, remove);
        return row;
      }));
      status.textContent = success || (grants.length ? "" : "No one else has access.");
    } catch (error) {
      status.textContent = error.message || "Access could not be updated.";
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
    }), role ? `Access saved for ${username}.` : `Access removed for ${username}.`);
  }

  document.querySelector('[data-open-dialog="space-access-dialog"]').addEventListener("click", () => {
    if (busy) return;
    list.replaceChildren();
    void manage(() => getJson(accessApi));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    void setGrant(data.get("username").trim(), data.get("role"));
  });
}
