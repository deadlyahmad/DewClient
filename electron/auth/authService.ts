/**
 * DewClient - Master Authentication Service
 */

import crypto from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type {
  UserAccount,
  MicrosoftAccount,
  OfflineProfile,
  DiscordAccount,
  AuthProgressStatus,
  EncryptedAccountTokens
} from '../../shared/types/account.ts';
import {
  validateUsername,
  normalizeUsername
} from '../../shared/schemas/validation.ts';
import { getAccountStorage } from '../storage/accountStorage.ts';
import { getSettingsStorage } from '../storage/settingsStorage.ts';
import { MicrosoftOAuthService } from './microsoftOAuthService.ts';
import { XboxLiveService } from './xboxLiveService.ts';
import { XSTSService } from './xstsService.ts';
import { MinecraftAuthService } from './minecraftAuthService.ts';
import { SessionService } from './sessionService.ts';
import { OfflineProfileService } from './offlineProfileService.ts';
import { getCosmeticStorage } from '../storage/cosmeticStorage.ts';
import { getLogger } from '../core/logger.ts';
import type { LocalCosmeticTexture } from '../../shared/types/account.ts';
import { resolveRemoteServerBaseUrl } from '../../shared/constants/defaults.ts';
import fs from 'node:fs';
import path from 'node:path';

export interface MinecraftLaunchAuth {
  uuid: string;
  accessToken: string;
  userType: 'msa' | 'legacy';
  verified: boolean;
}

export interface FreeCapeCatalogItem {
  assetId: string;
  sha256: string;
  name: string;
  kind: 'cape';
  width: number | null;
  height: number | null;
  byteSize: number;
  createdAt: string;
  claimed: boolean;
}

export interface DiscordCapeClaimCode {
  words: string[];
  expiresAt: string;
  discordInviteUrl: string;
  instruction: string;
  alreadyLinked?: boolean;
}

function isNetworkFailure(error: any, depth = 0): boolean {
  if (!error || depth > 4) return false;
  const code = String(error.code || '');
  if (/^(ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR|ERR_NETWORK)/i.test(code) || error.name === 'AbortError') return true;
  if (/^(TypeError|FetchError)$/.test(String(error.name || '')) && /(fetch|network|socket|connect)/i.test(String(error.message || ''))) return true;
  return isNetworkFailure(error.cause, depth + 1);
}

export class AuthService {
  private oauthService = new MicrosoftOAuthService();
  private xboxLiveService = new XboxLiveService();
  private xstsService = new XSTSService();
  private minecraftAuthService = new MinecraftAuthService();
  private sessionService = new SessionService();
  private offlineProfileService = new OfflineProfileService();
  private discordCallback?: { resolve: (ticket: string) => void; reject: (error: Error) => void };

  private rejectDiscordLogin(error: Error): void {
    const callback = this.discordCallback;
    callback?.reject(error);
  }

  public getAccounts(): UserAccount[] {
    return getAccountStorage().getAccounts();
  }

  public getActiveAccount(): UserAccount | null {
    return getAccountStorage().getActiveAccount();
  }

  public selectAccount(id: string): UserAccount | null {
    getAccountStorage().setActiveAccount(id);
    return this.getActiveAccount();
  }

  public removeAccount(id: string): void {
    getAccountStorage().removeAccount(id);
  }

  public updateAccount(id: string, partial: Partial<UserAccount>): UserAccount | null {
    return getAccountStorage().updateAccount(id, partial);
  }

  public createOfflineProfile(username: string): OfflineProfile {
    return this.offlineProfileService.createProfile(username);
  }

