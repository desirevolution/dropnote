import { createHash } from "node:crypto";
import { secureEquals } from "./secure-compare.ts";
import { bearerTokenOf, type PinAuthority } from "./pin.ts";
import { type GrantRole, type PadRecord } from "./store.ts";

export function padRole(pad: PadRecord, username: string | null): GrantRole | "owner" | null {
  if (username === null || pad.owner === username) return "owner";
  return pad.grants?.find((grant) => grant.username === username)?.role ?? null;
}

export function canEdit(pad: PadRecord, username: string | null): boolean {
  const role = padRole(pad, username);
  return role === "owner" || role === "edit";
}

export interface EncryptionParameters {
  salt: string;
  check: string;
  proofHash: string;
}

function canonicalBase64url(value: unknown, bytes: number): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === bytes && decoded.toString("base64url") === value;
}

export function parseEncryption(value: unknown): EncryptionParameters | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { salt, check, proofHash } = value as Partial<EncryptionParameters>;
  if (!canonicalBase64url(salt, 16) || !canonicalBase64url(check, 29) || !canonicalBase64url(proofHash, 32)) return undefined;
  return { salt, check, proofHash };
}

export function hasPadProof(pad: PadRecord, proof: unknown): boolean {
  if (pad.kind === "plain") return true;
  if (!pad.encryption || !canonicalBase64url(proof, 32)) return false;
  return secureEquals(createHash("sha256").update(proof).digest("base64url"), pad.encryption.proofHash);
}

export function writeFailure(
  pad: PadRecord, pins: PinAuthority, headers: { authorization?: string; "x-pad-proof"?: unknown }, username: string | null = null,
): string | null {
  if (!canEdit(pad, username)) return "You have read-only access to this space";
  if (!hasPadProof(pad, headers["x-pad-proof"])) return "Unlock the encrypted Pad before making changes";
  if (pad.pin && !pins.checkToken(pad.slug, bearerTokenOf(headers.authorization), username)) {
    return "This Pad is PIN-protected — exchange its PIN for a capability token first";
  }
  return null;
}
