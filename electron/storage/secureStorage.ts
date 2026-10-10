/**
 * DewClient - Secure OS-Backed Credential Storage
 */

import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);

function getSafeStorage(): any {
  if (process.versions.electron) {
    try {
      const electron = require('electron');
      return electron.safeStorage || null;
    } catch {
      return null;
    }
  }
  return null;
}

const processFallbackKey = crypto.randomBytes(32);

export class SecureStorageService {
  public static isSafeStorageAvailable(): boolean {
    try {
      const ss = getSafeStorage();
      return Boolean(ss && ss.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  public static encrypt(plainText: string): string {
    if (!plainText) return '';

    const ss = getSafeStorage();
    if (ss && this.isSafeStorageAvailable()) {
      const encryptedBuffer = ss.encryptString(plainText);
      return `safe:${encryptedBuffer.toString('base64')}`;
    }

    if (process.versions.electron) {
      throw new Error('OS-backed secure storage is unavailable; refusing to persist credentials.');
    }

    const key = processFallbackKey;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `process:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('base64')}`;
  }

  public static decrypt(cipherText: string): string {
    if (!cipherText) return '';

    try {
      if (cipherText.startsWith('safe:')) {
        const ss = getSafeStorage();
        if (!ss) return '';
        const rawBase64 = cipherText.slice(5);
        const buf = Buffer.from(rawBase64, 'base64');
        return ss.decryptString(buf);
      }

      if (cipherText.startsWith('process:') && !process.versions.electron) {
        const parts = cipherText.split(':');
        if (parts.length !== 4) return '';

        const iv = Buffer.from(parts[1], 'hex');
        const tag = Buffer.from(parts[2], 'hex');
        const encrypted = Buffer.from(parts[3], 'base64');

        const decipher = crypto.createDecipheriv('aes-256-gcm', processFallbackKey, iv);
        decipher.setAuthTag(tag);
        return decipher.update(encrypted) + decipher.final('utf8');
      }

      // Legacy unrecognized format
      return '';
    } catch (err: any) {
      console.error('[SECURE-STORAGE] Decryption failed.');
      return '';
    }
  }
}
