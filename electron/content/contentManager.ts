/**
 * DewClient - Content Manager
 * Manages Mods, Resourcepacks, Shaders, and secure .mrpack modpack extraction
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';
import type { ModItem, PackItem, MrpackIndex } from '../../shared/types/content.ts';
import type { InstanceConfig } from '../../shared/types/instance.ts';
import { getInstanceManager } from '../instances/instanceManager.ts';
import { getModrinthService } from './modrinthService.ts';
import { getSettingsStorage } from '../storage/settingsStorage.ts';
import { getLogger } from '../core/logger.ts';
import { CURRENT_MINECRAFT_PRIMARY_TARGET } from '../../shared/constants/versions.ts';

type InstallableProjectType = 'mod' | 'resourcepack' | 'shader';
const nodeRequire = createRequire(import.meta.url);

function getElectronAppPath(): string | null {
  try {
    const runtime = nodeRequire('electron');
    return runtime && typeof runtime === 'object' && runtime.app && typeof runtime.app.getAppPath === 'function'
      ? runtime.app.getAppPath()
      : null;
  } catch {
    return null;
  }
}

interface InstalledProjectRecord {
  projectType: InstallableProjectType;
  fileName: string;
  sha1?: string;
}

interface BundledCosmeticsVersion {
  status?: string;
  artifact?: string | null;
  sha256?: string | null;
  modVersion?: string;
  dependencies?: Array<{ projectId?: string; artifact?: string; sha256?: string }>;
}

export class ContentManager {
  private instanceManager = getInstanceManager();
  private modrinthService = getModrinthService();
  private managedFabricProjects = ['fabric-api'];

  private getInstanceDir(instanceId: string): string {
    const inst = this.instanceManager.getInstance(instanceId);
    if (!inst) throw new Error(`Instance '${instanceId}' not found.`);
    return inst.gameDirectory || '';
  }

  private getBundledLoaderDir(): string | null {
    const appPath = getElectronAppPath();
    const roots = [
      ...(process.resourcesPath ? [path.resolve(process.resourcesPath, 'DewCosmeticsLoader')] : []),
      ...(appPath ? [path.resolve(appPath, 'DewCosmeticsLoader')] : []),
      path.resolve(process.cwd(), 'DewCosmeticsLoader')
    ];
    return roots.find((root) => fs.existsSync(path.join(root, 'versions.json'))) || null;
  }

  private readBundledCosmeticsVersion(gameVersion: string): { loaderDir: string; metadata: BundledCosmeticsVersion } | null {
    const loaderDir = this.getBundledLoaderDir();
    if (!loaderDir) return null;
    try {
      const index = JSON.parse(fs.readFileSync(path.join(loaderDir, 'versions.json'), 'utf8')) as {
        versions?: Record<string, BundledCosmeticsVersion>;
      };
      const metadata = index.versions?.[gameVersion];
      if (!metadata || metadata.status !== 'built' || !metadata.artifact || !metadata.sha256) return null;
      return { loaderDir, metadata };
    } catch (error: any) {
      getLogger().warn('content', 'Could not read the bundled DewCosmetics version index:', error?.message || error);
      return null;
    }
  }

  public hasManagedCosmeticsForVersion(gameVersion: string): boolean {
    return this.readBundledCosmeticsVersion(gameVersion) !== null;
  }

  public getManagedCosmeticsModVersion(gameVersion: string): string | null {
    const modVersion = this.readBundledCosmeticsVersion(gameVersion)?.metadata.modVersion;
    return typeof modVersion === 'string' && /^[A-Za-z0-9.+_-]{1,64}$/.test(modVersion) ? modVersion : null;
  }

  private findInstalledDewCosmeticsMods(modsDir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(modsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.jar(?:\.disabled)?$/i.test(entry.name)) continue;
      const candidate = path.join(modsDir, entry.name);
      try {
        const archive = new AdmZip(candidate);
        const metadata = archive.getEntry('fabric.mod.json');
        if (!metadata) continue;
        const descriptor = JSON.parse(metadata.getData().toString('utf8'));
        if (descriptor?.id === 'dewcosmetics') found.push(candidate);
      } catch {
        // Ignore unrelated, unreadable, or non-Fabric jars.
      }
    }
    return found;
  }

  public validateSafeExtractPath(baseDir: string, relativePath: string): string {
    if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
      throw new Error(`Zip Slip path traversal security violation detected: ${relativePath}`);
    }
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(resolvedBase, relativePath);
    const relativeTarget = path.relative(resolvedBase, resolvedTarget);
    if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
      throw new Error(`Zip Slip path traversal security violation detected: ${relativePath}`);
    }
    return resolvedTarget;
  }

  private getSafeContentPath(instanceId: string, directory: string, fileName: string): string {
    return this.validateSafeExtractPath(path.join(this.getInstanceDir(instanceId), directory), fileName);
  }

  private getProjectContentIndexPath(instanceId: string): string {
    return path.join(this.getInstanceDir(instanceId), 'config', '.dewclient-modrinth-content.json');
  }

  private readProjectContentIndex(instanceId: string): Record<string, InstalledProjectRecord> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.getProjectContentIndexPath(instanceId), 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, record]) => {
        const value = record as Partial<InstalledProjectRecord>;
        return ['mod', 'resourcepack', 'shader'].includes(value.projectType || '') && typeof value.fileName === 'string'
          && (value.sha1 === undefined || /^[a-f0-9]{40}$/i.test(value.sha1));
      })) as Record<string, InstalledProjectRecord>;
    } catch {
      return {};
    }
  }

  private writeProjectContentIndex(instanceId: string, index: Record<string, InstalledProjectRecord>): void {
    const indexPath = this.getProjectContentIndexPath(instanceId);
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    const temporaryPath = `${indexPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(temporaryPath, JSON.stringify(index, null, 2), 'utf-8');
    fs.renameSync(temporaryPath, indexPath);
  }

  private contentFolderForProjectType(projectType: InstallableProjectType): string {
    if (projectType === 'resourcepack') return 'resourcepacks';
    if (projectType === 'shader') return 'shaderpacks';
    return 'mods';
  }

  private projectFileExists(instanceDir: string, record: InstalledProjectRecord): boolean {
    const directory = path.join(instanceDir, this.contentFolderForProjectType(record.projectType));
    try {
      const filePath = this.validateSafeExtractPath(directory, record.fileName);
      return fs.existsSync(filePath) || (record.projectType === 'mod' && fs.existsSync(`${filePath}.disabled`));
    } catch {
      return false;
    }
  }

  private rememberInstalledProject(instanceId: string, projectId: string, projectType: InstallableProjectType, fileName: string, sha1?: string): void {
    const index = this.readProjectContentIndex(instanceId);
    index[projectId] = { projectType, fileName, ...(sha1 ? { sha1: sha1.toLowerCase() } : {}) };
    this.writeProjectContentIndex(instanceId, index);
  }

  private forgetInstalledProjectFile(instanceId: string, projectType: InstallableProjectType, fileName: string): void {
    const index = this.readProjectContentIndex(instanceId);
    let changed = false;
    for (const [projectId, record] of Object.entries(index)) {
      if (record.projectType === projectType && record.fileName === fileName) {
        delete index[projectId];
        changed = true;
      }
    }
    if (changed) this.writeProjectContentIndex(instanceId, index);
  }

  public async listInstalledProjectIds(
    instanceId: string,
    projectType?: InstallableProjectType,
    candidateProjectIds: string[] = []
  ): Promise<string[]> {
    const instanceDir = this.getInstanceDir(instanceId);
    const index = this.readProjectContentIndex(instanceId);
    const installedProjectIds = new Set<string>();
    let changed = false;

    for (const [projectId, record] of Object.entries(index)) {
      if (!this.projectFileExists(instanceDir, record)) {
        delete index[projectId];
        changed = true;
      } else if (!projectType || record.projectType === projectType) {
        installedProjectIds.add(projectId);
      }
    }

    const candidates = [...new Set(candidateProjectIds.filter((id) => typeof id === 'string' && id.trim()))]
      .filter((id) => !index[id])
      .slice(0, 24);
    const candidateType = projectType || 'mod';
    const loaders = candidateType === 'mod' ? ['fabric'] : undefined;

    const matches = await Promise.all(candidates.map(async (projectId) => {
      try {
        const versions = await this.modrinthService.getProjectVersions(
          projectId,
          this.instanceManager.getInstance(instanceId)?.minecraftVersion,
          loaders
        );
        const installedFile = versions
          .flatMap((version) => version.files)
          .find((file) => this.projectFileExists(instanceDir, { projectType: candidateType, fileName: file.filename }));
        return installedFile ? { projectId, fileName: installedFile.filename } : null;
      } catch {
        return null;
      }
    }));

    for (const match of matches) {
      if (!match) continue;
      index[match.projectId] = { projectType: candidateType, fileName: match.fileName };
      installedProjectIds.add(match.projectId);
      changed = true;
    }

    if (changed) this.writeProjectContentIndex(instanceId, index);
    return [...installedProjectIds];
  }

  // ============================ MODS ============================

  private extractModMetadata(jarPath: string): { name?: string; iconUrl?: string } {
    try {
      const zip = new AdmZip(jarPath);
      // 1. Try fabric.mod.json
      const fabricEntry = zip.getEntry('fabric.mod.json');
      if (fabricEntry) {
        const text = zip.readAsText(fabricEntry);
        const json = JSON.parse(text);
        const name = json.name;
        let iconPath = json.icon;
        if (typeof iconPath === 'object' && iconPath) {
          iconPath = iconPath['128'] || iconPath['64'] || iconPath['32'] || Object.values(iconPath)[0];
        }
        if (iconPath && typeof iconPath === 'string') {
          const cleanPath = iconPath.replace(/^\/+/, '');
          const iconEntry = zip.getEntry(cleanPath) || zip.getEntry(`assets/${cleanPath}`) || zip.getEntry(iconPath);
          if (iconEntry) {
            const buf = zip.readFile(iconEntry);
            if (buf) {
              const mime = cleanPath.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
              return { name, iconUrl: `data:${mime};base64,${buf.toString('base64')}` };
            }
          }
        }
        if (name) return { name };
      }

      // 2. Try looking for icon.png or logo.png inside jar entries
      const entries = zip.getEntries();
      const iconEntry = entries.find((e) => !e.isDirectory && (e.entryName.endsWith('/icon.png') || e.entryName === 'icon.png' || e.entryName.endsWith('/logo.png')));
      if (iconEntry) {
        const buf = zip.readFile(iconEntry);
        if (buf) {
          return { iconUrl: `data:image/png;base64,${buf.toString('base64')}` };
        }
      }
    } catch {
      // Ignore jar read errors
    }
    return {};
  }

  public listMods(instanceId: string): ModItem[] {
    const modsDir = path.join(this.getInstanceDir(instanceId), 'mods');
    if (!fs.existsSync(modsDir)) return [];

    const files = fs.readdirSync(modsDir);
    const mods: ModItem[] = [];

    for (const f of files) {
      if (f.endsWith('.jar') || f.endsWith('.jar.disabled')) {
        const fullPath = path.join(modsDir, f);
        const enabled = !f.endsWith('.disabled');
        const cleanName = f.replace(/\.jar(\.disabled)?$/, '');

        let sizeBytes = 0;
        try {
          sizeBytes = fs.statSync(fullPath).size;
        } catch {
          // Ignore
        }

        const meta = this.extractModMetadata(fullPath);

        mods.push({
          id: f,
          fileName: f,
          filePath: fullPath,
          name: meta.name || cleanName,
          iconUrl: meta.iconUrl,
          enabled,
          sizeBytes
        });
      }
    }

    return mods;
  }

  public toggleMod(instanceId: string, fileName: string): boolean {
    const modsDir = path.join(this.getInstanceDir(instanceId), 'mods');
    const fullPath = this.getSafeContentPath(instanceId, 'mods', fileName);
    if (!fs.existsSync(fullPath)) return false;

    if (fileName.endsWith('.disabled')) {
      const newPath = fullPath.replace(/\.disabled$/, '');
      fs.renameSync(fullPath, newPath);
      return true;
    } else {
      const newPath = `${fullPath}.disabled`;
      fs.renameSync(fullPath, newPath);
      return false;
    }
  }

  public removeMod(instanceId: string, fileName: string): boolean {
    const modsDir = path.join(this.getInstanceDir(instanceId), 'mods');
    const fullPath = this.getSafeContentPath(instanceId, 'mods', fileName);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath);
      this.forgetInstalledProjectFile(instanceId, 'mod', fileName);
      return true;
    }
    return false;
  }

  // ======================== RESOURCEPACKS ========================

  public listResourcePacks(instanceId: string): PackItem[] {
    const packsDir = path.join(this.getInstanceDir(instanceId), 'resourcepacks');
    if (!fs.existsSync(packsDir)) return [];

    const files = fs.readdirSync(packsDir);
    const packs: PackItem[] = [];

    for (const f of files) {
      if (f.endsWith('.zip') || fs.statSync(path.join(packsDir, f)).isDirectory()) {
        const fullPath = path.join(packsDir, f);
        let sizeBytes = 0;
        try {
          sizeBytes = fs.statSync(fullPath).size;
        } catch {
          // Ignore
        }

        packs.push({
          id: f,
          fileName: f,
          filePath: fullPath,
          name: f.replace(/\.zip$/, ''),
          sizeBytes
        });
      }
    }

    return packs;
  }

  public removeResourcePack(instanceId: string, fileName: string): boolean {
    const packsDir = path.join(this.getInstanceDir(instanceId), 'resourcepacks');
    const fullPath = this.getSafeContentPath(instanceId, 'resourcepacks', fileName);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      this.forgetInstalledProjectFile(instanceId, 'resourcepack', fileName);
      return true;
    }
    return false;
  }

  // ======================== SHADERPACKS ========================

  public listShaderPacks(instanceId: string): PackItem[] {
    const shadersDir = path.join(this.getInstanceDir(instanceId), 'shaderpacks');
    if (!fs.existsSync(shadersDir)) return [];

    const files = fs.readdirSync(shadersDir);
    const packs: PackItem[] = [];

    for (const f of files) {
      if (f.endsWith('.zip') || fs.statSync(path.join(shadersDir, f)).isDirectory()) {
        const fullPath = path.join(shadersDir, f);
        let sizeBytes = 0;
        try {
          sizeBytes = fs.statSync(fullPath).size;
        } catch {
          // Ignore
        }

        packs.push({
          id: f,
          fileName: f,
          filePath: fullPath,
          name: f.replace(/\.zip$/, ''),
          sizeBytes
        });
      }
    }

    return packs;
  }

  public removeShaderPack(instanceId: string, fileName: string): boolean {
    const shadersDir = path.join(this.getInstanceDir(instanceId), 'shaderpacks');
    const fullPath = this.getSafeContentPath(instanceId, 'shaderpacks', fileName);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      this.forgetInstalledProjectFile(instanceId, 'shader', fileName);
      return true;
    }
    return false;
  }

  // ======================== MODPACK (.mrpack) INSTALLATION ========================

  public async installModrinthModpack(projectId: string, requestedName?: string): Promise<InstanceConfig> {
    if (!projectId.trim()) throw new Error('A Modrinth project ID is required.');

    const versions = await this.modrinthService.getProjectVersions(projectId, undefined, ['fabric']);
    const compatibleVersions = versions.filter((version) =>
      version.loaders.includes('fabric') && version.files.some((file) => file.filename.toLowerCase().endsWith('.mrpack'))
    );
    const version = compatibleVersions.find((candidate) => candidate.version_type === 'release') || compatibleVersions[0];
    const archive = version?.files.find((file) => file.primary && file.filename.toLowerCase().endsWith('.mrpack'))
      || version?.files.find((file) => file.filename.toLowerCase().endsWith('.mrpack'));
    if (!archive?.url) throw new Error('No compatible Fabric .mrpack release is available for this project.');
    if (archive.size > 100 * 1024 * 1024) throw new Error('The Modrinth modpack archive exceeds the 100 MiB download limit.');
    if (!/^[a-f0-9]{40}$/i.test(String(archive.hashes?.sha1 || ''))) {
      throw new Error('The Modrinth modpack does not declare a valid SHA-1 checksum.');
    }

    const archiveUrl = new URL(archive.url);
    if (archiveUrl.protocol !== 'https:' || !['cdn.modrinth.com', 'modrinth.com', 'launcher.mojang.com'].includes(archiveUrl.hostname)) {
      throw new Error('The Modrinth modpack download URL is not trusted.');
    }

    const response = await fetch(archiveUrl, { headers: { 'User-Agent': 'DewClient/1.0.1' }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Modpack download failed (${response.status}).`);
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > 0 && declaredSize !== archive.size) {
      throw new Error('The downloaded modpack size does not match Modrinth metadata.');
    }
    const archiveBuffer = Buffer.from(await response.arrayBuffer());
    if (archive.size > 0 && archiveBuffer.length !== archive.size) {
      throw new Error('The downloaded modpack size does not match Modrinth metadata.');
    }
    const actualSha1 = crypto.createHash('sha1').update(archiveBuffer).digest('hex');
    if (actualSha1.toLowerCase() !== archive.hashes.sha1.toLowerCase()) {
      throw new Error('The downloaded modpack failed SHA-1 verification.');
    }

    const zip = new AdmZip(archiveBuffer);
    const indexEntry = zip.getEntry('modrinth.index.json');
    if (!indexEntry) throw new Error('Invalid .mrpack archive: missing modrinth.index.json metadata.');
    const index = JSON.parse(indexEntry.getData().toString('utf-8')) as MrpackIndex;
    const minecraftVersion = index.dependencies?.minecraft;
    const loaderVersion = index.dependencies?.['fabric-loader'];
    if (index.game !== 'minecraft' || !minecraftVersion || !loaderVersion) {
      throw new Error('This modpack does not declare a supported Minecraft and Fabric loader version.');
    }

    const name = (requestedName?.trim() || index.name || version?.name || 'Modrinth Modpack').slice(0, 64);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-modpack-'));
    const tempArchivePath = path.join(tempDir, 'project.mrpack');
    let instance: InstanceConfig | null = null;
    try {
      fs.writeFileSync(tempArchivePath, archiveBuffer, { flag: 'wx' });
      instance = this.instanceManager.createInstance({
        name,
        minecraftVersion,
        loaderType: 'fabric',
        loaderVersion
      });
      await this.installMrpack(tempArchivePath, instance.id);
      if (instance.minecraftVersion === CURRENT_MINECRAFT_PRIMARY_TARGET) {
        // 26.3 is this release's supported managed target: its verified mod bundle
        // is part of the installer, so a pack-created instance must not silently
        // succeed without it.
        const installed = await this.installManagedCosmeticsMod(instance.id);
        if (!installed) {
          throw new Error(`Required DewClient 26.3 mods could not be installed for Modrinth instance ${instance.id}.`);
        }
      } else {
        try {
          await this.installManagedCosmeticsMod(instance.id);
        } catch (error: any) {
          getLogger().warn('content', `DewCosmetics was not installed for Modrinth instance ${instance.id}:`, error?.message || error);
        }
      }
      return instance;
    } catch (error) {
      if (instance) this.instanceManager.deleteInstance(instance.id);
      throw error;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  public async installMrpack(
    mrpackFilePath: string,
    targetInstanceId: string,
    onProgress?: (progressPercent: number, statusMessage: string) => void
  ): Promise<boolean> {
    const logger = getLogger();
    const gameDir = this.getInstanceDir(targetInstanceId);
    const resolvedGameDir = path.resolve(gameDir);

    logger.info('content', `Installing .mrpack archive ${mrpackFilePath} into instance ${targetInstanceId}...`);

    if (!fs.existsSync(mrpackFilePath)) {
      throw new Error(`Mrpack file does not exist at ${mrpackFilePath}`);
    }

    const zip = new AdmZip(mrpackFilePath);
    const indexEntry = zip.getEntry('modrinth.index.json');
    if (!indexEntry) {
      throw new Error('Invalid .mrpack archive: missing modrinth.index.json metadata.');
    }

    const index = JSON.parse(indexEntry.getData().toString('utf-8')) as MrpackIndex;
    const totalFiles = (index.files || []).length;
    const maxArchiveEntries = 10_000;
    const maxArchiveBytes = 512 * 1024 * 1024;
    if (zip.getEntries().length > maxArchiveEntries) {
      throw new Error('The modpack archive exceeds the supported entry count.');
    }
    if (fs.statSync(mrpackFilePath).size > maxArchiveBytes) {
      throw new Error('The modpack archive exceeds the supported size limit.');
    }

    let completedFiles = 0;
    onProgress?.(5, `Parsed modpack '${index.name}' with ${totalFiles} components.`);

    for (const fileItem of index.files || []) {
      if (fileItem.env?.client === 'unsupported') continue;
      if (!fileItem.path || typeof fileItem.path !== 'string' || fileItem.path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(fileItem.path)) {
        throw new Error(`Unsafe modpack entry path detected: ${fileItem.path}`);
      }
      if (!/^[a-f0-9]{40}$/i.test(String(fileItem.hashes?.sha1 || '')) || !Number.isSafeInteger(fileItem.fileSize) || Number(fileItem.fileSize) <= 0) {
        throw new Error(`Modpack entry ${fileItem.path} does not declare verifiable integrity metadata.`);
      }

      const destPath = this.validateSafeExtractPath(gameDir, fileItem.path);
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let downloaded = false;
      for (const downloadUrl of fileItem.downloads || []) {
        try {
          const download = new URL(downloadUrl);
          if (download.protocol !== 'https:' || !['cdn.modrinth.com', 'modrinth.com', 'edge.forgecdn.net', 'media.forgecdn.net', 'files.minecraftforge.net'].includes(download.hostname)) {
            continue;
          }
          const res = await fetch(download, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
          if (!res.ok) continue;
          if (Number.isFinite(Number(res.headers.get('content-length'))) && Number(res.headers.get('content-length')) > Number(fileItem.fileSize)) {
            throw new Error(`Modpack file ${fileItem.path} exceeds its declared size.`);
          }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length !== Number(fileItem.fileSize)) throw new Error(`Modpack file ${fileItem.path} size does not match its metadata.`);
          const actualSha1 = crypto.createHash('sha1').update(buf).digest('hex');
          if (actualSha1.toLowerCase() !== fileItem.hashes.sha1.toLowerCase()) {
            throw new Error('SHA-1 checksum verification mismatch');
          }
          fs.writeFileSync(destPath, buf);
          downloaded = true;
          break;
        } catch {
          // Try the next allowed download URL.
        }
      }

      if (!downloaded && fileItem.env?.client !== 'optional') {
        throw new Error(`Failed to download required modpack file ${fileItem.path}.`);
      }

      completedFiles++;
      const pct = Math.min(80, Math.round(5 + (completedFiles / Math.max(1, totalFiles)) * 75));
      onProgress?.(pct, `Installing ${path.basename(fileItem.path)} (${completedFiles}/${totalFiles})...`);
    }

    onProgress?.(85, 'Extracting modpack configuration and overrides...');
    const overridesPrefix = 'overrides/';

    for (const entry of zip.getEntries()) {
      if (entry.entryName.startsWith(overridesPrefix) && !entry.isDirectory) {
        const relativePath = entry.entryName.slice(overridesPrefix.length);
        let destPath: string;
        try {
          destPath = this.validateSafeExtractPath(gameDir, relativePath);
        } catch {
          logger.warn('content', `Skipping suspicious override path in .mrpack: ${relativePath}`);
          continue;
        }
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(destPath, entry.getData());
      }
    }

    onProgress?.(100, `Modpack '${index.name}' installed successfully.`);
    logger.info('content', `Modpack ${index.name} installed successfully.`);
    return true;
  }

  public async installProjectContent(
    instanceId: string,
    projectId: string,
    projectType: InstallableProjectType
  ): Promise<boolean> {
    const logger = getLogger();
    const instance = this.instanceManager.getInstance(instanceId);
    if (!instance) throw new Error(`Instance '${instanceId}' not found.`);
    const gameDir = instance.gameDirectory || this.getInstanceDir(instanceId);
    const loaders = projectType === 'mod' ? ['fabric'] : undefined;
    const versions = await this.modrinthService.getProjectVersions(projectId, instance.minecraftVersion, loaders);
    const version = versions.find((candidate) => candidate.version_type === 'release') || versions[0];
    if (!version) {
      throw new Error('No compatible versions found for this project.');
    }

    const primaryFile = version.files.find((file) => file.primary) || version.files[0];
    if (!primaryFile || !primaryFile.url) {
      throw new Error('No downloadable file found in version release.');
    }

    let subDir = 'mods';
    if (projectType === 'resourcepack') subDir = 'resourcepacks';
    if (projectType === 'shader') subDir = 'shaderpacks';

    const targetDir = path.join(gameDir, subDir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetPath = this.validateSafeExtractPath(targetDir, primaryFile.filename);
    logger.info('content', `Downloading ${projectType} ${primaryFile.filename} to ${targetDir}...`);

    const dlRes = await fetch(primaryFile.url);
    if (!dlRes.ok) {
      throw new Error(`Download failed (${dlRes.status}): ${primaryFile.url}`);
    }

    const buf = Buffer.from(await dlRes.arrayBuffer());
    if (primaryFile.size > 0 && buf.length !== primaryFile.size) {
      throw new Error(`Downloaded file size does not match Modrinth metadata for ${primaryFile.filename}.`);
    }
    if (primaryFile.hashes?.sha1) {
      const actualSha1 = crypto.createHash('sha1').update(buf).digest('hex');
      if (actualSha1.toLowerCase() !== primaryFile.hashes.sha1.toLowerCase()) {
        throw new Error(`Downloaded file failed SHA-1 verification for ${primaryFile.filename}.`);
      }
    }
    fs.writeFileSync(targetPath, buf);
    this.rememberInstalledProject(instanceId, projectId, projectType, primaryFile.filename);
    logger.info('content', `Successfully installed ${projectType} ${primaryFile.filename}`);
    return true;
  }

  public async installManagedFabricMods(
    instanceId: string,
    gameVersion: string,
    onProgress?: (message: string) => void
  ): Promise<string[]> {
    const installed = new Set<string>();
    const installing = new Set<string>();

    const installProject = async (projectId: string): Promise<void> => {
      if (installed.has(projectId) || installing.has(projectId)) return;
      installing.add(projectId);

      const existingRecord = this.readProjectContentIndex(instanceId)[projectId];
      if (existingRecord?.projectType === 'mod' && existingRecord.sha1) {
        const modsDir = path.join(this.getInstanceDir(instanceId), 'mods');
        const normalPath = this.validateSafeExtractPath(modsDir, existingRecord.fileName);
        const existingPath = fs.existsSync(normalPath) ? normalPath : `${normalPath}.disabled`;
        if (fs.existsSync(existingPath)) {
          const digest = crypto.createHash('sha1').update(fs.readFileSync(existingPath)).digest('hex');
          if (digest.toLowerCase() === existingRecord.sha1.toLowerCase()) {
            installing.delete(projectId);
            installed.add(projectId);
            return;
          }
        }
      }

      const versions = await this.modrinthService.getProjectVersions(projectId, gameVersion, ['fabric']);
      const version = versions.find((candidate) => candidate.version_type === 'release') || versions[0];
      if (!version) throw new Error(`No Fabric build of managed project ${projectId} supports Minecraft ${gameVersion}.`);

      for (const dependency of version.dependencies || []) {
        if (dependency.dependency_type === 'required' && dependency.project_id) {
          await installProject(dependency.project_id);
        }
      }

      const file = version.files.find((candidate) => candidate.primary) || version.files[0];
      if (!file?.url || !file.filename.toLowerCase().endsWith('.jar')) {
        throw new Error(`Managed project ${projectId} has no downloadable Fabric JAR.`);
      }
      const downloadUrl = new URL(file.url);
      if (downloadUrl.protocol !== 'https:' || !(downloadUrl.hostname === 'cdn.modrinth.com' || downloadUrl.hostname.endsWith('.modrinth.com'))) {
        throw new Error(`Managed project ${projectId} returned an untrusted download URL.`);
      }
      const expectedSha1 = String(file.hashes?.sha1 || '').toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(expectedSha1)) {
        throw new Error(`Managed project ${projectId} has no valid SHA-1 checksum.`);
      }
      if (Number(file.size) > 100 * 1024 * 1024) {
        throw new Error(`Managed project ${projectId} exceeds the 100 MiB download limit.`);
      }

      const modsDir = path.join(this.getInstanceDir(instanceId), 'mods');
      fs.mkdirSync(modsDir, { recursive: true });
      const targetPath = this.validateSafeExtractPath(modsDir, file.filename);
      const disabledPath = `${targetPath}.disabled`;
      const disabledByUser = !fs.existsSync(targetPath) && fs.existsSync(disabledPath);
      let targetIsValid = false;
      const existingPath = fs.existsSync(targetPath) ? targetPath : (disabledByUser ? disabledPath : null);
      if (existingPath) {
        const existingHash = crypto.createHash('sha1').update(fs.readFileSync(existingPath)).digest('hex');
        targetIsValid = existingHash.toLowerCase() === expectedSha1;
      }
      if (!targetIsValid) {
        if (existingPath) fs.rmSync(existingPath, { force: true });
        onProgress?.(`Downloading managed Fabric mod ${file.filename}...`);
        const response = await fetch(downloadUrl, {
          headers: { 'User-Agent': 'DewClient/1.0.1' },
          redirect: 'error',
          signal: AbortSignal.timeout(60_000)
        });
        if (!response.ok) throw new Error(`Managed Fabric mod download failed (${response.status}).`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length || buffer.length > 100 * 1024 * 1024 || (file.size > 0 && buffer.length !== file.size)) {
          throw new Error(`Managed project ${projectId} downloaded an invalid file size.`);
        }
        const checksum = crypto.createHash('sha1').update(buffer).digest('hex');
        if (checksum.toLowerCase() !== expectedSha1) {
          throw new Error(`Managed Fabric mod checksum failed for ${file.filename}.`);
        }
        const writePath = disabledByUser ? disabledPath : targetPath;
        const temporaryPath = `${writePath}.tmp.${process.pid}`;
        try {
          fs.writeFileSync(temporaryPath, buffer);
          fs.renameSync(temporaryPath, writePath);
        } catch (error) {
          fs.rmSync(temporaryPath, { force: true });
          throw error;
        }
      }

      this.rememberInstalledProject(instanceId, projectId, 'mod', file.filename, expectedSha1);

      installing.delete(projectId);
      installed.add(projectId);
    };

    const configuredProjects = getSettingsStorage().getSettings().modrinth?.managedProjectIds;
    const bundledFabricApi = this.readBundledCosmeticsVersion(gameVersion)?.metadata.dependencies
      ?.some((dependency) => dependency.projectId === 'fabric-api') === true;
    const projectIds = [...new Set([
      ...(bundledFabricApi ? [] : ['fabric-api']),
      ...(Array.isArray(configuredProjects) && configuredProjects.length > 0
        ? configuredProjects
        : this.managedFabricProjects)
    ])].filter((projectId) => !(bundledFabricApi && projectId === 'fabric-api'));

    for (const projectId of projectIds) {
      try {
        await installProject(projectId);
      } catch (error: any) {
        getLogger().warn('content', `Optional managed Fabric project ${projectId} was not installed:`, error.message);
        installing.delete(projectId);
      }
    }
    return [...installed];
  }

  public async installManagedCosmeticsMod(
    instanceId: string,
    onProgress?: (message: string) => void
  ): Promise<boolean> {
    const instance = this.instanceManager.getInstance(instanceId);
    if (!instance || instance.loaderType !== 'fabric') return false;

    const loaderDir = this.getBundledLoaderDir();
    if (!loaderDir) {
      throw new Error('DewCosmetics manifest was not packaged with this DewClient installation.');
    }
    let manifest: { versions?: Record<string, BundledCosmeticsVersion> };
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(loaderDir, 'versions.json'), 'utf8'));
    } catch {
      throw new Error(`DewCosmetics manifest is invalid for Minecraft ${instance.minecraftVersion}.`);
    }
    const metadata = manifest.versions?.[instance.minecraftVersion];
    if (!metadata) return false;
    if (metadata.status !== 'built') {
      throw new Error(`DewCosmetics for Minecraft ${instance.minecraftVersion} has not been built into the installer.`);
    }
    const modVersion = this.getManagedCosmeticsModVersion(instance.minecraftVersion);
    if (!modVersion) {
      throw new Error(`DewCosmetics version metadata is invalid for Minecraft ${instance.minecraftVersion}.`);
    }
    const modsDir = path.join(this.getInstanceDir(instanceId), 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    const artifacts = [
      ...(metadata.dependencies || []),
      { artifact: metadata.artifact, sha256: metadata.sha256, projectId: 'dewcosmetics' }
    ];
    for (const artifact of artifacts) {
      if (!artifact.artifact || !artifact.sha256 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
        throw new Error(`A bundled mod dependency has invalid installer metadata for Minecraft ${instance.minecraftVersion}.`);
      }
      const sourcePath = this.validateSafeExtractPath(loaderDir, artifact.artifact);
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Bundled mod dependency is missing from the installer: ${path.basename(artifact.artifact)}.`);
      }
      const sourceBytes = fs.readFileSync(sourcePath);
      const actualSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
      if (artifact.sha256.toLowerCase() !== actualSha256) {
        throw new Error(`Bundled mod failed SHA-256 verification: ${path.basename(artifact.artifact)}.`);
      }
      const fileName = path.basename(artifact.artifact);
      const targetPath = this.validateSafeExtractPath(modsDir, fileName);
      const disabledPath = `${targetPath}.disabled`;
      const oldCosmeticsMods = artifact.projectId === 'dewcosmetics' ? this.findInstalledDewCosmeticsMods(modsDir) : [];
      const previousDisabledMod = oldCosmeticsMods.some((candidate) => candidate !== targetPath && candidate.endsWith('.disabled'));
      const disabledByUser = !fs.existsSync(targetPath) && (fs.existsSync(disabledPath) || previousDisabledMod);
      const existingPath = fs.existsSync(targetPath) ? targetPath : (fs.existsSync(disabledPath) ? disabledPath : null);
      let alreadyValid = false;
      if (existingPath) {
        const existingHash = crypto.createHash('sha256').update(fs.readFileSync(existingPath)).digest('hex');
        alreadyValid = existingHash === actualSha256;
      }
      if (!alreadyValid) {
        onProgress?.(`Installing ${artifact.projectId === 'fabric-api' ? 'Fabric API' : `DewCosmetics ${modVersion}`} for Minecraft ${instance.minecraftVersion}...`);
        const writePath = disabledByUser ? disabledPath : targetPath;
        const temporaryPath = `${writePath}.tmp.${process.pid}`;
        try {
          fs.writeFileSync(temporaryPath, sourceBytes);
          fs.renameSync(temporaryPath, writePath);
        } catch (error) {
          fs.rmSync(temporaryPath, { force: true });
          throw error;
        }
      }
      if (artifact.projectId === 'dewcosmetics') {
        const installedPath = disabledByUser ? disabledPath : targetPath;
        for (const previousPath of oldCosmeticsMods) {
          if (previousPath === installedPath || previousPath === targetPath || previousPath === disabledPath) continue;
          fs.rmSync(previousPath, { force: true });
        }
      }
      if (artifact.projectId) this.rememberInstalledProject(instanceId, artifact.projectId, 'mod', fileName);
    }
    return true;
  }
}

let contentManager: ContentManager | null = null;

export function getContentManager(): ContentManager {
  if (!contentManager) {
    contentManager = new ContentManager();
  }
  return contentManager;
}
