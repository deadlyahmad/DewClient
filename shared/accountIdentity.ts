import crypto from 'node:crypto';

export function normalizeUsernameForIdentity(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

export function generateStableDewAccountId(): string {
  return crypto.randomUUID();
}

export function getStableAccountIdentity(account?: { dewAccountId?: string | null; id?: string | null; uuid?: string | null }): string | null {
  if (!account) return null;
  const candidates = [account.dewAccountId, account.id, account.uuid];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}
