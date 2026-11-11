import { createEncryption } from "./passphrase.js";
import { rememberPad } from "./pad-navigation.js";

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
    status.textContent = "Copy failed.";
  }
}

export function ttlChoice(element) {
  const value = element.value;
  if (value === "default") return {};
  return { ttl: value === "never" ? value : Number(value) };
}

export function initPadActions(username) {
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
  const result = $("one-time-link");
  const link = $("one-time-link-url");
  const copyPassword = $("one-time-password");
  const status = $("one-time-status");
  let createdPassphrase = "";
  function syncChoice() {
    $("create-passphrase-field").hidden = !encrypted.checked;
    passphrase.required = encrypted.checked;
  }
  encrypted.addEventListener("change", syncChoice);
  syncChoice();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    error.hidden = true;
    submit.disabled = true;
    const secret = encrypted.checked ? passphrase.value : "";
    try {
      const body = ttlChoice($("new-pad-ttl"));
      if (encrypted.checked) {
        if (!crypto.subtle) throw new Error("Encrypted spaces require HTTPS or localhost.");
        if (secret.trim().length < 12) throw new Error("Use a passphrase with at least 12 characters.");
        body.encrypted = true;
        body.encryption = await createEncryption(secret);
      }
      const slug = $("new-pad-slug").value.trim().toLowerCase();
      const pin = $("new-pad-pad-pin").value.trim();
      const instancePin = $("new-pad-pin")?.value.trim();
      if (slug) body.slug = slug;
      if (pin) body.pin = pin;
      if (instancePin) body.instancePin = instancePin;

      const response = await fetch("/api/pads", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const pad = await response.json();
      if (!response.ok) throw new Error(pad.error ?? "Could not create the space.");
      if (!username) rememberPad(pad, true);
      createdPassphrase = secret;
      copyPassword.hidden = $("created-encrypted-hint").hidden = !secret;
      link.value = new URL(pad.path, location.origin).href;
      status.textContent = "";
      form.reset();
      syncChoice();
      form.closest("dialog").close();
      result.showModal();
      link.select();
    } catch (cause) {
      error.textContent = cause.message || "Could not create the space.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  $("one-time-copy").addEventListener("click", () => copyText(link.value, status, "Link copied."));
  copyPassword.addEventListener("click", () => copyText(createdPassphrase, status, "Passphrase copied."));
  $("one-time-open").addEventListener("click", () => location.assign(link.value));
  result.addEventListener("close", () => {
    createdPassphrase = "";
    link.value = "";
  });
}
