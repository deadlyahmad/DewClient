import type { UserAccount } from '../../shared/types/account.ts';
import type { DewCosmeticsModSession, DewCosmeticsModSessionRequest } from '../../shared/types/cosmetics.ts';
import { getAccountStorage } from '../storage/accountStorage.ts';
import { getSettingsStorage } from '../storage/settingsStorage.ts';
import { resolveRemoteServerBaseUrl } from '../../shared/constants/defaults.ts';

export interface DewCosmeticsSessionClientDependencies {
  accountStorage?: Pick<ReturnType<typeof getAccountStorage>, 'getAccounts' | 'getAccountTokens'>;
  settingsStorage?: Pick<ReturnType<typeof getSettingsStorage>, 'getSettings'>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class DewCosmeticsSessionClient {
  private readonly accountStorage: NonNullable<DewCosmeticsSessionClientDependencies['accountStorage']>;
  private readonly settingsStorage: NonNullable<DewCosmeticsSessionClientDependencies['settingsStorage']>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(dependencies: DewCosmeticsSessionClientDependencies = {}) {
    this.accountStorage = dependencies.accountStorage || getAccountStorage();
    this.settingsStorage = dependencies.settingsStorage || getSettingsStorage();
    this.fetchImpl = dependencies.fetchImpl || fetch;
    this.timeoutMs = dependencies.timeoutMs || 10_000;
  }

  public async createSession(account: UserAccount, request: DewCosmeticsModSessionRequest, minecraftAccessToken?: string | null): Promise<DewCosmeticsModSession | null> {
    const authAccount = [account, ...this.accountStorage.getAccounts()].find((candidate) => candidate.authUserId
      && (candidate.type === 'discord' || Boolean(minecraftAccessToken)));
    if (!authAccount) return null;
    const accountTokens = this.accountStorage.getAccountTokens(authAccount.id);
    if (!accountTokens?.accessToken || (accountTokens.expiresAt > 0 && accountTokens.expiresAt <= Date.now() + 30_000)) return null;

    const settings = this.settingsStorage.getSettings();
    if (!settings.remote?.enabled) return null;
    const baseUrl = resolveRemoteServerBaseUrl(settings.remote.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname)) {
      throw new Error('DewCosmetics sessions require a secure HTTPS API connection.');
    }

    const response = await this.fetchImpl(`${baseUrl}/client/mod-sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accountTokens.accessToken}`,
        ...(authAccount.type === 'discord' ? {} : { 'x-minecraft-access-token': minecraftAccessToken || '' }),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(request),
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true || !payload.data) {
      throw new Error(payload?.error?.message || `DewCosmetics session request failed (${response.status}).`);
    }

    const session = payload.data;
    if (typeof session.sessionId !== 'string' || typeof session.accessToken !== 'string'
      || typeof session.expiresAt !== 'string' || typeof session.apiBaseUrl !== 'string'
      || typeof session.wsUrl !== 'string' || session.protocolVersion !== request.protocolVersion) {
      throw new Error('DewCosmetics API returned an invalid mod session.');
    }
    return session as DewCosmeticsModSession;
  }
}
