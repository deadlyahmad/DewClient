/**
 * DewClient - Instance and Version Repair Service
 */

import fs from 'node:fs';
import { ManifestService } from './manifestService.ts';
import { ArtifactResolver } from './artifactResolver.ts';
import { LibraryResolver } from './libraryResolver.ts';
import { AssetService } from './assetService.ts';
import { InstallService } from './installService.ts';
import { getLogger } from '../core/logger.ts';

export interface RepairDiagnostics {
  isHealthy: boolean;
  missingClientJar: boolean;
  corruptedLibrariesCount: number;
  corruptedAssetsCount: number;
  totalLibrariesChecked: number;
  totalAssetsChecked: number;
}

export class RepairService {
  private manifestService = new ManifestService();
  private artifactResolver = new ArtifactResolver();
  private libraryResolver = new LibraryResolver();
  private assetService = new AssetService();
  private installService = new InstallService();

  public async checkHealth(versionId: string): Promise<RepairDiagnostics> {
    const logger = getLogger();
    logger.info('repair', `Checking health for version ${versionId}...`);

    const pkg = await this.manifestService.getVersionPackage(versionId);
    const clientJar = this.artifactResolver.resolveClientJar(pkg);
    const resolvedLibs = this.libraryResolver.resolveLibraries(pkg);
    const assetIndex = await this.assetService.fetchAssetIndex(pkg);
    const resolvedAssets = this.assetService.resolveAssets(assetIndex);

    const missingClientJar = !this.artifactResolver.verifyArtifact(clientJar);

    let corruptedLibrariesCount = 0;
    for (const lib of resolvedLibs) {
      if (!this.libraryResolver.isLibraryValid(lib)) {
        corruptedLibrariesCount++;
      }
    }

    let corruptedAssetsCount = 0;
    for (const asset of resolvedAssets) {
      if (!this.assetService.verifyAssetSha1(asset)) {
        corruptedAssetsCount++;
      }
    }

    const isHealthy = !missingClientJar && corruptedLibrariesCount === 0 && corruptedAssetsCount === 0;

    return {
      isHealthy,
      missingClientJar,
      corruptedLibrariesCount,
      corruptedAssetsCount,
      totalLibrariesChecked: resolvedLibs.length,
      totalAssetsChecked: resolvedAssets.length
    };
  }

  public async repairVersion(
    versionId: string,
    instanceId: string,
    onProgress?: (progress: any) => void
  ): Promise<boolean> {
    const logger = getLogger();
    logger.info('repair', `Initiating repair pipeline for ${versionId} (Instance: ${instanceId})...`);

    // Force re-installation of missing/corrupted components
    await this.installService.installVersion(versionId, instanceId, onProgress);
    return true;
  }
}
