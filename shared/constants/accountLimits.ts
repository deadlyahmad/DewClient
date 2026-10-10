import type { UserAccount } from '../types/account.ts';

export const ACCOUNT_LIMITS = {
  dew: 3,
  offline: 5
} as const;

export type LimitedAccountCategory = keyof typeof ACCOUNT_LIMITS;
export type AccountCategory = LimitedAccountCategory | 'microsoft';

export function getAccountCategory(account: Partial<UserAccount>): AccountCategory {
  if (account.type === 'microsoft') return 'microsoft';
  if (account.authUserId || account.accountType === 'dew') return 'dew';
  return 'offline';
}

export function countAccountCategories(accounts: readonly Partial<UserAccount>[]) {
  return accounts.reduce((counts, account) => {
    const category = getAccountCategory(account);
    counts[category] += 1;
    return counts;
  }, { microsoft: 0, dew: 0, offline: 0 });
}
