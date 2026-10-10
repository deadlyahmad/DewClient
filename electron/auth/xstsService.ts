/**
 * DewClient - XSTS Authorization Service
 */

import { ENDPOINTS } from '../../shared/constants/endpoints.ts';
import { getLogger } from '../core/logger.ts';

export interface XSTSAuthResult {
  token: string;
  userHash: string;
}

export class XSTSService {
  public async authorize(xblToken: string): Promise<XSTSAuthResult> {
    const logger = getLogger();
    logger.info('auth', 'Authorizing with XSTS for Minecraft Services relying party...');

    const res = await fetch(ENDPOINTS.XBOX_XSTS_AUTH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        Properties: {
          SandboxId: 'RETAIL',
          UserTokens: [xblToken]
        },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT'
      })
    });

    // Safely consume the response body stream exactly once
    const rawBody = await res.text().catch(() => '');
    let jsonData: any = null;
    if (rawBody && rawBody.trim()) {
      try {
        jsonData = JSON.parse(rawBody);
      } catch {
        // Body is not JSON (e.g. plain text, HTML error, or malformed)
      }
    }

    if (res.ok && jsonData) {
      const userHash = jsonData.DisplayClaims?.xui?.[0]?.uhs;
      if (userHash && jsonData.Token) {
        logger.info('auth', 'XSTS authorization successful.');
        return { token: jsonData.Token, userHash };
      }
    }

    const xerr = typeof jsonData?.XErr === 'number' ? jsonData.XErr : undefined;

    if (xerr === 2148916233) {
      throw new Error('This Microsoft account does not have an active Xbox Live profile. Please create an Xbox profile on xbox.com.');
    }
    if (xerr === 2148916238) {
      throw new Error('This is a child account that requires parental approval. An adult must add the account to a Microsoft Family.');
    }
    if (xerr === 2148916235) {
      throw new Error('Xbox Live is not available in your region or territory.');
    }

    const errText = jsonData?.Message || jsonData?.error || (rawBody ? rawBody.trim() : '');
    logger.error('auth', `XSTS authorization failed (${res.status})`, { xerr, errText });
    throw new Error(`XSTS authorization failed: ${errText || res.statusText || String(res.status)}`);
  }
}
