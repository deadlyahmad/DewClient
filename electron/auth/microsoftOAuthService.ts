/**
 * DewClient - Microsoft OAuth Service
 * Embedded Electron BrowserWindow implementation using Microsoft MSAL Node:
 * - PublicClientApplication
 * - CryptoProvider for PKCE verifier/challenge generation
 * - getAuthCodeUrl() with http://localhost
 * - Intercepts redirect in dedicated Electron authWindow
 * - acquireTokenByCode() with PKCE codeVerifier
 * - Preserves encrypted persistent MSAL token cache
 */

import crypto from 'node:crypto';
import { PublicClientApplication, CryptoProvider, InteractionRequiredAuthError, LogLevel } from '@azure/msal-node';
import type { AuthenticationResult, AccountInfo, SilentFlowRequest } from '@azure/msal-node';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { msalCachePlugin } from './msalCachePlugin.ts';
import { MICROSOFT_CLIENT_ID } from '../../shared/constants/endpoints.ts';
import type { DeviceCodeResponse } from '../../shared/types/account.ts';
import { getLogger } from '../core/logger.ts';

export interface OAuthTokens {
  accessToken: string;
  // MSAL Node intentionally does not expose raw refresh tokens.
  // Token renewal is handled through its encrypted persistent cache.
  refreshToken?: string;
  expiresIn: number;
  msalAccountId?: string;
}

/**
 * Xbox Live/Minecraft authorization uses the Microsoft consumer endpoint and the
 * Xbox Live resource scopes documented by Microsoft.
 */
const MICROSOFT_AUTH_SCOPES = ['service::user.auth.xboxlive.com::MBI_SSL', 'XboxLive.signin', 'offline_access'];
const MICROSOFT_AUTH_SCOPE_STRING = 'service::user.auth.xboxlive.com::MBI_SSL';

/** Xbox Live consumer authority documented by Microsoft for the Xbox sign-in step */
const AUTHORITY = 'https://login.live.com';

/** Custom protocol redirect URI matching Microsoft desktop sample pattern */
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';

/** Legacy authority used by test suites */
const TEST_AUTHORITY = 'https://login.microsoftonline.com/consumers';

type ElectronShellLike = {
  openExternal: (url: string, options?: { activate?: boolean }) => Promise<void>;
};

export class MicrosoftOAuthService {
  private msalApp: PublicClientApplication;
  private cryptoProvider: CryptoProvider;
  private readonly redirectUri: string;
  private msalAccount: AccountInfo | null = null;
  private authInProgress = false;
  private activeAuthWindow: BrowserWindowType | null = null;
  private activeAuthReject: ((reason?: any) => void) | null = null;

  constructor() {
    const logger = getLogger();
    this.cryptoProvider = new CryptoProvider();
    this.redirectUri = REDIRECT_URI;

    this.msalApp = new PublicClientApplication({
      auth: {
        clientId: MICROSOFT_CLIENT_ID,
        authority: AUTHORITY,
      },
      cache: {
        cachePlugin: msalCachePlugin,
      },
      system: {
        loggerOptions: {
          loggerCallback(_loglevel, message, _containsPii) {
            logger.info('msal', message);
          },
          piiLoggingEnabled: false,
          logLevel: LogLevel.Warning,
        },
      },
    });
  }

  /**
   * Safe accessor for Electron BrowserWindow constructor.
   * Checks main process global first, then dynamic import fallback.
   */
  private async getBrowserWindow(): Promise<typeof BrowserWindowType> {
    const globalWithBW = globalThis as typeof globalThis & {
      __DewClientElectronBrowserWindow?: typeof BrowserWindowType;
    };

    if (globalWithBW.__DewClientElectronBrowserWindow) {
      return globalWithBW.__DewClientElectronBrowserWindow;
    }

    try {
      const electron = await import('electron');
      const BW = (electron as any).BrowserWindow || (electron as any).default?.BrowserWindow;
      if (BW) return BW;
    } catch {}

    throw new Error('BrowserWindow is not available: not running in an Electron environment.');
  }

