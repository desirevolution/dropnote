import { createTransferSink, KEEP_SAVED_MS, sweepStaleTemps } from "./transfer-sink.js";
import { language, t } from "./i18n.js";
/**
 * The Pad's flat attachment list (no folders, per the glossary): uploads with
 * progress, live list rendering from the shared Yjs document, downloads of
 * the original bytes and deletion. The blob bytes travel over the HTTP
 * endpoints in src/attachments.ts; the visible metadata (name, size, blob ID)
 * lives in the Pad's Yjs document (ADR-0002), so additions and removals
 * propagate live to every connected client through the same Live-Sync path
 * as the Note.
 *
 * On an Encrypted Pad (ADR-0001) nothing plaintext ever leaves the browser:
 * an upload is sealed chunk-wise first (frontend/encrypted-attachments.js)
 * and the sealed container — the only thing the server ever stores — is
 * sent through the same endpoint; a download opens the container back into
 * the original bytes. Transfer bodies above the spill threshold flow
 * through an OPFS temp file instead of memory, so a 1 GB-class file is
 * never held whole (the browser streams a File body from disk).
 * Plain Pads keep the direct upload/download they always had.
 */

import { DecryptionError } from "./crypto.js";
import { decryptAttachment, encryptAttachment } from "./encrypted-attachments.js";

/** Must match test/helpers/sync-client.ts — the shared list's Yjs type name. */
const ATTACHMENTS_TYPE = "attachments";

const $ = (id) => document.getElementById(id);
const uploadArea = $("attachment-uploads");
const list = $("attachments");
const input = $("attachment-input");
const errorLine = $("attachment-error");
const dropZone = $("file-drop");
const choose = $("choose-files");
const pasteImage = $("paste-image");
const pasteStatus = $("image-paste-status");
const previewTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon"]);
const imageExtensions = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/gif", "gif"], ["image/webp", "webp"], ["image/avif", "avif"], ["image/bmp", "bmp"], ["image/svg+xml", "svg"]]);

