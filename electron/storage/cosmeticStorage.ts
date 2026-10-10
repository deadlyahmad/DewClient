import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPathManager } from './paths.ts';

export const MAX_COSMETIC_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export type CosmeticKind = 'skin' | 'cape' | 'elytra';

export interface StoredCosmetic {
  path: string;
  previewUrl: string;
}

export interface CosmeticImageInfo {
  contentType: string;
  width: number;
  height: number;
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) break;
    offset += 2 + segmentLength;
  }
  return { width: 0, height: 0 };
}

function inspectImage(buffer: Buffer): CosmeticImageInfo | null {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { contentType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { contentType: 'image/jpeg', ...readJpegDimensions(buffer) };
  }
  if (buffer.length >= 25 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunkType = buffer.toString('ascii', 12, 16);
    if (chunkType === 'VP8X' && buffer.length >= 30) {
      return {
        contentType: 'image/webp',
        width: 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16),
        height: 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16)
      };
    }
    if (chunkType === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return { contentType: 'image/webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunkType === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer[21] | (buffer[22] << 8) | (buffer[23] << 16) | (buffer[24] << 24);
      return { contentType: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
  }
  return null;
}

export function validateCosmeticImage(kind: CosmeticKind, buffer: Buffer, expectedContentType: string): CosmeticImageInfo {
  const image = inspectImage(buffer);
  const supportedWidths = [64, 128, 256, 512, 1024, 2048];
  if (!image || image.contentType !== expectedContentType || !supportedWidths.includes(image.width)
    || image.height < 32 || image.height > 1024) {
    throw new Error('Cosmetic file data does not match a supported image format.');
  }
  if (kind === 'skin' && !(
    (supportedWidths.includes(image.width) && image.height === image.width)
    || (supportedWidths.includes(image.width) && image.height === image.width / 2)
  )) {
    throw new Error('Minecraft skins must be 64x32 minimum to 2048x1024 maximum and use a square or 2:1 UV layout.');
  }
  if (kind === 'cape' && !(supportedWidths.includes(image.width) && image.height === image.width / 2)) {
    throw new Error('Cape textures must be 64x32 minimum to 2048x1024 maximum in a 2:1 UV layout.');
  }
  if (kind === 'elytra' && (image.width !== image.height * 2 || !supportedWidths.includes(image.width))) {
    throw new Error('Wing textures must be 64x32 minimum to 2048x1024 maximum in a 2:1 UV layout.');
  }
  return image;
}

function contentTypeFor(extension: string): string {
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'image/webp';
}

function extensionFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error('Cosmetics must be PNG, JPG, JPEG, or WebP files.');
  }
  return extension;
}

function validateAccountId(accountId: string): void {
  if (!/^[A-Za-z0-9_.-]{1,96}$/.test(accountId)) {
    throw new Error('Invalid account ID.');
  }
}

export class CosmeticStorageService {
  private readonly rootPath = path.join(getPathManager().getRootPath(), 'cosmetics');

