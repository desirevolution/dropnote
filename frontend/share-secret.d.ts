export function secretLink(url: string, passphrase: string): string;
export function openCreatedSpace(pad: { path: string; createdAt: string }, passphrase: string | null): void;
export function consumeOpeningSecret(
  metadata: { encrypted: boolean; createdAt: string },
  fragment?: string | null,
): { passphrase: string; created: boolean } | null;