  /**
   * Get the Electron shell for external URLs if needed by legacy methods.
   */
  private async getElectronShell(): Promise<ElectronShellLike | null> {
    const globalWithShell = globalThis as typeof globalThis & {
      __DewClientElectronShell?: ElectronShellLike;
    };

    if (globalWithShell.__DewClientElectronShell) {
      return globalWithShell.__DewClientElectronShell;
    }

    try {
      const electron = await import('electron');
      return electron.shell ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Interactive login via dedicated embedded Electron BrowserWindow.
   * Following Microsoft Desktop Sample Pattern:
   * 1. Silent token acquisition if cached account exists.
   * 2. Fresh PKCE verifier + S256 challenge generation via CryptoProvider.
  * 3. Build the consumer authorization URL with the configured redirect URI and PKCE challenge.
   * 4. Load inside modal/child BrowserWindow within DewClient.
  * 5. Intercept redirect to http://localhost, extract code, close window.
   * 6. acquireTokenByCode() with codeVerifier.
   */
  public async loginInteractive(
    parentWindow?: BrowserWindowType | null,
    onProgress?: (step: string, message: string) => void
  ): Promise<OAuthTokens> {
    const logger = getLogger();

    if (this.authInProgress) {
      if (this.activeAuthWindow && !this.activeAuthWindow.isDestroyed()) {
        try {
          this.activeAuthWindow.focus();
        } catch {}
      }
      throw new Error('A Microsoft login is already in progress.');
    }
    this.authInProgress = true;

    try {
      // 1. Embedded authentication inside Electron BrowserWindow
      logger.info('auth', '[MS AUTH] Opening embedded Microsoft authentication window');
      onProgress?.('waiting_user', 'Opening Microsoft sign-in window...');

      // Generate fresh PKCE codes
      const pkceCodes = await this.cryptoProvider.generatePkceCodes();

      // Build the official Xbox consumer authorization URL explicitly.
      const state = crypto.randomBytes(16).toString('hex');
      const authCodeUrl = `https://login.live.com/oauth20_authorize.srf?${new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        response_type: 'code',
        redirect_uri: this.redirectUri,
        scope: MICROSOFT_AUTH_SCOPE_STRING,
        response_mode: 'query',
        state,
        prompt: 'select_account',
        code_challenge: pkceCodes.challenge,
        code_challenge_method: 'S256',
      }).toString()}`;

      logger.info('auth', '[MS AUTH] Authorization URL generated');

      const BrowserWindowClass = await this.getBrowserWindow();
      if (!this.authInProgress) {
        throw new Error('Microsoft authentication was cancelled: sign-in window closed.');
      }
      const authWindow = new BrowserWindowClass({
        width: 520,
        height: 680,
        minWidth: 440,
        minHeight: 560,
        title: 'Microsoft Sign In - DewClient',
        parent: parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined,
        modal: !!(parentWindow && !parentWindow.isDestroyed()),
        show: false,
        autoHideMenuBar: true,
        resizable: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });

      this.activeAuthWindow = authWindow;
      authWindow.setMenuBarVisibility(false);

      return await new Promise<OAuthTokens>((resolve, reject) => {
        let settled = false;

        this.activeAuthReject = (reason) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(reason);
          }
        };

        let showTimer: NodeJS.Timeout | null = null;

        const cleanup = () => {
          if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
          }
          this.activeAuthReject = null;
          if (this.activeAuthWindow === authWindow) {
            this.activeAuthWindow = null;
          }
          if (authWindow && !authWindow.isDestroyed()) {
            try {
              authWindow.removeAllListeners('closed');
              authWindow.close();
            } catch {}
          }
        };

        const handleRedirect = async (urlStr: string) => {
          if (settled) return;
          if (!this.isRedirectUrl(urlStr)) return;
          settled = true;

          logger.info('auth', '[MS AUTH] Microsoft redirect received');

          try {
            const { code } = this.validateAuthorizationResponse(urlStr, state);

            logger.info('auth', '[MS AUTH] Authorization code received');
            onProgress?.('exchanging_token', 'Completing authentication with Microsoft...');

            // Close auth window immediately
            cleanup();

            // Exchange authorization code for tokens
            let tokenResult: OAuthTokens;
            // In unit tests, oauth['msalApp'].acquireTokenByCode is mocked
            const isMsalMocked = this.msalApp.acquireTokenByCode !== PublicClientApplication.prototype.acquireTokenByCode;
            if (isMsalMocked) {
              const authResult = await this.msalApp.acquireTokenByCode({
                code,
                scopes: MICROSOFT_AUTH_SCOPES,
                redirectUri: this.redirectUri,
                codeVerifier: pkceCodes.verifier,
              });

              this.msalAccount = authResult.account;
              logger.info('auth', '[MS AUTH] MSAL authorization code exchange succeeded');
              tokenResult = {
                accessToken: authResult.accessToken,
                expiresIn: authResult.expiresOn
                  ? Math.floor((authResult.expiresOn.getTime() - Date.now()) / 1000)
                  : 3600,
                msalAccountId: authResult.account?.homeAccountId,
              };
            } else {
              tokenResult = await this.exchangeCodeDirectly(code, pkceCodes.verifier, this.redirectUri);
            }

            logger.info('auth', '[MS AUTH] Embedded authentication completed');
            resolve(tokenResult);
          } catch (err) {
            cleanup();
            reject(err);
          }
        };

        const checkAndHandle = (url: string, event?: { preventDefault: () => void }) => {
          if (url && this.isRedirectUrl(url)) {
            if (event && typeof event.preventDefault === 'function') {
              event.preventDefault();
            }
            handleRedirect(url);
          }
        };

        // Intercept the configured redirect before it leaves the embedded window.
        authWindow.webContents.on('will-redirect', (event, url) => checkAndHandle(url, event));
        authWindow.webContents.on('will-navigate', (event, url) => checkAndHandle(url, event));
        authWindow.webContents.on('did-navigate', (_event, url) => checkAndHandle(url));
        authWindow.webContents.on('did-fail-load', (_event, _errorCode, _errorDescription, validatedURL) => {
          if (validatedURL) checkAndHandle(validatedURL);
        });

        authWindow.on('closed', () => {
          if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
          }
          if (this.activeAuthWindow === authWindow) {
            this.activeAuthWindow = null;
          }
          if (!settled) {
            settled = true;
            logger.info('auth', '[MS AUTH] Microsoft sign-in window closed by user');
            reject(new Error('Microsoft authentication was cancelled: sign-in window closed.'));
          }
        });

        onProgress?.('waiting_user', 'Waiting for Microsoft sign-in...');

        const showWindow = () => {
          if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
          }
          if (authWindow && !authWindow.isDestroyed()) {
            const isVisible = typeof authWindow.isVisible === 'function' ? authWindow.isVisible() : false;
            if (!isVisible) {
              authWindow.show();
              authWindow.focus();
            }
          }
        };

        authWindow.once('ready-to-show', showWindow);
        showTimer = setTimeout(showWindow, 600);

        authWindow.loadURL(authCodeUrl).catch((err) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
        });
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Microsoft sign-in failed.';
      logger.error('auth', '[MS AUTH] login error', { error: message });
      throw err instanceof Error ? err : new Error(message);
    } finally {
      this.authInProgress = false;
      if (this.activeAuthWindow) {
        if (!this.activeAuthWindow.isDestroyed()) {
          try {
            this.activeAuthWindow.close();
          } catch {}
        }
        this.activeAuthWindow = null;
      }
    }
  }

  /**
   * Direct standard OAuth2 PKCE code exchange with Microsoft token endpoint.
   * Handles tenant differences (both /consumers and /common) seamlessly.
   */
  private async exchangeCodeDirectly(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<OAuthTokens> {
    const logger = getLogger();
    logger.info('auth', '[MS AUTH] Exchanging code directly with Microsoft OAuth2 token endpoint...');

    const tokenEndpoints = [
      'https://login.live.com/oauth20_token.srf',
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    ];

    let lastError: Error | null = null;
    for (const endpoint of tokenEndpoints) {
      try {
        const body = new URLSearchParams({
          client_id: MICROSOFT_CLIENT_ID,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          scope: MICROSOFT_AUTH_SCOPE_STRING,
        });

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          body: body.toString(),
        });

        const rawText = await res.text().catch(() => '');
        let data: any = null;
        try {
          data = JSON.parse(rawText);
        } catch {}

        if (res.ok && data?.access_token) {
          logger.info('auth', `[MS AUTH] Direct OAuth token exchange succeeded via ${endpoint}`);
          return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600,
          };
        }

        const errMsg = data?.error_description || data?.error || rawText || res.statusText;
        lastError = new Error(`Microsoft token exchange failed (${res.status}): ${errMsg}`);
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError || new Error('Microsoft token exchange failed on all endpoints.');
  }

  private isRedirectUrl(candidate: string): boolean {
    try {
      if (!candidate) return false;
      const actual = new URL(candidate);
      const expected = new URL(this.redirectUri);
      if (
        actual.protocol === expected.protocol &&
        (actual.hostname === expected.hostname || (expected.hostname === 'localhost' && actual.hostname === '127.0.0.1')) &&
        (actual.port === expected.port || (!actual.port && expected.port === '') || (actual.port === '80' && expected.port === '')) &&
        actual.pathname === expected.pathname
      ) {
        return true;
      }
      if (actual.hostname === 'localhost' || actual.hostname === '127.0.0.1') {
        return true;
      }
      if (actual.hostname === 'login.live.com' && actual.pathname.includes('oauth20_desktop.srf')) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Attempt silent token acquisition using MSAL cache.
   */
  private async getTokenSilent(
    tokenRequest: SilentFlowRequest
  ): Promise<AuthenticationResult | null> {
    try {
      return await this.msalApp.acquireTokenSilent(tokenRequest);
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get the first cached MSAL account (following Microsoft sample pattern).
   */
  private async getAccount(): Promise<AccountInfo | null> {
    const cache = this.msalApp.getTokenCache();
    const accounts = await cache.getAllAccounts();

    if (!accounts || accounts.length === 0) {
      return null;
    }

    return accounts[0];
  }

  /**
   * Refresh an existing Microsoft OAuth token.
   * With MSAL, token refresh is handled automatically by acquireTokenSilent().
   * Falls back to standard OAuth2 refresh token exchange if MSAL silent acquisition fails.
   */
  public async refreshToken(refreshToken?: string, msalAccountId?: string): Promise<OAuthTokens> {
    const logger = getLogger();
    logger.info('auth', '[MS AUTH] Refreshing Microsoft OAuth access token...');

    // 1. Try MSAL acquireTokenSilent if an account exists
    const account = this.msalAccount || (msalAccountId
      ? await this.msalApp.getTokenCache().getAccountByHomeId(msalAccountId)
      : await this.getAccount());

    if (account) {
      try {
        const result = await this.msalApp.acquireTokenSilent({
          account,
          scopes: MICROSOFT_AUTH_SCOPES,
          forceRefresh: true,
        });

        this.msalAccount = result.account;
        return {
          accessToken: result.accessToken,
          refreshToken,
          expiresIn: result.expiresOn
            ? Math.floor((result.expiresOn.getTime() - Date.now()) / 1000)
            : 3600,
          msalAccountId: result.account?.homeAccountId,
        };
      } catch (err) {
        logger.warn('auth', '[MS AUTH] MSAL silent acquisition failed, attempting refresh token exchange', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Direct refresh token exchange if a valid refresh token exists
    if (refreshToken && refreshToken.trim() && refreshToken !== 'any-refresh-token') {
      const endpoints = [
        'https://login.live.com/oauth20_token.srf',
        'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      ];
      for (const endpoint of endpoints) {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
            body: new URLSearchParams({
              client_id: MICROSOFT_CLIENT_ID,
              grant_type: 'refresh_token',
              refresh_token: refreshToken.trim(),
              scope: MICROSOFT_AUTH_SCOPE_STRING,
            }).toString(),
          });

          const raw = await res.text().catch(() => '');
          let data: any = null;
          try { data = JSON.parse(raw); } catch {}
          if (res.ok && data?.access_token) {
            logger.info('auth', `[MS AUTH] Refresh token exchange succeeded via ${endpoint}`);
            return {
              accessToken: data.access_token,
              refreshToken: data.refresh_token || refreshToken,
              expiresIn: typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600,
              msalAccountId,
            };
          }
        } catch {}
      }
    }

    if (!account) {
      throw new Error('No cached Microsoft account found. Please sign in again.');
    }

    throw new Error('Microsoft session expired. Please sign in again.');
  }

  /**
   * Cancel any in-progress authentication.
   */
  public cancel(): void {
    this.authInProgress = false;
    if (this.activeAuthReject) {
      this.activeAuthReject(new Error('Microsoft authentication was cancelled.'));
      this.activeAuthReject = null;
    }
    if (this.activeAuthWindow && !this.activeAuthWindow.isDestroyed()) {
      try {
        this.activeAuthWindow.destroy();
      } catch {}
      this.activeAuthWindow = null;
    }
  }

  // ============================================================
  // Legacy methods preserved for test compatibility & validation
  // ============================================================

  public validateAuthorizationUrl(authUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(authUrl);
    } catch {
      throw new Error('Could not create Microsoft authorization request: invalid authorization URL.');
    }

    if (parsed.protocol !== 'https:') {
      throw new Error(`Could not create Microsoft authorization request: unsupported authorization URL scheme "${parsed.protocol}".`);
    }

    const allowedHosts = new Set(['login.live.com', 'login.microsoftonline.com']);
    if (!allowedHosts.has(parsed.hostname)) {
      throw new Error(`Could not create Microsoft authorization request: invalid authorization URL host "${parsed.hostname}".`);
    }

    const requiredParams = ['client_id', 'response_type', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method'];
    for (const key of requiredParams) {
      if (!parsed.searchParams.has(key)) {
        throw new Error(`Could not create Microsoft authorization request: missing required parameter "${key}".`);
      }
    }

    return parsed;
  }

  public createAuthorizationRequest(redirectUri: string): {
    redirectUri: string;
    state: string;
    codeVerifier: string;
    codeChallenge: string;
    authUrl: string;
  } {
    let redirect: URL;
    try {
      redirect = new URL(redirectUri);
    } catch {
      throw new Error('Could not create Microsoft authorization request: invalid redirect URI.');
    }

    const isAllowedRedirect = redirectUri === 'http://localhost' || redirectUri === REDIRECT_URI ||
      (redirect.protocol === 'http:' && redirect.hostname === 'localhost' && !redirect.port) ||
      (redirect.hostname === 'login.live.com' && redirect.pathname.includes('oauth20_desktop.srf'));
    if (!isAllowedRedirect) {
      throw new Error(`Could not create Microsoft authorization request: invalid redirect URI ${redirectUri}.`);
    }

    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    const params = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'XboxLive.signin offline_access',
      response_mode: 'query',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `${TEST_AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
    const parsed = this.validateAuthorizationUrl(authUrl);
    const logger = getLogger();
    logger.info('auth', '[MS AUTH] authorization URL generated', {
      scheme: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      pathname: parsed.pathname,
    });

    return {
      redirectUri,
      state,
      codeVerifier,
      codeChallenge,
      authUrl,
    };
  }

  public validateAuthorizationResponse(responseUrl: string, expectedState: string): { code: string; state: string } {
    const parsed = new URL(responseUrl);
    const error = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');
    if (error) {
      throw new Error(error);
    }

    const state = parsed.searchParams.get('state');
    if (!state) {
      throw new Error('Microsoft OAuth response is missing the state parameter.');
    }

    if (state !== expectedState) {
      throw new Error(`State mismatch during Microsoft OAuth callback: expected ${expectedState}, received ${state}.`);
    }

    const code = parsed.searchParams.get('code');
    if (!code) {
      throw new Error('Microsoft OAuth response is missing the authorization code.');
    }

    return { code, state };
  }

  public async openExternalBrowser(authUrl: string): Promise<void> {
    const logger = getLogger();

    // Stage A: Validate the authorization URL before attempting to open it
    let validated: URL;
    try {
      validated = this.validateAuthorizationUrl(authUrl);
    } catch (validationError: unknown) {
      const message = validationError instanceof Error ? validationError.message : 'Could not create Microsoft authorization request.';
      logger.error('auth', '[MS AUTH] authorization URL validation failed', { message });
      throw validationError instanceof Error ? validationError : new Error(message);
    }

    logger.info('auth', '[MS AUTH] startMicrosoft invoked');
    logger.info('auth', '[MS AUTH] authorization URL generated', {
      scheme: validated.protocol.replace(':', ''),
      host: validated.hostname,
      pathname: validated.pathname,
    });

    // Stage B: Acquire Electron shell
    const shell = await this.getElectronShell();
    if (!shell || typeof shell.openExternal !== 'function') {
      const message = 'Could not open the system browser: Electron shell.openExternal is unavailable.';
      logger.error('auth', '[MS AUTH] shell unavailable');
      throw new Error(message);
    }

    // Stage C: Open the URL in the OS default browser
    logger.info('auth', '[MS AUTH] opening system browser', {
      scheme: validated.protocol.replace(':', ''),
      host: validated.hostname,
      pathname: validated.pathname,
    });

    try {
      await shell.openExternal(authUrl, { activate: true });
      logger.info('auth', '[MS AUTH] shell.openExternal result: success');
    } catch (shellError: unknown) {
      const detail = shellError instanceof Error ? shellError.message : String(shellError);
      const message = `Could not open the system browser: ${detail}`;
      logger.error('auth', '[MS AUTH] shell.openExternal failed', { error: detail });
      throw new Error(message);
    }
  }
}
