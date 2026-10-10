/**
 * DewClient - Validation Functions and Sanitization Schemas
 */

import type { ClientRegisterRequestDto } from '../dtos/clientRegister.dto.ts';
import type { ClientHeartbeatRequestBodyDto } from '../dtos/clientHeartbeat.dto.ts';
import type {
  AdminMaintenanceUpdateDto,
  AdminClientReleaseUpdateDto,
  AdminNewsUpsertDto,
  AdminAnnouncementUpsertDto,
  AdminServerUpsertDto,
  AdminFeatureFlagsUpdateDto,
  AdminPremiumUpdateDto
} from '../dtos/admin.dto.ts';

export function normalizeUsername(username: string): string {
  return String(username ?? '').trim();
}

export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username must not be empty.' };
  }
  const trimmed = normalizeUsername(username);
  if (trimmed.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters.' };
  }
  if (trimmed.length > 16) {
    return { valid: false, error: 'Username must be at most 16 characters.' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { valid: false, error: 'Username can only contain alphanumeric characters and underscores.' };
  }
  return { valid: true };
}

export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email must not be empty.' };
  }
  const trimmed = normalizeEmail(email);
  if (!trimmed || trimmed.length > 254) {
    return { valid: false, error: 'Email must be between 1 and 254 characters.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { valid: false, error: 'Enter a valid email address.' };
  }
  return { valid: true };
}

export function validatePassword(password: string): { valid: boolean; error?: string; requirements: Array<{ key: string; label: string; met: boolean }> } {
  const requirements = [
    { key: 'length', label: 'Minimum 8 characters', met: Boolean(password && password.length >= 8) },
    { key: 'uppercase', label: 'Uppercase letter', met: /[A-Z]/.test(String(password || '')) },
    { key: 'lowercase', label: 'Lowercase letter', met: /[a-z]/.test(String(password || '')) },
    { key: 'number', label: 'Number', met: /\d/.test(String(password || '')) },
    { key: 'special', label: 'Special character', met: /[^A-Za-z0-9]/.test(String(password || '')) }
  ];
  const valid = requirements.every((item) => item.met);
  return {
    valid,
    error: valid ? undefined : 'Password must include a minimum of 8 characters, uppercase and lowercase letters, a number, and a special character.',
    requirements
  };
}

export function validateOfflineSignup(input: {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}): { valid: boolean; error?: string; normalized?: { username: string; email: string } } {
  const usernameResult = validateUsername(input.username ?? '');
  if (!usernameResult.valid) return { valid: false, error: usernameResult.error || 'Invalid username.' };

  const emailResult = validateEmail(input.email ?? '');
  if (!emailResult.valid) return { valid: false, error: emailResult.error || 'Invalid email.' };

  const passwordResult = validatePassword(input.password ?? '');
  if (!passwordResult.valid) return { valid: false, error: passwordResult.error || 'Password does not meet the requirements.' };

  if (!input.confirmPassword || input.confirmPassword !== input.password) {
    return { valid: false, error: 'Passwords do not match.' };
  }

  return {
    valid: true,
    normalized: {
      username: normalizeUsername(input.username ?? ''),
      email: normalizeEmail(input.email ?? '')
    }
  };
}

export function validateInstanceName(name: string): { valid: boolean; error?: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Instance name must not be empty.' };
  }
  const trimmed = name.trim();
  if (trimmed.length < 1) {
    return { valid: false, error: 'Instance name must be at least 1 character.' };
  }
  if (trimmed.length > 64) {
    return { valid: false, error: 'Instance name must be at most 64 characters.' };
  }
  if (/[\/\\:*?"<>|]/.test(trimmed)) {
    return { valid: false, error: 'Instance name contains invalid characters (/ \\ : * ? " < > |).' };
  }
  return { valid: true };
}

export function cleanText(value: unknown, max = 500): string {
  return String(value ?? '').trim().slice(0, max);
}

export function isUuid(val: unknown): boolean {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val.trim());
}

export function validateId(id: unknown, name = 'id'): { valid: boolean; error?: string; value?: string } {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: `${name} must be a non-empty string.` };
  }
  const clean = id.trim();
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(clean)) {
    return { valid: false, error: `${name} contains invalid characters. Alphanumeric, hyphen, underscore, and dot allowed up to 64 chars.` };
  }
  return { valid: true, value: clean };
}

export function validateNumericRange(value: unknown, min: number, max: number, name = 'value'): { valid: boolean; error?: string; value?: number } {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    return { valid: false, error: `${name} must be a valid number.` };
  }
  if (num < min || num > max) {
    return { valid: false, error: `${name} must be between ${min} and ${max}.` };
  }
  return { valid: true, value: num };
}

