/**
 * DewClient - Minecraft Asset Pipeline Manager
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { MinecraftVersionPackage, AssetIndex, AssetObject } from '../../shared/types/minecraft.ts';
import { ENDPOINTS } from '../../shared/constants/endpoints.ts';
import { getPathManager } from '../storage/paths.ts';
import { getLogger } from '../core/logger.ts';

async function readBufferLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error('Asset index response exceeds the size limit.');
  if (!response.body) throw new Error('Asset index response has no body.');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('Asset index response exceeds the size limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export interface ResolvedAsset {
  key: string;
  hash: string;
  size: number;
  url: string;
  localPath: string;
}

export class AssetService {
  private pathManager = getPathManager();

  public async fetchAssetIndex(pkg: MinecraftVersionPackage): Promise<AssetIndex> {
    const logger = getLogger();
    const assetMeta = pkg.assetIndex;
    if (!assetMeta || !assetMeta.url) {
      throw new Error(`Version package '${pkg.id}' does not declare an assetIndex.`);
    }

    if (!/^[A-Za-z0-9._-]{1,128}$/.test(assetMeta.id)
      || !/^[a-f0-9]{40}$/i.test(String(assetMeta.sha1 || ''))
      || !Number.isSafeInteger(assetMeta.size) || assetMeta.size <= 0 || assetMeta.size > 20 * 1024 * 1024) {
      throw new Error(`Version package '${pkg.id}' has invalid asset index integrity metadata.`);
    }
    const indexUrl = new URL(assetMeta.url);
    if (indexUrl.protocol !== 'https:' || indexUrl.hostname !== 'piston-meta.mojang.com') {
      throw new Error(`Version package '${pkg.id}' has an untrusted asset index URL.`);
    }
    const localIndexPath = path.join(this.pathManager.getAssetIndexesPath(), `${assetMeta.id}.json`);

    if (fs.existsSync(localIndexPath)) {
      try {
        const content = fs.readFileSync(localIndexPath);
        if (content.length === assetMeta.size && crypto.createHash('sha1').update(content).digest('hex').toLowerCase() === assetMeta.sha1.toLowerCase()) {
          const parsed = JSON.parse(content.toString('utf8'));
          return { id: assetMeta.id, sha1: assetMeta.sha1, size: assetMeta.size, totalSize: assetMeta.totalSize, url: assetMeta.url, objects: parsed.objects as Record<string, AssetObject> };
        }
      } catch {
        // Re-fetch if invalid
      }
    }

    logger.info('minecraft', `Downloading asset index for ${assetMeta.id} from ${assetMeta.url}...`);
    const res = await fetch(indexUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`Failed to fetch asset index (${res.status}): ${res.statusText}`);
    }

    const buffer = await readBufferLimited(res, 20 * 1024 * 1024);
    if (buffer.length !== assetMeta.size || crypto.createHash('sha1').update(buffer).digest('hex').toLowerCase() !== assetMeta.sha1.toLowerCase()) {
      throw new Error(`Asset index integrity verification failed for ${assetMeta.id}.`);
    }
    const json = JSON.parse(buffer.toString('utf8')) as { objects?: Record<string, AssetObject> };

    const dir = path.dirname(localIndexPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localIndexPath, buffer);

    return {
      id: assetMeta.id,
      sha1: assetMeta.sha1,
      size: assetMeta.size,
      totalSize: assetMeta.totalSize,
      url: assetMeta.url,
      objects: json.objects || {}
    };
  }

  public resolveAssets(assetIndex: AssetIndex): ResolvedAsset[] {
    const objectsDir = this.pathManager.getAssetObjectsPath();
    const resolved: ResolvedAsset[] = [];

    for (const [key, obj] of Object.entries(assetIndex.objects || {})) {
      if (!/^[a-f0-9]{40}$/i.test(String(obj.hash || '')) || !Number.isSafeInteger(obj.size) || obj.size < 0) {
        throw new Error(`Asset index contains an invalid object entry for '${key}'.`);
      }
      const prefix = obj.hash.slice(0, 2);
      const localPath = path.join(objectsDir, prefix, obj.hash);
      const url = `${ENDPOINTS.MOJANG_RESOURCES}/${prefix}/${obj.hash}`;

      resolved.push({
        key,
        hash: obj.hash,
        size: obj.size,
        url,
        localPath
      });
    }

    return resolved;
  }

  public isAssetValid(asset: ResolvedAsset): boolean {
    return this.verifyAssetSha1(asset);
  }

  /**
   * Verify the asset set without monopolizing Electron's main event loop.
   * A clean Minecraft install contains tens of thousands of small files; a
   * tight synchronous SHA-1 loop can make Windows mark the whole launcher as
   * not responding even though downloads and validation are progressing.
   */
  public async findMissingAssets(assets: ResolvedAsset[], onProgress?: (checked: number, total: number) => void): Promise<ResolvedAsset[]> {
    const missing: ResolvedAsset[] = [];
    const yieldToMain = () => new Promise<void>((resolve) => setImmediate(resolve));
    for (let index = 0; index < assets.length; index += 1) {
      if (!this.verifyAssetSha1(assets[index])) missing.push(assets[index]);
      const checked = index + 1;
      if (checked % 32 === 0 || checked === assets.length) {
        onProgress?.(checked, assets.length);
        await yieldToMain();
      }
    }
    return missing;
  }

  public verifyAssetSha1(asset: ResolvedAsset): boolean {
    if (!fs.existsSync(asset.localPath)) return false;
    try {
      if (!/^[a-f0-9]{40}$/i.test(asset.hash) || !Number.isSafeInteger(asset.size) || fs.statSync(asset.localPath).size !== asset.size) return false;
      const buf = fs.readFileSync(asset.localPath);
      const actualSha1 = crypto.createHash('sha1').update(buf).digest('hex');
      return actualSha1.toLowerCase() === asset.hash.toLowerCase();
    } catch {
      return false;
    }
  }
}
