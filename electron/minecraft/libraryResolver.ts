/**
 * DewClient - Library and Native Artifact Resolver
 * Processes official Mojang rules, platform classifiers, SDL3 and modern natives
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MinecraftVersionPackage, Library, ArgumentRule, ResolvedLibrary } from '../../shared/types/minecraft.ts';
import { getPathManager } from '../storage/paths.ts';

export class LibraryResolver {
  private pathManager = getPathManager();

  public isLibraryValid(library: ResolvedLibrary): boolean {
    if (!fs.existsSync(library.path)) return false;
    try {
      const stats = fs.statSync(library.path);
      if (!Number.isSafeInteger(library.size) || stats.size !== library.size) return false;
      if (typeof library.sha1 !== 'string' || !/^[a-f0-9]{40}$/i.test(library.sha1)) return false;
      const hash = crypto.createHash('sha1').update(fs.readFileSync(library.path)).digest('hex');
      if (hash.toLowerCase() !== library.sha1.toLowerCase()) return false;
      return true;
    } catch {
      return false;
    }
  }

  public getPlatformOsName(): 'windows' | 'osx' | 'linux' {
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'darwin') return 'osx';
    return 'linux';
  }

  public getPlatformArch(): string {
    if (process.arch === 'x64') return 'x64';
    if (process.arch === 'arm64') return 'arm64';
    if (process.arch === 'ia32') return 'x86';
    return process.arch;
  }

  /**
   * Evaluates Mojang conditional argument/library rules
   */
  public evaluateRules(rules?: ArgumentRule[], features: Record<string, boolean> = {}): boolean {
    if (!rules || rules.length === 0) return true;

    const currentOs = this.getPlatformOsName();
    const currentArch = this.getPlatformArch();

    // In Mojang rule semantics:
    // If any rule has action === 'allow', default is false (disallowed unless explicitly allowed)
    // If no rule has action === 'allow', default is true (allowed unless explicitly disallowed)
    const hasAllowRule = rules.some((r) => r.action === 'allow');
    let isAllowed = !hasAllowRule;

    for (const rule of rules) {
      let applies = true;

      if (rule.os) {
        if (rule.os.name && rule.os.name !== currentOs) {
          applies = false;
        }
        if (rule.os.arch && rule.os.arch !== currentArch) {
          applies = false;
        }
      }

      if (rule.features) {
        for (const [feature, expected] of Object.entries(rule.features)) {
          if ((features[feature] ?? false) !== expected) {
            applies = false;
            break;
          }
        }
      }

      if (applies) {
        isAllowed = rule.action === 'allow';
      }
    }

    return isAllowed;
  }

  /**
   * Converts Maven coordinate "group:name:version[:classifier][@ext]" to relative path
   */
  public mavenToPath(mavenCoordinate: string): string {
    const [groupNameVer, ext = 'jar'] = mavenCoordinate.split('@');
    const parts = groupNameVer.split(':');
    if (parts.length < 3 || parts.length > 4
      || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(parts[0])
      || !/^[A-Za-z0-9_.-]+$/.test(parts[1])
      || !/^[A-Za-z0-9_.+-]+$/.test(parts[2])
      || (parts[3] && !/^[A-Za-z0-9_.+-]+$/.test(parts[3]))
      || !/^[A-Za-z0-9]+$/.test(ext)) {
      throw new Error('Minecraft library metadata contains an unsafe Maven coordinate.');
    }
    const group = parts[0].replace(/\./g, '/');
    const artifact = parts[1];
    const version = parts[2];
    const classifier = parts[3];

    const fileName = classifier
      ? `${artifact}-${version}-${classifier}.${ext}`
      : `${artifact}-${version}.${ext}`;

    return path.join(group, artifact, version, fileName);
  }

  /**
   * Some native-only libraries publish classifier payloads (for example lwjgl-platform)
   * but do not provide a valid plain artifact download. Keep the classifier download and
   * skip the bogus plain JAR to avoid 404s such as legacyfabric lwjgl-platform 2.9.4.
   */
  private shouldSkipPlainNativeArtifact(lib: { name: string; downloads?: { artifact?: { path: string }; classifiers?: Record<string, { path: string }> }; natives?: Record<string, string> }): boolean {
    if (!lib.downloads?.artifact || !lib.natives || !lib.downloads.classifiers) {
      return false;
    }

    const plainPath = lib.downloads.artifact.path;
    const plainFile = path.basename(plainPath);
    if (plainFile.includes('-natives-')) {
      return false;
    }

    const classifierFiles = Object.values(lib.downloads.classifiers).map((artifact) => path.basename(artifact.path));
    const baseNameWithoutExt = plainFile.replace(/\.[^.]+$/, '');
    const plainArtifactLooksNativeOnly = plainFile.includes('-platform') || lib.name.includes('lwjgl-platform');

    return plainArtifactLooksNativeOnly && classifierFiles.some((classifierFile) =>
      classifierFile.startsWith(`${baseNameWithoutExt}-natives-`)
    );
  }

  /**
   * Resolves all applicable libraries and natives from version package metadata
   */
  public resolveLibraries(pkg: MinecraftVersionPackage, features: Record<string, boolean> = {}): ResolvedLibrary[] {
    const librariesDir = this.pathManager.getLibrariesPath();
    const resolved: ResolvedLibrary[] = [];
    const osName = this.getPlatformOsName();
    const currentArch = this.getPlatformArch();

    for (const lib of pkg.libraries) {
      if (!this.evaluateRules(lib.rules, features)) {
        continue;
      }

      // 1. Standard artifact
      if (lib.downloads?.artifact) {
        if (this.shouldSkipPlainNativeArtifact(lib)) {
          // Skip the bogus classifier-only native jar and let the OS-specific native below handle it.
        } else {
          const artifact = lib.downloads.artifact;
          if (!isSafeRelativeArtifactPath(artifact.path) || !isVerifiableArtifact(artifact.sha1, artifact.size)) {
            throw new Error(`Minecraft library '${lib.name}' has unsafe or unverifiable artifact metadata.`);
          }
          const localPath = path.join(librariesDir, artifact.path);
          const isNative = artifact.path.includes('natives') || lib.name.includes('natives');

          resolved.push({
            name: lib.name,
            path: localPath,
            url: artifact.url || '',
            sha1: artifact.sha1,
            size: artifact.size,
            isNative
          });
        }
      } else if (lib.url && lib.name) {
        // Maven fallback
        const relPath = this.mavenToPath(lib.name);
        if (!isVerifiableArtifact(lib.sha1, lib.size)) {
          throw new Error(`Minecraft library '${lib.name}' has no valid checksum or size.`);
        }
        const urlBase = lib.url.endsWith('/') ? lib.url : `${lib.url}/`;
        resolved.push({
          name: lib.name,
          path: path.join(librariesDir, relPath),
          url: `${urlBase}${relPath.replace(/\\/g, '/')}`,
          sha1: lib.sha1,
          size: lib.size,
          isNative: lib.name.includes('natives')
        });
      }

      // 2. Platform Classifiers / Natives (including SDL3 in Minecraft 26.3)
      if (lib.natives && lib.downloads?.classifiers) {
        const nativePattern = lib.natives[osName];
        if (nativePattern) {
          const classifierKey = nativePattern.replace('${arch}', currentArch === 'x64' ? '64' : (currentArch === 'x86' ? '32' : currentArch));
          const nativeArtifact = lib.downloads.classifiers[classifierKey] || lib.downloads.classifiers[nativePattern];

          if (nativeArtifact) {
            if (!isSafeRelativeArtifactPath(nativeArtifact.path) || !isVerifiableArtifact(nativeArtifact.sha1, nativeArtifact.size)) {
              throw new Error(`Minecraft native library '${lib.name}' has unsafe or unverifiable artifact metadata.`);
            }
            const localPath = path.join(librariesDir, nativeArtifact.path);
            resolved.push({
              name: `${lib.name}:${classifierKey}`,
              path: localPath,
              url: nativeArtifact.url || '',
              sha1: nativeArtifact.sha1,
              size: nativeArtifact.size,
              isNative: true
            });
          }
        }
      }
    }

    return resolved;
  }
}

function isVerifiableArtifact(sha1: string | undefined, size: number | undefined): boolean {
  return /^[a-f0-9]{40}$/i.test(String(sha1 || ''))
    && Number.isSafeInteger(size) && Number(size) > 0 && Number(size) <= 512 * 1024 * 1024;
}

function isSafeRelativeArtifactPath(value: string): boolean {
  return typeof value === 'string' && value.length > 0
    && !path.isAbsolute(value) && !/^[a-z]:/i.test(value)
    && !value.startsWith('\\')
    && !value.replace(/\\/g, '/').split('/').includes('..');
}
