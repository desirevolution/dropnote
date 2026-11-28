import { createHash } from "node:crypto";
import { SHARE_FRAGMENT_SCRIPT, STRIP_SHARE_FRAGMENT_SCRIPT } from "./share-fragment.ts";
import { THEME_RESTORE_SCRIPT } from "./theme.ts";

// Guest documents may execute only the public bundle and these exact scripts.
// Local font loading is allowed; the guest router exposes one public font.
const hashes = [SHARE_FRAGMENT_SCRIPT, STRIP_SHARE_FRAGMENT_SCRIPT, THEME_RESTORE_SCRIPT]
  .map(script => `'sha256-${createHash("sha256").update(script).digest("base64")}'`).join(" ");
export const GUEST_CSP = `default-src 'none'; script-src 'self' ${hashes}; style-src 'unsafe-inline'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
export const GUEST_FONT_PATH = "/fonts/IBMPlexMono-Regular.woff2";