export function initAttachments(ydoc, slug, { key, writeHeaders, onCount, onUploaded }) {
  const attachments = ydoc.getArray(ATTACHMENTS_TYPE);
  const activeTransfers = new AbortController();
  const { signal } = activeTransfers;
  let canEdit = false;
  let dragDepth = 0;
  let preview;
  let openingImage = false;
  let readingImages = false;
  const imageDialog = $("image-dialog");
  const fullImage = $("full-image");
  const copyImage = $("copy-image");
  const imageCopyStatus = $("image-copy-status");
  const canCopyImage = typeof navigator.clipboard?.write === "function" && typeof ClipboardItem === "function";

  attachments.observe(render);
  render();
  void sweepStaleTemps();

  for (const button of [choose, dropZone]) {
    button.addEventListener("click", () => input.click(), { signal });
  }
  input.addEventListener("change", () => {
    uploadFiles(input.files);
    input.value = "";
  }, { signal });
  const filesPanel = $("files-card");
  filesPanel.addEventListener("dragenter", (event) => {
    if (!canEdit || !event.dataTransfer.types.includes("Files")) return;
    dragDepth += 1;
    filesPanel.classList.add("is-dragging");
  }, { signal });
  filesPanel.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) filesPanel.classList.remove("is-dragging");
  }, { signal });
  filesPanel.addEventListener("dragover", (event) => {
    if (!canEdit || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, { signal });
  filesPanel.addEventListener("drop", (event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    resetDrag();
    uploadFiles(event.dataTransfer.files);
  }, { signal });
  for (const type of ["dragover", "drop"]) {
    document.addEventListener(type, (event) => {
      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
    }, { signal });
  }
  const note = $("note");
  document.addEventListener("paste", (event) => {
    if (!canEdit || event.defaultPrevented || document.querySelector("dialog[open]")) return;
    const target = event.target;
    if (!note.contains(target)) {
      if (filesPanel.hidden) return;
      if (target instanceof Element &&
          (target.isContentEditable || target.closest("input, textarea, select, dialog"))) return;
    }
    const clipboard = event.clipboardData;
    const files = clipboard?.files.length ? Array.from(clipboard.files) : Array.from(clipboard?.items ?? [])
      .filter((item) => item.kind === "file").map((item) => item.getAsFile());
    const images = files.filter((file) => file?.type.startsWith("image/"));
    if (!images.length) return;
    event.preventDefault();
    uploadImages(images);
  }, { capture: true, signal });

  function imagePasteStatus(message) {
    pasteStatus.textContent = message ? t(message) : "";
    pasteStatus.hidden = !message || filesPanel.hidden;
  }

  pasteImage.addEventListener("click", async () => {
    if (!canEdit || readingImages || filesPanel.hidden) return;
    const stillInFiles = () => !signal.aborted && canEdit && !filesPanel.hidden &&
      !document.querySelector("dialog[open]");
    readingImages = true;
    pasteImage.disabled = true;
    imagePasteStatus("");
    try {
      if (!navigator.clipboard?.read) throw new Error();
      const items = await navigator.clipboard.read();
      const images = [];
      for (const item of items) {
        const mime = item.types.find((type) => type.startsWith("image/"));
        if (mime) images.push(await item.getType(mime));
      }
      if (!stillInFiles()) return;
      if (images.length) uploadImages(images);
      else imagePasteStatus("No image in the clipboard. Use Add files to choose an image.");
    } catch {
      if (stillInFiles()) imagePasteStatus("Clipboard images are unavailable here. Use Add files to choose an image.");
    } finally {
      readingImages = false;
      if (!signal.aborted) pasteImage.disabled = !canEdit;
    }
  }, { signal });

  function uploadImages(images) {
    imagePasteStatus("");
    const timestamp = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-");
    uploadFiles(images.map((file, index) => {
      if (file.name && !/^image\.(png|jpe?g|webp)$/i.test(file.name)) return file;
      const extension = imageExtensions.get(file.type) ?? "img";
      return new File([file], `image-${timestamp}${index ? `-${index + 1}` : ""}.${extension}`, { type: file.type });
    }));
  }

  imageDialog.addEventListener("close", () => {
    if (!imageDialog.open) closePreview();
  }, { signal });

  copyImage.addEventListener("click", async () => {
    const source = preview;
    if (!source || !canCopyImage) return;
    copyImage.disabled = true;
    imageCopyStatus.textContent = "";
    const png = source.blob.type === "image/png" ? source.blob : imageAsPng(fullImage, source.url);
    try {
      // Start the clipboard write in the click handler, before awaiting conversion.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      if (preview === source) imageCopyStatus.textContent = t("Image copied.");
    } catch {
      if (preview === source) imageCopyStatus.textContent = t("Could not copy the image. Download it from the file list.");
    } finally {
      if (png instanceof Promise) void png.catch(() => {});
      if (preview === source) copyImage.disabled = false;
    }
  }, { signal });

  function closePreview() {
    if (!preview) return;
    fullImage.removeAttribute("src");
    URL.revokeObjectURL(preview.url);
    void preview.dispose();
    preview = null;
    copyImage.disabled = true;
    imageCopyStatus.textContent = "";
  }

  function resetDrag() {
    dragDepth = 0;
    filesPanel.classList.remove("is-dragging");
  }

  function uploadFiles(files) {
    if (!canEdit || !files?.length) return;
    showError(null);
    for (const file of files) {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      void uploadFile(file, id);
    }
  }

  function render() {
    const entries = attachments.toArray().filter((entry) =>
      entry && typeof entry.name === "string" && /^[0-9a-f]{32}$/.test(entry.blobId));
    dropZone.hidden = !canEdit || entries.length > 0;
    $("files-empty").hidden = canEdit || entries.length !== 0;
    entries.reverse().sort((left, right) => String(right.addedAt ?? "").localeCompare(String(left.addedAt ?? "")));
    list.replaceChildren(...entries.map(rowFor));
    onCount(entries.length);
  }

  function rowFor(entry) {
    const row = document.createElement("li");
    row.dataset.blobId = entry.blobId;
    const info = document.createElement("div");
    info.className = "file-info";

    if (previewTypes.has(entry.contentType)) {
      const open = button("View", () => download(entry, true));
      open.className = "file-action thumbnail-button";
      open.setAttribute("aria-label", t("View {name}", { name: entry.name }));
      if (typeof entry.thumbnail === "string" && entry.thumbnail.length <= 48_000 &&
          /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(entry.thumbnail)) {
        const image = document.createElement("img");
        image.alt = "";
        image.loading = "lazy";
        image.src = entry.thumbnail;
        open.replaceChildren(image);
      }
      info.classList.add("with-thumbnail");
      info.append(open);
    }
    const name = document.createElement("span");
    name.className = "attachment-name";
    name.textContent = entry.name;
    const size = document.createElement("span");
    size.className = "attachment-size";
    const date = new Date(entry.addedAt);
    size.textContent = Number.isFinite(+date)
      ? `${formatBytes(entry.size)} · ${date.toLocaleString(language(), { dateStyle: "short", timeStyle: "medium" })}`
      : formatBytes(entry.size);
    const description = document.createElement("div");
    description.className = "file-description";
    description.append(name, size);
    info.append(description);

    const action = key ? button("Download", () => download(entry, false)) : document.createElement("a");
    if (!key) {
      action.href = attachmentUrl(slug, entry.blobId, entry.name);
      action.download = entry.name;
      action.textContent = t("Download");
    }
    action.className = "file-action file-download";
    action.setAttribute("aria-label", t("Download {name}", { name: entry.name }));
    const actions = document.createElement("div");
    actions.className = "file-actions";
    actions.append(action);
    row.append(info, actions);
    if (canEdit) {
      const remove = button("Remove", async () => {
        if (!canEdit || !window.confirm(t("Remove “{name}” from this pad?", { name: entry.name }))) return;
        remove.disabled = true;
        try {
          showError(null);
          await removeAttachment(entry);
        } catch (error) {
          showError(error.message);
        } finally {
          remove.disabled = false;
        }
      });
      remove.className = "file-action quiet file-remove";
      remove.setAttribute("aria-label", t("Remove {name}", { name: entry.name }));
      actions.append(remove);
    }
    return row;
  }

  async function uploadFile(file, id) {
    const row = progressRowFor(file, key ? "Encrypting" : "Uploading");
    uploadArea.append(row);
    let sink;
    try {
      const thumbnail = await makeThumbnail(file);
      let body = file;
      if (key) {
        sink = await createTransferSink(file.size);
        body = await sinkThrough(encryptAttachment(key, file, (bytes) => setProgress(row, bytes / file.size)), sink, signal);
        setTransferPhase(row, "Uploading");
      }
      if (signal.aborted) return;
      if (!canEdit) throw new Error(t("Wait until editing is available, then retry."));
      const request = await postAttachment(body, id, (fraction) => setProgress(row, fraction));
      if (request.status !== 201) throw new Error(errorMessageOf(request));
      const { blobId } = JSON.parse(request.responseText);
      if (signal.aborted) return;
      if (!attachments.toArray().some((entry) => entry.blobId === blobId)) {
        attachments.push([{
          blobId,
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          addedAt: new Date().toISOString(),
          ...(thumbnail ? { thumbnail } : {}),
        }]);
      }
      row.remove();
      onUploaded();
    } catch (error) {
      if (signal.aborted) return;
      row.classList.add("transfer-failed");
      const status = row.querySelector(".transfer-phase");
      status.className = "transfer-error";
      status.setAttribute("role", "status");
      status.textContent = error.message || t("Upload failed.");
      const retry = button("Retry", () => {
        if (!canEdit) return;
        row.remove();
        void uploadFile(file, id);
      });
      retry.className = "retry-upload";
      retry.disabled = !canEdit;
      row.replaceChildren(row.firstElementChild, retry, button("Dismiss", () => row.remove()));
    } finally {
      await sink?.dispose();
    }
  }

  async function download(entry, view) {
    if (view && openingImage) return;
    if (view) openingImage = true;
    showError(null);
    const row = progressRowFor(entry, key ? "Downloading and decrypting" : "Downloading");
    uploadArea.append(row);
    let sink;
    let retained = false;
    try {
      const response = await fetch(attachmentUrl(slug, entry.blobId), { signal, headers: key ? writeHeaders() : undefined });
      if (!response.ok) throw new Error(await serverErrorOf(response));
      let body;
      if (key) {
        sink = await createTransferSink(entry.size);
        for await (const chunk of decryptAttachment(key, response.body, {
          onProgress: (bytes) => setProgress(row, bytes / entry.size),
        })) {
          if (signal.aborted) return;
          if (!chunk.ok) throw chunk.error;
          await sink.write(chunk.bytes);
        }
        body = await sink.close();
      } else {
        body = await response.blob();
      }
      if (signal.aborted) return;
      const blob = view ? body.slice(0, body.size, entry.contentType) : body;
      const url = URL.createObjectURL(blob);
      retained = true;
      if (view) {
        closePreview();
        preview = { url, blob, dispose: () => sink?.dispose() };
        copyImage.disabled = !canCopyImage;
        imageCopyStatus.textContent = canCopyImage ? "" : t("Image copying is unavailable here. Download it from the file list.");
        $("image-title").textContent = entry.name;
        fullImage.alt = entry.name;
        fullImage.src = url;
        if (!imageDialog.open) imageDialog.showModal();
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = entry.name;
        anchor.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
          void sink?.dispose();
        }, KEEP_SAVED_MS);
      }
    } catch (error) {
      if (!signal.aborted) showError(error instanceof DecryptionError ? t("This file could not be decrypted.") : error.message);
    } finally {
      row.remove();
      if (view) openingImage = false;
      if (!retained) await sink?.dispose();
    }
  }

  async function removeAttachment(entry) {
    const response = await fetch(attachmentUrl(slug, entry.blobId), {
      method: "DELETE", headers: writeHeaders(), signal,
    });
    if (response.status !== 204 && response.status !== 404) throw new Error(await serverErrorOf(response));
    const index = attachments.toArray().findIndex((candidate) => candidate.blobId === entry.blobId);
    if (index >= 0) attachments.delete(index, 1);
  }

  function postAttachment(body, id, onFraction) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", `/api/pads/${encodeURIComponent(slug)}/attachments`);
      request.setRequestHeader("content-type", "application/octet-stream");
      request.setRequestHeader("x-upload-id", id);
      for (const [name, value] of Object.entries(writeHeaders())) request.setRequestHeader(name, value);
      const abort = () => request.abort();
      signal.addEventListener("abort", abort, { once: true });
      request.addEventListener("loadend", () => signal.removeEventListener("abort", abort));
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onFraction(event.loaded / event.total);
      });
      request.addEventListener("load", () => resolve(request));
      request.addEventListener("abort", () => reject(new Error(t("Upload cancelled."))));
      request.addEventListener("error", () => reject(new Error(t("Could not reach the server. Try again."))));
      request.send(body);
    });
  }

  return {
    setEditing(enabled) {
      if (enabled === canEdit) return;
      canEdit = enabled;
      input.disabled = choose.disabled = dropZone.disabled = !enabled;
      pasteImage.disabled = !enabled || readingImages;
      if (!enabled) imagePasteStatus("");
      for (const retry of uploadArea.querySelectorAll(".retry-upload")) retry.disabled = !enabled;
      resetDrag();
      render();
    },
    async clear() {
      showError(null);
      for (const entry of attachments.toArray()) {
        if (!canEdit) {
          showError(t("Editing is unavailable. Remaining files were kept."));
          return;
        }
        try {
          await removeAttachment(entry);
        } catch (error) {
          showError(error.message);
          return;
        }
      }
    },
    destroy() {
      activeTransfers.abort();
      attachments.unobserve(render);
      closePreview();
      if (imageDialog.open) imageDialog.close();
      imagePasteStatus("");
      pasteImage.disabled = true;
      uploadArea.replaceChildren();
      list.replaceChildren();
      showError(null);
    },
  };
}

