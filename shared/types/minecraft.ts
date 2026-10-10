/**
 * DewClient - Minecraft Types and Launch Contracts
 */

export interface MinecraftVersionMetadata {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel: number;
  isInstalled?: boolean;
}

export interface MinecraftManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: MinecraftVersionMetadata[];
}

export interface VersionDownloads {
  client?: {
    sha1: string;
    size: number;
    url: string;
  };
  server?: {
    sha1: string;
    size: number;
    url: string;
  };
}

export interface ArgumentRule {
  action: 'allow' | 'disallow';
  os?: {
    name?: 'windows' | 'osx' | 'linux';
    arch?: string;
    version?: string;
  };
  features?: Record<string, boolean>;
}

export type MinecraftVersion = MinecraftVersionMetadata;

export interface LibraryArtifact {
  path: string;
  sha1?: string;
  size?: number;
  url?: string;
}

export interface Library {
  name: string;
  downloads?: {
    artifact?: LibraryArtifact;
    classifiers?: Record<string, LibraryArtifact>;
  };
  rules?: ArgumentRule[];
  url?: string;
  sha1?: string;
  size?: number;
  natives?: Record<string, string>;
}

export interface AssetObject {
  hash: string;
  size: number;
}

export interface AssetIndex {
  id: string;
  sha1: string;
  size: number;
  totalSize: number;
  url: string;
  objects?: Record<string, AssetObject>;
}

export interface MinecraftVersionPackage {
  id: string;
  type: string;
  mainClass: string;
  inheritsFrom?: string;
  javaVersion?: {
    component: string;
    majorVersion: number;
  };
  downloads?: VersionDownloads;
  libraries: Library[];
  assetIndex?: AssetIndex;
  arguments?: {
    game?: Array<string | { rules?: ArgumentRule[]; value: string | string[] }>;
    jvm?: Array<string | { rules?: ArgumentRule[]; value: string | string[] }>;
  };
  minecraftArguments?: string;
  complianceLevel?: number;
}

export interface ResolvedLibrary {
  name: string;
  path: string;
  url: string;
  sha1?: string;
  size?: number;
  isNative: boolean;
}

export interface LaunchConfiguration {
  versionId: string;
  instanceId: string;
  gameDirectory: string;
  assetsDirectory: string;
  nativesDirectory: string;
  resolutionWidth?: number;
  resolutionHeight?: number;
  fullscreen?: boolean;
  features?: Record<string, boolean>;
  javaPath: string;
  mainClass: string;
  jvmArgs: string[];
  gameArgs: string[];
  classpath: string[];
  memoryMb: number;
  auth: {
    username: string;
    uuid: string;
    accessToken: string;
    userType: string;
    userProperties?: Record<string, unknown>;
  };
  quickPlay?: QuickPlayConfig;
}

export interface QuickPlayConfig {
  type: 'singleplayer' | 'multiplayer' | 'realms';
  target: string;
}

export interface LaunchOptions {
  quickPlay?: QuickPlayConfig;
  fullscreen?: boolean;
  resolutionWidth?: number;
  resolutionHeight?: number;
}

export interface LaunchStatusUpdate {
  instanceId: string;
  state: 'idle' | 'checking' | 'downloading' | 'preparing' | 'launching' | 'running' | 'error';
  pid?: number;
  exitCode?: number;
  message: string;
  progress?: {
    phase: string;
    progressPercent: number;
    downloadedBytes?: number;
    totalBytes?: number;
    speedBytesPerSec?: number;
    etaSeconds?: number;
  };
  diagnosticError?: {
    title: string;
    message: string;
    details?: string;
    actionLabel?: string;
    actionRoute?: string;
  };
}

export interface GameLogEntry {
  instanceId: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'STDOUT' | 'STDERR';
  message: string;
}

export interface ServerStatusResult {
  host: string;
  online: boolean;
  latencyMs: number;
  players?: {
    online: number;
    max: number;
  };
  version?: string;
  motd?: string;
  icon?: string;
  state: 'online' | 'offline' | 'timeout' | 'error';
  error?: string;
}
