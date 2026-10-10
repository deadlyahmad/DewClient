/**
 * DewClient - Minecraft Services Authentication
 */

import { ENDPOINTS } from '../../shared/constants/endpoints.ts';
import { getLogger } from '../core/logger.ts';

export interface MinecraftTokenResult {
  accessToken: string;
  expiresIn: number;
}

export interface MinecraftProfileResult {
  id: string;
  name: string;
  skinUrl?: string;
  capeUrl?: string;
  capes: Array<{ id: string; state: string; url: string; alias?: string }>;
}

export class MinecraftAuthService {
  private extractErrorDetails(status: number, statusText: string, responseText: string): string {
    const trimmed = responseText.trim();
    if (!trimmed) {
      return statusText || `HTTP ${status}`;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const candidates = [
        parsed.errorMessage,
        parsed.error,
        parsed.message,
        parsed.error_description,
        parsed.details,
        parsed.errText
      ];

      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
          return candidate.trim();
        }
      }
    } catch {
      // Fall back to raw text below.
    }

    return trimmed;
  }

  public async loginWithXbox(userHash: string, xstsToken: string): Promise<MinecraftTokenResult> {
    const logger = getLogger();
    logger.info('auth', 'Exchanging XSTS token for Minecraft Services access token...');

    const res = await fetch(ENDPOINTS.MINECRAFT_SERVICES_LOGIN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        identityToken: `XBL3.0 x=${userHash};${xstsToken}`
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const parsedError = this.extractErrorDetails(res.status, res.statusText, errText);
      logger.error('auth', 'Minecraft login failed', { status: res.status, errText, parsedError });
      throw new Error(`Failed to login to Minecraft Services (${res.status}): ${parsedError}`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('Minecraft Services returned a successful response without an access token.');
    }

    return {
      accessToken: data.access_token,
      expiresIn: Number.isFinite(data.expires_in) && (data.expires_in as number) > 0
        ? data.expires_in as number
        : 86400
    };
  }

  public async checkEntitlements(mcAccessToken: string): Promise<boolean> {
    const logger = getLogger();
    logger.info('auth', 'Verifying Minecraft game ownership...');

    try {
      const res = await fetch(ENDPOINTS.MINECRAFT_SERVICES_ENTITLEMENTS, {
        headers: {
          Authorization: `Bearer ${mcAccessToken}`,
          Accept: 'application/json'
        }
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        logger.warn('auth', `Minecraft entitlement check returned status ${res.status}, continuing to profile lookup.`, {
          status: res.status,
          errText
        });
        return true; // Best effort fallback to profile verification
      }

      const data = (await res.json()) as { items?: Array<{ name?: string }> };
      const hasGame = Array.isArray(data.items) &&
        data.items.some((i) => i.name && (i.name.includes('minecraft') || i.name.includes('game_pass')));

      if (!hasGame && Array.isArray(data.items) && data.items.length > 0) {
        logger.warn('auth', 'Minecraft item not explicitly found in mcstore, continuing to profile verification...');
      }

      return true;
    } catch (err) {
      logger.warn('auth', 'Could not verify Minecraft ownership via mcstore, continuing to profile lookup.', {
        error: err instanceof Error ? err.message : String(err)
      });
      return true;
    }
  }

  public async getProfile(mcAccessToken: string): Promise<MinecraftProfileResult> {
    const logger = getLogger();
    logger.info('auth', 'Fetching Minecraft player profile...');

    const res = await fetch(ENDPOINTS.MINECRAFT_SERVICES_PROFILE, {
      headers: {
        Authorization: `Bearer ${mcAccessToken}`,
        Accept: 'application/json'
      }
    });

    if (res.status === 404) {
      throw new Error('This Microsoft account does not have a Minecraft Java Edition profile. Please purchase Minecraft or create a profile on minecraft.net.');
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.error('auth', 'Failed to fetch Minecraft profile', { status: res.status, errText });
      throw new Error(`Failed to fetch Minecraft profile: ${res.statusText}`);
    }

    const data = (await res.json()) as {
      id: string;
      name: string;
      skins?: Array<{ id: string; state: string; url: string; variant?: string }>;
      capes?: Array<{ id: string; state: string; url: string; alias?: string }>;
    };

    const activeSkin = data.skins?.find((s) => s.state === 'ACTIVE')?.url || data.skins?.[0]?.url;
    const activeCape = data.capes?.find((c) => c.state === 'ACTIVE')?.url || data.capes?.[0]?.url;

    return {
      id: data.id,
      name: data.name,
      skinUrl: activeSkin,
      capeUrl: activeCape,
      capes: Array.isArray(data.capes) ? data.capes.filter((cape) => typeof cape.id === 'string' && typeof cape.url === 'string') : []
    };
  }
}
