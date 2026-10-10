/**
 * DewClient - Metadata-Driven Java Runtime Manager
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import type { JavaInstallation, JavaValidationResult, JavaCompatibilityResult } from '../../shared/types/runtime.ts';
import type { MinecraftVersionPackage } from '../../shared/types/minecraft.ts';
import { getPathManager } from '../storage/paths.ts';
import { getLogger } from '../core/logger.ts';

export function getRequiredJavaMajor(versionId: string, metadataMajor?: number): number {
  if (Number.isFinite(metadataMajor) && metadataMajor) return metadataMajor;
  const [major, minor, patch = 0] = versionId.split('.').map((part) => Number.parseInt(part, 10));
  if (major === 26) return 25;
  if (major !== 1) return 21;
  if (minor <= 8) return 8;
  if (minor === 17) return 16;
  if (minor === 18 || minor === 19) return 17;
  if (minor === 20) return patch <= 4 ? 17 : 21;
  return 21;
}

export function getRequiredJavaForPackage(versionId: string, pkg: MinecraftVersionPackage): number {
  return getRequiredJavaMajor(versionId, pkg.javaVersion?.majorVersion);
}

export class RuntimeService {
  private pathManager = getPathManager();
  private pendingProvisioning = new Map<number, Promise<string>>();

  private getManagedRuntimeConfig(majorVersion: number): { primary: string; fallback?: string; name: string } {
    const operatingSystem = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const architecture = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'aarch64' : process.arch === 'ia32' ? 'x86' : null;
    if (!architecture) throw new Error(`Managed Java provisioning is not supported for architecture '${process.arch}'.`);
    const query = new URLSearchParams({ architecture, image_type: 'jdk', jvm_impl: 'hotspot', os: operatingSystem, vendor: 'eclipse' });
    const primary = `https://api.adoptium.net/v3/assets/latest/${majorVersion}/hotspot?${query}`;
    const fallbackQuery = new URLSearchParams({ architecture, image_type: 'jdk', jvm_impl: 'hotspot', os: operatingSystem, vendor: 'eclipse' });
    return {
      primary,
      fallback: majorVersion === 25 ? `https://api.adoptium.net/v3/assets/latest/${majorVersion}/ea/hotspot?${fallbackQuery}` : undefined,
      name: `Eclipse Temurin OpenJDK ${majorVersion}`
    };
  }

  private async resolveManagedRuntimePackage(metadataUrl: string): Promise<{ link: string; checksum: string; size: number } | null> {
    const url = new URL(metadataUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'api.adoptium.net') throw new Error('Adoptium metadata URL is not trusted.');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) throw new Error('Adoptium metadata response exceeds the size limit.');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw new Error('Adoptium metadata response exceeds the size limit.');
    const entries = JSON.parse(text);
    const pkg = Array.isArray(entries) ? entries[0]?.binary?.package : null;
    if (!pkg || typeof pkg.link !== 'string' || !/^[a-f0-9]{64}$/i.test(String(pkg.checksum || ''))
      || !Number.isSafeInteger(pkg.size) || pkg.size <= 0 || pkg.size > 1024 * 1024 * 1024) {
      throw new Error('Adoptium did not provide verifiable runtime package metadata.');
    }
    return { link: pkg.link, checksum: pkg.checksum.toLowerCase(), size: pkg.size };
  }

  private async downloadManagedRuntimePackage(pkg: { link: string; checksum: string; size: number }, onProgress?: (progressPercent: number, message: string) => void): Promise<string> {
    const allowedHosts = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
    let currentUrl = new URL(pkg.link);
    if (currentUrl.protocol !== 'https:' || currentUrl.hostname !== 'github.com') throw new Error('Adoptium runtime package URL is not trusted.');

    const runtimesDir = this.pathManager.getRuntimesPath();
    fs.mkdirSync(runtimesDir, { recursive: true });
    const archivePath = path.join(runtimesDir, `.java-runtime-${crypto.randomUUID()}.zip`);

    try {
      for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
        const response = await fetch(currentUrl, { redirect: 'manual', signal: AbortSignal.timeout(30 * 60 * 1000) });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirectCount === 5) throw new Error('Adoptium runtime download exceeded the redirect limit.');
          const location = response.headers.get('location');
          if (!location) throw new Error('Adoptium runtime redirect omitted its target.');
          currentUrl = new URL(location, currentUrl);
          if (currentUrl.protocol !== 'https:' || !allowedHosts.has(currentUrl.hostname)) throw new Error('Adoptium runtime redirected to an untrusted host.');
          continue;
        }
        if (!response.ok) throw new Error(`Failed to download managed Java runtime (${response.status}).`);
        if (!response.body) throw new Error('Adoptium runtime response did not include a download stream.');
        const declaredSize = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredSize) && declaredSize > 0 && declaredSize !== pkg.size) throw new Error('Adoptium runtime size does not match its metadata.');

        const hash = crypto.createHash('sha256');
        let downloaded = 0;
        const verifyAndMeasure = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            downloaded += chunk.length;
            if (downloaded > pkg.size || downloaded > 1024 * 1024 * 1024) {
              callback(new Error('Adoptium runtime exceeded its verified size limit.'));
              return;
            }
            hash.update(chunk);
            const downloadProgress = 10 + Math.floor((downloaded / pkg.size) * 45);
            onProgress?.(Math.min(55, downloadProgress), `Downloading ${Math.floor(downloaded / 1024 / 1024)} MiB of ${Math.ceil(pkg.size / 1024 / 1024)} MiB...`);
            callback(null, chunk);
          }
        });

        await pipeline(
          Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
          verifyAndMeasure,
          fs.createWriteStream(archivePath, { flags: 'wx' })
        );
        if (downloaded !== pkg.size || hash.digest('hex') !== pkg.checksum) {
          throw new Error('Adoptium runtime size or SHA-256 verification failed.');
        }
        return archivePath;
      }
      throw new Error('Adoptium runtime download failed.');
    } catch (error) {
      fs.rmSync(archivePath, { force: true });
      throw error;
    }
  }

  /**
   * Parse `java -version` output to extract vendor and major version
   */
  public parseJavaVersionOutput(output: string): { majorVersion: number; versionString: string; is64Bit: boolean } | null {
    if (!output) return null;

    const is64Bit = output.includes('64-Bit') || output.includes('x86_64') || output.includes('amd64');

    // 1. Check for legacy 1.x pattern (e.g. "1.8.0_381")
    const legacyMatch = output.match(/version "1\.([0-9]+)/i);
    if (legacyMatch) {
      const major = parseInt(legacyMatch[1], 10);
      return { majorVersion: major, versionString: `1.${major}`, is64Bit };
    }

    // 2. Check for modern Java (e.g. "21.0.2", "25", "25-ea")
    const modernMatch = output.match(/version "([0-9]+)/i);
    if (modernMatch) {
      const major = parseInt(modernMatch[1], 10);
      return { majorVersion: major, versionString: String(major), is64Bit };
    }

    return null;
  }

  /**
   * Validates a Java executable path by executing `java -version`
   */
  public async validateJavaPath(javaPath: string): Promise<JavaValidationResult> {
    if (!javaPath || !fs.existsSync(javaPath)) {
      return { valid: false, error: 'Java executable does not exist at specified path.' };
    }

    return new Promise((resolve) => {
      try {
        const proc = spawn(javaPath, ['-version']);
        let output = '';

        proc.stdout.on('data', (d) => {
          output += d.toString();
        });
        proc.stderr.on('data', (d) => {
          output += d.toString();
        });

        proc.on('error', (err) => {
          resolve({ valid: false, error: err.message });
        });

        proc.on('close', (code) => {
          if (code !== 0 && !output) {
            resolve({ valid: false, error: `Java process exited with code ${code}.` });
            return;
          }

          const parsed = this.parseJavaVersionOutput(output);
          if (!parsed) {
            resolve({ valid: false, error: 'Failed to parse Java version from output.' });
            return;
          }

          const details: JavaInstallation = {
            path: javaPath,
            versionString: parsed.versionString,
            majorVersion: parsed.majorVersion,
            is64Bit: parsed.is64Bit,
            vendor: output.includes('Adoptium') || output.includes('Temurin') ? 'Eclipse Adoptium' : (output.includes('Oracle') ? 'Oracle' : 'OpenJDK'),
            isCompatibleWithLatest: parsed.majorVersion >= 21
          };

          resolve({ valid: true, majorVersion: parsed.majorVersion, details });
        });
      } catch (err: any) {
        resolve({ valid: false, error: err.message });
      }
    });
  }

  /**
   * Auto-detect all Java installations on the local system
   */
  public async detectInstalledRuntimes(): Promise<JavaInstallation[]> {
    const candidates: string[] = [];

    // 1. Managed runtimes in .dewclient/runtimes/
    const runtimesDir = this.pathManager.getRuntimesPath();
    if (fs.existsSync(runtimesDir)) {
      const entries = fs.readdirSync(runtimesDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const candidateWin = path.join(runtimesDir, ent.name, 'bin', 'java.exe');
          const candidateUnix = path.join(runtimesDir, ent.name, 'bin', 'java');
          if (fs.existsSync(candidateWin)) candidates.push(candidateWin);
          else if (fs.existsSync(candidateUnix)) candidates.push(candidateUnix);
        }
      }
    }

    // 2. JAVA_HOME environment variable
    if (process.env.JAVA_HOME) {
      const jHome = process.env.JAVA_HOME;
      const binWin = path.join(jHome, 'bin', 'java.exe');
      const binUnix = path.join(jHome, 'bin', 'java');
      if (fs.existsSync(binWin)) candidates.push(binWin);
      else if (fs.existsSync(binUnix)) candidates.push(binUnix);
    }

    // 3. System common directories (Windows)
    if (process.platform === 'win32') {
      const programFiles = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']];
      const vendors = ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'BellSoft'];

      for (const pf of programFiles) {
        if (!pf) continue;
        for (const vendor of vendors) {
          const vendorDir = path.join(pf, vendor);
          if (fs.existsSync(vendorDir)) {
            try {
              const jdks = fs.readdirSync(vendorDir);
              for (const jdk of jdks) {
                const exe = path.join(vendorDir, jdk, 'bin', 'java.exe');
                if (fs.existsSync(exe)) candidates.push(exe);
              }
            } catch {
              // Ignore access errors
            }
          }
        }
      }
    }

    // 4. Test each candidate
    const results: JavaInstallation[] = [];
    const seenPaths = new Set<string>();

    for (const cand of candidates) {
      const normalized = path.normalize(cand).toLowerCase();
      if (seenPaths.has(normalized)) continue;
      seenPaths.add(normalized);

      const check = await this.validateJavaPath(cand);
      if (check.valid && check.details) {
        results.push(check.details);
      }
    }

    // Sort descending by major version
    results.sort((a, b) => b.majorVersion - a.majorVersion);
    return results;
  }

  /**
   * Resolves a compatible Java runtime for the version requirement declared in metadata.
   */
  public async resolveRuntimeForRequirement(requiredMajor: number, preferredPath?: string, onProgress?: (progressPercent: number, phase: string) => void): Promise<string> {
    const logger = getLogger();
    logger.info('runtime', `Resolving compatible Java runtime for requirement: Java ${requiredMajor}`);

    // If user specified an explicit path, validate it first
    if (preferredPath && fs.existsSync(preferredPath)) {
      const val = await this.validateJavaPath(preferredPath);
      if (val.valid && val.majorVersion !== undefined) {
        if (requiredMajor === 8 ? val.majorVersion === 8 : val.majorVersion >= requiredMajor) {
          logger.info('runtime', `User-preferred Java runtime ${preferredPath} matches requirement (Java ${val.majorVersion} >= ${requiredMajor})`);
          onProgress?.(100, `Java ${requiredMajor} ready.`);
          return preferredPath;
        }
        logger.warn('runtime', `User-preferred Java ${val.majorVersion} does not satisfy required Java ${requiredMajor}`);
      }
    }

    // Detect installed runtimes
    const installed = await this.detectInstalledRuntimes();

    // Look for exact match first
    const exact = installed.find((r) => r.majorVersion === requiredMajor);
    if (exact) {
      logger.info('runtime', `Found exact installed Java runtime: Java ${exact.majorVersion} at ${exact.path}`);
      onProgress?.(100, `Java ${requiredMajor} ready.`);
      return exact.path;
    }

    // Modern Minecraft can run on newer Java (e.g. Java 25 runtime can run Java 21/17 games)
    const compatible = requiredMajor === 8
      ? undefined
      : installed.find((r) => r.majorVersion >= requiredMajor && r.is64Bit);
    if (compatible) {
      logger.info('runtime', `Found compatible installed Java runtime: Java ${compatible.majorVersion} at ${compatible.path}`);
      onProgress?.(100, `Java ${requiredMajor} ready.`);
      return compatible.path;
    }

    // If not found, download and install managed Adoptium runtime
    logger.info('runtime', `No installed runtime satisfies Java ${requiredMajor}. Provisioning managed Adoptium runtime...`);
    return this.provisionManagedRuntime(requiredMajor, onProgress);
  }

  /**
   * Download and extract Adoptium OpenJDK runtime into .dewclient/runtimes/
   */
  public provisionManagedRuntime(
    majorVersion: number,
    onProgress?: (progressPercent: number, message: string) => void
  ): Promise<string> {
    const existing = this.pendingProvisioning.get(majorVersion);
    if (existing) return existing;

    const task = this.provisionManagedRuntimeInternal(majorVersion, onProgress);
    this.pendingProvisioning.set(majorVersion, task);
    task.finally(() => this.pendingProvisioning.delete(majorVersion)).catch(() => {});
    return task;
  }

  private async provisionManagedRuntimeInternal(
    majorVersion: number,
    onProgress?: (progressPercent: number, message: string) => void
  ): Promise<string> {
    const logger = getLogger();
    const config = this.getManagedRuntimeConfig(majorVersion);

    const runtimesDir = this.pathManager.getRuntimesPath();
    const targetDir = path.join(runtimesDir, `java-${majorVersion}`);
    const javaExe = process.platform === 'win32'
      ? path.join(targetDir, 'bin', 'java.exe')
      : path.join(targetDir, 'bin', 'java');

    if (fs.existsSync(javaExe)) {
      const validation = await this.validateJavaPath(javaExe);
      if (validation.valid && validation.majorVersion === majorVersion) return javaExe;
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    onProgress?.(10, `Downloading ${config.name}...`);
    logger.info('runtime', `Downloading managed ${config.name} from ${config.primary}...`);

    let packageMetadata = await this.resolveManagedRuntimePackage(config.primary);
    if (!packageMetadata && config.fallback) {
      logger.warn('runtime', `Primary Adoptium runtime metadata was unavailable, trying the fallback channel.`);
      packageMetadata = await this.resolveManagedRuntimePackage(config.fallback);
    }
    if (!packageMetadata) throw new Error(`Adoptium has no managed Java ${majorVersion} runtime for this platform.`);
    const archivePath = await this.downloadManagedRuntimePackage(packageMetadata, onProgress);

    onProgress?.(60, `Extracting ${config.name}...`);
    logger.info('runtime', `Extracting Java ${majorVersion} runtime to ${targetDir}...`);

    const tempExtractDir = path.join(runtimesDir, `temp-${majorVersion}-${Date.now()}`);
    fs.mkdirSync(tempExtractDir, { recursive: true });

    try {
      const zip = new AdmZip(archivePath);
      this.extractZipSafely(zip, tempExtractDir);

      // Locate the root directory inside the extracted zip
      const extractedEntries = fs.readdirSync(tempExtractDir);
      const rootFolder = extractedEntries.length === 1 && fs.statSync(path.join(tempExtractDir, extractedEntries[0])).isDirectory()
        ? path.join(tempExtractDir, extractedEntries[0])
        : tempExtractDir;

      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      fs.renameSync(rootFolder, targetDir);

      // Clean up temporary extraction wrapper if different
      if (rootFolder !== tempExtractDir && fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
    } finally {
      if (fs.existsSync(tempExtractDir)) {
        try {
          fs.rmSync(tempExtractDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
      fs.rmSync(archivePath, { force: true });
    }

    // Set executable permission on Unix
    if (process.platform !== 'win32' && fs.existsSync(javaExe)) {
      fs.chmodSync(javaExe, 0o755);
    }

    const validation = await this.validateJavaPath(javaExe);
    if (!validation.valid || validation.majorVersion !== majorVersion) {
      throw new Error(`Managed Java ${majorVersion} failed runtime verification.`);
    }

    onProgress?.(100, `Java ${majorVersion} installed.`);
    logger.info('runtime', `Managed Java ${majorVersion} installed at ${javaExe}`);
    return javaExe;
  }

  /**
   * Safely extracts a ZIP archive into a destination directory with comprehensive
   * path traversal (Zip Slip), sibling-prefix, UNC/drive-letter, and symlink/junction protection.
   */
  public extractZipSafely(zip: AdmZip, destinationDir: string): void {
    const resolvedDest = path.resolve(destinationDir);
    const destWithSep = resolvedDest.endsWith(path.sep) ? resolvedDest : resolvedDest + path.sep;

    if (!fs.existsSync(resolvedDest)) {
      fs.mkdirSync(resolvedDest, { recursive: true });
    }

    const realDest = fs.realpathSync(resolvedDest);
    const realDestWithSep = realDest.endsWith(path.sep) ? realDest : realDest + path.sep;

    // Helper: Step-by-step canonical directory creation preventing junction traversal
    const safeEnsureDir = (dirPath: string): void => {
      const rel = path.relative(resolvedDest, dirPath);
      if (!rel || rel === '.') return;
      const parts = rel.split(path.sep).filter(Boolean);
      let current = resolvedDest;

      for (const part of parts) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current, { throwIfNoEntry: false });
        if (stat) {
          if (stat.isSymbolicLink()) {
            throw new Error(`Encountered forbidden symbolic link / directory junction: ${part}`);
          }
          if (!stat.isDirectory()) {
            throw new Error(`Path component is not a directory: ${part}`);
          }
          const realCurrent = fs.realpathSync(current);
          if (realCurrent !== realDest && !realCurrent.startsWith(realDestWithSep)) {
            throw new Error(`Directory junction escape detected for component: ${part}`);
          }
        } else {
          fs.mkdirSync(current);
          const realCurrent = fs.realpathSync(current);
          if (realCurrent !== realDest && !realCurrent.startsWith(realDestWithSep)) {
            throw new Error(`Directory junction escape detected after creating component: ${part}`);
          }
        }
      }
    };

    // Resource & Decompression Limits (Defense against CVE-2026-77301, uncontrolled memory allocation & Zip Bombs)
    const MAX_ENTRIES = 10_000;
    const MAX_ENTRY_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500 MB per entry (largest genuine JDK module is ~140MB)
    const MAX_TOTAL_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB aggregate (genuine JDK runtimes are ~400MB)
    const MAX_COMPRESSION_RATIO = 100; // 100:1 max ratio for files > 1MB

    const entries = zip.getEntries();
    if (entries.length > MAX_ENTRIES) {
      throw new Error(`Archive exceeds maximum permitted entry count: ${entries.length} > ${MAX_ENTRIES}`);
    }

    let totalUncompressedBytes = 0;

    for (const entry of entries) {
      const rawName = entry.entryName;
      if (!rawName || typeof rawName !== 'string') continue;

      // 1. Check for null bytes or illegal characters
      if (rawName.includes('\0')) {
        throw new Error(`Suspicious archive entry containing null byte: ${JSON.stringify(rawName)}`);
      }

      // 2. Reject leading drive letters, UNC paths, and absolute roots
      if (/^[a-zA-Z]:/.test(rawName) || rawName.startsWith('\\\\') || rawName.startsWith('/') || rawName.startsWith('\\')) {
        throw new Error(`Archive entry contains an illegal absolute or drive path: ${rawName}`);
      }

      // 3. Reject symbolic links, special files & reparse points:
      // - Unix mode bits: reject if not regular file (0100000) and not directory (0040000), e.g. symlink (0120000), FIFO, device, socket
      // - Windows reparse point attribute 0x0400 (FILE_ATTRIBUTE_REPARSE_POINT)
      const unixType = entry.attr ? (entry.attr >>> 16) & 0o170000 : 0;
      const isUnixSymlinkOrSpecial = unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000;
      const isWinReparse = Boolean(entry.attr && (entry.attr & 0x0400) === 0x0400);
      if (isUnixSymlinkOrSpecial || isWinReparse) {
        throw new Error(`Archive entry is a forbidden symbolic link, reparse point, or special file: ${rawName}`);
      }

      // 4. Validate entry size limits & compression ratio before decompression
      const declaredSize = entry.header ? Number(entry.header.size) : 0;
      const compressedSize = entry.header ? Number(entry.header.compressedSize) : 0;

      if (declaredSize < 0 || declaredSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
        throw new Error(`Archive entry exceeds maximum permitted uncompressed size (${declaredSize} bytes): ${rawName}`);
      }

      totalUncompressedBytes += declaredSize;
      if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error(`Archive exceeds total permitted uncompressed size limit (${totalUncompressedBytes} bytes)`);
      }

      // Check compression ratio for entries larger than 1MB to prevent zip bombs
      if (declaredSize > 1024 * 1024 && compressedSize > 0) {
        const ratio = declaredSize / compressedSize;
        if (ratio > MAX_COMPRESSION_RATIO) {
          throw new Error(`Archive entry exhibits suspicious compression ratio (${ratio.toFixed(1)}:1): ${rawName}`);
        }
      }

      // 5. Resolve target destination path
      const targetPath = path.resolve(resolvedDest, rawName);

      // 6. Validate containment against resolved destination
      const rel = path.relative(resolvedDest, targetPath);
      const isContained =
        (targetPath === resolvedDest || targetPath.startsWith(destWithSep)) &&
        !rel.startsWith('..') &&
        !path.isAbsolute(rel);

      if (!isContained) {
        throw new Error(`Zip Slip path traversal attempt detected in archive entry: ${rawName}`);
      }

      // 7. Handle directory vs file
      if (entry.isDirectory) {
        safeEnsureDir(targetPath);
      } else {
        const parentDir = path.dirname(targetPath);
        safeEnsureDir(parentDir);

        // Pre-write target check: detect if targetPath already exists as a symlink/reparse point
        const existingStat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
        if (existingStat) {
          if (existingStat.isSymbolicLink()) {
            throw new Error(`Target path already exists as a forbidden symbolic link or reparse point: ${rawName}`);
          }
          if (existingStat.isDirectory()) {
            throw new Error(`Cannot write file: target path already exists as a directory: ${rawName}`);
          }
          // Remove existing regular file prior to atomic creation
          fs.unlinkSync(targetPath);
        }

        // Atomic write with O_CREAT | O_EXCL (CREATE_NEW on Windows)
        fs.writeFileSync(targetPath, entry.getData(), { flag: 'wx' });

        // Post-write validation
        const postStat = fs.lstatSync(targetPath);
        if (postStat.isSymbolicLink()) {
          throw new Error(`Target path post-write symbolic link detected: ${rawName}`);
        }
        const postReal = fs.realpathSync(targetPath);
        if (!postReal.startsWith(realDestWithSep)) {
          throw new Error(`Target path post-write escape detected: ${rawName}`);
        }
      }
    }
  }
}
