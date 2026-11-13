/** One remembered Pad: its Share Link — deliberately never a Key. */
export interface MyPadEntry {
  slug: string;
  displayName?: string | null;
  url: string;
  encrypted: boolean;
  createdAt: string;
  expiresAt: string | null;
  createdHere?: boolean;
  sharedBy?: string;
  canEdit?: boolean;
}

/** The localStorage key the list lives under. */
export const STORAGE_KEY: string;

/** Reads the remembered Pads; anything unreadable counts as an empty list. */
export function listMyPads(storage: Storage): MyPadEntry[];

/** Adds one entry (deduplicated by Share Link); returns the new list. */
export function addMyPad(storage: Storage, entry: MyPadEntry): MyPadEntry[];

/** Removes the entry with the given Share Link; returns the new list. */
export function removeMyPad(storage: Storage, url: string, createdAt?: string): MyPadEntry[];

/** Clears bookmarks while keeping spaces created here and the selected start page. */
export function clearMyPads(storage: Storage, keepUrl?: string): MyPadEntry[];
