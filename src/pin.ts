/**
 * Per-Pad PIN security (ticket 05): hashing and constant-time verification,
 * the capability-token exchange, and the client-IP lockout (5 failed
 * attempts, then PIN_LOCKOUT_SECONDS — 15 minutes by default). Spec: "PIN
 * security" — the same gate covers relay writes and the management
 * endpoints (rename, TTL extension).
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { PadRecord, PinRecord } from "./store.ts";

/** A PIN is a numeric credential of 4–10 digits. */
export const PIN_PATTERN = /^\d{4,10}$/;

/** Failed PIN attempts allowed per client IP and Pad before the lockout. */
const MAX_ATTEMPTS = 5;

/** How long an issued capability token may be presented, in seconds. */
export const TOKEN_TTL_SECONDS = 600;

/**
 * Hashes a PIN for storage in the data index: a random salt plus an scrypt
 * digest (hex). The PIN itself is never persisted.
 */
export function hashPin(pin: string): PinRecord {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return { salt, hash };
}

/** Constant-time PIN check: the scrypt digests are compared byte-wise. */
export function verifyPadPin(pad: PadRecord, pin: string): boolean {
  if (!pad.pin) return false;
  const stored = Buffer.from(pad.pin.hash, "hex");
  const derived = scryptSync(pin, pad.pin.salt, stored.length);
  return timingSafeEqual(derived, stored);
}

export type PinAuthResult =
  | { ok: true; token: string; expiresIn: number }
  | { ok: false; reason: "locked"; retryAfterSeconds: number }
  | { ok: false; reason: "wrong"; attemptsRemaining: number };

interface AttemptState {
  count: number;
  lockedUntil: number | null;
}

/**
 * Issues and checks the short-lived capability tokens a correct PIN
 * exchanges for, and tracks failed PIN attempts per client IP and Pad.
 * Tokens are kept only as digests, so a memory peek reveals no live
 * capability.
 */
export class PinAuthority {
  readonly #lockoutMs: number;
  readonly #now: () => number;
  readonly #tokens = new Map<string, { slug: string; username: string | null; expiresAt: number }>();
  readonly #attempts = new Map<string, AttemptState>();

  constructor(options: { lockoutSeconds: number; now?: () => number }) {
    this.#lockoutMs = options.lockoutSeconds * 1_000;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Checks one PIN attempt and — on success — issues a capability token.
   * `ip` is the client address the attempt came from; five failures from
   * one IP lock it out for the configured duration (even correct PINs are
   * refused while locked).
   */
  authenticate(pad: PadRecord, pin: string, ip: string, username: string | null = null): PinAuthResult {
    const key = `${pad.slug}|${ip}|${username ?? ""}`;
    const state = this.#attempts.get(key);
    const now = this.#now();
    if (state?.lockedUntil !== null && state?.lockedUntil !== undefined) {
      if (now < state.lockedUntil) {
        const retryAfterSeconds = Math.ceil((state.lockedUntil - now) / 1_000);
        return { ok: false, reason: "locked", retryAfterSeconds };
      }
      this.#attempts.delete(key); // the lockout has passed: a fresh set of attempts
    }
    if (!verifyPadPin(pad, pin)) {
      const count = (state?.count ?? 0) + 1;
      if (count >= MAX_ATTEMPTS) {
        const lockedUntil = now + this.#lockoutMs;
        this.#attempts.set(key, { count, lockedUntil });
        return { ok: false, reason: "locked", retryAfterSeconds: Math.ceil(this.#lockoutMs / 1_000) };
      }
      this.#attempts.set(key, { count, lockedUntil: null });
      return { ok: false, reason: "wrong", attemptsRemaining: MAX_ATTEMPTS - count };
    }
    this.#attempts.delete(key); // a success clears the failure count
    const token = randomBytes(32).toString("hex");
    this.#tokens.set(digest(token), { slug: pad.slug, username, expiresAt: this.#now() + TOKEN_TTL_SECONDS * 1_000 });
    return { ok: true, token, expiresIn: TOKEN_TTL_SECONDS };
  }

  revokeUser(slug: string, username: string): void {
    for (const [digest, token] of this.#tokens) {
      if (token.slug === slug && token.username === username) this.#tokens.delete(digest);
    }
  }

  revokePad(slug: string): void {
    for (const [digest, token] of this.#tokens) {
      if (token.slug === slug) this.#tokens.delete(digest);
    }
    for (const key of this.#attempts.keys()) {
      if (key.startsWith(`${slug}|`)) this.#attempts.delete(key);
    }
  }

  /** Whether this token is a live capability for exactly this Pad. */
  checkToken(slug: string, token: string | undefined, username: string | null = null): boolean {
    if (token === undefined || token === "") return false;
    const key = digest(token);
    const entry = this.#tokens.get(key);
    if (!entry || entry.slug !== slug || entry.username !== username) return false;
    if (entry.expiresAt <= this.#now()) {
      this.#tokens.delete(key); // expired capabilities are dropped lazily
      return false;
    }
    return true;
  }
}

/** Reads the capability token out of an Authorization header, if any. */
export function bearerTokenOf(authorization: unknown): string | undefined {
  if (typeof authorization !== "string") return undefined;
  if (!authorization.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length) || undefined;
}

/** Tokens are stored and looked up only as digests. */
function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
