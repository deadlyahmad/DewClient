/**
 * DewClient - Session Refresh & Validation Service
 */

import type { MicrosoftAccount, EncryptedAccountTokens } from '../../shared/types/account.ts';
import { getAccountStorage } from '../storage/accountStorage.ts';
import { MicrosoftOAuthService } from './microsoftOAuthService.ts';
import { XboxLiveService } from './xboxLiveService.ts';
import { XSTSService } from './xstsService.ts';
import { MinecraftAuthService } from './minecraftAuthService.ts';
import { getLogger } from '../core/logger.ts';

export class SessionService {
  private oauthService = new MicrosoftOAuthService();
  private xboxLiveService = new XboxLiveService();
  private xstsService = new XSTSService();
  private minecraftAuthService = new MinecraftAuthService();

  public isSessionExpired(tokens: EncryptedAccountTokens): boolean {
    const now = Date.now();
    // Consider expired if within 5 minutes of expiration
    return now >= tokens.expiresAt - 300_000;
  }

  public async getValidMinecraftToken(account: MicrosoftAccount): Promise<string> {
    const logger = getLogger();
    const storage = getAccountStorage();
    const tokens = storage.getAccountTokens(account.id);

    if (!tokens || !tokens.accessToken) {
      throw new Error(`No credentials found for account ${account.username}. Please log in again.`);
    }

    if (!this.isSessionExpired(tokens)) {
      return tokens.accessToken;
    }

    // MSAL Node intentionally does not expose refresh tokens through its
    // public API. The Microsoft OAuth service persists the encrypted MSAL
    // token cache, so silent acquisition can refresh the token without
    // storing or manually replaying a raw refresh token.
    logger.info('auth', `Session expired for ${account.username}, performing automatic token refresh...`);

    try {
      // 1. Refresh Microsoft OAuth token
      const msTokens = await this.oauthService.refreshToken(tokens.refreshToken, tokens.msalAccountId);

      // 2. Authenticate Xbox Live
      const xbl = await this.xboxLiveService.authenticate(msTokens.accessToken);

      // 3. Authorize XSTS
      const xsts = await this.xstsService.authorize(xbl.token);

      // 4. Authenticate Minecraft Services
      const mcToken = await this.minecraftAuthService.loginWithXbox(xsts.userHash, xsts.token);

      // 5. Update local encrypted storage
      const newExpiresAt = Date.now() + mcToken.expiresIn * 1000;
      const updatedTokens: EncryptedAccountTokens = {
        accessToken: mcToken.accessToken,
        refreshToken: msTokens.refreshToken || tokens.refreshToken,
        expiresAt: newExpiresAt,
        msalAccountId: msTokens.msalAccountId || tokens.msalAccountId
      };

      storage.saveAccount(
        {
          ...account,
          expiresAt: newExpiresAt,
          hasActiveSession: true
        },
        updatedTokens
      );

      logger.info('auth', `Session refreshed successfully for ${account.username}.`);
      return mcToken.accessToken;
    } catch (err: any) {
      logger.error('auth', `Failed to refresh session for ${account.username}:`, err.message);
      storage.saveAccount({
        ...account,
        hasActiveSession: false
      });
      throw Object.assign(new Error(`Authentication session expired for ${account.username}. Please sign in again.`), { cause: err });
    }
  }
}
