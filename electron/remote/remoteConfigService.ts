/**
 * DewClient - Remote Configuration & Manifest Client Service
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RemoteManifestSnapshot, RemoteConnectionTestResult } from '../../shared/types/remote.ts';
import { getSettingsStorage } from '../storage/settingsStorage.ts';
import { getPathManager } from '../storage/paths.ts';
import { getLogger } from '../core/logger.ts';
import { OFFICIAL_DEWCLIENT_DISCORD_URL, OFFICIAL_DEWCLIENT_WEBSITE_URL, resolveRemoteServerBaseUrl } from '../../shared/constants/defaults.ts';

const MANIFEST_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MANIFEST_REQUEST_TIMEOUT_MS = 8_000;

function canonicalizeManifest(snapshot: RemoteManifestSnapshot): RemoteManifestSnapshot {
  const replaceLegacyWebsite = (value?: string) => {
    if (typeof value !== 'string' || !value) return value;
    try {
      const url = new URL(value);
      if (url.hostname === 'dewclient.site' || url.hostname === 'www.dewclient.site') {
        url.hostname = 'dewclient.fun';
        return url.toString();
      }
    } catch { /* Preserve invalid content; callers validate links before opening. */ }
    return value;
  };

  return {
    ...snapshot,
    announcements: (snapshot.announcements || []).map((item) => ({
      ...item,
      url: typeof item.url === 'string' && /^https?:\/\/discord\.gg\/dewclient\/?$/i.test(item.url)
        ? OFFICIAL_DEWCLIENT_DISCORD_URL
        : replaceLegacyWebsite(item.url)
    })),
    client: { ...snapshot.client, notesUrl: replaceLegacyWebsite(snapshot.client?.notesUrl) },
    links: {
      ...(snapshot.links || {}),
      website: OFFICIAL_DEWCLIENT_WEBSITE_URL,
      support: `${OFFICIAL_DEWCLIENT_WEBSITE_URL}/#support`,
      download: `${OFFICIAL_DEWCLIENT_WEBSITE_URL}/#download`,
      discord: OFFICIAL_DEWCLIENT_DISCORD_URL
    }
  };
}

export class RemoteConfigService {
  private pathManager = getPathManager();
  private cacheFilePath: string;
  private currentEtag = '';
  private cachedSnapshot: RemoteManifestSnapshot | null = null;
  private lastCheckedAt = 0;
  private pendingFetch: Promise<RemoteManifestSnapshot> | null = null;

  constructor() {
    this.cacheFilePath = path.join(this.pathManager.getCachePath(), 'remote_manifest.json');
    this.loadCached();
  }

  private loadCached(): void {
    if (fs.existsSync(this.cacheFilePath)) {
      try {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.cachedSnapshot = canonicalizeManifest(parsed.snapshot || parsed);
        this.currentEtag = parsed.etag || '';
        this.lastCheckedAt = Math.max(0, Number(parsed.checkedAt) || 0);
      } catch {
        // Ignore
      }
    }
  }

  private saveCache(snapshot: RemoteManifestSnapshot, etag: string, checkedAt = Date.now()): void {
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const canonicalSnapshot = canonicalizeManifest(snapshot);
      const tempPath = `${this.cacheFilePath}.tmp.${process.pid}`;
      fs.writeFileSync(tempPath, JSON.stringify({ etag, checkedAt, snapshot: canonicalSnapshot }, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.cacheFilePath);
      this.cachedSnapshot = canonicalSnapshot;
      this.currentEtag = etag;
      this.lastCheckedAt = checkedAt;
    } catch {
      // Best effort
    }
  }

  public async fetchManifest(forceRefresh = false): Promise<RemoteManifestSnapshot> {
    if (this.cachedSnapshot && !forceRefresh) {
      if (Date.now() - this.lastCheckedAt < MANIFEST_REFRESH_INTERVAL_MS) return this.cachedSnapshot;
      void this.startManifestFetch(false);
      return this.cachedSnapshot;
    }
    return this.startManifestFetch(forceRefresh);
  }

  private startManifestFetch(forceRefresh: boolean): Promise<RemoteManifestSnapshot> {
    if (this.pendingFetch) return this.pendingFetch;
    this.pendingFetch = this.fetchManifestFromNetwork(forceRefresh).finally(() => {
      this.pendingFetch = null;
    });
    return this.pendingFetch;
  }

  private async fetchManifestFromNetwork(forceRefresh: boolean): Promise<RemoteManifestSnapshot> {
    const logger = getLogger();
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const manifestUrl = `${baseUrl.replace(/\/+$/, '')}/manifest`;

    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };
    if (!forceRefresh && this.currentEtag) {
      headers['If-None-Match'] = this.currentEtag;
    }

    try {
      const res = await fetch(manifestUrl, { headers, redirect: 'error', signal: AbortSignal.timeout(MANIFEST_REQUEST_TIMEOUT_MS) });

      if (res.status === 304 && this.cachedSnapshot) {
        logger.debug('remote', 'Remote manifest 304 Not Modified; using cached snapshot.');
        this.saveCache(this.cachedSnapshot, res.headers.get('etag') || this.currentEtag);
        return this.cachedSnapshot;
      }

      if (res.ok) {
        const data = (await res.json()) as { data?: RemoteManifestSnapshot } & RemoteManifestSnapshot;
        const snapshot = canonicalizeManifest(data.data || data);
        const etag = res.headers.get('etag') || '';
        this.saveCache(snapshot, etag);
        return snapshot;
      }

      throw new Error(`Server returned status ${res.status}`);
    } catch (err: any) {
      logger.debug('remote', `Failed to fetch remote manifest, checking offline cache: ${err.message}`);
      if (this.cachedSnapshot) {
        this.lastCheckedAt = Date.now();
        return this.cachedSnapshot;
      }
      this.cachedSnapshot = this.getDefaultFallbackManifest();
      this.lastCheckedAt = Date.now();
      return this.cachedSnapshot;
    }
  }

  public async testConnection(customUrl?: string): Promise<RemoteConnectionTestResult> {
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(customUrl || settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const healthUrl = `${baseUrl.replace(/\/+$/, '')}/health`;

    const start = Date.now();
    try {
      const res = await fetch(healthUrl);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        return { ok: false, latencyMs, error: `HTTP ${res.status}: ${res.statusText}` };
      }

      const json = (await res.json()) as any;
      return {
        ok: true,
        latencyMs,
        service: json.service,
        version: json.version,
        status: json.status,
        environment: json.environment,
        time: json.time
      };
    } catch (err: any) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err.message
      };
    }
  }

  public async getOnlineProfiles(): Promise<any[]> {
    const settings = getSettingsStorage().getSettings();
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/players/online`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json() as { data?: any[] };
      return Array.isArray(data.data) ? data.data : [];
    } catch {
      return [];
    }
  }

  public getDefaultFallbackManifest(): RemoteManifestSnapshot {
    return canonicalizeManifest({
      serverTime: '',
      updatedAt: '',
      maintenance: { enabled: false, mode: 'soft', title: '', message: '' },
      news: [],
      announcements: [],
      featuredServers: [],
      client: { latestVersion: '', minimumVersion: '', updateUrl: '' },
      flags: {},
      links: {}
    });
  }
}

let remoteConfigService: RemoteConfigService | null = null;

export function getRemoteConfigService(): RemoteConfigService {
  if (!remoteConfigService) {
    remoteConfigService = new RemoteConfigService();
  }
  return remoteConfigService;
}