export function validateVersionString(version: unknown): { valid: boolean; error?: string; value?: string } {
  if (!version || typeof version !== 'string') {
    return { valid: false, error: 'Version must be a non-empty string.' };
  }
  const clean = version.trim();
  // Validates version string like 2.0.0, 26.3, 1.20.4, 26.3-rc1, v1.0.0
  if (!/^v?[0-9]{1,4}(\.[0-9]{1,4}){1,3}(-[a-zA-Z0-9._-]+)?$/.test(clean)) {
    return { valid: false, error: 'Invalid version string format.' };
  }
  return { valid: true, value: clean };
}

export function parseSafeUrl(value: unknown, { allowEmpty = true } = {}): string {
  const input = cleanText(value, 1000);
  if (!input && allowEmpty) return '';
  try {
    const u = new URL(input);
    if (!['https:', 'http:'].includes(u.protocol)) {
      throw new Error('Invalid URL protocol. Only http: and https: are allowed.');
    }
    return u.toString();
  } catch {
    throw new Error('Invalid URL format.');
  }
}

export function parseUpdateInstallerFileName(value: string): string {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(new URL(value).pathname);
  } catch {
    throw new Error('The update URL has an invalid installer filename.');
  }
  const fileName = decodedPath.replace(/\\/g, '/').split('/').pop() || '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/i.test(fileName)) {
    throw new Error('The update URL must point to a Windows .exe installer.');
  }
  return fileName;
}

export function isValidEd25519PublicKey(rawKey: unknown): boolean {
  if (!rawKey || typeof rawKey !== 'string') return false;
  const clean = rawKey.trim();
  if (!clean) return false;

  if (clean.includes('-----BEGIN PUBLIC KEY-----')) {
    return clean.includes('-----END PUBLIC KEY-----');
  }

  // Raw hex format: 64 hex characters (32 bytes) or 88 hex characters (44 bytes DER)
  if (/^[0-9a-fA-F]{64}$/.test(clean) || /^[0-9a-fA-F]{88}$/.test(clean)) {
    return true;
  }

  // Base64 format: 44 chars for 32 bytes or 60 chars for 44 bytes
  if (/^[A-Za-z0-9+/]{43,60}={0,2}$/.test(clean)) {
    try {
      const buf = Buffer.from(clean, 'base64');
      return buf.length === 32 || buf.length === 44;
    } catch {
      return false;
    }
  }

  return false;
}

