import crypto from 'node:crypto';
import { CONFIG } from '../config.mjs';

const MAGIC = Buffer.from('DCA1', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
export const ENCRYPTED_COSMETIC_CONTENT_TYPE = 'application/vnd.dewclient.cosmetic-encrypted';

export function encryptedCosmeticContentType(contentType) {
  return `${ENCRYPTED_COSMETIC_CONTENT_TYPE}+${contentType === 'image/jpeg' ? 'jpeg' : 'png'}`;
}

export function decryptedCosmeticContentType(contentType) {
  if (String(contentType || '').endsWith('+jpeg')) return 'image/jpeg';
  if (String(contentType || '').endsWith('+png')) return 'image/png';
  return String(contentType || '').startsWith('image/') ? contentType : 'image/png';
}

function encryptionKey() {
  const value = CONFIG.COSMETIC_ASSET_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('COSMETIC_ASSET_ENCRYPTION_KEY must be a 32-byte (64 hexadecimal character) key.');
  }
  return Buffer.from(value, 'hex');
}

export function isEncryptedCosmeticAsset(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  return buffer.length >= MAGIC.length + NONCE_BYTES + TAG_BYTES && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Encrypt texture bytes before they are persisted in the Supabase asset table. */
export function encryptCosmeticAsset(value) {
  const plaintext = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (isEncryptedCosmeticAsset(plaintext)) return plaintext;

  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}

/** Decrypt server-stored texture bytes immediately before authorized delivery. */
export function decryptCosmeticAsset(value) {
  const envelope = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!isEncryptedCosmeticAsset(envelope)) return envelope;

  const offset = MAGIC.length;
  const nonce = envelope.subarray(offset, offset + NONCE_BYTES);
  const tag = envelope.subarray(offset + NONCE_BYTES, offset + NONCE_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(offset + NONCE_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
