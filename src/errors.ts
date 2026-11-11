/**
 * Shared helpers for dealing with thrown values of unknown type: one place
 * turns them into messages, one recognizes the common "file not found" case.
 */

/** The message of a thrown value: an Error's message, or its string form. */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Whether a thrown value is Node's "file not found" error (ENOENT). */
export function isNotFound(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && (cause as { code?: string }).code === "ENOENT";
}
