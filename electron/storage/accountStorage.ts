/**
 * DewClient - Account Storage Manager
 * Stores public account metadata in JSON and encrypts credentials via SecureStorageService
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UserAccount, EncryptedAccountTokens } from '../../shared/types/account.ts';
import { ACCOUNT_LIMITS, countAccountCategories, type LimitedAccountCategory } from '../../shared/constants/accountLimits.ts';
import { SecureStorageService } from './secureStorage.ts';
import { getPathManager } from './paths.ts';

interface StoredAccountData {
  accounts: UserAccount[];
  activeAccountId: string | null;
  // Encrypted token blobs keyed by account ID
  tokens: Record<string, string>;
}

function normalizeIdentityValue(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length ? normalized.toLowerCase() : null;
}

function getCanonicalAccountKey(account: Partial<UserAccount>): string | null {
  const candidates = [
    account.dewAccountId,
    account.id,
    account.minecraftUuid,
    account.uuid
  ];
  for (const candidate of candidates) {
    const normalized = normalizeIdentityValue(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function isSameVerifiedPremiumAccount(left: Partial<UserAccount>, right: Partial<UserAccount>): boolean {
  if (!left || !right) return false;
  const leftType = left.type || left.accountType;
  const rightType = right.type || right.accountType;
  if (leftType !== 'microsoft' && leftType !== 'online' && rightType !== 'microsoft' && rightType !== 'online') {
    return false;
  }
  const leftUuid = normalizeIdentityValue(left.minecraftUuid || left.uuid);
  const rightUuid = normalizeIdentityValue(right.minecraftUuid || right.uuid);
  return Boolean(leftUuid && rightUuid && leftUuid === rightUuid);
}

export class AccountStorage {
  private filePath: string;
  private data: StoredAccountData;

  constructor(customPath?: string) {
    this.filePath = customPath || getPathManager().getAccountsFilePath();
    this.data = this.load();
    if (this.stripLegacyLocalCredentials()) this.save();
  }

  public getAccounts(): UserAccount[] {
    return this.data.accounts.map((acc) => ({
      ...acc,
      active: acc.id === this.data.activeAccountId
    }));
  }

  public getAccountCounts() {
    return countAccountCategories(this.data.accounts);
  }

  public assertCanAddAccount(category: LimitedAccountCategory): void {
    const counts = this.getAccountCounts();
    if (counts[category] >= ACCOUNT_LIMITS[category]) {
      const label = category === 'dew' ? 'Dew accounts' : 'offline profiles';
      throw new Error(`This device already has the maximum of ${ACCOUNT_LIMITS[category]} ${label}. Remove one before adding another.`);
    }
  }

  public getActiveAccount(): UserAccount | null {
    if (!this.data.activeAccountId) return null;
    return this.data.accounts.find((a) => a.id === this.data.activeAccountId) || null;
  }

  public setActiveAccount(accountIdOrUuid: string): void {
    if (!accountIdOrUuid?.trim()) {
      this.data.activeAccountId = null;
      this.save();
      return;
    }
    const acc = this.data.accounts.find((a) => {
      const key = getCanonicalAccountKey(a);
      const target = accountIdOrUuid.trim();
      return key === target || a.id === target || a.uuid === target || a.minecraftUuid === target || a.dewAccountId === target;
    });
    if (acc) {
      this.data.activeAccountId = acc.id;
      this.save();
    }
  }

  public saveAccount(account: UserAccount, tokens?: EncryptedAccountTokens): void {
    const existingIndex = this.data.accounts.findIndex((a) => {
      const sameDewAccount = Boolean(account.dewAccountId) && Boolean(a.dewAccountId) && a.dewAccountId === account.dewAccountId;
      const sameId = Boolean(account.id) && a.id === account.id;
      const sameVerifiedPremiumIdentity = isSameVerifiedPremiumAccount(a, account);
      return sameDewAccount || sameId || sameVerifiedPremiumIdentity;
    });

    if (existingIndex < 0 && account.type !== 'microsoft') {
      const category = account.authUserId || account.accountType === 'dew' ? 'dew' : 'offline';
      this.assertCanAddAccount(category);
    }

    if (existingIndex >= 0) {
      const existing = this.data.accounts[existingIndex];
      const sameDewIdentity = Boolean(existing.dewAccountId) && Boolean(account.dewAccountId) && existing.dewAccountId === account.dewAccountId;
      const nextRecord = {
        ...existing,
        ...account,
        id: existing.id || account.id,
        dewAccountId: existing.dewAccountId || account.dewAccountId || account.id,
        uuid: sameDewIdentity || !existing.uuid ? account.uuid || existing.uuid : existing.uuid || account.uuid,
        minecraftUuid: account.minecraftUuid || existing.minecraftUuid || account.uuid || existing.uuid,
        username: sameDewIdentity ? (account.username || existing.username) : (existing.username || account.username),
        type: account.type || existing.type,
        accountType: account.accountType || existing.accountType || (account.type === 'offline' ? 'offline' : 'online'),
        lastUsedAt: new Date().toISOString()
      } as UserAccount;
      this.data.accounts[existingIndex] = nextRecord;
    } else {
      const candidate = {
        ...account,
        id: account.id || (account.dewAccountId ? `ms-${account.dewAccountId}` : `account-${account.uuid}`),
        dewAccountId: account.dewAccountId || account.id || account.uuid,
        uuid: account.uuid || account.minecraftUuid || account.dewAccountId,
        minecraftUuid: account.minecraftUuid || account.uuid,
        accountType: account.accountType || (account.type === 'offline' ? 'offline' : 'online'),
        createdAt: account.createdAt || new Date().toISOString(),
        lastUsedAt: new Date().toISOString()
      } as UserAccount;
      this.data.accounts.push(candidate);
    }

    if (!this.data.activeAccountId) {
      this.data.activeAccountId = account.id;
    }

    if (tokens) {
      const serialized = JSON.stringify(tokens);
      const encrypted = SecureStorageService.encrypt(serialized);
      this.data.tokens[account.id] = encrypted;
    }

    this.save();
  }

  public updateAccount(accountIdOrUuid: string, partial: Partial<UserAccount>): UserAccount | null {
    const index = this.data.accounts.findIndex((account) => {
      const target = accountIdOrUuid.trim();
      return account.id === target || account.uuid === target || account.dewAccountId === target || getCanonicalAccountKey(account) === target;
    });
    if (index < 0) return null;
    const current = this.data.accounts[index];
    const identityProtected = {
      id: current.id,
      dewAccountId: current.dewAccountId || current.id,
      uuid: current.type === 'discord' && typeof partial.uuid === 'string' ? partial.uuid : current.uuid,
      minecraftUuid: current.type === 'discord' && typeof partial.minecraftUuid === 'string'
        ? partial.minecraftUuid
        : current.minecraftUuid || current.uuid,
      username: current.type === 'discord' && typeof partial.username === 'string' ? partial.username : current.username,
      type: current.type,
      accountType: current.accountType || (current.type === 'offline' ? 'offline' : 'online')
    };
    this.data.accounts[index] = {
      ...current,
      ...partial,
      ...identityProtected,
      lastUsedAt: new Date().toISOString()
    } as UserAccount;
    this.save();
    return this.data.accounts[index];
  }

  public getAccountTokens(accountId: string): EncryptedAccountTokens | null {
    const encrypted = this.data.tokens[accountId];
    if (!encrypted) return null;

    try {
      const decrypted = SecureStorageService.decrypt(encrypted);
      if (!decrypted) return null;
      return JSON.parse(decrypted) as EncryptedAccountTokens;
    } catch {
      return null;
    }
  }

  public clearAccountTokens(accountId: string): void {
    if (!this.data.tokens[accountId]) return;
    delete this.data.tokens[accountId];
    this.save();
  }

  public removeAccount(accountIdOrUuid: string): void {
    const acc = this.data.accounts.find((a) => {
      const key = accountIdOrUuid.trim();
      return a.id === key || a.uuid === key || a.minecraftUuid === key || a.dewAccountId === key || getCanonicalAccountKey(a) === key;
    });
    if (acc) {
      this.data.accounts = this.data.accounts.filter((a) => a.id !== acc.id && a.uuid !== acc.uuid && a.dewAccountId !== acc.dewAccountId);
      delete this.data.tokens[acc.id];

      if (this.data.activeAccountId === acc.id) {
        this.data.activeAccountId = this.data.accounts[0]?.id || null;
      }

      this.save();
    }
  }

  private load(): StoredAccountData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
          activeAccountId: parsed.activeAccountId || null,
          tokens: parsed.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : {}
        };
      }
    } catch (err: any) {
      console.warn('[ACCOUNTS] Could not read accounts file, initializing empty:', err.message);
    }
    return { accounts: [], activeAccountId: null, tokens: {} };
  }

  private stripLegacyLocalCredentials(): boolean {
    let changed = false;
    this.data.accounts = this.data.accounts.map((account) => {
      const sanitized = { ...account };
      if (sanitized.passwordHash !== undefined) {
        delete sanitized.passwordHash;
        changed = true;
      }
      if (sanitized.passwordSalt !== undefined) {
        delete sanitized.passwordSalt;
        changed = true;
      }
      if ((sanitized.type === 'offline' || sanitized.accountType === 'offline') && sanitized.email !== undefined) {
        delete sanitized.email;
        changed = true;
      }
      return sanitized;
    });
    return changed;
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${this.filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tempPath, this.filePath);
  }
}

let accountStorageInstance: AccountStorage | null = null;

export function getAccountStorage(): AccountStorage {
  const expectedFilePath = getPathManager().getAccountsFilePath();
  if (!accountStorageInstance || (accountStorageInstance as any).filePath !== expectedFilePath) {
    accountStorageInstance = new AccountStorage();
  }
  return accountStorageInstance;
}
