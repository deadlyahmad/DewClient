import crypto from 'node:crypto';
import { CONFIG } from '../config.mjs';
import { DewUserAuthService } from './dewUserAuthService.mjs';

// A game session may outlive a launcher window. Bound the mod's scoped token to
// one play session while avoiding the old 15-minute mid-game expiry.
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_SESSIONS = 10_000;
const COSMETIC_TYPES = new Set(['skin', 'cape', 'wings', 'accessory', 'effect', 'other']);

function validRequest(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.instanceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.instanceId)
    && typeof value.minecraftVersion === 'string' && /^[A-Za-z0-9.+_-]{1,32}$/.test(value.minecraftVersion)
    && typeof value.modVersion === 'string' && /^[A-Za-z0-9.+_-]{1,64}$/.test(value.modVersion)
    && value.protocolVersion === 1
    && value.loaderFamily === 'fabric'
    && Array.isArray(value.capabilities) && value.capabilities.length <= COSMETIC_TYPES.size
    && value.capabilities.every((capability) => COSMETIC_TYPES.has(capability))
    && new Set(value.capabilities).size === value.capabilities.length);
}

function canonicalPlayerUuid(user) {
  const candidates = [
    user?.minecraftUuid,
    user?.uuid,
    user?.playerUuid,
    user?.user_metadata?.minecraftUuid,
    user?.user_metadata?.uuid
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class DewCosmeticsSessionService {
  constructor({ verifyAccessToken = DewUserAuthService.verifyAccessToken, verifyMinecraftAccessToken = DewUserAuthService.verifyMinecraftAccessToken, linkMinecraftIdentity, getLinkedIdentity, now = Date.now, ttlMs = SESSION_TTL_MS } = {}) {
    this.verifyAccessToken = verifyAccessToken;
    this.verifyMinecraftAccessToken = verifyMinecraftAccessToken;
    this.linkMinecraftIdentity = linkMinecraftIdentity;
    this.getLinkedIdentity = getLinkedIdentity;
    this.now = now;
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  async createSession(userAccessToken, request, minecraftAccessToken) {
    if (!validRequest(request)) {
      return { status: 400, code: 'INVALID_PROTOCOL', message: 'The mod session request is invalid or unsupported.' };
    }

    const authResult = await this.verifyAccessToken(userAccessToken);
    if (authResult?.status === 'unavailable') {
      return { status: 503, code: 'SERVER_UNAVAILABLE', message: 'Dew account authentication is temporarily unavailable.' };
    }
    if (authResult?.status !== 'authenticated' || !authResult.user?.id) {
      return { status: 401, code: 'AUTH_REQUIRED', message: 'A valid Dew account session is required.' };
    }

    const isDiscordProfile = authResult.user.provider === 'discord';
    let minecraftResult = null;
    let linkedIdentity = null;
    if (isDiscordProfile) {
      linkedIdentity = { playerUuid: authResult.user.minecraftUuid, username: authResult.user.username };
    } else {
      minecraftResult = await this.verifyMinecraftAccessToken(minecraftAccessToken);
      if (minecraftResult?.status === 'unavailable') {
        return { status: 503, code: 'MINECRAFT_AUTH_UNAVAILABLE', message: 'Minecraft profile verification is temporarily unavailable.' };
      }
      if (minecraftResult?.status !== 'authenticated') {
        return { status: 401, code: 'MINECRAFT_AUTH_REQUIRED', message: 'A valid Minecraft Services session is required.' };
      }
      const linked = await this.linkMinecraftIdentity?.(
        authResult.user.id,
        minecraftResult.profile.uuid,
        minecraftResult.profile.username
      );
      if (!linked) {
        return { status: 403, code: 'IDENTITY_LINK_CONFLICT', message: 'This Dew account cannot be linked to that Minecraft identity.' };
      }
      linkedIdentity = await this.getLinkedIdentity?.(authResult.user.id);
    }
    const username = String(linkedIdentity?.username || minecraftResult?.profile?.username || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      return { status: 403, code: 'FORBIDDEN', message: 'This Dew account is not linked to a verified Minecraft username.' };
    }

    const playerUuid = linkedIdentity?.playerUuid || minecraftResult?.profile?.uuid;
    if (!playerUuid) {
      return { status: 403, code: 'FORBIDDEN', message: 'This Dew account is not linked to a canonical Minecraft UUID.' };
    }

    this.removeExpiredSessions();
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.sessions.delete(oldest);
    }

    const issuedAt = this.now();
    const expiresAt = issuedAt + this.ttlMs;
    const sessionId = crypto.randomUUID();
    const accessToken = crypto.randomBytes(32).toString('base64url');
    const session = {
      sessionId,
      userId: authResult.user.id,
      username,
      playerUuid,
      instanceId: request.instanceId,
      minecraftVersion: request.minecraftVersion,
      modVersion: request.modVersion,
      protocolVersion: request.protocolVersion,
      permissions: ['cosmetics:read', 'cosmetics:equip', 'cosmetics:publish'],
      expiresAt
    };
    this.sessions.set(tokenHash(accessToken), session);

    const apiBaseUrl = `https://${CONFIG.PUBLIC_DOMAIN}/api/v1`;
    return {
      status: 201,
      data: {
        sessionId,
        accessToken,
        expiresAt: new Date(expiresAt).toISOString(),
        apiBaseUrl,
        wsUrl: '',
        protocolVersion: request.protocolVersion,
        heartbeatSeconds: 20
      }
    };
  }

  authenticate(accessToken) {
    if (typeof accessToken !== 'string' || accessToken.length > 256) return null;
    const key = tokenHash(accessToken);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(key);
      return null;
    }
    return { ...session };
  }

  revoke(accessToken) {
    if (typeof accessToken !== 'string') return false;
    return this.sessions.delete(tokenHash(accessToken));
  }

  removeExpiredSessions() {
    const now = this.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
  }
}
