import {
  createCipheriv, createDecipheriv, createHash, randomBytes,
} from 'node:crypto';
import { config } from '../config/env.js';

const KEY = config.integrations.encryptionKey;

function encryptionKey() {
  if (!/^[a-f0-9]{64}$/i.test(KEY)) {
    throw new Error('INTEGRATIONS_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters.');
  }
  return Buffer.from(KEY, 'hex');
}

export function encryptSecret(value) {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(value) {
  if (!value) return null;
  const [ivText, tagText, dataText] = value.split('.');
  if (!ivText || !tagText || !dataText) throw new Error('Stored integration credential is malformed.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const createOAuthState = () => randomBytes(32).toString('base64url');

export async function providerFetch(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || `Provider request failed (${response.status}).`;
    const error = new Error(String(message));
    error.status = response.status;
    throw error;
  }
  return data;
}
