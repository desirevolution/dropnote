import QRCode from "qrcode";
import { copyText } from "./pad-actions.js";
import { secretLink } from "./share-secret.js";
import { t } from "./i18n.js";

const $ = (id) => document.getElementById(id);

function png(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG export failed")), "image/png");
  });
}

export function initShareQr(padUrl, slug) {
  const dialog = $("pad-qr-dialog");
  const include = $("include-passphrase");
  const options = $("share-secret-options");
  const canvas = $("pad-qr");
  const error = $("pad-qr-error");
  const copy = $("qr-copy-image");
  const download = $("qr-save-image");
  const copyPassphrase = $("qr-copy-passphrase");
  const status = $("qr-status");
  const link = $("pad-qr-link");
  const hint = $("qr-passphrase-hint");
  let passphrase = null;
  let renderId = 0;
  const canCopy = Boolean(navigator.clipboard?.write && typeof ClipboardItem === "function");
  copy.hidden = !canCopy;

  const shareUrl = () => include.checked && passphrase ? secretLink(padUrl, passphrase) : padUrl;
  function clearImage() {
    renderId += 1;
    canvas.width = 0;
    canvas.hidden = copy.disabled = download.disabled = true;
    status.textContent = "";
  }
  async function render() {
    clearImage();
    const current = renderId;
    const withSecret = include.checked && Boolean(passphrase);
    $("share-secret-warning").hidden = !withSecret;
    if (hint) hint.hidden = withSecret;
    link.hidden = withSecret;
    error.hidden = true;
    try {
      const image = await QRCode.toCanvas(shareUrl(), { width: 560, margin: 4 });
      if (current !== renderId || !dialog.open) return;
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d").drawImage(image, 0, 0);
      canvas.hidden = download.disabled = false;
      copy.disabled = !canCopy;
    } catch {
      if (current === renderId && dialog.open) error.hidden = false;
    }
  }

  link.href = link.textContent = padUrl;
  $("show-pad-qr").addEventListener("click", render);
  include.addEventListener("change", render);
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    include.checked = false;
    clearImage();
  });
  $("qr-copy-link").addEventListener("click", () => copyText(shareUrl(), status, t("Link copied.")));
  copyPassphrase.addEventListener("click", () => {
    if (passphrase) void copyText(passphrase, status, t("Passphrase copied."));
  });
  copy.addEventListener("click", async () => {
    const current = renderId;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png(canvas) })]);
      if (current === renderId) status.textContent = t("QR image copied.");
    } catch {
      if (current === renderId) status.textContent = t("Could not copy the QR image. Download the PNG instead.");
    }
  });
  download.addEventListener("click", async () => {
    const current = renderId;
    try {
      const blob = await png(canvas);
      if (current !== renderId || !dialog.open) return;
      const url = URL.createObjectURL(blob);
      const save = document.createElement("a");
      save.href = url;
      save.download = `${slug}-qr.png`;
      save.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      if (current === renderId) status.textContent = t("Could not download the QR image.");
    }
  });

  return {
    setPassphrase(value) {
      passphrase = value;
      options.hidden = copyPassphrase.hidden = !value;
      if (!value) include.checked = false;
      if (dialog.open) void render();
    },
  };
}
