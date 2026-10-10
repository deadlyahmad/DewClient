/**
 * DewClient - Persistent MSAL Node token cache
 *
 * MSAL Node keeps its token cache in memory by default. Desktop applications
 * should persist the cache securely so silent token acquisition can survive
 * process restarts. The cache is encrypted with Electron safeStorage when
 * available, with DewClient's existing encrypted-storage fallback otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { SecureStorageService } from '../storage/secureStorage.ts';
import { getPathManager } from '../storage/paths.ts';

const require = createRequire(import.meta.url);

let cachePath: string | null = null;

function getCachePath(): string {
  if (!cachePath) {
    if (process.versions.electron) {
      try {
        const electron = require('electron');
        const electronApp = electron?.app || electron?.default?.app;
        if (electronApp && typeof electronApp.getPath === 'function') {
          cachePath = path.join(electronApp.getPath('userData'), 'msal-token-cache.dat');
        }
      } catch {}
    }
    if (!cachePath) {
      cachePath = path.join(getPathManager().getConfigPath(), 'msal-token-cache.dat');
    }
  }
  return cachePath;
}

function writeAtomically(filePath: string, contents: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

export const msalCachePlugin: ICachePlugin = {
  async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    const filePath = getCachePath();

    try {
      if (!fs.existsSync(filePath)) return;

      const encrypted = fs.readFileSync(filePath, 'utf8');
      const serialized = SecureStorageService.decrypt(encrypted);
      if (!serialized) return;

      cacheContext.tokenCache.deserialize(serialized);
    } catch {
      // A corrupt/incompatible cache must not prevent a fresh interactive login.
      try {
        fs.rmSync(filePath, { force: true });
      } catch {}
    }
  },

  async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (!cacheContext.cacheHasChanged) return;

    const serialized = cacheContext.tokenCache.serialize();
    const encrypted = SecureStorageService.encrypt(serialized);
    if (!encrypted) return;

    writeAtomically(getCachePath(), encrypted);
  }
};