  public async startDiscordLogin(): Promise<{ ticket: string }> {
    if (this.discordCallback) throw new Error('A Discord sign-in is already in progress.');
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const startResponse = await fetch(`${baseUrl}/auth/discord/start`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000)
    });
    const startPayload = await startResponse.json().catch(() => ({}));
    const authorizationUrl = startPayload?.data?.authorizationUrl;
    if (!startResponse.ok || startPayload?.ok !== true || typeof authorizationUrl !== 'string') {
      throw new Error(startPayload?.error?.message || 'Discord sign-in is not configured on the account server yet.');
    }
    const parsed = new URL(authorizationUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'discord.com' || parsed.pathname !== '/oauth2/authorize') {
      throw new Error('The account server returned an unsafe Discord sign-in link.');
    }
    const shell = (globalThis as any).__DewClientElectronShell;
    if (!shell?.openExternal) throw new Error('The system browser could not be opened for Discord sign-in.');

    const result = new Promise<{ ticket: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.discordCallback) return;
        this.discordCallback = undefined;
        reject(new Error('Discord sign-in timed out. Return to DewClient and try again.'));
      }, 5 * 60 * 1000);
      this.discordCallback = {
        resolve: (ticket) => { clearTimeout(timeout); this.discordCallback = undefined; resolve({ ticket }); },
        reject: (error) => { clearTimeout(timeout); this.discordCallback = undefined; reject(error); }
      };
    });
    try {
      await shell.openExternal(authorizationUrl);
    } catch {
      this.rejectDiscordLogin(new Error('Discord sign-in could not be opened in your browser.'));
    }
    return result;
  }

  public acceptDiscordOAuthCallback(value: string): boolean {
    try {
      const url = new URL(value);
      if (url.protocol !== 'dewclient:' || url.hostname !== 'auth' || url.pathname !== '/discord') return false;
      const ticket = url.searchParams.get('ticket') || '';
      if (!/^[A-Za-z0-9_-]{40,64}$/.test(ticket) || !this.discordCallback) return false;
      this.discordCallback.resolve(ticket);
      return true;
    } catch { return false; }
  }

  public async completeDiscordLogin(ticket: string, username = ''): Promise<{ account?: DiscordAccount; requiresUsername?: boolean; suggestedUsername?: string; ticket?: string }> {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(ticket)) throw new Error('Discord sign-in expired. Start again.');
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const response = await fetch(`${baseUrl}/auth/discord/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ticket, ...(username ? { username: username.trim() } : {}) }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message || `Discord account sign-in failed (${response.status}).`);
    if (payload?.data?.requiresUsername === true) {
      return { requiresUsername: true, suggestedUsername: payload.data.suggestedUsername || '', ticket };
    }
    const auth = payload?.data;
    const user = auth?.user;
    const session = auth?.session;
    if (!user?.discordUserId || !user?.minecraftUuid || !session?.accessToken) {
      throw new Error('Discord returned an incomplete DewClient profile. Try signing in again.');
    }
    const account: DiscordAccount = {
      id: `discord-${user.discordUserId}`,
      dewAccountId: `discord:${user.discordUserId}`,
      authUserId: `discord:${user.discordUserId}`,
      discordUserId: user.discordUserId,
      username: user.username,
      uuid: user.minecraftUuid,
      minecraftUuid: user.minecraftUuid,
      accountType: 'discord',
      type: 'discord',
      avatarUrl: user.avatarUrl || undefined,
      createdAt: user.createdAt || new Date().toISOString(),
      lastUsernameChangeAt: user.lastUsernameChangeAt || new Date().toISOString(),
      nextUsernameChangeAt: user.nextUsernameChangeAt || null,
      lastUsedAt: new Date().toISOString()
    };
    getAccountStorage().saveAccount(account, {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken || session.accessToken,
      expiresAt: Number(session.expiresAt) || 0
    });
    getAccountStorage().setActiveAccount(account.id);
    return { account };
  }

  public async changeUsername(accountId: string, nextUsername: string): Promise<OfflineProfile | DiscordAccount> {
    const usernameResult = validateUsername(nextUsername);
    if (!usernameResult.valid) {
      throw new Error(usernameResult.error || 'Invalid username.');
    }

    const normalized = normalizeUsername(nextUsername);
    const storage = getAccountStorage();
    const account = storage.getAccounts().find((candidate) => candidate.id === accountId || candidate.uuid === accountId || candidate.dewAccountId === accountId);
    if (!account) {
      throw new Error('Account not found.');
    }

    if (account.type === 'discord') {
      const tokens = storage.getAccountTokens(account.id);
      if (!tokens?.accessToken || (tokens.expiresAt > 0 && tokens.expiresAt <= Date.now())) {
        throw new Error('Discord sign-in expired. Sign in with Discord again before changing your name.');
      }
      const settings = getSettingsStorage().getSettings();
      const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
      const response = await fetch(`${baseUrl}/auth/discord/change-username`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: nextUsername.trim() }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message || 'Your in-game name could not be changed.');
      const changed = payload.data;
      const updated = storage.updateAccount(account.id, {
        username: changed.user.username,
        uuid: changed.user.minecraftUuid,
        minecraftUuid: changed.user.minecraftUuid,
        lastUsernameChangeAt: changed.usernameChangedAt,
        nextUsernameChangeAt: changed.nextUsernameChangeAt
      } as Partial<UserAccount>);
      if (!updated) throw new Error('The updated account could not be saved on this device.');
      storage.saveAccount(updated, {
        accessToken: changed.session.accessToken,
        refreshToken: changed.session.refreshToken || changed.session.accessToken,
        expiresAt: Number(changed.session.expiresAt) || 0
      });
      return updated as DiscordAccount;
    }

    const lastChangedAt = account.lastUsernameChangeAt ? Date.parse(account.lastUsernameChangeAt) : 0;
    const cooldownMs = 30 * 24 * 60 * 60 * 1000;
    if (lastChangedAt && Date.now() - lastChangedAt < cooldownMs) {
      throw new Error('You cannot change your username yet.');
    }

    const duplicate = storage.getAccounts().some((candidate) => {
      if (candidate.id === account.id) return false;
      return normalizeUsername(candidate.username || '').toLowerCase() === normalized.toLowerCase();
    });
    if (duplicate) {
      throw new Error('Username already taken.');
    }

    const updated = storage.updateAccount(accountId, {
      username: normalized,
      lastUsernameChangeAt: new Date().toISOString(),
      usernameChangeCooldownUntil: new Date(Date.now() + cooldownMs).toISOString()
    });
    if (!updated) {
      throw new Error('Account not found.');
    }
    return updated as OfflineProfile;
  }

  public cancelMicrosoftLogin(): void {
    this.oauthService.cancel();
  }

  public async startMicrosoftLogin(
    parentWindow?: BrowserWindow | null,
    onProgress?: (status: AuthProgressStatus) => void
  ): Promise<MicrosoftAccount> {
    const logger = getLogger();
    logger.info('auth', 'Starting Microsoft authentication flow...');

    onProgress?.({
      step: 'opening_browser',
      message: 'Connecting to Microsoft Authentication...'
    });

    try {
      // 1. Interactive OAuth
      const oAuthTokens = await this.oauthService.loginInteractive(parentWindow, (step, message) => {
        onProgress?.({ step: step as any, message });
      });

      // 2. Xbox Live
      onProgress?.({
        step: 'xbox_live',
        message: 'Authenticating with Xbox Live...'
      });
      const xbl = await this.xboxLiveService.authenticate(oAuthTokens.accessToken);

      // 3. XSTS
      onProgress?.({
        step: 'xsts',
        message: 'Requesting security authorization (XSTS)...'
      });
      const xsts = await this.xstsService.authorize(xbl.token);

      // 4. Minecraft Services Login
      onProgress?.({
        step: 'session',
        message: 'Logging into Minecraft Services...'
      });
      const mcToken = await this.minecraftAuthService.loginWithXbox(xsts.userHash, xsts.token);

      // 5. Entitlements check
      await this.minecraftAuthService.checkEntitlements(mcToken.accessToken);

      // 6. Player Profile
      onProgress?.({
        step: 'profile',
        message: 'Loading player profile and skin...'
      });
      const profile = await this.minecraftAuthService.getProfile(mcToken.accessToken);

      // Format UUID with standard hyphens if 32 hex chars
      let uuid = profile.id;
      if (uuid.length === 32 && !uuid.includes('-')) {
        uuid = `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20, 32)}`;
      }

      const expiresAt = Date.now() + mcToken.expiresIn * 1000;
      const storage = getAccountStorage();
      const existingAccount = storage.getAccounts().find((candidate) =>
        candidate.type === 'microsoft' && (candidate.uuid === uuid || candidate.minecraftUuid === uuid)
      );
      const generatedDewAccountId = existingAccount?.dewAccountId || crypto.randomUUID();
      const account: MicrosoftAccount = {
        id: `ms-${generatedDewAccountId}`,
        dewAccountId: generatedDewAccountId,
        username: profile.name,
        uuid,
        minecraftUuid: uuid,
        type: 'microsoft',
        accountType: 'online',
        skinUrl: profile.skinUrl,
        capeUrl: profile.capeUrl,
        avatarUrl: `https://mc-heads.net/avatar/${encodeURIComponent(profile.name)}/64`,
        hasActiveSession: true,
        expiresAt,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString()
      };

      const cosmeticStorage = getCosmeticStorage();
      const accountCosmetics = { ...(existingAccount?.cosmetics || {}) };
      const importOfficialTexture = async (kind: 'skin' | 'cape', textureUrl?: string): Promise<string | undefined> => {
        const sourceKey = kind === 'skin' ? 'skinSource' : 'capeSource';
        const pathKey = kind === 'skin' ? 'skinAssetPath' : 'capeAssetPath';
        const directPath = kind === 'skin' ? existingAccount?.skinAssetPath : existingAccount?.capeAssetPath;
        const previousPath = directPath || accountCosmetics[pathKey];
        const previousSource = accountCosmetics[sourceKey];
        if (previousSource === 'custom' || (!previousSource && previousPath)) {
          accountCosmetics[sourceKey] = 'custom';
          accountCosmetics[pathKey] = previousPath;
          return previousPath;
        }

        accountCosmetics[sourceKey] = 'official';
        if (!textureUrl) {
          if (previousSource === 'official') cosmeticStorage.remove(account.id, kind);
          accountCosmetics[pathKey] = undefined;
          return undefined;
        }

        try {
          const texture = new URL(textureUrl);
          if (!['http:', 'https:'].includes(texture.protocol) || texture.hostname !== 'textures.minecraft.net' || !/^\/texture\/[a-f0-9]{32,64}$/i.test(texture.pathname)) {
            throw new Error('Minecraft returned an unexpected texture URL.');
          }
          texture.protocol = 'https:';
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);
          let response: Response;
          try {
            response = await fetch(texture, { signal: controller.signal, redirect: 'error' });
          } finally {
            clearTimeout(timeout);
          }
          if (!response.ok) throw new Error(`Texture download returned HTTP ${response.status}.`);
          const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
          const extension = contentType === 'image/png' ? '.png'
            : contentType === 'image/jpeg' ? '.jpg'
              : contentType === 'image/webp' ? '.webp' : '';
          if (!extension) throw new Error('Minecraft returned an unsupported texture format.');
          const bytes = Buffer.from(await response.arrayBuffer());
          const stored = cosmeticStorage.saveBuffer(account.id, kind, bytes, extension);
          accountCosmetics[pathKey] = stored.path;
          return stored.path;
        } catch (error: any) {
          getLogger().warn('auth', `Could not cache the official ${kind} texture: ${error?.message || error}`);
          accountCosmetics[pathKey] = previousPath;
          return previousPath;
        }
      };

      account.skinAssetPath = await importOfficialTexture('skin', profile.skinUrl);
      account.capeAssetPath = await importOfficialTexture('cape', profile.capeUrl);
      account.cosmetics = accountCosmetics;

      const encryptedTokens: EncryptedAccountTokens = {
        accessToken: mcToken.accessToken,
        refreshToken: oAuthTokens.refreshToken || '',
        expiresAt,
        msalAccountId: oAuthTokens.msalAccountId
      };

      storage.saveAccount(account, encryptedTokens);
      storage.setActiveAccount(account.id);
      await this.syncOfficialCapes(account, profile.capes).catch((error: any) => {
        logger.warn('auth', `Could not cache official Minecraft capes: ${error?.message || error}`);
      });

      // Immediately sync active account to central server
      try {
        const { getHeartbeatService } = await import('../remote/heartbeatService.ts');
        getHeartbeatService().sendHeartbeat().catch(() => {});
      } catch {}
      import('../remote/cosmeticsSyncService.ts')
        .then(({ getCosmeticsSyncService }) => getCosmeticsSyncService().scheduleSync())
        .catch(() => {});

      onProgress?.({
        step: 'complete',
        message: `Successfully signed in as ${profile.name}!`
      });

      logger.info('auth', `Microsoft login completed successfully for ${profile.name} (${uuid})`);
      return account;
    } catch (err: any) {
      logger.error('auth', 'Microsoft login error:', err.message);
      onProgress?.({
        step: 'error',
        message: err.message,
        error: err.message
      });
      throw err;
    }
  }

  public async getValidTokenForAccount(account: UserAccount): Promise<string> {
    if (account.type !== 'microsoft') {
      return '0';
    }
    return this.sessionService.getValidMinecraftToken(account as MicrosoftAccount);
  }

  public async getLaunchAuth(account: UserAccount): Promise<MinecraftLaunchAuth> {
    if (account.type !== 'microsoft') {
      return { uuid: account.uuid, accessToken: '0', userType: 'legacy', verified: false };
    }

    try {
      const accessToken = await this.getValidTokenForAccount(account);
      const profile = await this.minecraftAuthService.getProfile(accessToken);
      const normalizedProfileId = profile.id.replace(/-/g, '').toLowerCase();
      if (normalizedProfileId !== account.uuid.replace(/-/g, '').toLowerCase()) {
        throw new Error('Minecraft returned a different profile for this account. Sign in again to continue.');
      }
      await this.syncOfficialCapes(account, profile.capes);
      return { uuid: account.uuid, accessToken, userType: 'msa', verified: true };
    } catch (error: any) {
      if (!isNetworkFailure(error)) throw error;
      getLogger().warn('auth', `Minecraft profile verification is unavailable; launching ${account.username} as an unverified offline session.`);
      return {
        uuid: this.offlineProfileService.generateOfflineUuid(account.username),
        accessToken: '0',
        userType: 'legacy',
        verified: false
      };
    }
  }

  public async getFreeCapeCatalog(accountId?: string): Promise<{ items: FreeCapeCatalogItem[]; identityRequired: string | null; discordLinked: boolean; selectedCapeAssetId: string | null }> {
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (accountId) Object.assign(headers, (await this.getVerifiedCapeClaimAccount(accountId)).headers);
    const response = await fetch(`${baseUrl}/cosmetics/free`, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(12_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload.data)) {
      throw new Error(payload?.error?.message || 'Could not load free capes from DewClient.');
    }
    return {
      items: payload.data,
      identityRequired: typeof payload.identityRequired === 'string' ? payload.identityRequired : null,
      discordLinked: payload.discordLinked === true,
      selectedCapeAssetId: typeof payload.selectedCapeAssetId === 'string' ? payload.selectedCapeAssetId.toLowerCase() : null
    };
  }

  public async getFreeCapePreview(_accountId: string, assetId: string, expectedSha256: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/i.test(assetId) || !/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new Error('This cape preview reference is invalid.');
    const catalog = await this.getFreeCapeCatalog();
    const cape = catalog.items.find((item) => item.assetId === assetId && item.sha256 === expectedSha256);
    if (!cape) throw new Error('This free cape is no longer published. Refresh the catalog and try again.');
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const response = await fetch(`${baseUrl}/cosmetics/free/${assetId}/preview`, {
      headers: { Accept: 'image/png' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Free cape preview could not be loaded (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 50 * 1024 * 1024 || crypto.createHash('sha256').update(bytes).digest('hex') !== expectedSha256.toLowerCase()) {
      throw new Error('Free cape preview failed its size or integrity check.');
    }
    return `data:image/png;base64,${bytes.toString('base64')}`;
  }

  public async createDiscordCapeClaimCode(accountId: string, assetId?: string): Promise<DiscordCapeClaimCode> {
    if (assetId && !/^[a-f0-9]{64}$/i.test(assetId)) throw new Error('Choose a valid free cape first.');
    const { account, headers } = await this.getVerifiedCapeClaimAccount(accountId);
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const response = await fetch(`${baseUrl}/cosmetics/free-claims/link-code`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(assetId ? { assetId } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true || (!payload?.data?.alreadyLinked && (!Array.isArray(payload?.data?.words) || payload.data.words.length !== 16))) {
      throw new Error(payload?.error?.message || `Could not create the Discord link code for ${account.username}.`);
    }
    return payload.data as DiscordCapeClaimCode;
  }

  public async getDiscordCapeClaimStatus(accountId: string): Promise<{ playerUuid: string; claimedAssetIds: string[]; discordLinked: boolean; discordLinkedAt: string | null; discordUsername: string | null; discordDisplayName: string | null }> {
    const { headers } = await this.getVerifiedCapeClaimAccount(accountId);
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const response = await fetch(`${baseUrl}/cosmetics/free-claims/status`, {
      headers: { ...headers, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload?.data?.claimedAssetIds)) {
      throw new Error(payload?.error?.message || 'Could not refresh your free cape claim status.');
    }
    return { ...payload.data, discordLinked: payload.data.discordLinked === true, discordLinkedAt: payload.data.discordLinkedAt || null, discordUsername: payload.data.discordUsername || null, discordDisplayName: payload.data.discordDisplayName || null };
  }

  public async claimFreeCape(accountId: string, assetId: string): Promise<{ claimed: boolean; requiresLink: boolean; alreadyClaimed: boolean; equipped?: boolean; selectedCapeAssetId?: string | null; message?: string }> {
    if (!/^[a-f0-9]{64}$/i.test(assetId)) throw new Error('Choose a valid free cape first.');
    const { headers } = await this.getVerifiedCapeClaimAccount(accountId);
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const response = await fetch(`${baseUrl}/cosmetics/free-claims/claim`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ assetId }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409 && payload?.error?.code === 'DISCORD_LINK_REQUIRED') {
      return { claimed: false, requiresLink: true, alreadyClaimed: false, message: payload.error.message };
    }
    if (!response.ok || payload?.ok !== true || payload?.data?.claimed !== true) {
      throw new Error(payload?.error?.message || 'The free cape could not be claimed.');
    }
    return {
      claimed: true,
      requiresLink: false,
      alreadyClaimed: payload.data.alreadyClaimed === true,
      equipped: payload.data.equipped === true,
      selectedCapeAssetId: typeof payload.data.selectedCapeAssetId === 'string' ? payload.data.selectedCapeAssetId : null
    };
  }

  public async equipFreeCape(accountId: string, assetId: string | null): Promise<{ equipped: boolean; cleared: boolean; selectedCapeAssetId: string | null }> {
    if (assetId !== null && !/^[a-f0-9]{64}$/i.test(assetId)) throw new Error('Choose a valid cape from your collection.');
    const { headers } = await this.getVerifiedCapeClaimAccount(accountId);
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const response = await fetch(`${baseUrl}/cosmetics/free-claims/equip`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ assetId }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true || !(payload?.data?.equipped === true || (assetId === null && payload?.data?.cleared === true))) {
      throw new Error(payload?.error?.message || 'The cape could not be equipped. Refresh your collection and try again.');
    }
    return {
      equipped: payload.data.equipped === true,
      cleared: payload.data.cleared === true,
      selectedCapeAssetId: typeof payload.data.selectedCapeAssetId === 'string' ? payload.data.selectedCapeAssetId.toLowerCase() : null
    };
  }

  private async getVerifiedCapeClaimAccount(accountId: string): Promise<{ account: UserAccount; headers: Record<string, string> }> {
    const account = this.getAccounts().find((candidate) => candidate.id === accountId || candidate.uuid === accountId);
    if (!account) throw new Error('Choose an account that is signed in to DewClient.');
    if (account.type === 'microsoft') {
      const minecraftAccessToken = await this.getValidTokenForAccount(account);
      if (!minecraftAccessToken || minecraftAccessToken === '0') throw new Error('Sign in to a Microsoft Minecraft account to claim a cape.');
      return { account, headers: { 'x-minecraft-access-token': minecraftAccessToken } };
    }
    if (account.type !== 'discord' && (account.accountType !== 'dew' || !account.authUserId)) {
      throw new Error('Free capes require a signed-in Microsoft, Dew, or Discord account. Offline profiles are not eligible.');
    }
    const tokens = getAccountStorage().getAccountTokens(account.id);
    if (!tokens?.accessToken || (tokens.expiresAt > 0 && tokens.expiresAt <= Date.now())) {
      throw new Error('Your Dew account session expired. Sign in to your Dew account again, then retry.');
    }
    return { account, headers: { Authorization: `Bearer ${tokens.accessToken}` } };
  }

  public async refreshOfficialCapes(accountId: string): Promise<UserAccount | null> {
    if (typeof accountId !== 'string' || !accountId) throw new Error('Select a Microsoft account first.');
    const account = getAccountStorage().getAccounts().find((candidate) => candidate.id === accountId);
    if (!account) throw new Error('This player account is no longer available.');
    if (account.type !== 'microsoft') return account;

    const accessToken = await this.getValidTokenForAccount(account);
    const profile = await this.minecraftAuthService.getProfile(accessToken);
    if (profile.id.replace(/-/g, '').toLowerCase() !== account.uuid.replace(/-/g, '').toLowerCase()) {
      throw new Error('Microsoft returned a different Minecraft profile. Sign in to this account again.');
    }
    await this.syncOfficialCapes(account, profile.capes);
    return getAccountStorage().getAccounts().find((candidate) => candidate.id === accountId) || account;
  }

  private async syncOfficialCapes(account: UserAccount, profileCapes: Array<{ id: string; state: string; url: string; alias?: string }>): Promise<void> {
    const storage = getAccountStorage();
    const current = storage.getAccounts().find((candidate) => candidate.id === account.id) || account;
    const cosmeticStorage = getCosmeticStorage();
    const existingCapes = current.cosmetics?.officialCapes || [];
    const officialCapes: LocalCosmeticTexture[] = [];
    let activeCape: LocalCosmeticTexture | null = null;

    for (const cape of Array.isArray(profileCapes) ? profileCapes : []) {
      if (!cape?.id || !cape?.url) continue;
      try {
        let stored = existingCapes.find((entry) => entry.id === cape.id && fs.existsSync(entry.assetPath));
        if (!stored) {
          const texture = new URL(cape.url);
          if (!['http:', 'https:'].includes(texture.protocol) || texture.hostname !== 'textures.minecraft.net' || !/^\/texture\/[a-f0-9]{32,64}$/i.test(texture.pathname)) {
            throw new Error('Minecraft returned an unexpected cape texture URL.');
          }
          texture.protocol = 'https:';
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);
          let response: Response;
          try {
            response = await fetch(texture, { signal: controller.signal, redirect: 'error' });
          } finally {
            clearTimeout(timeout);
          }
          if (!response.ok) throw new Error(`Cape download returned HTTP ${response.status}.`);
          const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
          const extension = contentType === 'image/png' ? '.png'
            : contentType === 'image/jpeg' ? '.jpg'
              : contentType === 'image/webp' ? '.webp' : '';
          if (!extension) throw new Error('Minecraft returned an unsupported cape format.');
          const saved = cosmeticStorage.saveOfficialCape(account.id, cape.id, Buffer.from(await response.arrayBuffer()), extension);
          stored = { id: cape.id, name: cape.alias || 'Minecraft Cape', assetPath: saved.path, previewUrl: saved.previewUrl };
        }
        const listedCape = { ...stored, name: cape.alias || stored.name || 'Minecraft Cape', active: cape.state === 'ACTIVE' };
        officialCapes.push(listedCape);
        if (listedCape.active) activeCape = listedCape;
      } catch (error: any) {
        getLogger().warn('auth', `Could not cache official Minecraft cape ${cape.id}: ${error?.message || error}`);
      }
    }

    const previousCosmetics = current.cosmetics || {};
    const nextCosmetics = { ...previousCosmetics, officialCapes };
    let capeAssetPath = current.capeAssetPath || previousCosmetics.capeAssetPath;
    if (previousCosmetics.capeSource !== 'custom') {
      if (activeCape && fs.existsSync(activeCape.assetPath)) {
        const extension = path.extname(activeCape.assetPath);
        capeAssetPath = cosmeticStorage.saveBuffer(account.id, 'cape', fs.readFileSync(activeCape.assetPath), extension).path;
      } else {
        cosmeticStorage.remove(account.id, 'cape');
        capeAssetPath = undefined;
      }
      nextCosmetics.capeAssetPath = capeAssetPath;
      nextCosmetics.capeSource = 'official';
    }

    storage.updateAccount(account.id, {
      capeUrl: profileCapes.find((cape) => cape.state === 'ACTIVE')?.url,
      capeAssetPath,
      cosmetics: nextCosmetics
    });
  }
}

let authServiceInstance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!authServiceInstance) {
    authServiceInstance = new AuthService();
  }
  return authServiceInstance;
}
