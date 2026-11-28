import type { ReferenceCache } from "./reference-cache.js";
export interface ReferenceTarget {
  spaceId: string;
  slug: string;
  path: string;
  displayName: string | null;
  encrypted: boolean;
  encryption?: { salt: string; check: string };
}
export interface ReferenceFile { blobId: string; name: string; size: number; contentType: string; addedAt?: string }
export interface ReferenceReplay { spaceId: string; updates: string[]; blobIds: string[] }
export interface ReferenceOptions { signal?: AbortSignal; unlock?: (target: ReferenceTarget, signal: AbortSignal) => Promise<string | null> }
export interface ReferenceTransferContext { slug: string; spaceId: string; key?: Uint8Array | null; proof?: string; signal: AbortSignal }
export class ReferenceAccessError extends Error { constructor(code: string, message: string); code: string }
export function replayReferenceFiles(replay: ReferenceReplay, key: Uint8Array | null | undefined, signal: AbortSignal): Promise<ReferenceFile[]>;
export function createReferenceFiles(options?: { request?: typeof fetch; cache?: ReferenceCache; replayFiles?: typeof replayReferenceFiles }): {
  browse(id: string, options?: ReferenceOptions): Promise<{ target: ReferenceTarget; files: ReferenceFile[] }>;
  open<T>(id: string, blobId: string, options: ReferenceOptions, transfer: (file: ReferenceFile, context: ReferenceTransferContext) => Promise<T>): Promise<T>;
  name(id: string, blobId?: string): string | undefined;
  invalidate(id: string): void;
  clear(): void;
};
