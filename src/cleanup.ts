/**
 * The cleanup sweep (spec: TTL and cleanup): on a fixed interval it deletes
 * every Pad whose TTL has ended, together with all of its files. The
 * interval comes from the environment (CLEANUP_SWEEP_SECONDS) so tests can
 * run it fast instead of sleeping.
 */
import type { PadStore } from "./store.ts";

export interface CleanupSweep {
  /** Deletes every expired Pad right now; returns the deleted Slugs. */
  runOnce(now?: Date): Promise<string[]>;
  /** Stops the periodic sweep. */
  stop(): void;
}

export function startCleanupSweep(options: {
  store: PadStore;
  intervalMs: number;
  /** Notified before each Pad's files go — e.g. the relay drops its room. */
  onPadDeleted?: (slug: string) => Promise<void> | void;
}): CleanupSweep {
  const runOnce = async (now: Date = new Date()): Promise<string[]> => {
    const deleted: string[] = [];
    for (const pad of options.store.expiredPads(now)) {
      const current = options.store.getPad(pad.slug);
      if (current?.expiresAt && Date.parse(current.expiresAt) <= +now &&
          await options.store.removePad(pad.slug, options.onPadDeleted)) {
        deleted.push(pad.slug);
      }
    }
    return deleted;
  };

  const timer = setInterval(() => {
    void runOnce().catch((cause) => {
      // A failed sweep tick must not take the server down; the next tick retries.
      console.error("cleanup sweep failed:", cause);
    });
  }, options.intervalMs);
  timer.unref(); // a pending sweep never keeps the process alive

  return {
    runOnce,
    stop: () => clearInterval(timer),
  };
}
