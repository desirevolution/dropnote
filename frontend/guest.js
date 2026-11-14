import { decryptAttachment } from "./encrypted-attachments.js";
import { listedGuestFiles, openGuestSnapshot } from "./guest-snapshot.js";
import { t } from "./i18n.js";
import { copyText } from "./pad-actions.js";
import { guestProof, unlockPadKey } from "./passphrase.js";
import { createTransferSink, KEEP_SAVED_MS, sweepStaleTemps } from "./transfer-sink.js";

const $ = (id) => document.getElementById(id);
const opening = JSON.parse($("guest-opening").textContent);
const fragment = window.takeOpeningPassphrase?.();

if (opening) {
  const form = $("guest-form");
  const field = $("guest-passphrase");
  const submit = $("guest-open");
  const status = $("guest-message");
  const path = location.pathname.replace(/\/$/, "");
  const unavailable = t("This guest link is unavailable.");
  const transfers = new AbortController();
  let expiryTimer;

  function expire() {
    clearTimeout(expiryTimer);
    transfers.abort();
    $("guest-content").hidden = true;
    $("guest-note").value = "";
    $("guest-files").replaceChildren();
    $("guest-name").textContent = "";
    $("guest-expiry").textContent = "";
    $("guest-locked").hidden = true;
    field.value = "";
    status.textContent = unavailable;
  }

  async function download(entry, key, headers, button) {
    button.disabled = true;
    status.textContent = t(key ? "Downloading and decrypting" : "Downloading");
    let sink;
    let retained = false;
    try {
      const signal = transfers.signal;
      const response = await fetch(`${path}/files/${entry.blobId}`, { headers, signal });
      if (!response.ok) throw new Error(t("The Attachment could not be downloaded."));
      sink = await createTransferSink(entry.size);
      if (key) {
        for await (const chunk of decryptAttachment(key, response.body)) {
          signal.throwIfAborted();
          if (!chunk.ok) throw chunk.error;
          await sink.write(chunk.bytes);
        }
      } else {
        const reader = response.body.getReader();
        try {
          for (;;) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            await sink.write(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      const file = await sink.close();
      if (Number.isSafeInteger(entry.size) && file.size !== entry.size) throw new Error(t("This file could not be decrypted."));
      signal.throwIfAborted();
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = entry.name;
      anchor.click();
      retained = true;
      setTimeout(() => {
        URL.revokeObjectURL(url);
        void sink.dispose();
      }, KEEP_SAVED_MS);
      status.textContent = "";
    } catch (error) {
      if (!transfers.signal.aborted) status.textContent = error.message;
    } finally {
      button.disabled = false;
      if (!retained) await sink?.dispose();
    }
  }

  async function open(passphrase) {
    if (submit.disabled) return;
    submit.disabled = true;
    status.textContent = "";
    try {
      const key = opening.encryption ? await unlockPadKey(passphrase, opening.encryption) : null;
      if (opening.encryption && !key) {
        status.textContent = t("Incorrect passphrase.");
        field.focus();
        return;
      }
      const proof = key && await guestProof(key);
      const signal = transfers.signal;
      signal.throwIfAborted();
      const result = await fetch(`${path}/open`, {
        method: "POST", signal,
        ...(proof ? { headers: { "X-Guest-Proof": proof } } :
          { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: passphrase }) }),
      });
      if (result.status === 404) {
        expire();
        return;
      }
      if (result.status === 403 && !opening.encryption) {
        status.textContent = t("Incorrect guest password.");
        field.focus();
        return;
      }
      if (!result.ok) throw new Error(unavailable);
      const data = await result.json();
      const content = key ? await openGuestSnapshot(key, data.snapshot) : data;
      signal.throwIfAborted();
      $("guest-note").value = content.note;
      const allowedIds = key ? new Set(data.fileIds) : null;
      const entries = listedGuestFiles(content.files).reverse()
        .filter(({ blobId }) => !allowedIds || allowedIds.has(blobId));
      if (data.capturedAt) {
        const date = new Date(data.capturedAt).toLocaleString(document.documentElement.lang);
        $("guest-captured").textContent = t("Snapshot from {date}", { date });
        $("guest-captured").hidden = false;
      }

      const headers = data.session ? { "X-Guest-Session": data.session } : { "X-Guest-Proof": proof };
      $("guest-name").textContent = data.displayName;
      const date = new Date(data.expiresAt);
      $("guest-expiry").textContent = t("Access until {date}", { date: date.toLocaleString(document.documentElement.lang) });
      $("guest-files").replaceChildren(...entries.map((entry) => {
        const row = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = entry.name;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = t("Download");
        button.addEventListener("click", () => void download(entry, key, headers, button));
        row.append(name, button);
        return row;
      }));
      $("guest-no-files").hidden = entries.length > 0;
      $("guest-copy").disabled = !$("guest-note").value;
      $("guest-content").hidden = false;
      $("guest-locked").hidden = true;
      field.value = "";
      expiryTimer = setTimeout(expire, Math.max(0, date.getTime() - Date.now()));
      void sweepStaleTemps();
    } catch {
      if (!transfers.signal.aborted) status.textContent = t("Could not open this guest link.");
    } finally {
      submit.disabled = false;
    }
  }

  $("guest-copy").addEventListener("click", () => void copyText($("guest-note").value, status, t("Text copied.")));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void open(field.value);
  });
  window.addEventListener("pagehide", expire);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && !opening.oneTime) location.reload();
  });
  if (fragment) {
    if (opening.oneTime) field.value = fragment;
    else void open(fragment);
  }
}
