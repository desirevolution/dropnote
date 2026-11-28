export interface ReferenceCacheEntry {
  key?: Uint8Array | null;
  salt?: string;
  name: string;
  files: { blobId: string; name: string }[];
}
export interface ReferenceCache {
  key(id: string, salt?: string): Uint8Array | undefined;
  name(id: string, blobId?: string): string | undefined;
  put(id: string, entry: ReferenceCacheEntry): void;
  invalidate(id: string): void;
  clear(): void;
}
export function createReferenceCache(options?: { maxSpaces?: number; maxFiles?: number; maxAgeMs?: number; now?: () => number }): ReferenceCache;
