import { createEncryption } from "./passphrase.js";
import { language, t } from "./i18n.js";
import { openCreatedSpace } from "./share-secret.js";

// Lowercase letters and digits with common lookalikes removed.
const passwordCharacters = "abcdefghjkmnpqrtuvwxy346789";

const $ = (id) => document.getElementById(id);

export async function copyText(text, status, success) {
  try {
    try {
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(text);
    } catch {
      const active = document.activeElement;
      const field = document.createElement("textarea");
      field.value = text;
      field.readOnly = true;
      field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      (active.closest("dialog") ?? document.body).append(field);
      field.select();
      try {
        if (!document.execCommand("copy")) throw new Error();
      } finally {
        field.remove();
        active.focus();
      }
    }
    status.textContent = success;
  } catch {
    status.textContent = t("Copy failed.");
  }
}

export function ttlChoice(element) {
  const value = element.value;
  if (value === "default") return {};
  return { ttl: value === "never" ? value : Number(value) };
}

export function initPadActions() {
  document.querySelectorAll("[data-open-dialog]").forEach((button) => {
    button.addEventListener("click", () => $(button.dataset.openDialog).showModal());
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  const menu = $("pad-menu");
  menu.addEventListener("click", (event) => {
    if (event.target.closest(".menu-items button, .menu-items a")) menu.open = false;
  });
  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });

  const form = $("new-pad-form");
  const encrypted = $("new-pad-encrypted");
  const passphrase = $("create-passphrase");
  const error = $("new-pad-error");
  const submit = form.querySelector('button[type="submit"]');
  const expiry = $("new-pad-ttl");
  const displayNameInput = $("new-pad-name");
  const slugInput = $("new-pad-slug");
  const slugValue = () => slugInput.value.trim().toLowerCase();
  function syncUrlPreview() {
    $("new-pad-url-segment").textContent = slugValue() || "…";
  }
  slugInput.addEventListener("input", syncUrlPreview);
  const suggest = $("suggest-passphrase");
  const suggestPassword = $("suggest-password");
  const grouped = $("password-groups");
  let suggestedPassword = "";
  const reveal = $("show-passphrase");
  const dialog = form.closest("dialog");
  let wordList;
  let revision = 0;

  function showPassphrase(show) {
    passphrase.type = show ? "text" : "password";
    reveal.textContent = t(show ? "Hide passphrase" : "Show passphrase");
    grouped.hidden = !show || !suggestedPassword || passphrase.value !== suggestedPassword;
    grouped.textContent = grouped.hidden ? "" : suggestedPassword.replace(/(.{4})(.{4})(.{4})(.{5})/, "$1 $2 $3 $4");
  }
  passphrase.addEventListener("input", () => {
    revision += 1;
    suggestedPassword = "";
    showPassphrase(passphrase.type === "text");
  });
  suggestPassword.addEventListener("click", () => {
    revision += 1;
    error.hidden = true;
    suggestedPassword = randomItems(passwordCharacters, 17).join("");
    passphrase.value = suggestedPassword;
    showPassphrase(true);
  });
  reveal.addEventListener("click", () => showPassphrase(passphrase.type === "password"));
  dialog.addEventListener("close", () => {
    revision += 1;
    passphrase.value = suggestedPassword = "";
    showPassphrase(false);
  });
  function syncExpiry() {
    $("new-pad-expiry-summary").textContent = expiry.selectedOptions[0]?.textContent ?? "";
  }
  expiry.addEventListener("change", syncExpiry);
  syncExpiry();
  suggest.addEventListener("click", async () => {
    const current = revision;
    suggest.disabled = true;
    error.hidden = true;
    try {
      if (!crypto.subtle) throw new Error();
      wordList ??= fetch(`/api/words/${language()}`).then(async (response) => {
        if (!response.ok) throw new Error();
        return (await response.text()).trim().split("\n");
      }).catch((error) => {
        wordList = undefined;
        throw error;
      });
      const words = await wordList;
      if (!Array.isArray(words) || words.length < 2) throw new Error();
      if (revision !== current || !dialog.open || !encrypted.checked || submit.disabled) return;
      suggestedPassword = "";
      passphrase.value = randomItems(words, 6).join(" ");
      showPassphrase(true);
    } catch {
      if (revision === current) {
        error.textContent = t("Could not suggest a passphrase.");
        error.hidden = false;
      }
    } finally {
      suggest.disabled = false;
    }
  });
  function syncChoice() {
    $("create-passphrase-field").hidden = !encrypted.checked;
    passphrase.required = encrypted.checked;
  }
  encrypted.addEventListener("change", () => {
    revision += 1;
    if (!encrypted.checked) {
      passphrase.value = suggestedPassword = "";
      showPassphrase(false);
    }
    syncChoice();
  });
  syncChoice();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    error.hidden = true;
    submit.disabled = true;
    const secret = encrypted.checked ? passphrase.value : null;
    const slug = slugValue();
    const displayName = displayNameInput.value.trim();
    const pin = $("new-pad-pad-pin").value.trim();
    const instancePin = $("new-pad-pin")?.value.trim();
    try {
      const body = ttlChoice(expiry);
      if (secret !== null) {
        if (!crypto.subtle) throw new Error(t("Encrypted spaces require HTTPS or localhost."));
        if (secret.trim().length < 12) throw new Error(t("Use a passphrase with at least 12 characters."));
        body.encrypted = true;
        body.encryption = await createEncryption(secret);
      }
      if (slug) body.slug = slug;
      if (displayName) body.displayName = displayName;
      if (pin) body.pin = pin;
      if (instancePin) body.instancePin = instancePin;

      const response = await fetch("/api/pads", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const pad = await response.json();
      if (!response.ok) {
        let message = pad.error ?? "Could not create the space.";
        if (response.status === 409 || (response.status === 400 &&
            (message.includes("not a valid Slug") || message.includes("is reserved for the site's own routes")))) {
          $("new-pad-options").open = true;
          slugInput.focus();
          if (response.status === 409) message = "This URL address is already in use.";
          else if (message.includes("not a valid Slug")) message = "Use letters, digits and single hyphens for the URL address.";
          else message = "This URL address is reserved.";
        }
        throw new Error(t(message));
      }
      form.reset();
      syncUrlPreview();
      syncChoice();
      syncExpiry();
      if (dialog.open) dialog.close();
      openCreatedSpace(pad, secret);
    } catch (cause) {
      error.textContent = t(cause.message || "Could not create the space.");
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}

function randomItems(items, count) {
  const limit = 2 ** 32 - (2 ** 32 % items.length);
  const random = new Uint32Array(1);
  return Array.from({ length: count }, () => {
    do {
      crypto.getRandomValues(random);
    } while (random[0] >= limit);
    return items[random[0] % items.length];
  });
}
