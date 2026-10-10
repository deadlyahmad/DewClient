/**
 * DewClient - Xbox Live Authentication Service
 */

import { ENDPOINTS } from '../../shared/constants/endpoints.ts';
import { getLogger } from '../core/logger.ts';

export interface XboxLiveAuthResult {
  token: string;
  userHash: string;
  gamerTag?: string;
  xuid?: string;
}

export class XboxLiveService {
  public async authenticate(msAccessToken: string): Promise<XboxLiveAuthResult> {
    const logger = getLogger();
    logger.info('auth', 'Authenticating with Xbox Live User API...');

    // Minecraft's Xbox Live RPS flow expects the Microsoft access token
    // as a d= ticket. Do not send speculative alternate formats: they can
    // create unnecessary failed requests and make diagnostics misleading.
    const dTicket = msAccessToken.startsWith('d=') ? msAccessToken : `d=${msAccessToken}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-xbl-contract-version': '1'
    };

    try {
      const res = await fetch(ENDPOINTS.XBOX_USER_AUTH, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          Properties: {
            AuthMethod: 'RPS',
            SiteName: 'user.auth.xboxlive.com',
            RpsTicket: dTicket
          },
          RelyingParty: 'http://auth.xboxlive.com',
          TokenType: 'JWT'
        })
      });

      const rawBody = await res.text().catch(() => '');
      let data: any = null;
      if (rawBody) {
        try { data = JSON.parse(rawBody); } catch {}
      }

      if (res.ok) {
        const xui = data?.DisplayClaims?.xui?.[0];
        const userHash = xui?.uhs;
        if (userHash && data?.Token) {
          logger.info('auth', 'Xbox Live authentication succeeded (canonical RPS ticket)');
          return {
            token: data.Token,
            userHash,
            gamerTag: xui?.gtg,
            xuid: xui?.xid
          };
        }
      }

      // If prefixed ticket was rejected, try fallback with raw ticket
      if (dTicket.startsWith('d=')) {
        const rawTicket = msAccessToken.replace(/^d=/, '');
        try {
          const fallbackRes = await fetch(ENDPOINTS.XBOX_USER_AUTH, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              Properties: {
                AuthMethod: 'RPS',
                SiteName: 'user.auth.xboxlive.com',
                RpsTicket: rawTicket
              },
              RelyingParty: 'http://auth.xboxlive.com',
              TokenType: 'JWT'
            })
          });
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json().catch(() => null);
            const xui = fallbackData?.DisplayClaims?.xui?.[0];
            const userHash = xui?.uhs;
            if (userHash && fallbackData?.Token) {
              logger.info('auth', 'Xbox Live authentication succeeded (raw ticket fallback)');
              return {
                token: fallbackData.Token,
                userHash,
                gamerTag: xui?.gtg,
                xuid: xui?.xid
              };
            }
          }
        } catch {}
      }

      logger.error('auth', `Xbox Live authentication failed with status ${res.status}`, {
        error: data?.Message || data?.error || rawBody || res.statusText
      });
      throw new Error(
        `Xbox Live authentication failed (${res.status})${data?.Message || data?.error ? `: ${data.Message || data.error}` : ''}`
      );
    } catch (err: any) {
      if (err instanceof Error && err.message.startsWith('Xbox Live authentication failed')) {
        throw err;
      }
      logger.error('auth', 'Xbox Live authentication request failed', { error: err?.message || String(err) });
      throw new Error(`Xbox Live authentication failed: ${err?.message || String(err)}`);
    }
  }
}
