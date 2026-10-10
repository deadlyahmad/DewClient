/**
 * DewClient - Default Configurations & Constants
 */

export const DIRECTORY_NAMES = {
  DATA_ROOT: '.dewclient',
  ACCOUNTS: 'accounts',
  PROFILES: 'profiles',
  INSTANCES: 'instances',
  VERSIONS: 'versions',
  ASSETS: 'assets',
  LIBRARIES: 'libraries',
  NATIVES: 'natives',
  RUNTIMES: 'runtimes',
  DOWNLOADS: 'downloads',
  METADATA: 'metadata',
  CACHE: 'cache',
  MODS: 'mods',
  RESOURCEPACKS: 'resourcepacks',
  SHADERPACKS: 'shaderpacks',
  MODPACKS: 'modpacks',
  LOGS: 'logs',
  BACKUPS: 'backups',
  CONFIG: 'config',
  DATABASE: 'launcher.db'
} as const;

export const DEFAULT_JVM_ARGS = [
  '-XX:+UseG1GC',
  '-Dsun.rmi.dgc.client.gcInterval=2147483646',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:G1NewSizePercent=20',
  '-XX:G1ReservePercent=20',
  '-XX:MaxGCPauseMillis=50',
  '-XX:G1HeapRegionSize=32M'
];

export const OFFICIAL_DEWCLIENT_API_URL = 'https://server.dewclient.fun/api/v1';
export const OFFICIAL_DEWCLIENT_WEBSITE_URL = 'https://dewclient.fun';
export const OFFICIAL_DEWCLIENT_DISCORD_URL = 'https://discord.gg/uXs2YD4D6H';

export function resolveRemoteServerBaseUrl(rawUrl?: string, options: { allowLocalhostInTests?: boolean } = {}): string {
  const candidate = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  const officialUrl = OFFICIAL_DEWCLIENT_API_URL.replace(/\/+$/, '');
  if (!candidate) return officialUrl;

  try {
    const parsed = new URL(candidate);
    const officialOrigin = new URL(officialUrl).origin;
    const isOfficial = parsed.origin === officialOrigin && parsed.pathname.replace(/\/+$/, '') === '/api/v1';
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) && /^https?:$/.test(parsed.protocol);
    if (isOfficial || (options.allowLocalhostInTests && isLocalhost)) {
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    // fall through to rejection below
  }

  throw new Error('Only the official DewClient API server is supported in production. Custom remote server URLs are not allowed.');
}

export const DEFAULT_SETTINGS = {
  general: {
    startWithWindows: false,
    minimizeToTray: false,
    closeToTray: false,
    theme: 'black' as 'black' | 'white',
    language: 'en' as const,
    animations: true,
    versionChannel: 'release' as const,
    hasCompletedIntro: false
  },
  minecraft: {
    defaultJavaPath: '',
    memoryMb: 4096,
    defaultJvmArgs: DEFAULT_JVM_ARGS.join(' '),
    defaultGameArgs: '',
    defaultLoader: 'fabric' as const,
    resolutionWidth: 1280,
    resolutionHeight: 720,
    fullscreen: false,
    checkHashVerification: true
  },
  downloads: {
    maxConcurrentDownloads: 6,
    retryAttempts: 3,
    downloadCacheEnabled: true,
    requestTimeoutMs: 30000
  },
  modrinth: {
    cacheDurationMinutes: 60,
    defaultSearchType: 'mod' as const,
    autoCheckModUpdates: true,
    managedProjectIds: ['fabric-api']
  },
  launcher: {
    checkForUpdates: true,
    autoInstallUpdates: false,
    closeOnLaunch: false,
    richPresenceEnabled: true,
    discordClientId: '1554555504410370149',
    debugLogging: false,
    developerMode: false
  },
  remote: {
    serverUrl: OFFICIAL_DEWCLIENT_API_URL,
    enabled: true,
    autoSync: true,
    shareAccountUsage: true,
    shareOnlinePresence: true,
    privacyDefaultsVersion: 2,
    revokeSharedDataPending: false
  }
};
