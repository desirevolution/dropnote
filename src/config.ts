/**
 * Configuration: every behavior-relevant setting comes from an environment
 * variable with a documented default (see README.md and .env.example).
 *
 * Invalid values fail boot with a clear error naming the variable — the
 * server never silently falls back when an operator mistypes a setting.
 */

import type { BlockList } from "node:net";
import { parseTrustedProxies } from "./proxy-user.ts";

export interface Config {
  trustedProxies: BlockList | null;
  /** HTTP port the server listens on. */
  port: number;
  /** Externally reachable base URL, used when building Share Links. */
  baseUrl: string;
  /** Directory holding all persistent state (JSON index, per-Pad data). */
  dataDir: string;
  /** Instance PIN gating Pad creation; null means creation is open (default). */
  instancePin: string | null;
  /** Default TTL offered at Pad creation, in seconds; null means no expiry. */
  defaultTtlSeconds: number | null;
  /** The longest TTL a Pad may be given, in seconds; null means unbounded. */
  maxTtlSeconds: number | null;
  /** Per-file size limit in bytes. */
  maxFileSizeBytes: number;
  /** Global instance storage limit in bytes. */
  maxInstanceSizeBytes: number;
  /** URL path prefix under which additional Pads are addressed. */
  padPath: string;
  /** How long a client IP is locked out after 5 failed PIN attempts, in seconds. */
  pinLockoutSeconds: number;
  /** How often the cleanup sweep deletes expired Pads, in seconds. */
  cleanupSweepSeconds: number;
  /** Rate-limit window in seconds. */
  rateLimitWindowSeconds: number;
  /** Maximum requests per rate-limit window. */
  rateLimitMax: number;
}

export class ConfigError extends Error {}

const DEFAULTS = {
  PORT: 3000,
  DATA_DIR: "./data",
  DEFAULT_TTL: "7d",
  MAX_TTL: "never",
  MAX_FILE_SIZE: "1GB",
  MAX_INSTANCE_SIZE: "10GB",
  PAD_PATH: "/p",
  PIN_LOCKOUT: "15m",
  CLEANUP_SWEEP: "60s",
  RATE_LIMIT_WINDOW: "1m",
  RATE_LIMIT_MAX: 120,
} as const;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const port = intFrom(env, "PORT", DEFAULTS.PORT, { min: 0, max: 65_535 });
  const baseUrl = urlFrom(env, "BASE_URL", `http://localhost:${port}`);
  const dataDir = stringFrom(env, "DATA_DIR", DEFAULTS.DATA_DIR);
  const multiuser = env.MULTIUSER ?? "false";
  if (multiuser !== "true" && multiuser !== "false") throw new ConfigError("MULTIUSER must be true or false");
  let trustedProxies: BlockList | null = null;
  if (multiuser === "true") {
    try {
      trustedProxies = parseTrustedProxies(env.TRUSTED_PROXIES ?? "");
    } catch {
      throw new ConfigError("MULTIUSER=true requires TRUSTED_PROXIES with a comma-separated list of proxy IPs or CIDRs");
    }
  }
  const instancePin = pinFrom(env);
  const defaultTtlSeconds = optionalDurationFrom(env, "DEFAULT_TTL", DEFAULTS.DEFAULT_TTL);
  // The TTL bound (spec: "bounded by env config"): accepts the same formats
  // as DEFAULT_TTL, plus "never" (the default) meaning unbounded.
  const maxTtlSeconds = optionalDurationFrom(env, "MAX_TTL", DEFAULTS.MAX_TTL);
  if (maxTtlSeconds !== null && maxTtlSeconds <= 0) {
    throw new ConfigError(`MAX_TTL must be a positive duration like "7d" or "never" (unbounded), got "${env.MAX_TTL}"`);
  }
  if (maxTtlSeconds !== null && defaultTtlSeconds === null) {
    throw new ConfigError(`MAX_TTL bounds Pad lifetimes, but DEFAULT_TTL is "never" — set DEFAULT_TTL to a duration of at most MAX_TTL`);
  }
  if (defaultTtlSeconds !== null && maxTtlSeconds !== null && maxTtlSeconds < defaultTtlSeconds) {
    throw new ConfigError(`MAX_TTL (${maxTtlSeconds}s) must not be shorter than DEFAULT_TTL (${defaultTtlSeconds}s)`);
  }
  const maxFileSizeBytes = bytesFrom(env, "MAX_FILE_SIZE", DEFAULTS.MAX_FILE_SIZE);
  const maxInstanceSizeBytes = bytesFrom(env, "MAX_INSTANCE_SIZE", DEFAULTS.MAX_INSTANCE_SIZE);
  const padPath = padPathFrom(env);
  const pinLockoutSeconds = durationFrom(env, "PIN_LOCKOUT_SECONDS", DEFAULTS.PIN_LOCKOUT);
  if (pinLockoutSeconds <= 0) {
    throw new ConfigError(`PIN_LOCKOUT_SECONDS must be a positive duration, got "${env.PIN_LOCKOUT_SECONDS}"`);
  }
  const cleanupSweepSeconds = durationFrom(env, "CLEANUP_SWEEP_SECONDS", DEFAULTS.CLEANUP_SWEEP);
  if (cleanupSweepSeconds <= 0) {
    throw new ConfigError(`CLEANUP_SWEEP_SECONDS must be a positive duration, got "${env.CLEANUP_SWEEP_SECONDS}"`);
  }
  const rateLimitWindowSeconds = durationFrom(env, "RATE_LIMIT_WINDOW", DEFAULTS.RATE_LIMIT_WINDOW);
  if (rateLimitWindowSeconds <= 0) {
    throw new ConfigError(`RATE_LIMIT_WINDOW must be a positive duration, got "${env.RATE_LIMIT_WINDOW}"`);
  }
  const rateLimitMax = intFrom(env, "RATE_LIMIT_MAX", DEFAULTS.RATE_LIMIT_MAX, { min: 1, max: Number.MAX_SAFE_INTEGER });

  return Object.freeze({
    trustedProxies,
    port,
    baseUrl,
    dataDir,
    instancePin,
    defaultTtlSeconds,
    maxTtlSeconds,
    maxFileSizeBytes,
    maxInstanceSizeBytes,
    padPath,
    pinLockoutSeconds,
    cleanupSweepSeconds,
    rateLimitWindowSeconds,
    rateLimitMax,
  });
}