export function sanitizeLogString(message: string): string {
  if (!message || typeof message !== 'string') return '';
  return message
    .replace(/(?:Authorization:\s*)?Bearer\s+[a-zA-Z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/("?accessToken"?[\':=\s]+)["']?[a-zA-Z0-9._~+\/-]+["']?/gi, '$1"[REDACTED]"')
    .replace(/("?refreshToken"?[\':=\s]+)["']?[a-zA-Z0-9._~+\/-]+["']?/gi, '$1"[REDACTED]"')
    .replace(/("?(?:clientToken|idToken|identityToken|sessionToken|xstsToken|msaToken|access_token|refresh_token|client_token|id_token|identity_token|session_token|xsts_token|msa_token)"?[\':=\s]+)["']?[a-zA-Z0-9._~+\/-]+["']?/gi, '$1"[REDACTED]"')
    .replace(/("?password"?[\':=\s]+)(?:"[^"]*"|'[^']*'|[^\s,{}]+)/gi, '$1"[REDACTED]"')
    .replace(/client_secret=[^&\s]+/gi, 'client_secret=[REDACTED]')
    .replace(/XBL3.0\s+x=[^;]+;[a-zA-Z0-9._~+\/-]+/gi, 'XBL3.0 x=[REDACTED]')
    .replace(/(Cookie:\s*)[^\r\n]+/gi, '$1[REDACTED]');
}

// ======================== API Request Body Validators ========================

export function validateClientRegisterBody(body: unknown): { valid: boolean; error?: string; data?: ClientRegisterRequestDto } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Registration payload must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;

  if (!raw.publicKey || !isValidEd25519PublicKey(raw.publicKey)) {
    return { valid: false, error: 'Missing or invalid Ed25519 publicKey.' };
  }

  const verCheck = validateVersionString(raw.clientVersion);
  if (!verCheck.valid) {
    return { valid: false, error: `Invalid clientVersion: ${verCheck.error}` };
  }

  const data: ClientRegisterRequestDto = {
    publicKey: String(raw.publicKey).trim(),
    clientVersion: verCheck.value!,
    os: raw.os ? cleanText(raw.os, 50) : undefined,
    osVersion: raw.osVersion ? cleanText(raw.osVersion, 50) : undefined,
    architecture: raw.architecture ? cleanText(raw.architecture, 30) : undefined,
    hostname: raw.hostname ? cleanText(raw.hostname, 100) : undefined,
    metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata as Record<string, unknown> : undefined
  };

  return { valid: true, data };
}

export function validateClientHeartbeatHeaders(headers: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  data?: { clientId: string; timestamp: number; signature: string; version?: string };
} {
  const clientId = headers['x-dewclient-id'];
  if (!clientId || !isUuid(clientId)) {
    return { valid: false, error: 'Invalid or missing x-dewclient-id header (must be UUID).' };
  }

  const tsRaw = headers['x-dewclient-timestamp'];
  const timestamp = Number(tsRaw);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { valid: false, error: 'Invalid or missing x-dewclient-timestamp header.' };
  }

  // Check timestamp freshness (must be within 5 minutes)
  const now = Date.now();
  if (Math.abs(now - timestamp) > 300_000) {
    return { valid: false, error: 'Heartbeat timestamp expired or too far in the future.' };
  }

  const signature = headers['x-dewclient-signature'];
  if (!signature || typeof signature !== 'string') {
    return { valid: false, error: 'Missing x-dewclient-signature header.' };
  }
  const cleanSig = signature.trim();
  // Ed25519 signature is 64 bytes: 128 hex chars or 86-88 base64 chars
  if (!(/^[0-9a-fA-F]{128}$/.test(cleanSig) || /^[A-Za-z0-9+/]{86,88}={0,2}$/.test(cleanSig))) {
    return { valid: false, error: 'Invalid x-dewclient-signature format.' };
  }

  const version = headers['x-dewclient-version'] ? cleanText(headers['x-dewclient-version'], 30) : undefined;

  return {
    valid: true,
    data: {
      clientId: String(clientId).trim(),
      timestamp,
      signature: cleanSig,
      version
    }
  };
}

export function validateClientHeartbeatBody(body: unknown): { valid: boolean; error?: string; data?: ClientHeartbeatRequestBodyDto } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: true, data: {} };
  }
  const raw = body as Record<string, unknown>;
  const data: ClientHeartbeatRequestBodyDto = {};

  if (raw.clientVersion) {
    const verCheck = validateVersionString(raw.clientVersion);
    if (!verCheck.valid) {
      return { valid: false, error: `Invalid clientVersion: ${verCheck.error}` };
    }
    data.clientVersion = verCheck.value;
  }

  if (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
    data.metadata = raw.metadata as Record<string, unknown>;
  }

  if (Array.isArray(raw.accounts)) {
    data.accounts = raw.accounts.map((acc: any) => ({
      username: String(acc?.username || '').slice(0, 64),
      uuid: String(acc?.uuid || '').slice(0, 64),
      type: String(acc?.type || 'offline'),
      avatarUrl: acc?.avatarUrl ? String(acc.avatarUrl).slice(0, 500) : null,
      skinUrl: acc?.skinUrl ? String(acc.skinUrl).slice(0, 500) : null,
      lastUsedAt: acc?.lastUsedAt ? String(acc.lastUsedAt).slice(0, 64) : null
    }));
  }

  return { valid: true, data };
}

export function validateAdminMaintenanceBody(body: unknown): { valid: boolean; error?: string; data?: AdminMaintenanceUpdateDto } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Payload must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;

  if (typeof raw.enabled !== 'boolean') {
    return { valid: false, error: 'Field "enabled" is required and must be a boolean.' };
  }

  const mode = raw.mode !== undefined ? String(raw.mode).trim() : 'soft';
  if (!['soft', 'hard'].includes(mode)) {
    return { valid: false, error: 'Field "mode" must be either "soft" or "hard".' };
  }

  return {
    valid: true,
    data: {
      enabled: raw.enabled,
      mode: mode as 'soft' | 'hard',
      title: cleanText(raw.title || 'System Maintenance', 120),
      message: cleanText(raw.message || 'The launcher services are undergoing maintenance.', 500)
    }
  };
}

export function validateAdminClientReleaseBody(body: unknown): { valid: boolean; error?: string; data?: AdminClientReleaseUpdateDto } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Payload must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;

  const latCheck = validateVersionString(raw.latestVersion);
  if (!latCheck.valid) return { valid: false, error: `Invalid latestVersion: ${latCheck.error}` };

  const minCheck = validateVersionString(raw.minimumVersion);
  if (!minCheck.valid) return { valid: false, error: `Invalid minimumVersion: ${minCheck.error}` };

  try {
    const updateUrl = parseSafeUrl(raw.updateUrl, { allowEmpty: false });
    const notesUrl = raw.notesUrl ? parseSafeUrl(raw.notesUrl) : undefined;
    return {
      valid: true,
      data: {
        latestVersion: latCheck.value!,
        minimumVersion: minCheck.value!,
        updateUrl,
        notesUrl
      }
    };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

export function validateAdminNewsBody(body: unknown): { valid: boolean; error?: string; data?: AdminNewsUpsertDto } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Payload must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;

  const title = cleanText(raw.title, 120);
  if (!title) return { valid: false, error: 'News title is required.' };

  const summary = cleanText(raw.summary, 500);
  if (!summary) return { valid: false, error: 'News summary is required.' };

  try {
    const imageUrl = raw.imageUrl ? parseSafeUrl(raw.imageUrl) : undefined;
    const url = raw.url ? parseSafeUrl(raw.url) : undefined;

    return {
      valid: true,
      data: {
        id: raw.id ? cleanText(raw.id, 64) : undefined,
        title,
        summary,
        tag: cleanText(raw.tag, 30) || undefined,
        imageUrl,
        url,
        enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : true
      }
    };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

export function validateAdminAnnouncementBody(body: unknown): { valid: boolean; error?: string; data?: AdminAnnouncementUpsertDto } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Payload must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;

  const title = cleanText(raw.title, 120);
  if (!title) return { valid: false, error: 'Announcement title is required.' };

  const message = cleanText(raw.message, 1000);
  if (!message) return { valid: false, error: 'Announcement message is required.' };

  const severity = raw.severity !== undefined ? String(raw.severity).trim() : 'info';
  if (!['info', 'success', 'warning', 'critical'].includes(severity)) {
    return { valid: false, error: 'Severity must be one of: info, success, warning, critical.' };
  }

  const priorityRange = validateNumericRange(raw.priority ?? 0, 0, 1000, 'priority');
  if (!priorityRange.valid) return { valid: false, error: priorityRange.error };

  try {
    const url = raw.url ? parseSafeUrl(raw.url) : undefined;
    return {
      valid: true,
      data: {
        id: raw.id ? cleanText(raw.id, 64) : undefined,
        title,
        message,
        severity: severity as 'info' | 'success' | 'warning' | 'critical',
        url,
        enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : true,
        priority: priorityRange.value
      }
    };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

export function validateAdminServerBody(body: unknown): { valid: boolean; error?: string; data?: AdminServerUpsertDto } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Payload must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;

  const name = cleanText(raw.name, 100);
  if (!name) return { valid: false, error: 'Server name is required.' };

  const host = cleanText(raw.host, 255);
  if (!host) return { valid: false, error: 'Server host is required.' };

  const portRange = validateNumericRange(raw.port ?? 25565, 1, 65535, 'port');
  if (!portRange.valid) return { valid: false, error: portRange.error };

  const priorityRange = validateNumericRange(raw.priority ?? 0, 0, 1000, 'priority');
  if (!priorityRange.valid) return { valid: false, error: priorityRange.error };

  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => cleanText(t, 30)).filter(Boolean) : [];

  try {
    const iconUrl = raw.iconUrl ? parseSafeUrl(raw.iconUrl) : undefined;
    return {
      valid: true,
      data: {
        id: raw.id ? cleanText(raw.id, 64) : undefined,
        name,
        host,
        port: portRange.value,
        iconUrl,
        tags,
        enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : true,
        priority: priorityRange.value
      }
    };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

export function validateAdminFeatureFlagsBody(body: unknown): { valid: boolean; error?: string; data?: AdminFeatureFlagsUpdateDto } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Payload must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;
  const flagsInput = (raw.flags && typeof raw.flags === 'object' && !Array.isArray(raw.flags)) ? raw.flags : raw;
  const flags: Record<string, boolean> = {};

  for (const [key, val] of Object.entries(flagsInput as Record<string, unknown>)) {
    const cleanKey = cleanText(key, 50);
    if (cleanKey && /^[a-zA-Z0-9_.-]+$/.test(cleanKey)) {
      flags[cleanKey] = Boolean(val);
    }
  }

  return { valid: true, data: { flags } };
}

export function validateAdminPremiumBody(body: unknown): { valid: boolean; error?: string; data?: AdminPremiumUpdateDto } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Payload must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;
  const tier = cleanText(raw.tier, 30) || 'free';
  const enabled = Boolean(raw.enabled);
  const label = cleanText(raw.label, 100) || 'PREMIUM FEATURES SOON';

  return {
    valid: true,
    data: {
      tier,
      enabled,
      label
    }
  };
}
