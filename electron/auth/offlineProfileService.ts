/**
 * DewClient - Offline Profile Service
 */

import crypto from 'node:crypto';
import type { OfflineProfile } from '../../shared/types/account.ts';
import { validateUsername } from '../../shared/schemas/validation.ts';
import { getAccountStorage, type AccountStorage } from '../storage/accountStorage.ts';
import { getLogger } from '../core/logger.ts';

export function generateStableDewAccountId(): string {
  return crypto.randomUUID();
}

export class OfflineProfileService {
  private readonly accountStorage: Pick<AccountStorage, 'saveAccount' | 'setActiveAccount'>;

  constructor(accountStorage: Pick<AccountStorage, 'saveAccount' | 'setActiveAccount'> = getAccountStorage()) {
    this.accountStorage = accountStorage;
  }

  /**
   * Generates standard Mojang deterministic offline player UUID (v3 UUID from MD5)
   */
  public generateOfflineUuid(username: string): string {
    const md5 = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest();
    // Set version to 3 (0011)
    md5[6] = (md5[6] & 0x0f) | 0x30;
    // Set variant to IETF (10xx)
    md5[8] = (md5[8] & 0x3f) | 0x80;

    const hex = md5.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  public createProfile(username: string, accountType: 'offline' | 'dew' = 'offline'): OfflineProfile {
    const valRes = validateUsername(username);
    if (!valRes.valid) {
      throw new Error(valRes.error || 'Invalid username.');
    }

    const trimmed = username.trim();
    const dewAccountId = generateStableDewAccountId();
    const vanillaOfflineUuid = this.generateOfflineUuid(trimmed);
    const now = new Date().toISOString();

    const profile: OfflineProfile = {
      id: `offline-${dewAccountId}`,
      dewAccountId,
      username: trimmed,
      uuid: vanillaOfflineUuid,
      minecraftUuid: vanillaOfflineUuid,
      type: 'offline',
      accountType,
      avatarUrl: `https://mc-heads.net/avatar/${encodeURIComponent(trimmed)}/64`,
      createdAt: now,
      lastUsedAt: now
    };

    this.accountStorage.saveAccount(profile);
    this.accountStorage.setActiveAccount(profile.id);

    // Immediately sync account to central server
    try {
      import('../remote/heartbeatService.ts').then(({ getHeartbeatService }) => {
        getHeartbeatService().sendHeartbeat().catch(() => {});
      }).catch(() => {});
    } catch {}
    import('../remote/cosmeticsSyncService.ts')
      .then(({ getCosmeticsSyncService }) => getCosmeticsSyncService().scheduleSync())
      .catch(() => {});

    getLogger().info('auth', `Created and activated offline profile for ${trimmed} (${dewAccountId})`);
    return profile;
  }
}