function stringFrom(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  return value;
}

function intFrom(env: NodeJS.ProcessEnv, name: string, fallback: number, bounds: { min: number; max: number }): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new ConfigError(`${name} must be an integer between ${bounds.min} and ${bounds.max}, got "${raw}"`);
  }
  return value;
}

function urlFrom(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = stringFrom(env, name, fallback);
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`unsupported protocol ${url.protocol}`);
    return raw;
  } catch (cause) {
    throw new ConfigError(`${name} must be an absolute http(s) URL, got "${raw}"`, { cause: cause instanceof Error ? cause : undefined });
  }
}

/**
 * Parses a size in bytes: a plain integer ("1048576") or suffixed
 * "KB"/"MB"/"GB" (binary units, 1024-based).
 */
function bytesFrom(env: NodeJS.ProcessEnv, name: string, fallback: string): number {
  const raw = stringFrom(env, name, fallback);
  const match = /^(\d+)(KB|MB|GB)?$/i.exec(raw);
  if (!match) {
    throw new ConfigError(`${name} must be a byte count like "1073741824" or "1GB", got "${raw}"`);
  }
  const value = Number(match[1]);
  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "KB" ? 1024 : suffix === "MB" ? 1024 ** 2 : suffix === "GB" ? 1024 ** 3 : 1;
  return value * multiplier;
}

/**
 * Parses a duration in seconds: a plain integer ("604800") or suffixed
 * "s"/"m"/"h"/"d" — always finite, never "never".
 */
function durationFrom(env: NodeJS.ProcessEnv, name: string, fallback: string): number {
  const raw = stringFrom(env, name, fallback);
  if (raw.toLowerCase() === "never") {
    throw new ConfigError(`${name} must be a duration like "1m" or a plain number of seconds, got "${raw}"`);
  }
  const match = /^(\d+)(s|m|h|d)?$/i.exec(raw);
  if (!match) {
    throw new ConfigError(`${name} must be a duration like "7d", "24h", "90s" or a plain number of seconds, got "${raw}"`);
  }
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier = unit === "m" ? 60 : unit === "h" ? 3_600 : unit === "d" ? 86_400 : 1;
  return value * multiplier;
}

/** Like durationFrom, but also accepts "never" (no expiry) and maps it to null. */
function optionalDurationFrom(env: NodeJS.ProcessEnv, name: string, fallback: string): number | null {
  const raw = stringFrom(env, name, fallback);
  if (raw.toLowerCase() === "never") return null;
  return durationFrom(env, name, raw);
}

function padPathFrom(env: NodeJS.ProcessEnv): string {
  const raw = stringFrom(env, "PAD_PATH", DEFAULTS.PAD_PATH);
  if (!raw.startsWith("/")) {
    throw new ConfigError(`PAD_PATH must start with "/", got "${raw}"`);
  }
  const normalized = raw !== "/" && raw.endsWith("/") ? raw.replace(/\/+$/, "") : raw;
  if (normalized === "/") {
    throw new ConfigError(`PAD_PATH "/" is reserved: the site root is the Default Pad's address`);
  }
  if (normalized === "/default") {
    throw new ConfigError('PAD_PATH "/default" is reserved for the fixed Pad');
  }
  return normalized;
}

function pinFrom(env: NodeJS.ProcessEnv): string | null {
  const raw = env.INSTANCE_PIN;
  if (raw === undefined || raw === "") return null; // default off: creation is open
  return raw;
}
