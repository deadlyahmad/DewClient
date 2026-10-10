/**
 * DewClient - Official Mojang Version Manifest Pipeline
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ENDPOINTS } from '../../shared/constants/endpoints.ts';
import { CURRENT_MINECRAFT_PRIMARY_TARGET } from '../../shared/constants/versions.ts';
import type { MinecraftManifest, MinecraftVersionMetadata, MinecraftVersionPackage } from '../../shared/types/minecraft.ts';
import { getPathManager } from '../storage/paths.ts';
import { getLogger } from '../core/logger.ts';

async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error('Minecraft metadata response exceeds the size limit.');
  if (!response.body) throw new Error('Minecraft metadata response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('Minecraft metadata response exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

function sha1(value: string | Buffer): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

export class ManifestService {
  private pathManager = getPathManager();
  private manifestCachePath: string;

  constructor() {
    this.manifestCachePath = path.join(this.pathManager.getCachePath(), 'version_manifest_v2.json');
  }

  private isSupportedRelease(versionId: string): boolean {
    const parts = versionId.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return false;
    const [major, minor] = parts;
    const atLeastFabricFloor = major > 1 || (major === 1 && minor >= 14);
    const atMostSupportedCeiling = major < 26 || (major === 26 && minor <= 3);
    return atLeastFabricFloor && atMostSupportedCeiling;
  }

  /**
   * Fetches official Mojang version_manifest_v2.json with local caching
   */
  public async getManifest(forceRefresh = false): Promise<MinecraftManifest> {
    const logger = getLogger();

    if (!forceRefresh && fs.existsSync(this.manifestCachePath)) {
      try {
        const stats = fs.statSync(this.manifestCachePath);
        // Cache valid for 30 minutes
        if (Date.now() - stats.mtimeMs < 30 * 60 * 1000) {
          const content = fs.readFileSync(this.manifestCachePath, 'utf-8');
          return JSON.parse(content) as MinecraftManifest;
        }
      } catch (err: any) {
        logger.warn('minecraft', 'Could not read manifest cache, re-fetching...', { error: err.message });
      }
    }

    logger.info('minecraft', `Fetching Mojang version manifest from ${ENDPOINTS.MOJANG_MANIFEST_V2}...`);
    try {
      const res = await fetch(ENDPOINTS.MOJANG_MANIFEST_V2, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        throw new Error(`Failed to fetch Mojang manifest (${res.status}): ${res.statusText}`);
      }

      const manifest = JSON.parse(await readTextLimited(res, 10 * 1024 * 1024)) as MinecraftManifest;
      if (!Array.isArray(manifest.versions) || manifest.versions.length > 10_000) throw new Error('Mojang version manifest is invalid.');
      fs.writeFileSync(this.manifestCachePath, JSON.stringify(manifest, null, 2), 'utf-8');
      return manifest;
    } catch (err: any) {
      if (fs.existsSync(this.manifestCachePath)) {
        logger.warn('minecraft', 'Using expired manifest cache due to network failure.');
        const content = fs.readFileSync(this.manifestCachePath, 'utf-8');
        return JSON.parse(content) as MinecraftManifest;
      }
      throw err;
    }
  }

  /**
   * Lists stable/released versions only. Snapshot channel support is intentionally excluded.
   */
  public async listVersions(channel: 'release' | 'all' = 'release'): Promise<MinecraftVersionMetadata[]> {
    const manifest = await this.getManifest();
    const installedSet = this.listInstalledVersionIds();

    return manifest.versions
      .filter((v) => {
        const supported = v.type === 'release' || v.type === 'snapshot';
        return supported && this.isSupportedRelease(v.id) && (channel === 'all' || v.type === 'release');
      })
      .map((v) => ({
        ...v,
        isInstalled: installedSet.has(v.id)
      }));
  }

  public async listFabricVersions(): Promise<string[]> {
    try {
      const res = await fetch('https://meta.fabricmc.net/v2/versions/game', { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const data = JSON.parse(await readTextLimited(res, 2 * 1024 * 1024)) as Array<{ version: string; stable: boolean }>;
        if (!Array.isArray(data)) return [];
        return data.filter((v) => v.stable).map((v) => v.version);
      }
    } catch (err: any) {
      getLogger().warn('minecraft', 'Failed to fetch Fabric versions:', err.message);
    }
    return [];
  }

  public listInstalledVersionIds(): Set<string> {
    const set = new Set<string>();
    const versionsDir = this.pathManager.getVersionsPath();
    if (!fs.existsSync(versionsDir)) return set;

    const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const jsonPath = path.join(versionsDir, ent.name, `${ent.name}.json`);
        const jarPath = path.join(versionsDir, ent.name, `${ent.name}.jar`);
        if (fs.existsSync(jsonPath) && fs.existsSync(jarPath)) {
          set.add(ent.name);
        }
      }
    }
    return set;
  }

  /**
   * Fetches official version package JSON for a specific version ID (e.g. "26.3")
   */
  public async getVersionPackage(versionId: string, forceRefresh = false): Promise<MinecraftVersionPackage> {
    const logger = getLogger();
    const localJsonPath = this.pathManager.getVersionJsonPath(versionId);

    const manifest = await this.getManifest();
    const versionMeta = manifest.versions.find((v) =>
      v.id === versionId &&
      (v.type === 'release' || v.type === 'snapshot') &&
      this.isSupportedRelease(v.id)
    );
    if (!versionMeta) {
      throw new Error(`Version '${versionId}' is not a supported official release (required range is 1.14 through 26.3).`);
    }

    if (!forceRefresh && fs.existsSync(localJsonPath)) {
      try {
        const content = fs.readFileSync(localJsonPath);
        const cached = JSON.parse(content.toString('utf-8')) as MinecraftVersionPackage;
        if (cached?.id === versionId && /^[a-f0-9]{40}$/i.test(versionMeta.sha1 || '')
          && sha1(content).toLowerCase() === versionMeta.sha1.toLowerCase()) {
          return cached;
        }
        fs.rmSync(localJsonPath, { force: true });
      } catch (err: any) {
        logger.warn('minecraft', `Corrupted local version JSON for ${versionId}, re-fetching...`);
      }
    }

    logger.info('minecraft', `Fetching official version package for ${versionId} from ${versionMeta.url}...`);
    let packageUrl: URL;
    try {
      packageUrl = new URL(versionMeta.url);
    } catch {
      throw new Error(`Mojang version package URL for ${versionId} is invalid.`);
    }
    if (packageUrl.protocol !== 'https:' || packageUrl.hostname !== 'piston-meta.mojang.com'
      || !/^[a-f0-9]{40}$/i.test(versionMeta.sha1 || '')) {
      throw new Error(`Mojang version package metadata for ${versionId} is not verifiable.`);
    }
    const res = await fetch(packageUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`Failed to fetch version package JSON for ${versionId} (${res.status}): ${res.statusText}`);
    }

    const packageText = await readTextLimited(res, 20 * 1024 * 1024);
    if (sha1(packageText).toLowerCase() !== versionMeta.sha1.toLowerCase()) {
      throw new Error(`Mojang version package checksum failed for ${versionId}.`);
    }
    const pkg = JSON.parse(packageText) as MinecraftVersionPackage;
    if (pkg.id !== versionId || !Array.isArray(pkg.libraries)) throw new Error(`Mojang version package for ${versionId} is invalid.`);

    const dir = path.dirname(localJsonPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localJsonPath, packageText, 'utf-8');

    return pkg;
  }

  public getPrimaryTargetVersionId(): string {
    return CURRENT_MINECRAFT_PRIMARY_TARGET;
  }
}
