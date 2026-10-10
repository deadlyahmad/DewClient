/**
 * DewClient - Active-account cosmetics publisher for the public manifest API.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UserAccount } from '../../shared/types/account.ts';
import { getClientIdentityService } from './clientIdentityService.ts';
import { getHeartbeatService } from './heartbeatService.ts';
import { getLogger } from '../core/logger.ts';
import { getPathManager } from '../storage/paths.ts';
import { getAccountStorage } from '../storage/accountStorage.ts';
import { getSettingsStorage } from '../storage/settingsStorage.ts';
import { validateCosmeticImage } from '../storage/cosmeticStorage.ts';
import { resolveRemoteServerBaseUrl } from '../../shared/constants/defaults.ts';

const MAX_ASSET_BYTES = 50 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

interface PublishedAsset {
  enabled: true;
  assetId: string;
  sha256: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  updatedAt?: string;
}

interface DisabledAsset {
  enabled: false;
  updatedAt?: string;
}

type PublishedCosmetic = PublishedAsset | DisabledAsset | null;

interface ManifestSyncRecord {
  accountId: string;
  fingerprint: string;
  skin: PublishedCosmetic;
  cape: PublishedCosmetic;
  elytra: PublishedCosmetic;
  serverManifest?: any | null;
  serverFetchedAt?: string;
  manifestEtag?: string;
  lastAttemptAt: string;
  lastSuccessAt: string;
  status: 'synced' | 'failed' | 'conflict';
  lastError?: string;
}

type PendingAction = 'set' | 'remove';

interface PendingChanges {
  skin?: PendingAction;
  cape?: PendingAction;
  elytra?: PendingAction;
  metadata?: 'set';
}

interface SyncState {
  version: 1;
  assets: Record<string, PublishedAsset>;
  manifests: Record<string, ManifestSyncRecord>;
  pending: Record<string, PendingChanges>;
}

export interface CosmeticsSyncStateStore {
  read(): SyncState;
  write(state: SyncState): void;
}

export class FileCosmeticsSyncStateStore implements CosmeticsSyncStateStore {
  private readonly filePath: string;

  constructor(filePath = path.join(getPathManager().getConfigPath(), 'cosmetics-sync.json')) {
    this.filePath = filePath;
  }

  public read(): SyncState {
    try {
      if (!fs.existsSync(this.filePath)) return emptySyncState();
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        return {
        version: 1,
        assets: parsed?.assets && typeof parsed.assets === 'object' ? parsed.assets : {},
          manifests: parsed?.manifests && typeof parsed.manifests === 'object' ? parsed.manifests : {},
          pending: parsed?.pending && typeof parsed.pending === 'object' ? parsed.pending : {}
      };
    } catch {
      return emptySyncState();
    }
  }

  public write(state: SyncState): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
  }
}

export interface CosmeticsSyncDependencies {
  accountStorage?: Pick<ReturnType<typeof getAccountStorage>, 'getAccounts' | 'getActiveAccount' | 'updateAccount' | 'getAccountTokens'>;
  settingsStorage?: Pick<ReturnType<typeof getSettingsStorage>, 'getSettings'>;
  identityService?: Pick<ReturnType<typeof getClientIdentityService>, 'getClientId' | 'registerWithServer' | 'signPayload'>;
  heartbeatService?: Pick<ReturnType<typeof getHeartbeatService>, 'sendHeartbeat'>;
  pathManager?: Pick<ReturnType<typeof getPathManager>, 'getRootPath' | 'getCachePath'>;
  stateStore?: CosmeticsSyncStateStore;
  fetchImpl?: typeof fetch;
  dewAccessTokenProvider?: (account: UserAccount) => string | null;
  minecraftAccessTokenProvider?: (account: UserAccount) => Promise<string | null>;
  timeoutMs?: number;
  debounceMs?: number;
  retryDelaysMs?: number[];
}

export interface CosmeticsSyncResult {
  status: 'published' | 'unchanged' | 'skipped' | 'account-changed' | 'conflict' | 'failed';
  accountId?: string;
  playerUuid?: string;
  error?: string;
}

export interface ActiveCosmeticsResult {
  accountId: string | null;
  playerUuid: string | null;
  source: 'server' | 'cache' | 'legacy' | 'empty';
  manifest: any | null;
  skinPreviewUrl: string | null;
  capePreviewUrl: string | null;
  elytraPreviewUrl: string | null;
  error?: string;
}

interface LocalAsset {
  buffer: Buffer;
  sha256: string;
  contentType: string;
  width: number;
  height: number;
}

interface AssignedCosmeticFile {
  fileName: string;
  sha256: string;
}

interface AssignedCosmeticsEntry {
  username: string;
  files: Partial<Record<'skin' | 'cape' | 'elytra', AssignedCosmeticFile>>;
}

function emptySyncState(): SyncState {
  return { version: 1, assets: {}, manifests: {}, pending: {} };
}

function normalizeUuid(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function resolveActiveManifestCosmetics(
  manifest: any,
  localAdminSelections: Record<string, string> = {},
  localCapeChoice?: { source?: string; assetId?: string | null },
  preferLocalCape = false
): any {
  if (!manifest || typeof manifest !== 'object') return manifest;
  const resolved = { ...manifest };
  const metadata = manifest.metadata && typeof manifest.metadata === 'object' ? manifest.metadata : {};
  const adminKinds = Array.isArray(metadata.adminAssignedKinds) ? metadata.adminAssignedKinds : [];
  const activeAdmin = metadata.activeAdminCosmetics && typeof metadata.activeAdminCosmetics === 'object'
    ? metadata.activeAdminCosmetics
    : {};
  const preferredAdmin = { ...activeAdmin, ...localAdminSelections };
  for (const kind of ['skin', 'cape', 'elytra'] as const) {
    let selectedId: string | null | undefined;
    if (adminKinds.includes(kind)) {
      selectedId = typeof preferredAdmin[kind] === 'string' ? preferredAdmin[kind].toLowerCase() : undefined;
    } else if (kind === 'cape' && preferLocalCape && localCapeChoice?.source === 'microsoft') {
      selectedId = null;
    } else if (kind === 'cape' && preferLocalCape && localCapeChoice?.source === 'dew' && localCapeChoice.assetId) {
      selectedId = localCapeChoice.assetId.toLowerCase();
    } else if (kind === 'cape' && Object.prototype.hasOwnProperty.call(metadata, 'activeCapeAssetId')) {
      selectedId = typeof metadata.activeCapeAssetId === 'string' ? metadata.activeCapeAssetId.toLowerCase() : null;
    } else {
      continue;
    }
    const collectionKey = kind === 'skin' ? 'skins' : kind === 'cape' ? 'capes' : 'elytras';
    const collection = Array.isArray(metadata[collectionKey]) ? metadata[collectionKey] : [manifest[kind]];
    const selected = selectedId ? collection.find((item: any) => item?.enabled === true && String(item.assetId || '').toLowerCase() === selectedId) : null;
    resolved[kind] = selected || (selectedId === undefined && manifest[kind]?.enabled === true ? manifest[kind] : null);
  }
  return resolved;
}

function remoteApiBaseUrl(value?: string): string {
  return resolveRemoteServerBaseUrl(value, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
}

function sanitizeMetadata(account: UserAccount): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const badge = account.cosmetics?.badge;
  const accentColor = account.cosmetics?.accentColor;
  if (typeof badge === 'string' && badge.trim()) metadata.badge = badge.trim().slice(0, 64);
  if (typeof accentColor === 'string' && accentColor.trim()) metadata.accentColor = accentColor.trim().slice(0, 32);
  const activeAdminCosmetics = account.cosmetics?.activeAdminCosmetics;
  if (activeAdminCosmetics && typeof activeAdminCosmetics === 'object') {
    const selected = Object.fromEntries(['skin', 'cape', 'elytra']
      .filter((kind) => /^[a-f0-9]{64}$/i.test(String(activeAdminCosmetics[kind as keyof typeof activeAdminCosmetics] || '')))
      .map((kind) => [kind, activeAdminCosmetics[kind as keyof typeof activeAdminCosmetics]]));
    if (Object.keys(selected).length) metadata.activeAdminCosmetics = selected;
  }
  return metadata;
}

function contentHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertActiveAccount(account: UserAccount | null): asserts account is UserAccount {
  if (!account || typeof account !== 'object') throw new Error('No active account is selected.');
  const uuid = normalizeUuid(account.uuid);
  const username = typeof account.username === 'string' ? account.username.trim() : '';
  const prefix = account.type === 'microsoft' ? 'ms' : account.type === 'offline' ? 'offline' : account.type === 'discord' ? 'discord' : '';
  if (!prefix || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)) {
    throw new Error('The active account identity is invalid.');
  }
  const expectedStableId = account.type === 'discord'
    ? (account.discordUserId ? `discord-${account.discordUserId}` : '')
    : account.dewAccountId ? `${prefix}-${account.dewAccountId}` : `${prefix}-${uuid}`;
  const legacyId = `${prefix}-${uuid}`;
  if ((account.id !== expectedStableId && account.id !== legacyId) || !username) {
    throw new Error('The active account ID, UUID, and username are inconsistent.');
  }
}

function parsePublishedCosmetic(value: any): PublishedCosmetic {
  if (!value || typeof value !== 'object') return null;
  if (value.enabled === false) return { enabled: false, updatedAt: value.updatedAt };
  if (value.enabled !== true || typeof value.assetId !== 'string' || typeof value.sha256 !== 'string') return null;
  return {
    enabled: true,
    assetId: value.assetId,
    sha256: value.sha256,
    contentType: String(value.contentType || 'application/octet-stream'),
    byteSize: Number(value.byteSize || 0),
    width: Number(value.width || 0),
    height: Number(value.height || 0),
    updatedAt: value.updatedAt
  };
}

function isEnabledAsset(value: PublishedCosmetic): value is PublishedAsset {
  return Boolean(value && value.enabled === true);
}

export class CosmeticsSyncService {
  private readonly accountStorage: NonNullable<CosmeticsSyncDependencies['accountStorage']>;
  private readonly settingsStorage: NonNullable<CosmeticsSyncDependencies['settingsStorage']>;
  private readonly identityService: NonNullable<CosmeticsSyncDependencies['identityService']>;
  private readonly heartbeatService: NonNullable<CosmeticsSyncDependencies['heartbeatService']>;
  private readonly pathManager: NonNullable<CosmeticsSyncDependencies['pathManager']>;
  private readonly stateStore: CosmeticsSyncStateStore;
  private readonly fetchImpl: typeof fetch;
  private readonly dewAccessTokenProvider: (account: UserAccount) => string | null;
  private readonly minecraftAccessTokenProvider: (account: UserAccount) => Promise<string | null>;
  private readonly timeoutMs: number;
  private readonly debounceMs: number;
  private readonly retryDelaysMs: number[];
  private readonly logger = getLogger();
  private debounceTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private isStarted = false;
  private isRunning = false;
  private syncAgain = false;
  private retryAttempt = 0;
  private readonly syncListeners = new Set<(result: CosmeticsSyncResult) => void>();

  constructor(dependencies: CosmeticsSyncDependencies = {}) {
    this.accountStorage = dependencies.accountStorage || getAccountStorage();
    this.settingsStorage = dependencies.settingsStorage || getSettingsStorage();
    this.identityService = dependencies.identityService || getClientIdentityService();
    this.heartbeatService = dependencies.heartbeatService || getHeartbeatService();
    this.pathManager = dependencies.pathManager || getPathManager();
    this.stateStore = dependencies.stateStore || new FileCosmeticsSyncStateStore();
    this.fetchImpl = dependencies.fetchImpl || fetch;
    this.dewAccessTokenProvider = dependencies.dewAccessTokenProvider || ((account) => {
      const candidates = [account, ...this.accountStorage.getAccounts()];
      for (const candidate of candidates) {
        if (!candidate.authUserId) continue;
        const tokens = this.accountStorage.getAccountTokens(candidate.id);
        if (tokens?.accessToken && (!tokens.expiresAt || tokens.expiresAt > Date.now() + 30_000)) return tokens.accessToken;
      }
      return null;
    });
    this.minecraftAccessTokenProvider = dependencies.minecraftAccessTokenProvider || (async (account) => {
      if (account.type !== 'microsoft') return null;
      const { getAuthService } = await import('../auth/authService.ts');
      const launchAuth = await getAuthService().getLaunchAuth(account);
      return launchAuth.verified ? launchAuth.accessToken : null;
    });
    this.timeoutMs = dependencies.timeoutMs || REQUEST_TIMEOUT_MS;
    this.debounceMs = dependencies.debounceMs ?? 500;
    this.retryDelaysMs = dependencies.retryDelaysMs || [60_000, 300_000, 900_000];
  }

  public start(): void {
    if (this.isStarted) return;
    this.isStarted = true;
    this.scheduleSync();
  }

  public stop(): void {
    this.isStarted = false;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.debounceTimer = null;
    this.retryTimer = null;
  }

  public scheduleSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runScheduledSync();
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }

  public async syncNow(): Promise<CosmeticsSyncResult> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    const result = await this.syncActiveAccount();
    this.notifySyncComplete(result);
    return result;
  }

  public async syncAssignedCosmetics(gameDirectory: string): Promise<{ playersSynced: number }> {
    const settings = this.settingsStorage.getSettings();
    const baseUrl = remoteApiBaseUrl(settings.remote?.serverUrl);
    if (!settings.remote?.enabled || !/^https?:\/\//i.test(baseUrl)) return { playersSynced: 0 };

    const response = await this.fetchWithTimeout(`${baseUrl}/cosmetics/assigned`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`Assigned cosmetics API returned HTTP ${response.status}.`);
    const result = await response.json() as { ok?: boolean; data?: any[] };
    if (!result?.ok || !Array.isArray(result.data)) throw new Error('Assigned cosmetics API returned an invalid response.');

    const statePath = path.join(gameDirectory, 'config', '.dewclient-cosmetics.json');
    let previousEntries: AssignedCosmeticsEntry[] = [];
    try {
      const previous = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      previousEntries = Array.isArray(previous?.entries) ? previous.entries as AssignedCosmeticsEntry[] : [];
    } catch {}

    const legacySkinRoot = path.join(gameDirectory, 'CustomSkinLoader');
    if (fs.existsSync(legacySkinRoot)) {
      fs.rmSync(legacySkinRoot, { recursive: true, force: true });
    }

    const nextEntries: Array<{ username: string; files: Record<string, { fileName: string; sha256: string }> }> = [];
    for (const entry of result.data) {
      if (!entry || !/^[A-Za-z0-9_]{1,16}$/.test(String(entry?.username || ''))) continue;
      const files: Record<string, { fileName: string; sha256: string }> = {};
      for (const kind of ['skin', 'cape', 'elytra'] as const) {
        const cosmetic = entry[kind];
        if (!cosmetic || cosmetic.enabled !== true || !/^[a-f0-9]{64}$/i.test(String(cosmetic.sha256 || ''))) continue;
        files[kind] = { fileName: `${entry.username}-${kind}.bin`, sha256: String(cosmetic.sha256) };
      }
      if (Object.keys(files).length > 0) {
        nextEntries.push({ username: entry.username, files });
      }
    }

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temporaryStatePath = `${statePath}.tmp.${process.pid}`;
    fs.writeFileSync(temporaryStatePath, JSON.stringify({ version: 1, entries: nextEntries }, null, 2), 'utf8');
    fs.renameSync(temporaryStatePath, statePath);
    return { playersSynced: nextEntries.length };
  }

  public onSyncComplete(listener: (result: CosmeticsSyncResult) => void): () => void {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  private notifySyncComplete(result: CosmeticsSyncResult): void {
    for (const listener of this.syncListeners) {
      try {
        listener(result);
      } catch (error: any) {
        this.logger.warn('remote', `Cosmetics sync listener failed: ${error?.message || error}`);
      }
    }
  }

  public markPendingChange(accountId: string, kind: 'skin' | 'cape' | 'elytra' | 'metadata', action: PendingAction | 'set'): void {
    const account = this.accountStorage.getAccounts().find((candidate) => candidate.id === accountId);
    if (!account) throw new Error('Account was not found.');
    assertActiveAccount(account);
    const settings = this.settingsStorage.getSettings();
    const baseUrl = remoteApiBaseUrl(settings.remote?.serverUrl);
    const key = `${baseUrl}|${normalizeUuid(account.uuid)}`;
    const state = this.readState();
    const pending = state.pending[key] || {};
    if (kind === 'metadata') pending.metadata = 'set';
    else pending[kind] = action as PendingAction;
    state.pending[key] = pending;
    if (state.manifests[key]?.status === 'conflict') {
      state.manifests[key].status = 'failed';
      state.manifests[key].lastError = undefined;
    }
    this.stateStore.write(state);
    this.scheduleSync();
  }

  public async getActiveCosmetics(): Promise<ActiveCosmeticsResult> {
    const account = this.accountStorage.getActiveAccount();
    if (!account) {
      return { accountId: null, playerUuid: null, source: 'empty', manifest: null, skinPreviewUrl: null, capePreviewUrl: null, elytraPreviewUrl: null };
    }
    try {
      assertActiveAccount(account);
    } catch (error: any) {
      return { accountId: account.id, playerUuid: null, source: 'empty', manifest: null, skinPreviewUrl: null, capePreviewUrl: null, elytraPreviewUrl: null, error: error?.message };
    }

    const playerUuid = normalizeUuid(account.uuid);
    const settings = this.settingsStorage.getSettings();
    const baseUrl = remoteApiBaseUrl(settings.remote?.serverUrl);
    const key = `${baseUrl}|${playerUuid}`;
    const state = this.readState();
    const localAdminSelections = account.cosmetics?.activeAdminCosmetics || {};
    const localCapeChoice = { source: account.cosmetics?.activeCapeSource, assetId: account.cosmetics?.activeCapeAssetId };
    const cachedManifest = resolveActiveManifestCosmetics(state.manifests[key]?.serverManifest || null, localAdminSelections, localCapeChoice, true);
    if (!settings.remote?.enabled || !/^https?:\/\//i.test(baseUrl)) {
      const cachedPreviews = this.getCachedPreviewUrls(baseUrl, playerUuid, cachedManifest, state);
      const localPreviews = this.getLegacyPreviewUrls(account);
      const previews = {
        skinPreviewUrl: account.cosmetics?.skinSource === 'custom'
          ? localPreviews.skinPreviewUrl || cachedPreviews.skinPreviewUrl
          : cachedPreviews.skinPreviewUrl || localPreviews.skinPreviewUrl,
        capePreviewUrl: cachedPreviews.capePreviewUrl || localPreviews.capePreviewUrl,
        elytraPreviewUrl: cachedPreviews.elytraPreviewUrl || localPreviews.elytraPreviewUrl
      };
      return {
        accountId: account.id,
        playerUuid,
        source: cachedManifest ? 'cache' : (previews.skinPreviewUrl || previews.capePreviewUrl || previews.elytraPreviewUrl ? 'legacy' : 'empty'),
        manifest: cachedManifest,
        ...previews
      };
    }

    try {
      const response = await this.fetchWithTimeout(`${baseUrl}/cosmetics/player/${playerUuid}`, {
        headers: {
          Accept: 'application/json',
          ...(state.manifests[key]?.manifestEtag ? { 'If-None-Match': state.manifests[key].manifestEtag } : {})
        }
      });
      let manifest: any | null = null;
      if (response.status === 404) {
        manifest = null;
      } else if (response.status === 304 && cachedManifest) {
        manifest = cachedManifest;
      } else if (response.ok) {
        const result = await response.json() as any;
        if (!result?.ok || (result.data && normalizeUuid(result.data.playerUuid) !== playerUuid)) {
          throw new Error('Cosmetics API returned a manifest for a different player.');
        }
        manifest = result.data || null;
      } else {
        throw new Error(`Cosmetics API returned HTTP ${response.status}.`);
      }

      manifest = resolveActiveManifestCosmetics(manifest, localAdminSelections, localCapeChoice);
      const current = state.manifests[key];
      state.manifests[key] = {
        ...(current || { accountId: account.id, fingerprint: '', skin: null, cape: null, lastAttemptAt: '', lastSuccessAt: '', status: 'synced' as const }),
        accountId: account.id,
        serverManifest: manifest,
        serverFetchedAt: new Date().toISOString(),
        manifestEtag: response.headers.get('etag') || current?.manifestEtag,
        status: current?.status === 'conflict' ? 'conflict' : 'synced'
      };
      this.stateStore.write(state);

      const serverPreviews = manifest
        ? await this.cacheManifestAssets(baseUrl, playerUuid, manifest)
        : { skinPreviewUrl: null, capePreviewUrl: null, elytraPreviewUrl: null };
      const localPreviews = this.getLegacyPreviewUrls(account);
      const previews = {
        skinPreviewUrl: account.cosmetics?.skinSource === 'custom'
          ? localPreviews.skinPreviewUrl || serverPreviews.skinPreviewUrl
          : serverPreviews.skinPreviewUrl || (manifest?.skin?.enabled === false ? null : localPreviews.skinPreviewUrl),
        capePreviewUrl: serverPreviews.capePreviewUrl || (manifest?.cape?.enabled === false ? null : localPreviews.capePreviewUrl),
        elytraPreviewUrl: serverPreviews.elytraPreviewUrl || (manifest?.elytra?.enabled === false ? null : localPreviews.elytraPreviewUrl)
      };
      return { accountId: account.id, playerUuid, source: manifest ? 'server' : (previews.skinPreviewUrl || previews.capePreviewUrl || previews.elytraPreviewUrl ? 'legacy' : 'empty'), manifest, ...previews };
    } catch (error: any) {
      const cachedPreviews = this.getCachedPreviewUrls(baseUrl, playerUuid, cachedManifest, state);
      const localPreviews = this.getLegacyPreviewUrls(account);
      const previews = {
        skinPreviewUrl: account.cosmetics?.skinSource === 'custom'
          ? localPreviews.skinPreviewUrl || cachedPreviews.skinPreviewUrl
          : cachedPreviews.skinPreviewUrl || localPreviews.skinPreviewUrl,
        capePreviewUrl: cachedPreviews.capePreviewUrl || localPreviews.capePreviewUrl,
        elytraPreviewUrl: cachedPreviews.elytraPreviewUrl || localPreviews.elytraPreviewUrl
      };
      return {
        accountId: account.id,
        playerUuid,
        source: cachedManifest ? 'cache' : (previews.skinPreviewUrl || previews.capePreviewUrl || previews.elytraPreviewUrl ? 'legacy' : 'empty'),
        manifest: cachedManifest,
        ...previews,
        error: error?.message || 'Cosmetics API is unavailable.'
      };
    }
  }

  public async getAssignedCosmeticPreview(accountId: string, kind: 'skin' | 'cape' | 'elytra', assetId: string): Promise<string> {
    if (!['skin', 'cape', 'elytra'].includes(kind) || !/^[a-f0-9]{64}$/i.test(String(assetId || ''))) {
      throw new Error('This assigned cosmetic reference is invalid.');
    }
    const account = this.accountStorage.getActiveAccount();
    if (!account || account.id !== accountId) throw new Error('Select the account that owns this cosmetic.');
    const active = await this.getActiveCosmetics();
    if (active.accountId !== account.id || !active.manifest) throw new Error('The assigned cosmetic manifest is unavailable. Refresh and try again.');
    const collectionKey = kind === 'skin' ? 'skins' : kind === 'cape' ? 'capes' : 'elytras';
    const candidates = Array.isArray(active.manifest.metadata?.[collectionKey])
      ? active.manifest.metadata[collectionKey]
      : [active.manifest[kind]];
    const cosmetic = candidates.find((item: any) => item?.enabled === true && item.assetId === assetId);
    if (!cosmetic || !/^[a-f0-9]{64}$/i.test(String(cosmetic.sha256 || ''))) {
      throw new Error('This cosmetic is no longer assigned to the selected player. Refresh assignments.');
    }
    const contentTypes: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp'
    };
    const extension = contentTypes[cosmetic.contentType];
    if (!extension || (Number(cosmetic.byteSize) > 0 && Number(cosmetic.byteSize) > MAX_ASSET_BYTES)) {
      throw new Error('This assigned texture uses an unsupported image format or size.');
    }
    const settings = this.settingsStorage.getSettings();
    if (!settings.remote?.enabled) throw new Error('Connect to the DewClient server to preview assigned cosmetics.');
    const baseUrl = remoteApiBaseUrl(settings.remote.serverUrl);
    const response = await this.fetchWithTimeout(`${baseUrl}/cosmetics/assets/${cosmetic.assetId}`, {
      headers: { Accept: cosmetic.contentType }
    }, 120_000);
    if (!response.ok) throw new Error(`Assigned texture download failed (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_ASSET_BYTES) throw new Error('The assigned texture exceeds the 50 MiB limit.');
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== cosmetic.sha256) {
      throw new Error('The assigned texture did not pass its integrity check.');
    }
    return `data:${cosmetic.contentType};base64,${bytes.toString('base64')}`;
  }

  private readState(): SyncState {
    const state = this.stateStore.read();
    return {
      version: 1,
      assets: state.assets || {},
      manifests: state.manifests || {},
      pending: state.pending || {}
    };
  }

  private getCachedPreviewUrls(baseUrl: string, playerUuid: string, manifest: any, state: SyncState) {
    const resolve = (kind: 'skin' | 'cape' | 'elytra') => {
      const cosmetic = manifest?.[kind];
      if (!cosmetic || cosmetic.enabled !== true || typeof cosmetic.assetId !== 'string') return null;
      const cacheKey = `${baseUrl}|${playerUuid}|${kind}|${cosmetic.sha256}`;
      const entry: any = state.assets[cacheKey];
      const ext = path.extname(entry?.cacheFileName || '');
      if (!ext) return null;
      const cachePath = path.join(this.pathManager.getCachePath(), 'cosmetics', 'assets', `${cosmetic.assetId}${ext}`);
      if (!fs.existsSync(cachePath)) return null;
      const bytes = fs.readFileSync(cachePath);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== cosmetic.sha256) return null;
      const contentType = CONTENT_TYPES[ext];
      return contentType ? `data:${contentType};base64,${bytes.toString('base64')}` : null;
    };
    return { skinPreviewUrl: resolve('skin'), capePreviewUrl: resolve('cape'), elytraPreviewUrl: resolve('elytra') };
  }

  private getLegacyPreviewUrls(account: UserAccount) {
    const resolve = (kind: 'skin' | 'cape' | 'elytra') => {
      const configuredPath = kind === 'skin'
        ? account.skinAssetPath || account.cosmetics?.skinAssetPath
        : kind === 'cape'
          ? account.capeAssetPath || account.cosmetics?.capeAssetPath
          : account.elytraAssetPath || account.cosmetics?.elytraAssetPath;
      if (typeof configuredPath !== 'string') return null;
      try {
        const asset = this.readLocalAsset(account, kind);
        return asset ? `data:${asset.contentType};base64,${asset.buffer.toString('base64')}` : null;
      } catch {
        return null;
      }
    };
    return {
      skinPreviewUrl: resolve('skin'),
      capePreviewUrl: resolve('cape'),
      elytraPreviewUrl: resolve('elytra')
    };
  }

  private async cacheManifestAssets(baseUrl: string, playerUuid: string, manifest: any) {
    const preview: { skinPreviewUrl: string | null; capePreviewUrl: string | null; elytraPreviewUrl: string | null } = {
      skinPreviewUrl: null,
      capePreviewUrl: null,
      elytraPreviewUrl: null
    };
    for (const kind of ['skin', 'cape', 'elytra'] as const) {
      const cosmetic = manifest?.[kind];
      if (!cosmetic || cosmetic.enabled !== true) continue;
      if (typeof cosmetic.assetId !== 'string' || typeof cosmetic.sha256 !== 'string') continue;
      const extension = cosmetic.contentType === 'image/png' ? '.png'
        : cosmetic.contentType === 'image/jpeg' ? '.jpg'
          : cosmetic.contentType === 'image/webp' ? '.webp' : '';
      if (!extension) continue;

      const cacheDir = path.join(this.pathManager.getCachePath(), 'cosmetics', 'assets');
      const cacheFileName = `${cosmetic.assetId}${extension}`;
      const cachePath = path.join(cacheDir, cacheFileName);
      let valid = false;
      if (fs.existsSync(cachePath)) {
        const cachedBytes = fs.readFileSync(cachePath);
        valid = crypto.createHash('sha256').update(cachedBytes).digest('hex') === cosmetic.sha256;
      }
      if (!valid) {
        const response = await this.fetchWithTimeout(`${baseUrl}/cosmetics/assets/${cosmetic.assetId}`, {
          headers: { Accept: cosmetic.contentType }
        }, 120_000);
        if (!response.ok) throw new Error(`Cosmetic asset download failed (HTTP ${response.status}).`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== cosmetic.sha256) {
          throw new Error(`Downloaded ${kind} failed SHA-256 verification.`);
        }
        fs.mkdirSync(cacheDir, { recursive: true });
        const temporaryPath = `${cachePath}.tmp.${process.pid}.${Date.now()}`;
        fs.writeFileSync(temporaryPath, bytes);
        fs.renameSync(temporaryPath, cachePath);
      }

      const state = this.readState();
      state.assets[`${baseUrl}|${playerUuid}|${kind}|${cosmetic.sha256}`] = {
        enabled: true,
        assetId: cosmetic.assetId,
        sha256: cosmetic.sha256,
        contentType: cosmetic.contentType,
        byteSize: Number(cosmetic.byteSize || 0),
        width: Number(cosmetic.width || 0),
        height: Number(cosmetic.height || 0),
        updatedAt: cosmetic.updatedAt,
        cacheFileName,
        lastValidatedAt: new Date().toISOString()
      } as any;
      this.stateStore.write(state);
      const bytes = fs.readFileSync(cachePath);
      preview[`${kind}PreviewUrl`] = `data:${cosmetic.contentType};base64,${bytes.toString('base64')}`;
    }
    return preview;
  }

  private async runScheduledSync(): Promise<void> {
    if (this.isRunning) {
      this.syncAgain = true;
      return;
    }
    this.isRunning = true;
    try {
      do {
        this.syncAgain = false;
        const result = await this.syncActiveAccount();
        this.notifySyncComplete(result);
        if (result.status === 'failed') {
          this.scheduleRetry();
          break;
        }
        this.retryAttempt = 0;
      } while (this.syncAgain);
    } finally {
      this.isRunning = false;
      if (this.syncAgain) this.scheduleSync();
    }
  }

  private scheduleRetry(): void {
    if (!this.isStarted || this.retryTimer) return;
    const delay = this.retryDelaysMs[Math.min(this.retryAttempt, this.retryDelaysMs.length - 1)];
    if (!Number.isFinite(delay) || delay < 0) return;
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.scheduleSync();
    }, delay);
    this.retryTimer.unref?.();
  }

  private async syncActiveAccount(): Promise<CosmeticsSyncResult> {
    const settings = this.settingsStorage.getSettings();
    if (!settings.remote?.enabled || !settings.remote?.autoSync) return { status: 'skipped' };

    const account = this.accountStorage.getActiveAccount();
    try {
      assertActiveAccount(account);
    } catch (error: any) {
      return { status: 'skipped', error: error?.message || 'No valid active account.' };
    }

    const normalizedUuid = normalizeUuid(account.uuid);
    const username = account.username.trim();
    let baseUrl: string;
    try {
      baseUrl = remoteApiBaseUrl(settings.remote.serverUrl);
    } catch {
      return this.fail(account, '', 'The configured cosmetics API URL is not an approved DewClient server.');
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      return this.fail(account, baseUrl, 'The configured cosmetics API URL is invalid.');
    }

    let skin: LocalAsset | null;
    let cape: LocalAsset | null;
    let elytra: LocalAsset | null;
    try {
      skin = this.readLocalAsset(account, 'skin');
      cape = this.readLocalAsset(account, 'cape');
      elytra = this.readLocalAsset(account, 'elytra');
    } catch (error: any) {
      return this.fail(account, baseUrl, error?.message || 'Could not read local cosmetics.');
    }

    const metadata = sanitizeMetadata(account);
    const manifestKey = `${baseUrl}|${normalizedUuid}`;
    let state = this.readState();
    let previous = state.manifests[manifestKey];
    let pending = state.pending[manifestKey] || {};
      const skinIsLocal = account.cosmetics?.skinSource === 'custom' || account.cosmetics?.skinSource === 'official';
      const capeIsMicrosoftOwned = account.cosmetics?.capeSource === 'official';
      if (skinIsLocal) delete pending.skin;
      if (capeIsMicrosoftOwned) delete pending.cape;
      if (skinIsLocal || capeIsMicrosoftOwned) {
        if (Object.keys(pending).length > 0) state.pending[manifestKey] = pending;
        else delete state.pending[manifestKey];
        this.stateStore.write(state);
      }
    if (previous?.status === 'conflict' && Object.keys(pending).length > 0) {
      return { status: 'conflict', accountId: account.id, playerUuid: normalizedUuid, error: previous.lastError };
    }
    const attemptedAt = new Date().toISOString();

    try {
      let heartbeatOk = await this.withTimeout(this.heartbeatService.sendHeartbeat(false), 'Account heartbeat timed out.');
      if (!heartbeatOk) {
        await this.withTimeout(this.identityService.registerWithServer(baseUrl), 'Client registration timed out.');
        heartbeatOk = await this.withTimeout(this.heartbeatService.sendHeartbeat(false), 'Account heartbeat timed out.');
      }
      if (!heartbeatOk) throw new Error('Could not link the active account to the configured server.');

      const currentAccount = this.accountStorage.getActiveAccount();
      if (!currentAccount || currentAccount.id !== account.id || normalizeUuid(currentAccount.uuid) !== normalizedUuid) {
        return { status: 'account-changed', accountId: account.id, playerUuid: normalizedUuid };
      }

      const clientId = this.identityService.getClientId();
      if (!clientId) throw new Error('The server did not provide a registered client ID.');

      let currentManifest: any | null;
      let currentManifestEtag: string | undefined;
      try {
        const manifestResponse = await this.fetchWithTimeout(`${baseUrl}/cosmetics/player/${normalizedUuid}`, {
          headers: {
            Accept: 'application/json',
            ...(previous?.manifestEtag ? { 'If-None-Match': previous.manifestEtag } : {})
          }
        });
        if (manifestResponse.status === 404) {
          currentManifest = null;
          currentManifestEtag = undefined;
        } else if (manifestResponse.status === 304 && previous?.serverManifest) {
          currentManifest = previous.serverManifest;
          currentManifestEtag = previous.manifestEtag;
        } else if (manifestResponse.ok) {
          const manifestResult = await manifestResponse.json() as any;
          currentManifest = manifestResult?.ok ? manifestResult.data || null : null;
          currentManifestEtag = manifestResponse.headers.get('etag') || undefined;
          if (currentManifest && normalizeUuid(currentManifest.playerUuid) !== normalizedUuid) {
            throw new Error('Cosmetics API returned a manifest for a different player.');
          }
        } else {
          throw new Error(`Cosmetics manifest lookup failed (HTTP ${manifestResponse.status}).`);
        }
      } catch (error: any) {
        throw new Error(`Could not load the canonical cosmetics manifest: ${error?.message || 'request failed'}`);
      }

      if (!pending.skin && skin && !account.skinAssetPath && !account.cosmetics?.skinAssetPath && (!currentManifest || currentManifest.skin == null)) pending.skin = 'set';
      if (!pending.cape && cape && !account.capeAssetPath && !account.cosmetics?.capeAssetPath && account.cosmetics?.capeSource !== 'official' && (!currentManifest || currentManifest.cape == null)) pending.cape = 'set';
      if (!pending.elytra && elytra && !account.elytraAssetPath && !account.cosmetics?.elytraAssetPath && (!currentManifest || currentManifest.elytra == null)) pending.elytra = 'set';
      if (!pending.metadata && !currentManifest && Object.keys(metadata).length > 0) pending.metadata = 'set';

      if (account.cosmetics?.skinSource === 'custom' || account.cosmetics?.skinSource === 'official') delete pending.skin;
      if (account.cosmetics?.capeSource === 'official') delete pending.cape;

      const hasPending = Boolean(pending.skin || pending.cape || pending.elytra || pending.metadata);
      if (!hasPending) {
        state = this.readState();
        previous = state.manifests[manifestKey];
        state.manifests[manifestKey] = {
          ...(previous || { accountId: account.id, fingerprint: '', skin: null, cape: null, lastAttemptAt: '', lastSuccessAt: '', status: 'synced' as const }),
          accountId: account.id,
          serverManifest: currentManifest,
          serverFetchedAt: new Date().toISOString(),
          manifestEtag: currentManifestEtag,
          status: 'synced'
        };
        this.stateStore.write(state);
        if (currentManifest) {
          await this.cacheManifestAssets(baseUrl, normalizedUuid, currentManifest);
          this.persistCanonicalAccount(account, currentManifest);
        }
        return {
          status: currentManifest || skin || cape ? 'unchanged' : 'skipped',
          accountId: account.id,
          playerUuid: normalizedUuid
        };
      }

      state.pending[manifestKey] = pending;
      state.manifests[manifestKey] = {
        ...(previous || { accountId: account.id, fingerprint: '', skin: null, cape: null, lastAttemptAt: '', lastSuccessAt: '', status: 'failed' as const }),
        accountId: account.id,
        serverManifest: currentManifest,
        lastAttemptAt: attemptedAt,
        status: 'failed'
      };
      this.stateStore.write(state);

      const skinPayload = this.buildServerAssetPayload(baseUrl, normalizedUuid, 'skin', skin, currentManifest?.skin, pending.skin);
      const capePayload = this.buildServerAssetPayload(baseUrl, normalizedUuid, 'cape', cape, currentManifest?.cape, pending.cape);
      const elytraPayload = this.buildServerAssetPayload(baseUrl, normalizedUuid, 'elytra', elytra, currentManifest?.elytra, pending.elytra);
      const publishMetadata = pending.metadata === 'set' ? metadata : currentManifest?.metadata || metadata;
      if (pending.skin === 'set' && !skin) throw new Error('The pending skin file is missing; local data was retained.');
      if (pending.cape === 'set' && !cape) throw new Error('The pending cape file is missing; local data was retained.');
      if (pending.elytra === 'set' && !elytra) throw new Error('The pending elytra file is missing; local data was retained.');

      const dewAccessToken = this.dewAccessTokenProvider(account);
      const minecraftAccessToken = await this.minecraftAccessTokenProvider(account);
      if (!dewAccessToken || !minecraftAccessToken) {
        throw new Error('Publishing requires a signed-in Dew account and a verified Microsoft Minecraft profile.');
      }

      const body = JSON.stringify({
        expectedVersion: Number(currentManifest?.version || 0),
        playerUuid: normalizedUuid,
        username,
        skin: skinPayload,
        cape: capePayload,
        elytra: elytraPayload,
        metadata: publishMetadata
      });
      const timestamp = String(Date.now());
      const requestId = crypto.randomUUID();
      const bodyHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
      const signature = this.identityService.signPayload(`${clientId}:${timestamp}:${requestId}:${bodyHash}`);
      const response = await this.fetchWithTimeout(`${baseUrl}/cosmetics/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${dewAccessToken}`,
          'x-minecraft-access-token': minecraftAccessToken,
          'x-dewclient-id': clientId,
          'x-dewclient-timestamp': timestamp,
          'x-dewclient-request-id': requestId,
          'x-dewclient-signature': signature,
          'x-dewclient-player-uuid': normalizedUuid
        },
        body
      }, 120_000);

      if (response.status === 409) {
        const conflict = await response.json() as any;
        const serverManifest = conflict?.data?.manifest || null;
        const conflictState = this.readState();
        delete conflictState.pending[manifestKey];
        conflictState.manifests[manifestKey] = {
          ...(conflictState.manifests[manifestKey] || { accountId: account.id, fingerprint: '', skin: null, cape: null, lastAttemptAt: '', lastSuccessAt: '', status: 'conflict' as const }),
          accountId: account.id,
          serverManifest,
          serverFetchedAt: new Date().toISOString(),
          manifestEtag: serverManifest ? `"${serverManifest.playerUuid}:${serverManifest.updatedAt}:${serverManifest.version}"` : undefined,
          lastAttemptAt: attemptedAt,
          status: 'conflict',
          lastError: 'A newer server manifest won the update conflict. Local files were retained.'
        };
        this.stateStore.write(conflictState);
        return { status: 'conflict', accountId: account.id, playerUuid: normalizedUuid, error: conflictState.manifests[manifestKey].lastError };
      }
      if (!response.ok) throw new Error(`Cosmetics API rejected the publish request (HTTP ${response.status}).`);
      const result = await response.json() as any;
      const manifest = result?.data?.manifest;
      if (!result?.ok || !manifest || normalizeUuid(manifest.playerUuid) !== normalizedUuid) {
        throw new Error('Cosmetics API returned an invalid publish response.');
      }

      const nextState = this.readState();
      const publishedSkin = parsePublishedCosmetic(manifest.skin);
      const publishedCape = parsePublishedCosmetic(manifest.cape);
      const publishedElytra = parsePublishedCosmetic(manifest.elytra);
      this.rememberAsset(nextState, baseUrl, normalizedUuid, 'skin', publishedSkin);
      this.rememberAsset(nextState, baseUrl, normalizedUuid, 'cape', publishedCape);
      this.rememberAsset(nextState, baseUrl, normalizedUuid, 'elytra', publishedElytra);
      delete nextState.pending[manifestKey];
      nextState.manifests[manifestKey] = {
        accountId: account.id,
        fingerprint: contentHash({ skin: publishedSkin, cape: publishedCape, elytra: publishedElytra, metadata: manifest.metadata || {} }),
        skin: publishedSkin,
        cape: publishedCape,
        elytra: publishedElytra,
        serverManifest: manifest,
        serverFetchedAt: new Date().toISOString(),
        manifestEtag: `"${manifest.playerUuid}:${manifest.updatedAt}:${manifest.version}"`,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: new Date().toISOString(),
        status: 'synced'
      };
      this.stateStore.write(nextState);
      await this.cacheManifestAssets(baseUrl, normalizedUuid, manifest).catch((error: any) => {
        this.logger.warn('remote', `Published cosmetics but could not refresh the local cache: ${error?.message || error}`);
      });
      this.persistCanonicalAccount(account, manifest);
      this.logger.info('remote', `Published cosmetics for active account ${username}.`);
      return { status: 'published', accountId: account.id, playerUuid: normalizedUuid };
    } catch (error: any) {
      return this.fail(account, baseUrl, error?.message || 'Cosmetics sync failed.', manifestKey, attemptedAt);
    }
  }

  private buildServerAssetPayload(
    baseUrl: string,
    playerUuid: string,
    kind: 'skin' | 'cape' | 'elytra',
    localAsset: LocalAsset | null,
    currentCosmetic: any,
    action?: PendingAction
  ): Record<string, unknown> | null {
    if (action === 'remove') return { enabled: false };
    if (action === 'set' && localAsset) {
      if (currentCosmetic?.enabled === true && currentCosmetic.sha256 === localAsset.sha256) {
        return { assetId: currentCosmetic.assetId, sha256: currentCosmetic.sha256 };
      }
      return {
        data: localAsset.buffer.toString('base64'),
        contentType: localAsset.contentType,
        sha256: localAsset.sha256
      };
    }
    if (!action && currentCosmetic?.enabled === true) {
      return { assetId: currentCosmetic.assetId, sha256: currentCosmetic.sha256 };
    }
    if (currentCosmetic?.enabled === false) return { enabled: false };
    return null;
  }

  private persistCanonicalAccount(account: UserAccount, manifest: any): void {
    const storage = this.accountStorage as any;
    if (typeof storage.updateAccount !== 'function') return;
    const active = this.accountStorage.getActiveAccount();
    if (!active || active.id !== account.id || normalizeUuid(active.uuid) !== normalizeUuid(manifest.playerUuid)) return;

    const skin = parsePublishedCosmetic(manifest.skin);
    const cape = parsePublishedCosmetic(manifest.cape);
    const elytra = parsePublishedCosmetic(manifest.elytra);
    const cosmetics: Record<string, unknown> = {
      skinSource: account.cosmetics?.skinSource,
      capeSource: account.cosmetics?.capeSource,
      elytraSource: account.cosmetics?.elytraSource,
      badge: typeof manifest.metadata?.badge === 'string' ? manifest.metadata.badge : undefined,
      accentColor: typeof manifest.metadata?.accentColor === 'string' ? manifest.metadata.accentColor : undefined,
      manifestVersion: Number(manifest.version || 0),
      skinAssetId: isEnabledAsset(skin) ? skin.assetId : undefined,
      skinSha256: isEnabledAsset(skin) ? skin.sha256 : undefined,
      capeAssetId: isEnabledAsset(cape) ? cape.assetId : undefined,
      capeSha256: isEnabledAsset(cape) ? cape.sha256 : undefined,
      elytraAssetId: isEnabledAsset(elytra) ? elytra.assetId : undefined,
      elytraSha256: isEnabledAsset(elytra) ? elytra.sha256 : undefined,
      activeAdminCosmetics: manifest.metadata?.activeAdminCosmetics || account.cosmetics?.activeAdminCosmetics,
      skinAssetPath: account.skinAssetPath || account.cosmetics?.skinAssetPath,
      capeAssetPath: account.capeAssetPath || account.cosmetics?.capeAssetPath,
      elytraAssetPath: account.elytraAssetPath || account.cosmetics?.elytraAssetPath
    };
    storage.updateAccount(account.id, {
      skinAssetPath: account.skinAssetPath || account.cosmetics?.skinAssetPath,
      capeAssetPath: account.capeAssetPath || account.cosmetics?.capeAssetPath,
      elytraAssetPath: account.elytraAssetPath || account.cosmetics?.elytraAssetPath,
      cosmetics
    });
  }

  private readLocalAsset(account: UserAccount, kind: 'skin' | 'cape' | 'elytra'): LocalAsset | null {
    const directPath = kind === 'skin' ? account.skinAssetPath : kind === 'cape' ? account.capeAssetPath : account.elytraAssetPath;
    const configuredPath = directPath || (kind === 'skin' ? account.cosmetics?.skinAssetPath : kind === 'cape' ? account.cosmetics?.capeAssetPath : account.cosmetics?.elytraAssetPath);
    if (!configuredPath) return null;
    if (typeof configuredPath !== 'string') throw new Error(`The active account ${kind} path is invalid.`);

    const accountCosmeticsDir = path.resolve(this.pathManager.getRootPath(), 'cosmetics', account.id);
    const resolvedPath = path.resolve(configuredPath);
    const relative = path.relative(accountCosmeticsDir, resolvedPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(resolvedPath) !== accountCosmeticsDir) {
      throw new Error(`The active account ${kind} must be stored in its DewClient cosmetics folder.`);
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    const fileName = path.basename(resolvedPath);
    const isExpectedFileName = kind === 'skin'
      ? new RegExp(`^(?:skin|skin-slot-[1-4])\\${extension}$`, 'i').test(fileName)
      : fileName === `${kind}${extension}`;
    if (!contentType || !isExpectedFileName) {
      throw new Error(`The active account ${kind} must be a PNG, JPEG, or WebP file saved by DewClient.`);
    }
    if (!fs.existsSync(resolvedPath)) return null;
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_ASSET_BYTES) {
      throw new Error(`The active account ${kind} must be between 1 byte and 50 MiB.`);
    }

    const realDirectory = fs.realpathSync(accountCosmeticsDir);
    const realFilePath = fs.realpathSync(resolvedPath);
    if (path.dirname(realFilePath) !== realDirectory) {
      throw new Error(`The active account ${kind} file resolves outside its DewClient cosmetics folder.`);
    }

    const buffer = fs.readFileSync(realFilePath);
    const image = validateCosmeticImage(kind, buffer, contentType);
    return {
      buffer,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      contentType,
      width: image.width,
      height: image.height
    };
  }

  private rememberAsset(state: SyncState, baseUrl: string, playerUuid: string, kind: 'skin' | 'cape' | 'elytra', cosmetic: PublishedCosmetic): void {
    if (!isEnabledAsset(cosmetic)) return;
    state.assets[`${baseUrl}|${playerUuid}|${kind}|${cosmetic.sha256}`] = {
      enabled: true,
      assetId: cosmetic.assetId,
      sha256: cosmetic.sha256,
      contentType: cosmetic.contentType,
      byteSize: cosmetic.byteSize,
      width: cosmetic.width,
      height: cosmetic.height,
      updatedAt: cosmetic.updatedAt,
      cacheFileName: `${cosmetic.assetId}${cosmetic.contentType === 'image/png' ? '.png' : cosmetic.contentType === 'image/webp' ? '.webp' : '.jpg'}`
    } as any;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs = this.timeoutMs): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { redirect: 'error', ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), this.timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private fail(
    account: UserAccount,
    baseUrl: string,
    message: string,
    manifestKey = `${baseUrl}|${normalizeUuid(account.uuid)}`,
    attemptedAt = new Date().toISOString()
  ): CosmeticsSyncResult {
    try {
      const state = this.stateStore.read();
      const previous = state.manifests[manifestKey];
      state.manifests[manifestKey] = {
        ...(previous || { accountId: account.id, fingerprint: '', skin: null, cape: null, lastSuccessAt: '', status: 'failed' as const }),
        accountId: account.id,
        lastAttemptAt: attemptedAt,
        status: 'failed',
        lastError: message.slice(0, 240)
      };
      this.stateStore.write(state);
    } catch {
      // Local sync metadata is best-effort; it never affects local cosmetics files.
    }
    this.logger.warn('remote', `Cosmetics sync failed for the active account: ${message}`);
    return { status: 'failed', accountId: account.id, playerUuid: normalizeUuid(account.uuid), error: message };
  }
}

let cosmeticsSyncService: CosmeticsSyncService | null = null;

export function getCosmeticsSyncService(): CosmeticsSyncService {
  if (!cosmeticsSyncService) cosmeticsSyncService = new CosmeticsSyncService();
  return cosmeticsSyncService;
}
