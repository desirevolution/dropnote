/**
 * Always-on rate limiting (ticket 06): a fixed-window counter per client IP
 * throttles the requests an attacker can automate — Slug guessing (Pad reads
 * under the public Pad path), Pad creation and Attachment uploads. The site
 * itself (the Default Pad's page, static assets) and Live-Sync, which does
 * not pass through the HTTP middleware, are not counted. Window and limit
 * are env-configurable (RATE_LIMIT_WINDOW, RATE_LIMIT_MAX); the limiter
 * itself has no off switch.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface RateLimitOptions {
  /** Fixed window length in milliseconds. */
  windowMs: number;
  /** Maximum counted requests per client IP per window. */
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Beyond this many tracked clients, expired buckets are swept on the next hit. */
const MAX_TRACKED_CLIENTS = 65_536;

/**
 * Counts requests per client IP inside a fixed window. When the window
 * rolls over, the client's budget is whole again; expired buckets are
 * reused and swept so a public instance cannot grow the map without bound.
 */
export class RateLimitCounter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #windowMs: number;
  readonly #max: number;

  constructor(options: RateLimitOptions) {
    this.#windowMs = options.windowMs;
    this.#max = options.max;
  }

  /** Records one request; answers whether it may proceed and how long to wait. */
  hit(key: string, now: number = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    let bucket = this.#buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.#windowMs };
      this.#buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (this.#buckets.size > MAX_TRACKED_CLIENTS) this.#sweep(now);
    const allowed = bucket.count <= this.#max;
    return { allowed, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)) };
  }

  #sweep(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key);
    }
  }
}

/**
 * Express middleware over a shared counter. `counts` decides which requests
 * spend budget (requests that do not count pass straight through); two
 * middlewares over one counter give the routes of one instance a shared
 * per-client budget.
 */
export function rateLimiter(
  counter: RateLimitCounter,
  options: { counts?: (req: Request) => boolean } = {},
): RequestHandler {
  const counts = options.counts ?? (() => true);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!counts(req)) {
      next();
      return;
    }
    const verdict = counter.hit(clientIpOf(req));
    if (verdict.allowed) {
      next();
      return;
    }
    // A rejected request's body (e.g. an in-flight upload) must not keep
    // flowing into a socket nobody reads: stop reading and drop the
    // connection once the answer is out.
    req.pause();
    res
      .status(429)
      .set("retry-after", String(verdict.retryAfterSeconds))
      .json({ error: `Too many requests from your address — retry after ${verdict.retryAfterSeconds}s` });
    res.once("finish", () => req.destroy());
  };
}

/**
 * The client address a request arrived from — the one semantic used for
 * BOTH rate limiting and PIN lockout: `req.ip`, so Express's trust-proxy
 * setting decides whether a forwarded-for header may be believed. With no
 * proxy configured (the default), that is the raw socket address, which
 * cannot be spoofed by headers; an operator who fronts the instance with a
 * trusted proxy opts into real client IPs by setting `trust proxy`.
 * Per-socket fallbacks are deliberately not used, so both mechanisms always
 * count the same address.
 */
export function clientIpOf(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}
