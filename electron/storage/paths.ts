/**
 * DewClient - Local Paths and Directory Hierarchy Manager
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DIRECTORY_NAMES } from '../../shared/constants/defaults.ts';

function resolveConfiguredRootPath(customRoot?: string): string {
  if (customRoot) return customRoot;
  const explicitRoot = process.env.DEWCLIENT_DATA_DIR?.trim();
  if (explicitRoot) return explicitRoot;

  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, DIRECTORY_NAMES.DATA_ROOT);
  }
  return path.join(home, DIRECTORY_NAMES.DATA_ROOT);
}

export class PathManager {
  private rootPath: string;

  constructor(customRoot?: string) {
    this.rootPath = resolveConfiguredRootPath(customRoot);
    this.ensureDirectories();
  }

  public getRootPath(): string {
    return this.rootPath;
  }

  public getInstancesPath(): string {
    return path.join(this.rootPath, DIRECTORY_NAMES.INSTANCES);
  }

  public getInstancePath(instanceId: string): string {
    return path.join(this.getInstancesPath(), instanceId);
  }

  public getVersionsPath(): string {
    return path.join(this.rootPath, DIRECTORY_NAMES.VERSIONS);
  }

  public getVersionJsonPath(versionId: string): string {
    return path.join(this.getVersionsPath(), versionId, `${versionId}.json`);
  }

  public getVersionJarPath(versionId: string): string {
    return path.join(this.getVersionsPath(), versionId, `${versionId}.jar`);
  }

  public getLibrariesPath(): string {
    return path.join(this.rootPath, DIRECTORY_NAMES.LIBRARIES);
  }

  public getNativesPath(instanceId: string): string {
    return path.join(this.getInstancePath(instanceId), DIRECTORY_NAMES.NATIVES);
  }

  public getAssetsPath(): string {
    return path.join(this.rootPath, DIRECTORY_NAMES.ASSETS);
  }

  public getAssetIndexesPath(): string {
    return path.join(this.getAssetsPath(), 'indexes');
  }

  public getAssetObjectsPath(): string {
    return path.join(this.getAssetsPath(), 'objects');
  }

  public getRuntimesPath(): string {
    return path.join(this.rootPath, DIRECTORY_NAMES.RUNTIMES);
  }

  public getCachePath(): string {
    return path.join(this.rootPath, DIRECTORY_NAMES.CACHE);
  }

  public getLogsPath(): string {
    return path.join(this.rootPath, DIRECTORY_NAMES.LOGS);
  }

  public getConfigPath(): string {
    return path.join(this.rootPath, DIRECTORY_NAMES.CONFIG);
  }

  public getDownloadsPath(): string {
    return path.join(this.rootPath, 'downloads');
  }

  public getIdentityKeyPath(): string {
    return path.join(this.getConfigPath(), 'client_identity.json');
  }

  public getSettingsFilePath(): string {
    return path.join(this.getConfigPath(), 'settings.json');
  }

  public getAccountsFilePath(): string {
    return path.join(this.getConfigPath(), 'accounts.json');
  }

  public ensureDirectories(): void {
    const dirs = [
      this.rootPath,
      this.getInstancesPath(),
      this.getVersionsPath(),
      this.getLibrariesPath(),
      this.getAssetsPath(),
      this.getAssetIndexesPath(),
      this.getAssetObjectsPath(),
      this.getRuntimesPath(),
      this.getCachePath(),
      this.getLogsPath(),
      this.getConfigPath(),
      this.getDownloadsPath()
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
}

let defaultPathManager: PathManager | null = null;

export function getPathManager(): PathManager {
  const expectedRoot = resolveConfiguredRootPath();
  if (!defaultPathManager || defaultPathManager.getRootPath() !== expectedRoot) {
    defaultPathManager = new PathManager(expectedRoot);
  }
  return defaultPathManager;
}
