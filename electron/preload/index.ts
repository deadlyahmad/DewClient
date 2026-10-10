/**
 * DewClient - Secure Preload Context Bridge
 * Exposes strictly typed APIs with contextIsolation and zero nodeIntegration
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipcChannels.ts';

function formatGameLog(data: any): string {
  if (typeof data === 'string') return data;
  if (data && typeof data.message === 'string') {
    const level = typeof data.level === 'string' ? `[${data.level}] ` : '';
    return `${level}${data.message}`;
  }
  return String(data ?? '');
}

const dewclientApi = {
  // Authentication
  auth: {
    startMicrosoft: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_START_MICROSOFT),
    loginMicrosoft: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_START_MICROSOFT),
    startDiscordLogin: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_DISCORD_START),
    completeDiscordLogin: (input: { ticket: string; username?: string }) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_DISCORD_EXCHANGE, input),
    cancelMicrosoft: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CANCEL_MICROSOFT),
    getAccounts: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_ACCOUNTS),
    getActiveAccount: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_ACTIVE),
    getCosmetics: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_COSMETICS),
    getFreeCapes: (accountId?: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_FREE_CAPES, accountId),
    getFreeCapePreview: (accountId: string, assetId: string, sha256: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_FREE_CAPE_PREVIEW, { accountId, assetId, sha256 }),
    createDiscordCapeClaimCode: (accountId: string, assetId?: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CREATE_DISCORD_CAPE_CLAIM_CODE, { accountId, assetId }),
    getDiscordCapeClaimStatus: (accountId: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_DISCORD_CAPE_CLAIM_STATUS, accountId),
    claimFreeCape: (accountId: string, assetId: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CLAIM_FREE_CAPE, { accountId, assetId }),
    equipFreeCape: (accountId: string, assetId: string | null) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_EQUIP_FREE_CAPE, { accountId, assetId }),
    refreshOfficialCapes: (accountId: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_REFRESH_OFFICIAL_CAPES, accountId),
    getAssignedCosmeticPreview: (accountId: string, kind: 'skin' | 'cape' | 'elytra', assetId: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_ASSIGNED_COSMETIC_PREVIEW, { accountId, kind, assetId }),
    setActiveAccount: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_SELECT_ACCOUNT, id),
    selectAccount: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_SELECT_ACCOUNT, id),
    removeAccount: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_REMOVE_ACCOUNT, id),
    updateAccount: (id: string, partial: any) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_UPDATE_ACCOUNT, { id, partial }),
    pickCosmetic: (accountId: string, kind: 'skin' | 'cape' | 'elytra', slot?: number) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_PICK_COSMETIC, { accountId, kind, slot }),
    getCosmeticPreview: (accountId: string, assetPath: string, kind: 'skin' | 'cape' | 'elytra') => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_COSMETIC_PREVIEW, { accountId, assetPath, kind }),
    removeCosmetic: (accountId: string, kind: 'skin' | 'cape' | 'elytra') => ipcRenderer.invoke(IPC_CHANNELS.AUTH_REMOVE_COSMETIC, { accountId, kind }),
    createOfflineProfile: (username: string) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_CREATE, username),
    changeUsername: (payload: { accountId: string; username: string }) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CHANGE_USERNAME, payload),
    onAuthStatus: (callback: (status: any) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENT_AUTH_STATUS, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENT_AUTH_STATUS, listener);
    },
    onCosmeticsSync: (callback: (status: any) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENT_COSMETICS_SYNC, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENT_COSMETICS_SYNC, listener);
    }
  },

  // Minecraft Engine
  minecraft: {
    getVersions: (channel?: 'release' | 'all') => ipcRenderer.invoke(IPC_CHANNELS.MINECRAFT_GET_VERSIONS, channel),
    getFabricVersions: () => ipcRenderer.invoke('minecraft.getFabricVersions'),
    getManifest: () => ipcRenderer.invoke(IPC_CHANNELS.MINECRAFT_GET_VERSIONS, 'all'),
    isInstalled: (versionId: string) => ipcRenderer.invoke(IPC_CHANNELS.MINECRAFT_IS_INSTALLED, versionId),
    installVersion: (versionId: string, instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.MINECRAFT_INSTALL_VERSION, { versionId, instanceId }),
    launch: (params: string | { instanceId: string }) => {
      const instanceId = typeof params === 'string' ? params : params.instanceId;
      return ipcRenderer.invoke(IPC_CHANNELS.MINECRAFT_LAUNCH, instanceId);
    },
    stop: (instanceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.MINECRAFT_STOP, instanceId || ''),
    getRunning: () => ipcRenderer.invoke(IPC_CHANNELS.MINECRAFT_GET_RUNNING),
    repair: (instanceOrVersionId: string, instanceId?: string) => {
      const vId = instanceId ? instanceOrVersionId : undefined;
      const instId = instanceId || instanceOrVersionId;
      return ipcRenderer.invoke(IPC_CHANNELS.MINECRAFT_REPAIR, { versionId: vId, instanceId: instId });
    },
    onInstallProgress: (callback: (progress: any) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENT_INSTALL_PROGRESS, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENT_INSTALL_PROGRESS, listener);
    },
    onLaunchStatus: (callback: (status: any) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENT_LAUNCH_STATUS, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENT_LAUNCH_STATUS, listener);
    },
    onGameLog: (callback: (log: any) => void) => {
      const listener = (_: any, data: any) => callback(formatGameLog(data));
      ipcRenderer.on(IPC_CHANNELS.EVENT_GAME_LOG, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENT_GAME_LOG, listener);
    }
  },

  // Events listener alias for App.tsx
  events: {
    onLaunchStatus: (callback: (status: any) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENT_LAUNCH_STATUS, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENT_LAUNCH_STATUS, listener);
    },
    onInstallProgress: (callback: (progress: any) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENT_INSTALL_PROGRESS, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENT_INSTALL_PROGRESS, listener);
    },
    onGameLog: (callback: (log: any) => void) => {
      const listener = (_: any, data: any) => callback(formatGameLog(data));
      ipcRenderer.on(IPC_CHANNELS.EVENT_GAME_LOG, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENT_GAME_LOG, listener);
    }
  },

  // Instances
  instances: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_GET, id),
    getActive: () => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_GET_ACTIVE),
    select: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_SELECT, id),
    create: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_CREATE, data),
    update: (id: string, partial: any) => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_UPDATE, { id, partial }),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_DELETE, id),
    duplicate: (id: string, newName?: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_DUPLICATE, { id, newName }),
    export: (id: string, exportPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_EXPORT, { id, exportPath }),
    import: (zipPath?: string, name?: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_IMPORT, { zipPath, name }),
    openFolder: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES_OPEN_FOLDER, id)
  },

  // Java Runtimes & runtime alias
  java: {
    detect: () => ipcRenderer.invoke(IPC_CHANNELS.JAVA_DETECT),
    validate: (javaPath: string) => ipcRenderer.invoke(IPC_CHANNELS.JAVA_VALIDATE, javaPath),
    downloadRuntime: (majorVersion: number) => ipcRenderer.invoke(IPC_CHANNELS.JAVA_DOWNLOAD_RUNTIME, majorVersion)
  },
  runtime: {
    getInstalledRuntimes: () => ipcRenderer.invoke(IPC_CHANNELS.JAVA_DETECT),
    validateJavaPath: (javaPath: string) => ipcRenderer.invoke(IPC_CHANNELS.JAVA_VALIDATE, javaPath),
    downloadRuntime: (majorVersion: number) => ipcRenderer.invoke(IPC_CHANNELS.JAVA_DOWNLOAD_RUNTIME, majorVersion)
  },

  // Content & Modrinth
  content: {
    modrinthSearch: (params: any) => ipcRenderer.invoke(IPC_CHANNELS.MODRINTH_SEARCH, params),
    searchModrinth: (params: any) => ipcRenderer.invoke(IPC_CHANNELS.MODRINTH_SEARCH, params),
    modrinthGetProject: (slug: string) => ipcRenderer.invoke(IPC_CHANNELS.MODRINTH_GET_PROJECT, slug),
    modrinthGetVersions: (slug: string, gameVersion?: string, loaders?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.MODRINTH_GET_VERSIONS, { slug, gameVersion, loaders }),
    listMods: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.MODS_LIST, instanceId),
    getInstalledMods: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.MODS_LIST, instanceId),
    getInstalledProjectIds: (instanceId: string, projectType?: 'mod' | 'resourcepack' | 'shader', candidateProjectIds?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONTENT_LIST_INSTALLED_PROJECTS, { instanceId, projectType, candidateProjectIds }),
    toggleMod: (instanceId: string, fileName: string) => ipcRenderer.invoke(IPC_CHANNELS.MODS_TOGGLE, { instanceId, fileName }),
    deleteMod: (instanceId: string, fileName: string) => ipcRenderer.invoke(IPC_CHANNELS.MODS_REMOVE, { instanceId, fileName }),
    removeMod: (instanceId: string, fileName: string) => ipcRenderer.invoke(IPC_CHANNELS.MODS_REMOVE, { instanceId, fileName }),
    listResourcePacks: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.RESOURCEPACKS_LIST, instanceId),
    removeResourcePack: (instanceId: string, fileName: string) => ipcRenderer.invoke(IPC_CHANNELS.RESOURCEPACKS_REMOVE, { instanceId, fileName }),
    listShaders: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.SHADERS_LIST, instanceId),
    removeShader: (instanceId: string, fileName: string) => ipcRenderer.invoke(IPC_CHANNELS.SHADERS_REMOVE, { instanceId, fileName }),
    installMrpack: (mrpackPath: string, instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.MODPACKS_INSTALL, { mrpackPath, instanceId }),
    installContent: (instanceId: string, projectId: string, projectType?: string) =>
      ipcRenderer.invoke('content.install', { instanceId, projectId, projectType: projectType || 'mod' }),
    installMod: (instanceId: string, projectId: string) =>
      ipcRenderer.invoke('content.install', { instanceId, projectId, projectType: 'mod' }),
    installResourcePack: (instanceId: string, projectId: string) =>
      ipcRenderer.invoke('content.install', { instanceId, projectId, projectType: 'resourcepack' }),
    installShader: (instanceId: string, projectId: string) =>
      ipcRenderer.invoke('content.install', { instanceId, projectId, projectType: 'shader' }),
    installModpack: (projectId: string, options?: { instanceName?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.MODRINTH_INSTALL, { projectId, instanceName: options?.instanceName })
  },

  // Remote Management
  remote: {
    getManifest: () => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_GET_MANIFEST),
    getClientId: () => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_GET_CLIENT_ID),
    getNews: async () => {
      const m = await ipcRenderer.invoke(IPC_CHANNELS.REMOTE_GET_MANIFEST).catch(() => null);
      return m?.news || [];
    },
    getAnnouncements: async () => {
      const m = await ipcRenderer.invoke(IPC_CHANNELS.REMOTE_GET_MANIFEST).catch(() => null);
      return m?.announcements || [];
    },
    getFeaturedServers: async () => {
      const m = await ipcRenderer.invoke(IPC_CHANNELS.REMOTE_GET_MANIFEST).catch(() => null);
      return m?.featuredServers || [];
    },
    testConnection: (url?: string) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_TEST_CONNECTION, url),
    forceSync: () => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FORCE_SYNC),
    getOnlineProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_GET_ONLINE_PROFILES)
  },

  updater: {
    checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK_FOR_UPDATES),
    downloadUpdate: (force = false) => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_DOWNLOAD_UPDATE, force),
    openDownloadedUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_OPEN_DOWNLOADED),
    installDownloadedUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_INSTALL_DOWNLOADED),
    onDownloadProgress: (callback: (progress: any) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENT_UPDATE_PROGRESS, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENT_UPDATE_PROGRESS, listener);
    }
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    update: (partial: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, partial)
  },

  // Bug reports include only the text the user enters and public version data.
  support: {
    submitBugReport: (input: { category: 'launcher' | 'game-launch' | 'account' | 'cosmetics' | 'other'; title: string; description: string; clientVersion: string; minecraftVersion: string | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUPPORT_SUBMIT_BUG_REPORT, input)
  },

  // System
  system: {
    openExternal: (targetUrl: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, targetUrl),
    openDataDir: () => ipcRenderer.invoke('system.openDataDir'),
    resetLauncherData: () => ipcRenderer.invoke('system.resetLauncherData'),
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_INFO)
  }
};

contextBridge.exposeInMainWorld('dewclient', dewclientApi);