async function imageAsPng(image, expectedUrl) {
  await image.decode();
  if (image.src !== expectedUrl) throw new Error(t("The image preview has changed."));
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(t("Could not encode the image as PNG.")));
    }, "image/png");
  });
}

function button(label, action) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = t(label);
  element.addEventListener("click", action);
  return element;
}

async function makeThumbnail(file) {
  if (!previewTypes.has(file.type) || typeof createImageBitmap !== "function") return null;
  let image;
  try {
    image = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 96 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const thumbnail = canvas.toDataURL("image/webp", 0.72);
    return thumbnail.length <= 48_000 ? thumbnail : null;
  } catch {
    return null;
  } finally {
    image?.close();
  }
}

function progressRowFor(item, phase) {
  const row = document.createElement("li");
  row.dataset.name = item.name;
  const name = document.createElement("span");
  name.className = "attachment-name";
  name.textContent = item.name;
  const status = document.createElement("span");
  status.className = "transfer-phase attachment-size";
  status.textContent = t(phase);
  const info = document.createElement("div");
  info.className = "file-info";
  info.append(name, status);
  const bar = document.createElement("progress");
  bar.max = 100;
  bar.value = 0;
  bar.setAttribute("aria-label", `${t(phase)} ${item.name}`);
  const percent = document.createElement("span");
  percent.className = "attachment-size";
  percent.textContent = "0%";
  row.append(info, bar, percent);
  return row;
}

