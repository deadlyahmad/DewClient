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
};
export const DEFAULT_JVM_ARGS = [
    '-XX:+UseG1GC',
    '-Dsun.rmi.dgc.client.gcInterval=2147483646',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:G1NewSizePercent=20',
    '-XX:G1ReservePercent=20',
    '-XX:MaxGCPauseMillis=50',
    '-XX:G1HeapRegionSize=32M'
];
export const DEFAULT_SETTINGS = {
    general: {
        startWithWindows: false,
        minimizeToTray: false,
        closeToTray: false,
        theme: 'black',
        language: 'en',
        animations: true,
        versionChannel: 'release',
        hasCompletedIntro: false
    },
    minecraft: {
        defaultJavaPath: '',
        memoryMb: 4096,
        defaultJvmArgs: DEFAULT_JVM_ARGS.join(' '),
        defaultGameArgs: '',
        defaultLoader: 'fabric',
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
        defaultSearchType: 'mod',
        autoCheckModUpdates: true,
        managedProjectIds: ['fabric-api']
    },
    launcher: {
        checkForUpdates: true,
        autoInstallUpdates: false,
        closeOnLaunch: false,
        debugLogging: false,
        developerMode: false
    },
    remote: {
        serverUrl: 'https://server.dewclient.fun/api/v1',
        enabled: true,
        autoSync: true
    }
};
