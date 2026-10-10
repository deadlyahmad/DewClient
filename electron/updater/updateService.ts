/**
 * DewClient - Production Update Service
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipcChannels.ts';
import { PRODUCT_VERSION } from '../../shared/constants/versions.ts';
import { parseSafeUrl, parseUpdateInstallerFileName } from '../../shared/schemas/validation.ts';
import { compareSemver, isVersionOutdated } from '../../shared/schemas/semver.ts';
import { getRemoteConfigService } from '../remote/remoteConfigService.ts';
import { getSettingsStorage } from '../storage/settingsStorage.ts';
import { getLogger } from '../core/logger.ts';
import { OFFICIAL_DEWCLIENT_API_URL } from '../../shared/constants/defaults.ts';

const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024;

function validIntegrityMetadata(sha256?: string, sizeBytes?: number): boolean {
  return typeof sha256 === 'string' && /^[a-f0-9]{64}$/i.test(sha256)
    && Number.isSafeInteger(sizeBytes) && Number(sizeBytes) > 0 && Number(sizeBytes) <= MAX_INSTALLER_BYTES;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  mandatory: boolean;
  currentVersion: string;
  latestVersion: string;
  updateUrl: string;
  notesUrl?: string;
  sha256?: string;
  sizeBytes?: number;
}

export interface UpdateDownloadResult {
  status: 'up-to-date' | 'downloaded' | 'failed';
  version: string;
  filePath?: string;
  message: string;
}

export interface UpdateDownloadProgress {
  status: 'preparing' | 'downloading' | 'verifying' | 'complete' | 'failed';
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  message: string;
  filePath?: string;
}

export class UpdateService {
  private remoteConfigService = getRemoteConfigService();
  private backgroundTimer: NodeJS.Timeout | null = null;
  private downloadInFlight: Promise<UpdateDownloadResult> | null = null;

  private reportDownloadProgress(progress: UpdateDownloadProgress): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.EVENT_UPDATE_PROGRESS, progress);
      }
    }
  }

  public startBackgroundChecks(): void {
    if (this.backgroundTimer) return;

    this.backgroundTimer = setInterval(() => {
      void this.runBackgroundSync();
    }, 6 * 60 * 60 * 1000);

    void this.runBackgroundSync();
  }

  public stopBackgroundChecks(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }

  private async runBackgroundSync(): Promise<void> {
    try {
      const settings = getSettingsStorage().getSettings();
      if (!settings.launcher?.checkForUpdates) {
        return;
      }

      const check = await this.checkForUpdates();
      if (!check.updateAvailable || !check.updateUrl) {
        return;
      }

      await this.downloadUpdateIfNeeded(false);
    } catch (error: any) {
      getLogger().debug('updater', `Background update check failed: ${error?.message || error}`);
    }
  }

  public async checkForUpdates(): Promise<UpdateCheckResult> {
    const logger = getLogger();
    logger.info('updater', `Checking for updates (current version: ${PRODUCT_VERSION})...`);

    const manifest = await this.remoteConfigService.fetchManifest(true);
    const clientConfig = manifest.client;

    let safeUpdateUrl = '';
    if (clientConfig.updateUrl) {
      try {
        const updateUrl = new URL(parseSafeUrl(clientConfig.updateUrl));
        if (updateUrl.protocol !== 'https:') throw new Error('Update downloads require HTTPS.');
        if (updateUrl.origin !== new URL(OFFICIAL_DEWCLIENT_API_URL).origin) throw new Error('Update downloads must use the official DewClient host.');
        parseUpdateInstallerFileName(updateUrl.toString());
        safeUpdateUrl = updateUrl.toString();
      } catch {
        logger.warn('updater', 'Update URL does not identify a valid published installer.');
      }
    }

    const sha256 = typeof clientConfig.sha256 === 'string' ? clientConfig.sha256 : undefined;
    const sizeBytes = Number(clientConfig.sizeBytes);
    const hasPublishedInstaller = Boolean(safeUpdateUrl && validIntegrityMetadata(sha256, sizeBytes));
    const latest = hasPublishedInstaller ? clientConfig.latestVersion || PRODUCT_VERSION : PRODUCT_VERSION;
    const minimum = hasPublishedInstaller ? clientConfig.minimumVersion || PRODUCT_VERSION : PRODUCT_VERSION;
    const updateAvailable = hasPublishedInstaller && isVersionOutdated(PRODUCT_VERSION, latest);
    const mandatory = hasPublishedInstaller && compareSemver(PRODUCT_VERSION, minimum) < 0;

    return {
      updateAvailable,
      mandatory,
      currentVersion: PRODUCT_VERSION,
      latestVersion: latest,
      updateUrl: safeUpdateUrl,
      notesUrl: hasPublishedInstaller ? clientConfig.notesUrl : undefined,
      sha256: hasPublishedInstaller ? sha256 : undefined,
      sizeBytes: hasPublishedInstaller ? sizeBytes : undefined
    };
  }

  public downloadUpdateIfNeeded(force = false): Promise<UpdateDownloadResult> {
    if (this.downloadInFlight) return this.downloadInFlight;
    this.downloadInFlight = this.downloadUpdate(force).finally(() => {
      this.downloadInFlight = null;
    });
    return this.downloadInFlight;
  }

  private async downloadUpdate(force = false): Promise<UpdateDownloadResult> {
    this.reportDownloadProgress({ status: 'preparing', progressPercent: 0, downloadedBytes: 0, totalBytes: 0, message: 'Preparing secure update download…' });
    const result = await this.checkForUpdates();
    if (!result.updateAvailable) {
      this.reportDownloadProgress({ status: 'failed', progressPercent: 0, downloadedBytes: 0, totalBytes: 0, message: 'No newer release is available.' });
      return { status: 'up-to-date', version: result.latestVersion, message: 'You are already running the latest version.' };
    }

    if (!result.updateUrl || !validIntegrityMetadata(result.sha256, result.sizeBytes)) {
      this.reportDownloadProgress({ status: 'failed', progressPercent: 0, downloadedBytes: 0, totalBytes: 0, message: 'The release is missing trusted download metadata.' });
      return { status: 'failed', version: result.latestVersion, message: 'The server did not provide a trusted update URL and complete integrity metadata.' };
    }

    const updateDir = path.join(app.getPath('userData'), 'updates');
    let fileName: string;
    try {
      fileName = parseUpdateInstallerFileName(result.updateUrl);
    } catch (error: any) {
      this.reportDownloadProgress({ status: 'failed', progressPercent: 0, downloadedBytes: 0, totalBytes: result.sizeBytes || 0, message: error?.message || 'The update URL has an invalid installer filename.' });
      return { status: 'failed', version: result.latestVersion, message: error?.message || 'The update URL has an invalid installer filename.' };
    }
    const filePath = path.join(updateDir, fileName);

    if (result.sha256 && !/^[a-f0-9]{64}$/i.test(result.sha256)) {
      return { status: 'failed', version: result.latestVersion, message: 'The server provided an invalid update hash.' };
    }

    if (!force && fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const sizeMatches = !result.sizeBytes || stat.size === result.sizeBytes;
      const hashMatches = !result.sha256 || (await getFileSha256(filePath)) === result.sha256.toLowerCase();
      if (sizeMatches && hashMatches) {
        this.reportDownloadProgress({ status: 'complete', progressPercent: 100, downloadedBytes: stat.size, totalBytes: stat.size, message: 'Verified update is already downloaded.', filePath });
        return {
          status: 'downloaded',
          version: result.latestVersion,
          filePath,
          message: 'Update file is already cached locally and ready to install.'
        };
      }
      fs.rmSync(filePath, { force: true });
    }

    const temporaryPath = `${filePath}.download-${process.pid}-${Date.now()}`;
    try {
      fs.mkdirSync(updateDir, { recursive: true });
      const response = await fetch(result.updateUrl, { redirect: 'error', signal: AbortSignal.timeout(10 * 60_000) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      if (!response.body) throw new Error('The update response did not contain a file body.');
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > 0 && contentLength !== result.sizeBytes) {
        throw new Error('Downloaded update size does not match the published release metadata.');
      }

      const hash = crypto.createHash('sha256');
      let downloadedBytes = 0;
      let signatureBytes = Buffer.alloc(0);
      let lastProgressAt = 0;
      let lastReportedPercent = -1;
      const updateService = this;
      this.reportDownloadProgress({
        status: 'downloading', progressPercent: 0, downloadedBytes: 0,
        totalBytes: result.sizeBytes!, message: 'Downloading update…'
      });
      const verifier = new Transform({
        transform(chunk, encoding, callback) {
          downloadedBytes += chunk.length;
          if (downloadedBytes > MAX_INSTALLER_BYTES || downloadedBytes > (result.sizeBytes || 0)) {
            callback(new Error('Downloaded update exceeds the published size limit.'));
            return;
          }
          if (signatureBytes.length < 2) signatureBytes = Buffer.concat([signatureBytes, chunk.subarray(0, 2 - signatureBytes.length)]);
          hash.update(chunk);
          const now = Date.now();
          const progressPercent = Math.min(99, Math.floor(downloadedBytes / result.sizeBytes! * 100));
          if (progressPercent !== lastReportedPercent && (progressPercent === 0 || progressPercent === 99 || now - lastProgressAt >= 150)) {
            lastProgressAt = now;
            lastReportedPercent = progressPercent;
            updateService.reportDownloadProgress({
              status: 'downloading', progressPercent, downloadedBytes,
              totalBytes: result.sizeBytes!, message: 'Downloading update…'
            });
          }
          callback(null, chunk);
        }
      });
      await pipeline(
        Readable.fromWeb(response.body as any),
        verifier,
        fs.createWriteStream(temporaryPath, { flags: 'wx' })
      );

      if (downloadedBytes !== result.sizeBytes) {
        throw new Error('Downloaded update size does not match the published release metadata.');
      }
      this.reportDownloadProgress({
        status: 'verifying', progressPercent: 100, downloadedBytes,
        totalBytes: result.sizeBytes!, message: 'Download complete. Verifying file integrity…'
      });
      if (signatureBytes.toString('ascii') !== 'MZ') {
        throw new Error('Downloaded update is not a valid Windows executable.');
      }
      const digest = hash.digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(result.sha256!.toLowerCase(), 'hex'))) {
        throw new Error('Downloaded update failed SHA-256 verification.');
      }
      fs.rmSync(filePath, { force: true });
      fs.renameSync(temporaryPath, filePath);
      getLogger().info('updater', `Downloaded update ${result.latestVersion} to ${filePath}`);
      this.reportDownloadProgress({ status: 'complete', progressPercent: 100, downloadedBytes, totalBytes: result.sizeBytes!, message: 'Update verified and ready to install.', filePath });
      return {
        status: 'downloaded',
        version: result.latestVersion,
        filePath,
        message: 'Update downloaded in the background and is ready to install.'
      };
    } catch (error: any) {
      fs.rmSync(temporaryPath, { force: true });
      getLogger().error('updater', `Failed to download update: ${error?.message || error}`);
      this.reportDownloadProgress({ status: 'failed', progressPercent: 0, downloadedBytes: 0, totalBytes: result.sizeBytes || 0, message: error?.message || 'Update download failed.' });
      return {
        status: 'failed',
        version: result.latestVersion,
        message: `Could not download the update: ${error?.message || 'unknown error'}`
      };
    }
  }

  public async installDownloadedUpdate(filePath?: string, expectedSha256?: string): Promise<boolean> {
    if (process.platform !== 'win32' || !filePath || !expectedSha256 || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
      return false;
    }
    const updateDir = path.resolve(app.getPath('userData'), 'updates');
    if (path.dirname(path.resolve(filePath)) !== updateDir || !/^DewClient-[A-Za-z0-9._-]+\.exe$/i.test(path.basename(filePath)) || !fs.existsSync(filePath)) return false;
    if ((await getFileSha256(filePath)) !== expectedSha256.toLowerCase()) return false;
    spawn(filePath, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => app.exit(0), 750);
    return true;
  }

  public async installLatestDownloadedUpdate(): Promise<boolean> {
    const release = await this.checkForUpdates();
    if (!release.updateUrl || !validIntegrityMetadata(release.sha256, release.sizeBytes)) return false;
    const fileName = parseUpdateInstallerFileName(release.updateUrl);
    const filePath = path.join(app.getPath('userData'), 'updates', fileName);
    return this.installDownloadedUpdate(filePath, release.sha256);
  }

  public async openDownloadedUpdate(): Promise<boolean> {
    const updateDir = path.join(app.getPath('userData'), 'updates');
    if (!fs.existsSync(updateDir)) {
      return false;
    }
    const release = await this.checkForUpdates();
    if (!release.updateUrl || !validIntegrityMetadata(release.sha256, release.sizeBytes)) return false;
    const expectedName = parseUpdateInstallerFileName(release.updateUrl);
    const filePath = path.join(updateDir, expectedName);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== release.sizeBytes) return false;
    if ((await getFileSha256(filePath)) !== release.sha256!.toLowerCase()) return false;
    await shell.openPath(filePath);
    return true;
  }
}

async function getFileSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

let updateService: UpdateService | null = null;

export function getUpdateService(): UpdateService {
  if (!updateService) {
    updateService = new UpdateService();
  }
  return updateService;
}
