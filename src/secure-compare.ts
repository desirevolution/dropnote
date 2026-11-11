/**
 * Secret comparisons: digested to fixed-length hashes first so the
 * comparison itself runs in constant time and leaks neither content
 * nor length.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** Compares two strings in constant time (SHA-256 digests, timingSafeEqual). */
export function secureEquals(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
