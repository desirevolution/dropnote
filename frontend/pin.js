import { t } from "./i18n.js";
export function initPinUnlock(metadata, { headers, onUnlocked }) {
  if (!metadata.pinProtected) return;
  const form = document.querySelector("#pin-form");
  const input = document.querySelector("#pin-input");
  const error = document.querySelector("#pin-error");
  const dialog = document.querySelector("#pin-dialog");
  const submit = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    error.hidden = true;
    submit.disabled = true;
    try {
      const response = await fetch(`/api/pads/${encodeURIComponent(metadata.slug)}/pin`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({ pin: input.value }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.token !== "string") throw new Error(body.error ? t(body.error) : t("Could not unlock editing."));
      if (dialog.open) {
        dialog.close();
        onUnlocked(body.token, body.expiresIn);
      }
    } catch (cause) {
      error.textContent = cause.message || t("Could not check the editing PIN.");
      error.hidden = false;
    } finally {
      input.value = "";
      submit.disabled = false;
    }
  });
}
