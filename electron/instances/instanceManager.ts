/**
 * DewClient - Isolated Instance Manager
 * Full instance lifecycle with disk isolation, duplication, export/import, stats
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import type { InstanceConfig, InstanceWithStats, InstanceStats } from '../../shared/types/instance.ts';
import { CURRENT_MINECRAFT_PRIMARY_TARGET } from '../../shared/constants/versions.ts';
import { validateInstanceName } from '../../shared/schemas/validation.ts';
import { getPathManager } from '../storage/paths.ts';
import { getLogger } from '../core/logger.ts';

export class InstanceManager {
  private pathManager = getPathManager();
  private indexFile: string;
  private activeInstanceId: string | null = null;

  private getManagedInstanceDirectory(instance: InstanceConfig): string {
    if (typeof instance.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(instance.id)) {
      throw new Error('Instance identifier is invalid.');
    }
    const managedPath = path.resolve(this.pathManager.getInstancePath(instance.id));
    const recordedPath = path.resolve(instance.gameDirectory || managedPath);
    if (recordedPath !== managedPath || (fs.existsSync(managedPath) && fs.lstatSync(managedPath).isSymbolicLink())) {
      throw new Error('Instance directory must remain inside the managed instances folder.');
    }
    return managedPath;
  }

  constructor() {
    this.indexFile = path.join(this.pathManager.getInstancesPath(), 'instances.json');
  }

  private loadIndex(): { instances: InstanceConfig[]; activeId: string | null } {
    try {
      if (fs.existsSync(this.indexFile)) {
        const raw = fs.readFileSync(this.indexFile, 'utf-8');
        const parsed = JSON.parse(raw);
        let changed = false;
        if (Array.isArray(parsed.instances)) {
          for (const inst of parsed.instances) {
            if (inst.loaderType !== 'fabric') {
              inst.loaderType = 'fabric';
              delete inst.loaderVersion;
              changed = true;
            }
            if ('memoryMb' in inst || 'minMemoryMb' in inst || 'maxMemoryMb' in inst) {
              delete inst.memoryMb;
              delete inst.minMemoryMb;
              delete inst.maxMemoryMb;
              changed = true;
            }
            // Only migrate old versions (e.g. 26.2 or obsolete 26.x) if different from primary target
            if (
              inst.minecraftVersion &&
              inst.minecraftVersion !== CURRENT_MINECRAFT_PRIMARY_TARGET &&
              (inst.minecraftVersion === '26.2' || inst.minecraftVersion.startsWith('26.'))
            ) {
              inst.minecraftVersion = CURRENT_MINECRAFT_PRIMARY_TARGET;
              inst.loaderType = 'fabric';
              changed = true;
            }
            // Only migrate legacy names if the name actually needs updating
            if (
              inst.name === 'Minecraft 26.3 Official' ||
              inst.name === 'Minecraft 26.2 (26.2)' ||
              inst.name === 'Minecraft 26.2'
            ) {
              const targetName = `Minecraft ${inst.minecraftVersion || CURRENT_MINECRAFT_PRIMARY_TARGET}`;
              if (inst.name !== targetName) {
                inst.name = targetName;
                changed = true;
              }
            }
          }
        }
        if (changed) {
          this.saveIndex(parsed);
          for (const inst of parsed.instances) {
            try {
              const metadataPath = path.join(this.getManagedInstanceDirectory(inst), 'instance.json');
              fs.writeFileSync(metadataPath, JSON.stringify(inst, null, 2), 'utf-8');
            } catch {}
          }
        }
        return parsed;
      }
    } catch {
      // Revert to empty
    }
    return { instances: [], activeId: null };
  }

  private saveIndex(data: { instances: InstanceConfig[]; activeId: string | null }): void {
    const dir = path.dirname(this.indexFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const temp = `${this.indexFile}.tmp.${Date.now()}`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(temp, this.indexFile);
  }

  public listInstances(): InstanceWithStats[] {
    const data = this.loadIndex();
    return data.instances.map((inst) => ({
      ...inst,
      stats: this.getInstanceStats(this.getManagedInstanceDirectory(inst))
    }));
  }

  public getInstance(id: string): InstanceWithStats | null {
    const data = this.loadIndex();
    const inst = data.instances.find((i) => i.id === id);
    if (!inst) return null;

    return {
      ...inst,
      stats: this.getInstanceStats(this.getManagedInstanceDirectory(inst))
    };
  }

  public recordPlayTime(id: string, elapsedMs: number): InstanceConfig {
    const elapsedMinutes = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) / 60_000 : 0;
    const data = this.loadIndex();
    const index = data.instances.findIndex((instance) => instance.id === id);
    if (index < 0) throw new Error(`Instance '${id}' not found.`);

    const current = data.instances[index];
    const updated: InstanceConfig = {
      ...current,
      totalPlayTimeMinutes: Math.max(0, current.totalPlayTimeMinutes || 0) + elapsedMinutes,
      lastPlayedAt: new Date().toISOString()
    };
    data.instances[index] = updated;
    this.saveIndex(data);

    const directory = this.getManagedInstanceDirectory(updated);
    try {
      fs.writeFileSync(path.join(directory, 'instance.json'), JSON.stringify(updated, null, 2), 'utf-8');
    } catch {
      // The instances index remains the authoritative playtime record.
    }
    return updated;
  }

  public getActiveInstance(): InstanceWithStats | null {
    const data = this.loadIndex();
    const id = data.activeId || data.instances[0]?.id;
    if (!id) return null;
    return this.getInstance(id);
  }

  public setActiveInstance(id: string): void {
    const data = this.loadIndex();
    if (data.instances.some((i) => i.id === id)) {
      data.activeId = id;
      this.saveIndex(data);
    }
  }

  public createInstance(params: Partial<InstanceConfig>): InstanceConfig {
    const name = params.name?.trim() || 'New Instance';
    const valRes = validateInstanceName(name);
    if (!valRes.valid) {
      throw new Error(valRes.error || 'Invalid instance name.');
    }

    const id = params.id || `inst-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new Error('Instance identifier is invalid.');
    }
    const gameDirectory = path.resolve(this.pathManager.getInstancePath(id));
    if (params.gameDirectory && path.resolve(params.gameDirectory) !== gameDirectory) {
      throw new Error('Instance directory must be selected by DewClient.');
    }

    // Create isolated folder structure
    this.scaffoldInstanceDirectories(gameDirectory);

    const now = new Date().toISOString();
    const config: InstanceConfig = {
      id,
      name,
      minecraftVersion: params.minecraftVersion || CURRENT_MINECRAFT_PRIMARY_TARGET,
      loaderType: 'fabric',
      loaderVersion: params.loaderVersion,
      gameDirectory,
      javaPath: params.javaPath,
      jvmArgs: params.jvmArgs || '',
      gameArgs: params.gameArgs || '',
      icon: params.icon,
      createdAt: now,
      lastPlayedAt: undefined,
      totalPlayTimeMinutes: 0
    };

    // Write instance.json metadata inside the game directory as well
    const metaFile = path.join(gameDirectory, 'instance.json');
    fs.writeFileSync(metaFile, JSON.stringify(config, null, 2), 'utf-8');

    const data = this.loadIndex();
    data.instances.push(config);
    if (!data.activeId) {
      data.activeId = config.id;
    }
    this.saveIndex(data);

    getLogger().info('instances', `Created instance '${config.name}' (${config.id})`);
    return config;
  }

  public updateInstance(id: string, partial: Partial<InstanceConfig>): InstanceConfig {
    const data = this.loadIndex();
    const idx = data.instances.findIndex((i) => i.id === id);
    if (idx < 0) {
      throw new Error(`Instance '${id}' not found.`);
    }
    const managedDirectory = this.getManagedInstanceDirectory(data.instances[idx]);
    if (partial.gameDirectory !== undefined && path.resolve(partial.gameDirectory) !== managedDirectory) {
      throw new Error('Instance directory cannot be changed.');
    }

    if (partial.name) {
      const valRes = validateInstanceName(partial.name);
      if (!valRes.valid) throw new Error(valRes.error);
    }

    const safePartial = { ...partial } as Partial<InstanceConfig> & Record<string, unknown>;
    safePartial.loaderType = 'fabric';
    delete safePartial.memoryMb;
    delete safePartial.minMemoryMb;
    delete safePartial.maxMemoryMb;

    const updated: InstanceConfig = {
      ...data.instances[idx],
      ...safePartial
    };

    data.instances[idx] = updated;
    this.saveIndex(data);

    // Update instance.json in instance folder
    const dir = this.getManagedInstanceDirectory(updated);
    const metaFile = path.join(dir, 'instance.json');
    try {
      fs.writeFileSync(metaFile, JSON.stringify(updated, null, 2), 'utf-8');
    } catch {
      // Best effort
    }

    return updated;
  }

  public duplicateInstance(id: string, newName?: string): InstanceConfig {
    const original = this.getInstance(id);
    if (!original) {
      throw new Error(`Instance '${id}' not found.`);
    }

    const targetName = newName || `${original.name} (Copy)`;
    const newInst = this.createInstance({
      ...original,
      name: targetName,
      id: undefined,
      gameDirectory: undefined,
      createdAt: undefined,
      lastPlayedAt: undefined,
      totalPlayTimeMinutes: 0
    });

    const origDir = this.getManagedInstanceDirectory(original);
    const targetDir = this.getManagedInstanceDirectory(newInst);

    // Copy mods, resourcepacks, shaderpacks, config
    const copyFolders = ['mods', 'resourcepacks', 'shaderpacks', 'config'];
    for (const folder of copyFolders) {
      const src = path.join(origDir, folder);
      const dst = path.join(targetDir, folder);
      if (fs.existsSync(src)) {
        try {
          fs.cpSync(src, dst, { recursive: true });
        } catch (err: any) {
          getLogger().warn('instances', `Failed to copy ${folder} during duplication:`, err.message);
        }
      }
    }

    return newInst;
  }

  public exportInstance(id: string, exportPath?: string): string {
    const instance = this.getInstance(id);
    if (!instance) throw new Error(`Instance '${id}' not found.`);

    const sourceDir = this.getManagedInstanceDirectory(instance);
    if (!fs.existsSync(sourceDir)) throw new Error(`Instance directory '${sourceDir}' does not exist.`);

    const safeName = instance.name.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-|-$/g, '') || id;
    const targetPath = exportPath || path.join(this.pathManager.getDownloadsPath(), `${safeName}.dewinstance.zip`);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const archive = new AdmZip();
    archive.addLocalFolder(sourceDir);
    archive.writeZip(targetPath);
    return targetPath;
  }

  public importInstance(zipPath: string, name?: string): InstanceConfig {
    if (!zipPath || !fs.existsSync(zipPath)) throw new Error('Instance archive was not found.');

    const archive = new AdmZip(zipPath);
    for (const entry of archive.getEntries()) {
      const normalized = entry.entryName.replace(/\\/g, '/');
      if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
        throw new Error('Instance archive contains an unsafe path.');
      }
    }

    const metadataEntry = archive.getEntry('instance.json');
    const metadata = metadataEntry
      ? JSON.parse(metadataEntry.getData().toString('utf8')) as Partial<InstanceConfig>
      : {};
    const instance = this.createInstance({
      ...metadata,
      id: undefined,
      name: name?.trim() || `${metadata.name || 'Imported Instance'} (Imported)`,
      gameDirectory: undefined,
      createdAt: undefined,
      lastPlayedAt: undefined,
      totalPlayTimeMinutes: 0
    });
    const targetDir = this.getManagedInstanceDirectory(instance);
    for (const entry of archive.getEntries()) {
      if (entry.isDirectory || entry.entryName === 'instance.json') continue;
      const destination = path.resolve(targetDir, entry.entryName);
      if (!destination.startsWith(`${path.resolve(targetDir)}${path.sep}`)) {
        throw new Error('Instance archive contains an unsafe destination path.');
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, entry.getData());
    }
    fs.writeFileSync(path.join(targetDir, 'instance.json'), JSON.stringify(instance, null, 2), 'utf-8');
    return instance;
  }

  public deleteInstance(id: string): boolean {
    const data = this.loadIndex();
    const inst = data.instances.find((i) => i.id === id);
    if (!inst) return false;

    let dir: string;
    try {
      dir = this.getManagedInstanceDirectory(inst);
    } catch {
      return false;
    }
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err: any) {
        getLogger().error('instances', `Failed to delete instance directory ${dir}:`, err.message);
      }
    }

    data.instances = data.instances.filter((i) => i.id !== id);
    if (data.activeId === id) {
      data.activeId = data.instances[0]?.id || null;
    }
    this.saveIndex(data);

    getLogger().info('instances', `Deleted instance ${id}`);
    return true;
  }

  public scaffoldInstanceDirectories(gameDir: string): void {
    const subdirs = [
      '',
      'mods',
      'resourcepacks',
      'shaderpacks',
      'config',
      'logs',
      'saves',
      'screenshots'
    ];

    for (const sub of subdirs) {
      const p = path.join(gameDir, sub);
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
      }
    }
  }

  public getInstanceStats(gameDir: string): InstanceStats {
    const countFiles = (dir: string) => {
      if (!fs.existsSync(dir)) return 0;
      try {
        return fs.readdirSync(dir).filter((f) => !f.startsWith('.') && !f.endsWith('.disabled')).length;
      } catch {
        return 0;
      }
    };

    let modCount = 0;
    const modsDir = path.join(gameDir, 'mods');
    if (fs.existsSync(modsDir)) {
      try {
        modCount = fs.readdirSync(modsDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && /\.jar(?:\.disabled)?$/i.test(entry.name)).length;
      } catch {
        modCount = 0;
      }
    }

    return {
      modCount,
      resourcePackCount: countFiles(path.join(gameDir, 'resourcepacks')),
      shaderPackCount: countFiles(path.join(gameDir, 'shaderpacks'))
    };
  }

}

let instanceManager: InstanceManager | null = null;

export function getInstanceManager(): InstanceManager {
  if (!instanceManager) {
    instanceManager = new InstanceManager();
  }
  return instanceManager;
}
