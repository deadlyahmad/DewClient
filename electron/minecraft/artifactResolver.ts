/**
 * DewClient - Minecraft Client JAR Artifact Resolver
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { MinecraftVersionPackage } from '../../shared/types/minecraft.ts';
import { getPathManager } from '../storage/paths.ts';
import { getLogger } from '../core/logger.ts';

export interface ClientArtifactDescriptor {
  versionId: string;
  url: string;
  sha1: string;
  size: number;
  localPath: string;
}

export class ArtifactResolver {
  private pathManager = getPathManager();

  public resolveClientJar(pkg: MinecraftVersionPackage): ClientArtifactDescriptor {
    const clientDownload = pkg.downloads?.client;
    if (!clientDownload || !clientDownload.url) {
      throw new Error(`Version package '${pkg.id}' does not declare a client JAR download artifact.`);
    }
    if (!/^[a-f0-9]{40}$/i.test(String(clientDownload.sha1 || ''))
      || !Number.isSafeInteger(clientDownload.size) || clientDownload.size <= 0) {
      throw new Error(`Version package '${pkg.id}' does not provide verifiable client JAR integrity metadata.`);
    }

    const localPath = this.pathManager.getVersionJarPath(pkg.id);

    return {
      versionId: pkg.id,
      url: clientDownload.url,
      sha1: clientDownload.sha1,
      size: clientDownload.size,
      localPath
    };
  }

  public verifyArtifact(descriptor: ClientArtifactDescriptor): boolean {
    if (!fs.existsSync(descriptor.localPath)) {
      return false;
    }

    try {
      const stats = fs.statSync(descriptor.localPath);
      if (!Number.isSafeInteger(descriptor.size) || stats.size !== descriptor.size) {
        return false;
      }

      if (!/^[a-f0-9]{40}$/i.test(descriptor.sha1)) return false;
      const fileBuf = fs.readFileSync(descriptor.localPath);
      const actualSha1 = crypto.createHash('sha1').update(fileBuf).digest('hex');
      if (actualSha1.toLowerCase() !== descriptor.sha1.toLowerCase()) {
        return false;
      }

      return true;
    } catch (err: any) {
      getLogger().warn('minecraft', `Failed to verify client artifact ${descriptor.localPath}:`, err.message);
      return false;
    }
  }
}
