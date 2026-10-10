/**
 * DewClient - Renderer Global Type Declarations
 */

import type { UserAccount, MicrosoftAccount, OfflineProfile, AuthProgressStatus } from '../../shared/types/account.ts';
import type {
  MinecraftVersionMetadata,
  MinecraftVersionPackage,
  LaunchStatusUpdate,
  GameLogEntry
} from '../../shared/types/minecraft.ts';
import type { InstanceConfig, InstanceWithStats } from '../../shared/types/instance.ts';
import type { JavaInstallation, JavaValidationResult } from '../../shared/types/runtime.ts';
import type { ModItem, PackItem, ModrinthSearchResult, ModrinthProjectDetails, ModrinthVersion } from '../../shared/types/content.ts';
import type { RemoteManifestSnapshot, RemoteConnectionTestResult, RemoteNewsItem, RemoteAnnouncement, RemoteFeaturedServer } from '../../shared/types/remote.ts';
import type { GameInstallProgress } from '../../shared/types/download.ts';
import type { DEFAULT_SETTINGS } from '../../shared/constants/defaults.ts';

export interface DewClientAPI {
  auth: {
    startMicrosoft: () => Promise<MicrosoftAccount>;
    loginMicrosoft: () => Promise<MicrosoftAccount>;
    startDiscordLogin: () => Promise<{ ticket: string }>;
    completeDiscordLogin: (input: { ticket: string; username?: string }) => Promise<{ account?: UserAccount; requiresUsername?: boolean; suggestedUsername?: string; ticket?: string }>;
    cancelMicrosoft: () => Promise<boolean>;
    getAccounts: () => Promise<UserAccount[]>;
    getActiveAccount: () => Promise<UserAccount | null>;
    getCosmetics: () => Promise<any>;
    getFreeCapes: (accountId?: string) => Promise<{ items: Array<{ assetId: string; sha256: string; name: string; kind: 'cape'; width: number | null; height: number | null; byteSize: number; createdAt: string; claimed: boolean }>; identityRequired: string | null; discordLinked: boolean; selectedCapeAssetId: string | null }>;
    getFreeCapePreview: (accountId: string, assetId: string, sha256: string) => Promise<string>;
    createDiscordCapeClaimCode: (accountId: string, assetId?: string) => Promise<{ words: string[]; expiresAt: string; discordInviteUrl: string; instruction: string; alreadyLinked?: boolean }>;
    getDiscordCapeClaimStatus: (accountId: string) => Promise<{ playerUuid: string; claimedAssetIds: string[]; discordLinked: boolean; discordLinkedAt: string | null; discordUsername: string | null; discordDisplayName: string | null }>;
    claimFreeCape: (accountId: string, assetId: string) => Promise<{ claimed: boolean; requiresLink: boolean; alreadyClaimed: boolean; equipped?: boolean; selectedCapeAssetId?: string | null; message?: string }>;
    equipFreeCape: (accountId: string, assetId: string | null) => Promise<{ equipped: boolean; cleared: boolean; selectedCapeAssetId: string | null }>;
    refreshOfficialCapes: (accountId: string) => Promise<UserAccount | null>;
    getAssignedCosmeticPreview: (accountId: string, kind: 'skin' | 'cape' | 'elytra', assetId: string) => Promise<string>;
    setActiveAccount: (id: string) => Promise<UserAccount | null>;
    selectAccount: (id: string) => Promise<UserAccount | null>;
    removeAccount: (id: string) => Promise<boolean>;
    updateAccount: (id: string, partial: any) => Promise<UserAccount | null>;
    pickCosmetic: (accountId: string, kind: 'skin' | 'cape' | 'elytra', slot?: number) => Promise<{ path: string; previewUrl: string } | null>;
    getCosmeticPreview: (accountId: string, assetPath: string, kind: 'skin' | 'cape' | 'elytra') => Promise<string>;
    removeCosmetic: (accountId: string, kind: 'skin' | 'cape' | 'elytra') => Promise<boolean>;
    createOfflineProfile: (username: string) => Promise<OfflineProfile>;
    changeUsername: (payload: { accountId: string; username: string }) => Promise<UserAccount>;
    onAuthStatus: (callback: (status: AuthProgressStatus) => void) => () => void;
    onCosmeticsSync: (callback: (status: any) => void) => () => void;
  };
  minecraft: {
    getVersions: (channel?: 'release' | 'all') => Promise<MinecraftVersionMetadata[]>;
    getFabricVersions: () => Promise<string[]>;
    getManifest: () => Promise<MinecraftVersionMetadata[]>;
    isInstalled: (versionId: string) => Promise<boolean>;
    installVersion: (versionId: string, instanceId: string) => Promise<any>;
    launch: (params: string | { instanceId: string }) => Promise<number>;
    stop: (instanceId?: string) => Promise<boolean>;
    getRunning: () => Promise<Record<string, number>>;
    repair: (instanceOrVersionId: string, instanceId?: string) => Promise<boolean>;
    onInstallProgress: (callback: (progress: GameInstallProgress) => void) => () => void;
    onLaunchStatus: (callback: (status: LaunchStatusUpdate) => void) => () => void;
    onGameLog: (callback: (log: GameLogEntry) => void) => () => void;
  };
  events?: {
    onLaunchStatus: (callback: (status: any) => void) => () => void;
    onInstallProgress: (callback: (progress: any) => void) => () => void;
    onGameLog: (callback: (log: string) => void) => () => void;
  };
  instances: {
    list: () => Promise<InstanceWithStats[]>;
    get: (id: string) => Promise<InstanceWithStats | null>;
    getActive: () => Promise<InstanceWithStats | null>;
    select: (id: string) => Promise<InstanceWithStats | null>;
    create: (data: Partial<InstanceConfig>) => Promise<InstanceConfig>;
    update: (id: string, partial: Partial<InstanceConfig>) => Promise<InstanceConfig>;
    delete: (id: string) => Promise<boolean>;
    duplicate: (id: string, newName?: string) => Promise<InstanceConfig>;
    export: (id: string, exportPath?: string) => Promise<string | null>;
    import: (zipPath?: string, name?: string) => Promise<InstanceConfig | null>;
    openFolder: (id: string) => Promise<boolean>;
  };
  java: {
    detect: () => Promise<JavaInstallation[]>;
    validate: (javaPath: string) => Promise<JavaValidationResult>;
    downloadRuntime: (majorVersion: number) => Promise<string>;
  };
  runtime?: {
    getInstalledRuntimes: () => Promise<JavaInstallation[]>;
    validateJavaPath: (javaPath: string) => Promise<JavaValidationResult>;
    downloadRuntime: (majorVersion: number) => Promise<string>;
  };
  content: {
    modrinthSearch: (params: any) => Promise<ModrinthSearchResult>;
    searchModrinth: (params: any) => Promise<ModrinthSearchResult>;
    modrinthGetProject: (slug: string) => Promise<ModrinthProjectDetails>;
    modrinthGetVersions: (slug: string, gameVersion?: string, loaders?: string[]) => Promise<ModrinthVersion[]>;
    listMods: (instanceId: string) => Promise<ModItem[]>;
    getInstalledMods: (instanceId: string) => Promise<ModItem[]>;
    getInstalledProjectIds: (instanceId: string, projectType?: 'mod' | 'resourcepack' | 'shader', candidateProjectIds?: string[]) => Promise<string[]>;
    toggleMod: (instanceId: string, fileName: string, enabled?: boolean) => Promise<boolean>;
    deleteMod: (instanceId: string, fileName: string) => Promise<boolean>;
    removeMod: (instanceId: string, fileName: string) => Promise<boolean>;
    listResourcePacks: (instanceId: string) => Promise<PackItem[]>;
    removeResourcePack: (instanceId: string, fileName: string) => Promise<boolean>;
    listShaders: (instanceId: string) => Promise<PackItem[]>;
    removeShader: (instanceId: string, fileName: string) => Promise<boolean>;
    installMrpack: (mrpackPath: string, instanceId: string) => Promise<boolean>;
    installModpack: (projectId: string, options?: { instanceName?: string }) => Promise<InstanceConfig>;
    installMod: (instanceId: string, projectId: string) => Promise<boolean>;
    installContent: (instanceId: string, projectId: string, projectType?: string) => Promise<boolean>;
    installResourcePack: (instanceId: string, projectId: string) => Promise<boolean>;
    installShader: (instanceId: string, projectId: string) => Promise<boolean>;
  };
  remote: {
    getManifest: () => Promise<RemoteManifestSnapshot>;
    getClientId: () => Promise<string | null>;
    getNews: () => Promise<RemoteNewsItem[]>;
    getAnnouncements: () => Promise<RemoteAnnouncement[]>;
    getFeaturedServers: () => Promise<RemoteFeaturedServer[]>;
    testConnection: (url?: string) => Promise<RemoteConnectionTestResult>;
    forceSync: () => Promise<RemoteManifestSnapshot>;
    getOnlineProfiles: () => Promise<any[]>;
  };
  updater: {
    checkForUpdates: () => Promise<{ updateAvailable: boolean; mandatory: boolean; currentVersion: string; latestVersion: string; updateUrl: string; notesUrl?: string; }>;
    downloadUpdate: (force?: boolean) => Promise<{ status: 'up-to-date' | 'downloaded' | 'failed'; version: string; filePath?: string; message: string; }>;
    openDownloadedUpdate: () => Promise<boolean>;
    installDownloadedUpdate: () => Promise<boolean>;
    onDownloadProgress: (callback: (progress: {
      status: 'preparing' | 'downloading' | 'verifying' | 'complete' | 'failed';
      progressPercent: number;
      downloadedBytes: number;
      totalBytes: number;
      message: string;
      filePath?: string;
    }) => void) => () => void;
  };
  settings: {
    get: () => Promise<typeof DEFAULT_SETTINGS>;
    update: (partial: any) => Promise<typeof DEFAULT_SETTINGS>;
  };
  support: {
    submitBugReport: (input: {
      category: 'launcher' | 'game-launch' | 'account' | 'cosmetics' | 'other';
      title: string;
      description: string;
      clientVersion: string;
      minecraftVersion: string | null;
    }) => Promise<{ id: string }>;
  };
  system: {
    openPath: (targetPath: string) => Promise<boolean>;
    openExternal: (targetUrl: string) => Promise<boolean>;
    openDataDir?: () => Promise<boolean>;
    resetLauncherData: () => Promise<boolean>;
    getInfo: () => Promise<{
      productName: string;
      version: string;
      platform: string;
      arch: string;
      osVersion: string;
      totalMemoryBytes: number;
      freeMemoryBytes: number;
      totalMemoryMb: number;
      freeMemoryMb: number;
      recommendedMemoryMb: number;
      cpuModel?: string;
      cpuCores?: number;
    }>;
  };
}

declare global {
  interface Window {
    dewclient: DewClientAPI;
  }
}
