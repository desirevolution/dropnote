export interface EncryptionParameters {
  salt: string;
  check: string;
  proofHash: string;
}
export function derivePadKey(passphrase: string, salt: string): Promise<Uint8Array>;
export function padProof(key: Uint8Array): Promise<string>;
export function presenceKey(key: Uint8Array): Promise<Uint8Array>;
export function createEncryption(passphrase: string): Promise<EncryptionParameters>;
export function verifyPadKey(key: Uint8Array, check: string): Promise<boolean>;
export const passwordCharacters: string;
export function unlockPadKey(passphrase: string, encryption: Pick<EncryptionParameters, "salt" | "check">): Promise<Uint8Array | null>;
