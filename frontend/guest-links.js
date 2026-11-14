import QRCode from "qrcode";
import { t } from "./i18n.js";
import { copyText, randomItems } from "./pad-actions.js";
import { dateLabel } from "./pad-navigation.js";
import { guestProofHash, passwordCharacters, unlockPadKey } from "./passphrase.js";
import { sealGuestSnapshot } from "./guest-snapshot.js";
import { secretLink } from "./share-secret.js";

const $ = (id) => document.getElementById(`guest-link-${id}`);

export function initGuestLinks(api, encryption, getProof, getKey, getDocument) {
  const dialog = $("dialog");
  if (!dialog) return;
  const open = document.querySelector('[data-open-dialog="guest-link-dialog"]');
  const form = $("form");
  const state = $("state");
  const feedback = $("feedback");
  const create = $("create");
  const duration = $("duration");
  const durationOptions = [...duration.options];
  const password = $("password");
  const suggest = $("suggest");
  const copyPassword = $("copy-password");
  const durationMs = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000 };
  let availability;
  let deadlineTimer;
  let ready = false;
  function suggestPassword() {
    if (password) password.value = randomItems(passwordCharacters, 17).join("");
  }
  suggest?.addEventListener("click", () => {
    suggestPassword();
    password.focus();
  });
  copyPassword?.addEventListener("click", () => {
    if (password.value) void copyText(password.value, feedback, t("Password copied."));
  });
  const revoke = $("revoke");
  const include = $("include");
  const field = $("secret");
  const url = $("url");
  const canvas = $("qr");
  const copy = $("copy");
  const qr = $("show-qr");
  let link;
  let busy = false;
  let version = 0;
  let validationTimer;
  let statusTimer;
  let mutation = 0;
  let verifiedPassphrase;
  let createdPassword;
  const copyActivePassword = $("copy-active-password");
  copyActivePassword?.addEventListener("click", () => {
    if (createdPassword) void copyText(createdPassword, feedback, t("Password copied."));
  });

  function refreshControls() {
    clearTimeout(deadlineTimer);
    const elapsed = availability ? performance.now() - availability.receivedAt : 0;
    const remaining = availability?.padExpiresAt === null ? Infinity :
      (availability ? Date.parse(availability.padExpiresAt) - availability.now - elapsed : 0);
    const selected = duration.value;
    for (const option of durationOptions) {
      option.disabled = !availability?.durations.includes(option.value) || durationMs[option.value] > remaining;
    }
    if (!selected || duration.selectedOptions[0]?.disabled) {
      duration.value = durationOptions.find((option) => !option.disabled)?.value ?? "";
    }
    const locked = Boolean(encryption && !getProof());
    const loading = Boolean(encryption && !locked && !getDocument());
    const allowed = Boolean(duration.value);
    if (password) password.disabled = suggest.disabled = copyPassword.disabled = !allowed || busy;
    duration.disabled = !allowed || busy;
    create.disabled = !ready || busy || locked || loading || !allowed;
    revoke.disabled = busy;
    $("lock-hint").hidden = !locked;
    $("sync-hint").hidden = !loading;
    $("ttl-hint").hidden = !availability || allowed;
    if (dialog.open && Number.isFinite(remaining)) {
      const next = durationOptions.filter((option) => !option.disabled).at(-1);
      if (next) deadlineTimer = setTimeout(refreshControls, Math.max(1, remaining - durationMs[next.value] + 1));
    }
  }

  function setAvailability(data) {
    if (!Array.isArray(data?.durations)) return;
    const first = !availability;
    availability = { durations: data.durations, padExpiresAt: data.padExpiresAt, now: data.now, receivedAt: performance.now() };
    if (first) duration.value = "24h";
    refreshControls();
  }

  function clearQr() {
    version++;
    canvas.hidden = true;
    canvas.width = 0;
    url.value = link?.url ?? "";
  }

  function render() {
    createdPassword = undefined;
    if (copyActivePassword) copyActivePassword.hidden = true;
    $("active").hidden = !link;
    $("share").hidden = Boolean(link?.redeemedAt);
    state.textContent = link ? t(link.redeemedAt ? "Redeemed · Access until {date}" :
      link.oneTime ? "One-time link · Access until {date}" : "Access until {date}", { date: dateLabel(link.expiresAt) }) :
      t("No active guest link.");
    $("replace-hint").hidden = !link;
    $("captured").hidden = !link?.capturedAt;
    $("captured").textContent = link?.capturedAt ? t("Snapshot from {date}", { date: dateLabel(link.capturedAt) }) : "";
    create.textContent = t(link ? "Replace guest link" : "Create guest link");
    include.checked = false;
    field.value = "";
    updateSecretControl();
    refreshControls();
  }

  function updateSecretControl() {
    $("secret-label").hidden = $("warning").hidden = !include.checked;
    url.hidden = include.checked;
    url.previousElementSibling.hidden = include.checked;
    field.value = include.checked ? createdPassword ?? "" : "";
    if (include.checked && createdPassword) {
      clearTimeout(validationTimer);
      clearQr();
      verifiedPassphrase = createdPassword;
      copy.disabled = qr.disabled = false;
    } else validateSecret();
  }

  function validateSecret() {
    clearTimeout(validationTimer);
    clearQr();
    const current = version;
    verifiedPassphrase = undefined;
    copy.disabled = qr.disabled = include.checked;
    feedback.textContent = "";
    const passphrase = field.value;
    if (!include.checked || !passphrase) return;

    validationTimer = setTimeout(async () => {
      let valid = false;
      try {
        if (encryption) valid = Boolean(await unlockPadKey(passphrase, encryption));
        else if (passphrase.length >= 12 && passphrase.length <= 256) {
          const response = await fetch(`${api}/guest-link/check-password`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: passphrase }),
          });
          valid = response.ok;
        }
      }
      catch { /* Show the same feedback as an incorrect passphrase. */ }
      if (current !== version || !dialog.open) return;
      if (!valid) {
        feedback.textContent = t(encryption ? "Enter the correct passphrase." : "Enter the correct guest password.");
        return;
      }
      verifiedPassphrase = passphrase;
      copy.disabled = qr.disabled = false;
    }, 350);
  }

  async function request(method = "GET", body, proof) {
    const response = await fetch(`${api}/guest-link`, {
      method,
      cache: "no-store",
      ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...(proof ? { "X-Pad-Proof": proof } : {}) } } : {}),
    });
    if (response.ok && method === "DELETE") return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setAvailability(data);
      throw new Error(t(data?.error ?? "Could not update the guest link."));
    }
    return data;
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    feedback.textContent = "";
    refreshControls();
    try {
      const data = await request();
      ready = true;
      setAvailability(data);
      link = data.link;
      render();
    } catch (error) {
      ready = false;
      link = null;
      render();
      feedback.textContent = t(error.message);
    } finally {
      busy = false;
      refreshControls();
    }
  }

  async function checkStatus() {
    if (!dialog.open || busy || document.hidden) return;
    const before = mutation;
    try {
      const current = await request();
      if (before !== mutation || busy || !dialog.open) return;
      ready = true;
      setAvailability(current);
      if (JSON.stringify(current.link) === JSON.stringify(link)) return;
      link = current.link;
      render();
    } catch {
      // Keep the last successful state until the next check.
    }
  }

  open.addEventListener("click", () => {
    if (password && !password.value) suggestPassword();
    clearInterval(statusTimer);
    statusTimer = setInterval(checkStatus, 5_000);
    void refresh();
  });
  if (new URLSearchParams(location.search).get("guest") === "1") {
    queueMicrotask(() => {
      const current = new URL(location.href);
      current.searchParams.delete("guest");
      history.replaceState(history.state, "", current);
      open.click();
    });
  }
  dialog.addEventListener("close", () => {
    clearInterval(statusTimer);
    clearTimeout(deadlineTimer);
    if (password) password.value = "";
    createdPassword = undefined;
    if (copyActivePassword) copyActivePassword.hidden = true;
    include.checked = false;
    updateSecretControl();
  });
  include.addEventListener("change", updateSecretControl);
  field.addEventListener("input", validateSecret);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = getKey();
    const proof = getProof();
    refreshControls();
    if (create.disabled) return;
    const choices = { duration: duration.value, oneTime: $("once").checked };
    const chosenPassword = password?.value;
    mutation++;
    busy = true;
    feedback.textContent = "";
    refreshControls();
    try {
      if (encryption) {
        const doc = getDocument();
        const [proofHash, snapshot] = await Promise.all([guestProofHash(key), sealGuestSnapshot(key, doc)]);
        if (getKey() !== key || getDocument() !== doc) return;
        choices.proofHash = proofHash;
        choices.snapshot = snapshot;
      } else choices.password = chosenPassword;
      const data = await request("PUT", choices, proof);
      setAvailability(data);
      link = data.link;
      render();
      if (password && dialog.open) {
        include.checked = false;
        // Keep the creation password available for copying while this dialog is open.
        createdPassword = chosenPassword;
        copyActivePassword.hidden = false;
        suggestPassword();
      }
    } catch (error) {
      feedback.textContent = t(error.message);
    } finally {
      busy = false;
      refreshControls();
    }
  });
  revoke.addEventListener("click", async () => {
    if (busy || !link) return;
    mutation++;
    busy = true;
    feedback.textContent = "";
    refreshControls();
    try {
      link = await request("DELETE");
      render();
      create.focus();
    } catch (error) {
      feedback.textContent = t(error.message);
    } finally {
      busy = false;
      refreshControls();
    }
  });

  async function share(drawQr) {
    if (!link || link.redeemedAt) return;
    const current = ++version;
    if (include.checked && !verifiedPassphrase) return;
    const address = verifiedPassphrase ? secretLink(link.url, verifiedPassphrase) : link.url;
    try {
      if (drawQr) {
        const image = await QRCode.toCanvas(address, { width: 440, margin: 4 });
        if (current !== version || !dialog.open) return;
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0);
        canvas.hidden = false;
        feedback.textContent = "";
      } else {
        await copyText(address, feedback, t("Link copied."));
      }
    } catch {
      if (current === version) feedback.textContent = t("Could not share the guest link.");
    }
  }

  copy.addEventListener("click", () => void share(false));
  qr.addEventListener("click", () => void share(true));
  return { refreshControls };
}
