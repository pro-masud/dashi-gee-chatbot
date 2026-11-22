import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption for integration credentials stored in the database (AES-256-GCM).
 * The key comes from the INTEGRATION_SECRET_KEY environment variable (>= 32 characters) and is never
 * stored. Without the key, saving a credential is refused rather than stored in plain text.
 */

export class SecretsKeyMissingError extends Error {
  readonly code = 'secrets_key_missing';
  constructor() {
    super('INTEGRATION_SECRET_KEY (at least 32 characters) is not configured on the server.');
    this.name = 'SecretsKeyMissingError';
  }
}

function getKey(): Buffer {
  const raw = (process.env.INTEGRATION_SECRET_KEY || '').trim();
  if (raw.length < 32) throw new SecretsKeyMissingError();
  return createHash('sha256').update(raw).digest();
}

export function isSecretsKeyConfigured(): boolean {
  return (process.env.INTEGRATION_SECRET_KEY || '').trim().length >= 32;
}

/** Output format: v1.<iv>.<tag>.<ciphertext> (all base64url). */
export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const [v, iv, tag, data] = String(payload || '').split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** Safe hint for the UI: never reveals more than the last 4 characters. */
export function maskSecret(plain: string): string {
  const t = String(plain || '');
  return t.length <= 8 ? '••••' : `••••${t.slice(-4)}`;
}
