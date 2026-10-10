/**
 * DewClient - Settings Storage Manager with Atomic Writes
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../../shared/constants/defaults.ts';
import { getPathManager } from './paths.ts';

export type LauncherSettings = typeof DEFAULT_SETTINGS;

export class SettingsStorage {
  private filePath: string;
  private settings: LauncherSettings;

  constructor(filePath?: string) {
    this.filePath = filePath || getPathManager().getSettingsFilePath();
    this.settings = this.load();
  }

  public getSettings(): LauncherSettings {
    return JSON.parse(JSON.stringify({
      ...this.settings,
      remote: {
        ...this.settings.remote,
        shareAccountUsage: true,
        shareOnlinePresence: true,
        privacyDefaultsVersion: 2
      }
    }));
  }

  public updateSettings(partial: Partial<LauncherSettings>): LauncherSettings {
    if (partial.minecraft?.memoryMb !== undefined && (!Number.isFinite(partial.minecraft.memoryMb) || partial.minecraft.memoryMb <= 0)) {
      throw new Error('Global Minecraft memory must be a finite positive number of megabytes.');
    }
    this.settings = {
      ...this.settings,
      ...partial,
      general: { ...this.settings.general, ...(partial.general || {}) },
      minecraft: { ...this.settings.minecraft, ...(partial.minecraft || {}) },
      downloads: { ...this.settings.downloads, ...(partial.downloads || {}) },
      modrinth: { ...this.settings.modrinth, ...(partial.modrinth || {}) },
      launcher: { ...this.settings.launcher, ...(partial.launcher || {}) },
      remote: {
        ...this.settings.remote,
        ...(partial.remote || {}),
        shareAccountUsage: true,
        shareOnlinePresence: true,
        privacyDefaultsVersion: 2
      }
    };
    this.save();
    return this.getSettings();
  }

  private load(): LauncherSettings {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const { minMemoryMb: _minMemoryMb, maxMemoryMb: _maxMemoryMb, ...minecraft } = parsed.minecraft || {};
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          general: { ...DEFAULT_SETTINGS.general, ...(parsed.general || {}) },
          minecraft: { ...DEFAULT_SETTINGS.minecraft, ...minecraft },
          downloads: { ...DEFAULT_SETTINGS.downloads, ...(parsed.downloads || {}) },
          modrinth: { ...DEFAULT_SETTINGS.modrinth, ...(parsed.modrinth || {}) },
          launcher: { ...DEFAULT_SETTINGS.launcher, ...(parsed.launcher || {}), autoInstallUpdates: false },
          remote: {
            ...DEFAULT_SETTINGS.remote,
            ...(parsed.remote || {}),
            // Connected account sharing is an always-on condition of using DewClient.
            shareAccountUsage: true,
            shareOnlinePresence: true,
            privacyDefaultsVersion: 2
          }
        };
      }
    } catch (err: any) {
      console.warn('[SETTINGS] Could not read settings file, reverting to defaults:', err.message);
    }
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${this.filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(this.settings, null, 2), 'utf-8');
    fs.renameSync(tempPath, this.filePath);
  }
}

let instance: SettingsStorage | null = null;

export function getSettingsStorage(): SettingsStorage {
  const expectedFilePath = getPathManager().getSettingsFilePath();
  if (!instance || (instance as any).filePath !== expectedFilePath) {
    instance = new SettingsStorage();
  }
  return instance;
}
