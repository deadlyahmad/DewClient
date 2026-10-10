/**
 * DewClient - Signed Heartbeat Service
 * Transmits Ed25519 signed presence heartbeats with server-enforced timestamp freshness
 */

import crypto from 'node:crypto';
import { PRODUCT_VERSION } from '../../shared/constants/versions.ts';
import type { ClientHeartbeatResponseDto, ClientHeartbeatRequestBodyDto } from '../../shared/dtos/clientHeartbeat.dto.ts';
import { getClientIdentityService } from './clientIdentityService.ts';
import { getSettingsStorage } from '../storage/settingsStorage.ts';
import { getAccountStorage } from '../storage/accountStorage.ts';
import { getLogger } from '../core/logger.ts';
import { resolveRemoteServerBaseUrl } from '../../shared/constants/defaults.ts';

function canonicalizeJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastHeartbeatAt: string | null = null;
  private heartbeatIntervalSeconds = 30;
  private backendAvailable: boolean | null = null;
  private consecutiveFailures = 0;

  public getLastHeartbeatAt(): string | null {
    return this.lastHeartbeatAt;
  }

  public isBackendAvailable(): boolean | null {
    return this.backendAvailable;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Send immediate first heartbeat, then start interval
    this.sendHeartbeat(true).catch(() => {});
    this.timer = setInterval(() => {
      // When known offline, poll less aggressively (every 4th cycle = ~2 minutes)
      if (this.backendAvailable === false && this.consecutiveFailures % 4 !== 0) {
        this.consecutiveFailures++;
        return;
      }
      this.sendHeartbeat(false).catch(() => {});
    }, this.heartbeatIntervalSeconds * 1000);

    if (this.timer.unref) this.timer.unref();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async sendHeartbeat(_includeCosmetics = false, clearSharedData = false): Promise<boolean> {
    const logger = getLogger();
    const identityService = getClientIdentityService();
    const settings = getSettingsStorage().getSettings();

    if (!settings.remote?.enabled && !clearSharedData && !settings.remote?.revokeSharedDataPending) {
      return false;
    }

    const primaryUrl = resolveRemoteServerBaseUrl(settings.remote.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const candidateUrls = [primaryUrl];

    const bodyObj: ClientHeartbeatRequestBodyDto = { clientVersion: PRODUCT_VERSION };
    if (clearSharedData || settings.remote?.revokeSharedDataPending === true) {
      bodyObj.accounts = [];
    } else {
      bodyObj.accounts = getAccountStorage().getAccounts().slice(0, 100).map((account) => ({
        username: account.username,
        uuid: account.minecraftUuid || account.uuid,
        type: account.type,
        lastUsedAt: account.lastUsedAt
      }));
    }

    if (clearSharedData || settings.remote?.revokeSharedDataPending === true) {
      bodyObj.activePlayer = null;
    } else {
      const activeAccount = getAccountStorage().getActiveAccount();
      const uuid = activeAccount?.minecraftUuid || activeAccount?.uuid || '';
      if (activeAccount?.type === 'microsoft' && activeAccount.hasActiveSession
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
        && /^[A-Za-z0-9_]{3,16}$/.test(activeAccount.username)) {
        bodyObj.activePlayer = { username: activeAccount.username, uuid };
      } else {
        bodyObj.activePlayer = null;
      }
    }
    const bodyStr = canonicalizeJson(bodyObj);

    for (const baseUrl of candidateUrls) {
      try {
        let clientId = identityService.getClientId();
        if (!clientId) {
          clientId = await identityService.registerWithServer(baseUrl);
        }

        const heartbeatUrl = `${baseUrl.replace(/\/+$/, '')}/client/heartbeat`;
        const postHeartbeat = (registeredClientId: string) => {
          const timestamp = String(Date.now());
          const requestId = crypto.randomUUID();
          const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
          const signature = identityService.signPayload(`${registeredClientId}:${timestamp}:${requestId}:${bodyHash}`);
          return fetch(heartbeatUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-dewclient-id': registeredClientId,
              'x-dewclient-timestamp': timestamp,
              'x-dewclient-request-id': requestId,
              'x-dewclient-signature': signature,
              'x-dewclient-version': PRODUCT_VERSION
            },
            body: bodyStr,
            signal: AbortSignal.timeout(5000)
          });
        };

        let res = await postHeartbeat(clientId);
        if (!res.ok && (res.status === 404 || res.status === 401)) {
          const errorText = await res.text().catch(() => '');
          let errorCode = '';
          try { errorCode = JSON.parse(errorText)?.error?.code || ''; } catch {}
          if (res.status === 404 || errorCode === 'INVALID_SIGNATURE') {
            identityService.clearClientRegistration();
            clientId = await identityService.registerWithServer(baseUrl);
            res = await postHeartbeat(clientId);
          } else {
            logger.warn('remote', `Heartbeat rejected by ${baseUrl} (${res.status}): ${errorText}`);
            continue;
          }
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          logger.warn('remote', `Heartbeat rejected by ${baseUrl} (${res.status}): ${errText}`);
          continue;
        }

        const data = (await res.json()) as ClientHeartbeatResponseDto;
        if (settings.remote?.revokeSharedDataPending === true) {
          getSettingsStorage().updateSettings({ remote: { ...settings.remote, revokeSharedDataPending: false } });
        }
        this.lastHeartbeatAt = new Date().toISOString();

        if (data.data?.heartbeatIntervalSeconds) {
          this.heartbeatIntervalSeconds = data.data.heartbeatIntervalSeconds;
        }

        if (this.backendAvailable !== true) {
          this.backendAvailable = true;
          logger.info('remote', `[remote] Central management server connected via ${baseUrl}`);
        }
        this.consecutiveFailures = 0;
        return true;
      } catch (err: any) {
        if (this.backendAvailable !== false) {
          logger.debug('remote', `Heartbeat attempt to ${baseUrl} failed: ${err.message}`);
        }
      }
    }

    this.consecutiveFailures++;
    if (this.backendAvailable !== false) {
      this.backendAvailable = false;
      logger.info('remote', '[remote] Central management server is unavailable; operating in standalone mode.');
    }
    return false;
  }

  public clearSharedData(): Promise<boolean> {
    return this.sendHeartbeat(false, true);
  }
}

let heartbeatService: HeartbeatService | null = null;

export function getHeartbeatService(): HeartbeatService {
  if (!heartbeatService) {
    heartbeatService = new HeartbeatService();
  }
  return heartbeatService;
}