  public save(accountId: string, kind: CosmeticKind, sourcePath: string): StoredCosmetic {
    validateAccountId(accountId);
    if (kind !== 'skin' && kind !== 'cape' && kind !== 'elytra') throw new Error('Unsupported cosmetic type.');
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error('Selected cosmetic file does not exist.');
    }
    return this.saveBuffer(accountId, kind, fs.readFileSync(sourcePath), extensionFor(sourcePath));
  }

  public saveBuffer(accountId: string, kind: CosmeticKind, buffer: Buffer, extension: string): StoredCosmetic {
    return this.saveBufferNamed(accountId, kind, kind, buffer, extension);
  }

  public saveSkinSlot(accountId: string, slot: number, sourcePath: string): StoredCosmetic {
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) throw new Error('Choose one of the four skin slots.');
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error('Selected cosmetic file does not exist.');
    }
    return this.saveBufferNamed(accountId, 'skin', `skin-slot-${slot + 1}`, fs.readFileSync(sourcePath), extensionFor(sourcePath));
  }

  public saveSkinSlotBuffer(accountId: string, slot: number, buffer: Buffer, extension: string): StoredCosmetic {
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) throw new Error('Choose one of the four skin slots.');
    return this.saveBufferNamed(accountId, 'skin', `skin-slot-${slot + 1}`, buffer, extension);
  }

  public saveOfficialCape(accountId: string, capeId: string, buffer: Buffer, extension: string): StoredCosmetic {
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(capeId)) throw new Error('Minecraft returned an invalid cape ID.');
    const capeKey = crypto.createHash('sha256').update(capeId).digest('hex').slice(0, 16);
    return this.saveBufferNamed(accountId, 'cape', `cape-official-${capeKey}`, buffer, extension);
  }

  public getPreviewDataUrl(accountId: string, assetPath: string, kind: CosmeticKind): string {
    validateAccountId(accountId);
    if (kind !== 'skin' && kind !== 'cape' && kind !== 'elytra') throw new Error('Unsupported cosmetic type.');
    const accountPath = path.resolve(this.rootPath, accountId);
    const resolvedPath = path.resolve(assetPath);
    const fileName = path.basename(resolvedPath);
    const filePattern = kind === 'skin'
      ? /^skin(?:-slot-[1-4])?\.(?:png|jpe?g|webp)$/i
      : kind === 'cape'
        ? /^cape(?:-official-[a-f0-9]{16})?\.(?:png|jpe?g|webp)$/i
        : /^elytra\.(?:png|jpe?g|webp)$/i;
    if (path.dirname(resolvedPath) !== accountPath || !filePattern.test(fileName) || !fs.existsSync(resolvedPath) || fs.lstatSync(resolvedPath).isSymbolicLink()) {
      throw new Error('Invalid local cosmetic preview path.');
    }
    const extension = path.extname(resolvedPath).toLowerCase();
    const bytes = fs.readFileSync(resolvedPath);
    const image = validateCosmeticImage(kind, bytes, contentTypeFor(extension));
    return `data:${image.contentType};base64,${bytes.toString('base64')}`;
  }

  private saveBufferNamed(accountId: string, kind: CosmeticKind, fileStem: string, buffer: Buffer, extension: string): StoredCosmetic {
    validateAccountId(accountId);
    if (kind !== 'skin' && kind !== 'cape' && kind !== 'elytra') throw new Error('Unsupported cosmetic type.');
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(fileStem)) throw new Error('Invalid cosmetic filename.');
    const normalizedExtension = extension.toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(normalizedExtension)) {
      throw new Error('Cosmetics must be PNG, JPG, JPEG, or WebP files.');
    }
    if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > MAX_COSMETIC_BYTES) {
    throw new Error('Cosmetic images must be 50 MiB or smaller.');
    }
    validateCosmeticImage(kind, buffer, contentTypeFor(normalizedExtension));

    const accountPath = path.resolve(this.rootPath, accountId);
    fs.mkdirSync(accountPath, { recursive: true });
    const destination = path.resolve(accountPath, `${fileStem}${normalizedExtension}`);
    if (!destination.startsWith(`${accountPath}${path.sep}`)) throw new Error('Invalid cosmetic destination.');
    fs.writeFileSync(destination, buffer);

    return { path: destination, previewUrl: pathToFileURL(destination).href };
  }

  public remove(accountId: string, kind: CosmeticKind): void {
    validateAccountId(accountId);
    if (kind !== 'skin' && kind !== 'cape' && kind !== 'elytra') throw new Error('Unsupported cosmetic type.');
    const accountPath = path.resolve(this.rootPath, accountId);
    if (!accountPath.startsWith(`${path.resolve(this.rootPath)}${path.sep}`)) return;
    for (const extension of ALLOWED_EXTENSIONS) {
      fs.rmSync(path.join(accountPath, `${kind}${extension}`), { force: true });
      if (kind === 'skin') {
        for (let slot = 1; slot <= 4; slot++) fs.rmSync(path.join(accountPath, `skin-slot-${slot}${extension}`), { force: true });
      }
    }
  }

  public removeAccount(accountId: string): void {
    validateAccountId(accountId);
    const accountPath = path.resolve(this.rootPath, accountId);
    if (!accountPath.startsWith(`${path.resolve(this.rootPath)}${path.sep}`)) return;
    fs.rmSync(accountPath, { recursive: true, force: true });
  }
}

let service: CosmeticStorageService | null = null;

export function getCosmeticStorage(): CosmeticStorageService {
  const expectedRoot = getPathManager().getRootPath();
  if (!service || (service as any).rootPath !== path.join(expectedRoot, 'cosmetics')) {
    service = new CosmeticStorageService();
  }
  return service;
}
