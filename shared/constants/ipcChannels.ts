/**
 * DewClient - Inter-Process Communication (IPC) Channels Contract
 */

export const IPC_CHANNELS = {
  // Authentication
  AUTH_START_MICROSOFT: 'auth.startMicrosoft',
  AUTH_DISCORD_START: 'auth.discordStart',
  AUTH_DISCORD_EXCHANGE: 'auth.discordExchange',
  AUTH_CANCEL_MICROSOFT: 'auth.cancelMicrosoft',
  AUTH_GET_ACCOUNTS: 'auth.getAccounts',
  AUTH_GET_ACTIVE: 'auth.getActive',
  AUTH_GET_COSMETICS: 'auth.getCosmetics',
  AUTH_GET_FREE_CAPES: 'auth.getFreeCapes',
  AUTH_GET_FREE_CAPE_PREVIEW: 'auth.getFreeCapePreview',
  AUTH_CREATE_DISCORD_CAPE_CLAIM_CODE: 'auth.createDiscordCapeClaimCode',
  AUTH_GET_DISCORD_CAPE_CLAIM_STATUS: 'auth.getDiscordCapeClaimStatus',
  AUTH_CLAIM_FREE_CAPE: 'auth.claimFreeCape',
  AUTH_EQUIP_FREE_CAPE: 'auth.equipFreeCape',
  AUTH_REFRESH_OFFICIAL_CAPES: 'auth.refreshOfficialCapes',
  AUTH_GET_ASSIGNED_COSMETIC_PREVIEW: 'auth.getAssignedCosmeticPreview',
  AUTH_SELECT_ACCOUNT: 'auth.selectAccount',
  AUTH_REMOVE_ACCOUNT: 'auth.removeAccount',
  AUTH_UPDATE_ACCOUNT: 'auth.updateAccount',
  AUTH_PICK_COSMETIC: 'auth.pickCosmetic',
  AUTH_GET_COSMETIC_PREVIEW: 'auth.getCosmeticPreview',
  AUTH_REMOVE_COSMETIC: 'auth.removeCosmetic',
  AUTH_REFRESH_SESSION: 'auth.refreshSession',
  AUTH_CHANGE_USERNAME: 'auth.changeUsername',

  // Privacy-scoped support
  SUPPORT_SUBMIT_BUG_REPORT: 'support.submitBugReport',

  // Offline Profiles
  PROFILES_LIST: 'profiles.list',
  PROFILES_CREATE: 'profiles.create',
  PROFILES_RENAME: 'profiles.rename',
  PROFILES_DELETE: 'profiles.delete',
  PROFILES_SELECT: 'profiles.select',

  // Minecraft Engine & Versions
  MINECRAFT_GET_VERSIONS: 'minecraft.getVersions',
  MINECRAFT_INSTALL_VERSION: 'minecraft.installVersion',
  MINECRAFT_IS_INSTALLED: 'minecraft.isInstalled',
  MINECRAFT_LAUNCH: 'minecraft.launch',
  MINECRAFT_STOP: 'minecraft.stop',
  MINECRAFT_GET_RUNNING: 'minecraft.getRunning',
  MINECRAFT_REPAIR: 'minecraft.repair',

  // Instances
  INSTANCES_LIST: 'instances.list',
  INSTANCES_GET: 'instances.get',
  INSTANCES_CREATE: 'instances.create',
  INSTANCES_UPDATE: 'instances.update',
  INSTANCES_DELETE: 'instances.delete',
  INSTANCES_DUPLICATE: 'instances.duplicate',
  INSTANCES_EXPORT: 'instances.export',
  INSTANCES_IMPORT: 'instances.import',
  INSTANCES_OPEN_FOLDER: 'instances.openFolder',
  INSTANCES_GET_ACTIVE: 'instances.getActive',
  INSTANCES_SELECT: 'instances.select',

  // Java Runtime
  JAVA_DETECT: 'java.detect',
  JAVA_VALIDATE: 'java.validate',
  JAVA_LIST_RUNTIMES: 'java.listRuntimes',
  JAVA_DOWNLOAD_RUNTIME: 'java.downloadRuntime',

  // Download Manager
  DOWNLOADS_LIST: 'downloads.list',
  DOWNLOADS_PAUSE: 'downloads.pause',
  DOWNLOADS_RESUME: 'downloads.resume',
  DOWNLOADS_CANCEL: 'downloads.cancel',
  DOWNLOADS_CLEAR_COMPLETED: 'downloads.clearCompleted',

  // Modrinth API Integration
  MODRINTH_SEARCH: 'modrinth.search',
  MODRINTH_GET_PROJECT: 'modrinth.getProject',
  MODRINTH_GET_VERSIONS: 'modrinth.getVersions',
  MODRINTH_GET_DEPENDENCIES: 'modrinth.getDependencies',
  MODRINTH_INSTALL: 'modrinth.install',
  MODRINTH_CHECK_UPDATES: 'modrinth.checkUpdates',

  // Content (Mods, Resourcepacks, Shaders)
  MODS_LIST: 'mods.list',
  CONTENT_LIST_INSTALLED_PROJECTS: 'content.listInstalledProjects',
  MODS_TOGGLE: 'mods.toggle',
  MODS_REMOVE: 'mods.remove',
  MODS_OPEN_FOLDER: 'mods.openFolder',

  RESOURCEPACKS_LIST: 'resourcepacks.list',
  RESOURCEPACKS_REMOVE: 'resourcepacks.remove',
  RESOURCEPACKS_OPEN_FOLDER: 'resourcepacks.openFolder',

  SHADERS_LIST: 'shaders.list',
  SHADERS_REMOVE: 'shaders.remove',
  SHADERS_OPEN_FOLDER: 'shaders.openFolder',

  MODPACKS_INSTALL: 'modpacks.install',

  // Central Management Integration
  REMOTE_GET_MANIFEST: 'remote.getManifest',
  REMOTE_GET_STATUS: 'remote.getStatus',
  REMOTE_GET_CLIENT_ID: 'remote.getClientId',
  REMOTE_TEST_CONNECTION: 'remote.testConnection',
  REMOTE_SET_SERVER_URL: 'remote.setServerUrl',
  REMOTE_FORCE_SYNC: 'remote.forceSync',
  REMOTE_GET_ONLINE_PROFILES: 'remote.getOnlineProfiles',

  UPDATER_CHECK_FOR_UPDATES: 'updater.checkForUpdates',
  UPDATER_DOWNLOAD_UPDATE: 'updater.downloadUpdate',
  UPDATER_OPEN_DOWNLOADED: 'updater.openDownloaded',
  UPDATER_INSTALL_DOWNLOADED: 'updater.installDownloaded',

  // Settings
  SETTINGS_GET: 'settings.get',
  SETTINGS_UPDATE: 'settings.update',
  SETTINGS_CLEAR_CACHE: 'settings.clearCache',

  // Logging & Diagnostics
  LOGS_READ: 'logs.read',
  LOGS_CLEAR: 'logs.clear',
  LOGS_OPEN_FOLDER: 'logs.openFolder',

  // System & Platform
  SYSTEM_OPEN_EXTERNAL: 'system.openExternal',
  SYSTEM_GET_INFO: 'system.getInfo',

  // Server List Ping
  SERVER_QUERY_STATUS: 'server.queryStatus',

  // Events (Main -> Renderer Push)
  EVENT_DOWNLOAD_PROGRESS: 'event.downloadProgress',
  EVENT_LAUNCH_STATUS: 'event.launchStatus',
  EVENT_GAME_LOG: 'event.gameLog',
  EVENT_AUTH_STATUS: 'event.authStatus',
  EVENT_INSTALL_PROGRESS: 'event.installProgress',
  EVENT_UPDATE_PROGRESS: 'event.updateProgress',
  EVENT_REMOTE_MANIFEST_UPDATED: 'event.remoteManifestUpdated',
  EVENT_COSMETICS_SYNC: 'event.cosmeticsSync'
} as const;

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
