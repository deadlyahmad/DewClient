import crypto from 'node:crypto';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { DewCosmeticsModSession, DewCosmeticsLaunchSnapshot } from '../../shared/types/cosmetics.ts';
import { DEW_COSMETICS_PROTOCOL_VERSION } from '../../shared/schemas/cosmetics.ts';
import { validateCosmeticImage, type CosmeticKind } from '../storage/cosmeticStorage.ts';
import type { ActiveCosmeticsResult } from './cosmeticsSyncService.ts';

const MAX_BRIDGE_ASSET_BYTES = 50 * 1024 * 1024;
const DATA_IMAGE_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

interface BridgeAsset {
  buffer: Buffer;
  contentType: string;
}

interface BridgeLaunchOptions {
  instanceId: string;
  minecraftVersion: string;
  modVersion: string;
  apiBaseUrl?: string | null;
  session: DewCosmeticsModSession | null;
  cosmetics: ActiveCosmeticsResult;
  microsoftCapes?: Array<{ name: string; dataUrl: string; active: boolean }>;
}

export interface DewCosmeticsBridgeConnection {
  url: string;
  token: string;
}

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

function isLoopback(address?: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address?.startsWith('::ffff:127.') === true;
}

export class DewCosmeticsBridgeService {
  private server: Server | null = null;
  private token = '';
  private baseUrl = '';
  private config: Record<string, unknown> | null = null;
  private readonly assets = new Map<string, BridgeAsset>();

  public async start(options: BridgeLaunchOptions): Promise<DewCosmeticsBridgeConnection> {
    if (this.server) throw new Error('DewCosmetics bridge is already running.');
    this.token = crypto.randomBytes(32).toString('base64url');
    const expectedTokenDigest = digest(this.token);
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response, expectedTokenDigest);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      await this.stop();
      throw new Error('DewCosmetics bridge did not bind to a local port.');
    }
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    this.update(options);
    return { url: this.baseUrl, token: this.token };
  }

  /** Refresh the launch snapshot while the game keeps its authenticated local bridge. */
  public update(options: BridgeLaunchOptions): void {
    if (!this.server?.listening || !this.baseUrl) throw new Error('DewCosmetics bridge is not running.');
    const equippedItems: DewCosmeticsLaunchSnapshot['equipped']['items'] = [];
    const definitions: Array<Record<string, unknown>> = [];
    const microsoftCapes: Array<Record<string, unknown>> = [];
    const nextAssets = new Map<string, BridgeAsset>();
    const previewFields: Array<{ field: keyof ActiveCosmeticsResult; type: CosmeticKind | 'wings' }> = [
      { field: 'skinPreviewUrl', type: 'skin' },
      { field: 'capePreviewUrl', type: 'cape' },
      { field: 'elytraPreviewUrl', type: 'wings' }
    ];

    for (const preview of previewFields) {
      const dataUrl = options.cosmetics[preview.field];
      if (typeof dataUrl !== 'string') continue;
      const match = DATA_IMAGE_PATTERN.exec(dataUrl);
      if (!match) continue;
      const contentType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length || buffer.length > MAX_BRIDGE_ASSET_BYTES) continue;
      const validationKind = preview.type === 'wings' ? 'elytra' : preview.type;
      try { validateCosmeticImage(validationKind, buffer, contentType); } catch { continue; }

      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const cosmeticId = `${preview.type}:${sha256}`;
      nextAssets.set(sha256, { buffer, contentType });
      equippedItems.push({ cosmeticId, assetVersion: 1, enabled: true });
      definitions.push({
        id: cosmeticId,
        type: preview.type,
        version: 1,
        assets: { texture: { sha256, mime: contentType, byteSize: buffer.length } }
      });
    }

    for (const cape of (options.microsoftCapes || []).slice(0, 24)) {
      const match = DATA_IMAGE_PATTERN.exec(cape.dataUrl);
      if (!match) continue;
      const contentType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length || buffer.length > MAX_BRIDGE_ASSET_BYTES) continue;
      try { validateCosmeticImage('cape', buffer, contentType); } catch { continue; }
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      nextAssets.set(sha256, { buffer, contentType });
      microsoftCapes.push({
        id: sha256,
        name: String(cape.name || 'Minecraft Cape').slice(0, 80),
        sha256,
        mime: contentType,
        active: cape.active === true
      });
    }

    for (const definition of definitions) {
      const texture = (definition.assets as Record<string, { sha256: string; url?: string }>).texture;
      if (texture) texture.url = `${this.baseUrl}/v1/mod/assets/${texture.sha256}`;
    }
    for (const cape of microsoftCapes) {
      cape.url = `${this.baseUrl}/v1/mod/assets/${cape.sha256}`;
    }
    const launchSnapshot: DewCosmeticsLaunchSnapshot = {
      instanceId: options.instanceId,
      minecraftVersion: options.minecraftVersion,
      modVersion: options.modVersion,
      protocolVersion: DEW_COSMETICS_PROTOCOL_VERSION,
      equipped: {
        revision: Math.max(0, Number(options.cosmetics.manifest?.version) || 0),
        items: equippedItems
      }
    };
    this.assets.clear();
    for (const [sha256, asset] of nextAssets) this.assets.set(sha256, asset);
    this.config = {
      ...launchSnapshot,
      apiBaseUrl: options.apiBaseUrl || null,
      session: options.session,
      definitions,
      microsoftCapes
    };
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.token = '';
    this.baseUrl = '';
    this.config = null;
    this.assets.clear();
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse, expectedTokenDigest: Buffer): Promise<void> {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname;
    if (!isLoopback(request.socket.remoteAddress)) return this.sendJson(response, 403, { ok: false, error: 'LOOPBACK_ONLY' });
    if (request.method === 'GET' && pathname === '/health') return this.sendJson(response, 200, { ok: true });

    const bearer = /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization || ''))?.[1] || '';
    if (!bearer || !crypto.timingSafeEqual(digest(bearer), expectedTokenDigest)) {
      return this.sendJson(response, 401, { ok: false, error: 'AUTH_REQUIRED' });
    }
    if (request.method !== 'GET') return this.sendJson(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    if (pathname === '/v1/mod/config') return this.sendJson(response, 200, { ok: true, data: this.config });
    if (pathname === '/v1/mod/equipped') {
      const snapshot = this.config?.equipped;
      return this.sendJson(response, 200, { ok: true, data: snapshot });
    }
    if (pathname === '/v1/mod/session') {
      const session = this.config?.session;
      return session
        ? this.sendJson(response, 200, { ok: true, data: session })
        : this.sendJson(response, 404, { ok: false, error: 'SESSION_UNAVAILABLE' });
    }

    const assetMatch = pathname.match(/^\/v1\/mod\/assets\/([a-f0-9]{64})$/i);
    if (assetMatch) {
      const asset = this.assets.get(assetMatch[1].toLowerCase());
      if (!asset) return this.sendJson(response, 404, { ok: false, error: 'NOT_FOUND' });
      response.writeHead(200, {
        'Content-Type': asset.contentType,
        'Content-Length': asset.buffer.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(asset.buffer);
      return;
    }
    return this.sendJson(response, 404, { ok: false, error: 'NOT_FOUND' });
  }

  private sendJson(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(JSON.stringify(payload));
  }
}