function setTransferPhase(row, phase) {
  row.querySelector(".transfer-phase").textContent = t(phase);
  row.querySelector("progress").setAttribute("aria-label", `${t(phase)} ${row.dataset.name}`);
  setProgress(row, 0);
}

function setProgress(row, fraction) {
  const percent = Number.isFinite(fraction) ? Math.min(100, Math.round(fraction * 100)) : 0;
  row.querySelector("progress").value = percent;
  row.lastElementChild.textContent = `${percent}%`;
}

/** Feeds a stream chunk by chunk into a sink; resolves with the closed body. */
async function sinkThrough(stream, sink, signal) {
  const reader = stream.getReader();
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      await sink.write(value);
    }
    return await sink.close();
  } finally {
    await reader.cancel();
  }
}

function attachmentUrl(slug, blobId, name = null) {
  const base = `/api/pads/${encodeURIComponent(slug)}/attachments/${encodeURIComponent(blobId)}`;
  return name === null ? base : `${base}?name=${encodeURIComponent(name)}`;
}

/** Shows (or clears, with null) the upload/removal error line. */
function showError(message) {
  if (message === null) {
    errorLine.hidden = true;
    errorLine.textContent = "";
    return;
  }
  errorLine.textContent = message;
  errorLine.hidden = false;
}

/** The server's clear error text, or a fallback when the body is unreadable. */
function errorMessageOf(request) {
  try {
    const body = JSON.parse(request.responseText);
    if (typeof body.error === "string" && body.error.length > 0) return t(body.error);
  } catch {
    // fall through to the generic message
  }
  return t("Attaching the file failed.");
}

/** The download response's clear error text, or a fallback. */
async function serverErrorOf(response) {
  try {
    const body = await response.json();
    if (typeof body.error === "string" && body.error.length > 0) return t(body.error);
  } catch {
    // fall through to the generic message
  }
  return t("The Attachment could not be downloaded.");
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
