/**
 * DewClient - Minecraft Installation Pipeline Coordinator
 * Real concurrent downloads, SHA-1 verification, native extraction, real progress tracking
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import type { GameInstallProgress } from '../../shared/types/download.ts';
import type { MinecraftVersionPackage } from '../../shared/types/minecraft.ts';
import { ManifestService } from './manifestService.ts';
import { ArtifactResolver } from './artifactResolver.ts';
import { LibraryResolver } from './libraryResolver.ts';
import { AssetService } from './assetService.ts';
import { RuntimeService, getRequiredJavaForPackage } from '../runtime/runtimeService.ts';
import { getPathManager } from '../storage/paths.ts';
import { getLogger } from '../core/logger.ts';
import { FabricService } from './fabricService.ts';

export class InstallService {
  private manifestService = new ManifestService();
  private artifactResolver = new ArtifactResolver();
  private libraryResolver = new LibraryResolver();
  private assetService = new AssetService();
  private runtimeService = new RuntimeService();
  private fabricService = new FabricService();
  private pathManager = getPathManager();

  /**
   * Safe atomic file downloader with size & sha1 check
   */
  private async downloadFile(
    url: string,
    destination: string,
    expectedSha1?: string,
    expectedSize?: number
  ): Promise<void> {
    if (!/^[a-f0-9]{40}$/i.test(String(expectedSha1 || ''))
      || !Number.isSafeInteger(expectedSize) || Number(expectedSize) <= 0 || Number(expectedSize) > 512 * 1024 * 1024) {
      throw new Error(`Artifact '${path.basename(destination)}' has no valid checksum and size.`);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('Minecraft artifact URL is invalid.');
    }
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
      throw new Error('Minecraft artifacts must be downloaded over HTTPS.');
    }

    const dir = path.dirname(destination);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tempPath = `${destination}.tmp.${process.pid}.${Date.now()}`;
    try {
      const res = await fetch(parsedUrl, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
      if (!res.body) throw new Error(`Download response has no body for ${url}`);
      const declaredLength = Number(res.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > 0 && declaredLength !== expectedSize) {
        throw new Error(`Downloaded size does not match expected ${expectedSize} bytes.`);
      }

      const hash = crypto.createHash('sha1');
      let downloadedBytes = 0;
      const verifier = new Transform({
        transform(chunk, encoding, callback) {
          downloadedBytes += chunk.length;
          if (downloadedBytes > Number(expectedSize)) {
            callback(new Error('Downloaded artifact exceeds its declared size.'));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        }
      });
      await pipeline(Readable.fromWeb(res.body as any), verifier, fs.createWriteStream(tempPath, { flags: 'wx' }));
      if (downloadedBytes !== expectedSize) throw new Error(`Downloaded size ${downloadedBytes} bytes does not match expected ${expectedSize} bytes.`);
      const actualSha1 = hash.digest('hex');
      if (actualSha1.toLowerCase() !== expectedSha1!.toLowerCase()) {
        throw new Error(`Checksum failed for ${path.basename(destination)}.`);
      }
      fs.renameSync(tempPath, destination);
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  /**
   * Safely extracts native dynamic libraries (.dll, .so, .dylib) avoiding Zip Slip
   */
  public extractNatives(jarPath: string, destinationDir: string): void {
    if (!fs.existsSync(jarPath)) return;
    if (!fs.existsSync(destinationDir)) {
      fs.mkdirSync(destinationDir, { recursive: true });
    }

    try {
      const zip = new AdmZip(jarPath);
      const entries = zip.getEntries();
      const resolvedDest = path.resolve(destinationDir);

      for (const entry of entries) {
        if (entry.isDirectory || entry.entryName.startsWith('META-INF')) {
          continue;
        }

        const ext = path.extname(entry.entryName).toLowerCase();
        // Modern Minecraft natives: .dll on Windows, .so on Linux, .dylib on macOS
        if (['.dll', '.so', '.dylib'].includes(ext)) {
          const targetPath = path.resolve(destinationDir, path.basename(entry.entryName));
          // Zip Slip / Path Traversal protection
          if (!targetPath.startsWith(resolvedDest)) {
            continue;
          }
          fs.writeFileSync(targetPath, entry.getData());
        }
      }
    } catch (err: any) {
      getLogger().warn('minecraft', `Failed to extract natives from ${jarPath}:`, err.message);
    }
  }

  /**
   * Runs the complete installation sequence for an instance
   */
  public async installVersion(
    versionId: string,
    instanceId: string,
    onProgress?: (progress: GameInstallProgress) => void
  ): Promise<{ pkg: MinecraftVersionPackage; javaPath: string }> {
    const logger = getLogger();
    logger.info('minecraft', `Starting full installation for version ${versionId} (Instance: ${instanceId})...`);

    let downloadedBytes = 0;
    let totalBytes = 0;
    const startTime = Date.now();

    const report = (
      step: GameInstallProgress['step'],
      phase: string,
      currentDownloaded: number,
      targetTotal: number,
      currentFile?: string,
      completedFiles?: number,
      totalFiles?: number
    ) => {
      const elapsedSec = (Date.now() - startTime) / 1000;
      const speedBytesPerSec = step !== 'verifying' && elapsedSec > 0 ? Math.round(currentDownloaded / elapsedSec) : 0;
      const remainingBytes = Math.max(0, targetTotal - currentDownloaded);
      const etaSeconds = step !== 'verifying' && speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;
      const progressPercent = targetTotal > 0 ? Math.min(100, Math.round((currentDownloaded / targetTotal) * 100)) : 0;

      onProgress?.({
        instanceId,
        versionId,
        step,
        phase,
        downloadedBytes: currentDownloaded,
        totalBytes: targetTotal,
        remainingBytes,
        progressPercent,
        speedBytesPerSec,
        etaSeconds,
        completedFiles,
        totalFiles,
        currentFile
      });
    };

    // 1. Metadata Phase
    report('metadata', 'Fetching version metadata...', 0, 1000);
    let pkg = await this.manifestService.getVersionPackage(versionId);
    const loader = this.getInstanceLoader(instanceId);
    pkg = await this.fabricService.mergeLoaderProfile(pkg, loader.loaderVersion);

    // 2. Java Runtime Resolution
    report('java', 'Verifying Java runtime requirements...', 500, 1000);
    const requiredJavaMajor = getRequiredJavaForPackage(versionId, pkg);
    const javaPath = await this.runtimeService.resolveRuntimeForRequirement(requiredJavaMajor);

    // 3. Client JAR Resolution
    const clientJar = this.artifactResolver.resolveClientJar(pkg);
    const resolvedLibs = this.libraryResolver.resolveLibraries(pkg);
    const assetIndex = await this.assetService.fetchAssetIndex(pkg);
    const resolvedAssets = this.assetService.resolveAssets(assetIndex);

    // Calculate total download size
    let missingClientJar = !this.artifactResolver.verifyArtifact(clientJar);
    const missingLibs = resolvedLibs.filter((lib) => !this.libraryResolver.isLibraryValid(lib));
    const missingAssets = await this.assetService.findMissingAssets(resolvedAssets, (checked, total) => {
      report(
        'verifying',
        `Checking existing game assets (${checked.toLocaleString()}/${total.toLocaleString()})...`,
        checked,
        total,
        undefined,
        checked,
        total
      );
    });

    totalBytes = (missingClientJar ? clientJar.size : 0) +
      missingLibs.reduce((acc, l) => acc + (l.size || 0), 0) +
      missingAssets.reduce((acc, a) => acc + a.size, 0);

    if (totalBytes === 0) totalBytes = 1; // Prevent div by 0

    // 4. Download Client JAR
    if (missingClientJar) {
      report('client', `Downloading client JAR (${pkg.id})...`, downloadedBytes, totalBytes, `${pkg.id}.jar`);
      await this.downloadFile(clientJar.url, clientJar.localPath, clientJar.sha1, clientJar.size);
      downloadedBytes += clientJar.size;
    }

    // 5. Download Libraries & Natives
    const nativesDir = this.pathManager.getNativesPath(instanceId);
    for (let i = 0; i < missingLibs.length; i++) {
      const lib = missingLibs[i];
      report('libraries', `Downloading libraries (${i + 1}/${missingLibs.length})...`, downloadedBytes, totalBytes, path.basename(lib.path));
      await this.downloadFile(lib.url, lib.path, lib.sha1, lib.size);
      downloadedBytes += (lib.size || 0);
    }

    // Extract natives
    report('natives', 'Extracting native dynamic libraries...', downloadedBytes, totalBytes);
    const nativeLibs = resolvedLibs.filter((l) => l.isNative && fs.existsSync(l.path));
    for (const nLib of nativeLibs) {
      this.extractNatives(nLib.path, nativesDir);
    }

    // 6. Download Assets concurrently (Pool Concurrency = 8)
    const CONCURRENCY = 8;
    for (let i = 0; i < missingAssets.length; i += CONCURRENCY) {
      const batch = missingAssets.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (asset) => {
          await this.downloadFile(asset.url, asset.localPath, asset.hash, asset.size);
          downloadedBytes += asset.size;
        })
      );

      if (i % 32 === 0 || i + CONCURRENCY >= missingAssets.length) {
        report(
          'assets',
          `Downloading game assets (${Math.min(i + CONCURRENCY, missingAssets.length)}/${missingAssets.length})...`,
          downloadedBytes,
          totalBytes
        );
      }
    }

    report('complete', 'Installation complete.', totalBytes, totalBytes);
    logger.info('minecraft', `Installation finished successfully for ${versionId}`);

    return { pkg, javaPath };
  }

  private getInstanceLoader(instanceId: string): { loaderType: 'fabric'; loaderVersion?: string } {
    const metadataPath = path.join(this.pathManager.getInstancePath(instanceId), 'instance.json');
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as { loaderVersion?: string };
      return { loaderType: 'fabric', loaderVersion: metadata.loaderVersion };
    } catch {
      return { loaderType: 'fabric' };
    }
  }
}
