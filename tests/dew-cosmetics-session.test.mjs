import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret-with-more-bytes';
process.env.PUBLIC_DOMAIN = 'server.example.test';
process.env.CORS_ORIGINS = 'null';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_KEY = 'test-service-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.DEWCLIENT_RELEASE_DIR = 'test-releases';

const { createApp } = await import('../server/src/index.mjs');
const { DewCosmeticsSessionService } = await import('../server/src/services/dewCosmeticsSessionService.mjs');

const canonicalPlayerUuid = '11111111-1111-4111-8111-111111111111';

async function withServer(storage, options, run) {
  const server = createApp(storage, options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/v1`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const sessionRequest = {
  instanceId: 'instance-123',
  minecraftVersion: '26.3',
  modVersion: '0.3.0',
  protocolVersion: 1,
  loaderFamily: 'fabric',
  capabilities: ['skin', 'cape', 'wings']
};

test('mod session requires a verified Dew user and returns only a short-lived scoped token', async () => {
  const originalFetch = globalThis.fetch;
  let authRequest;
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://api.minecraftservices.com/minecraft/profile') {
      assert.equal(options.headers.Authorization, 'Bearer minecraft-profile-token');
      return Response.json({ id: canonicalPlayerUuid.replace(/-/g, ''), name: 'PlayerOne' });
    }
    if (!String(url).startsWith('https://test-project.supabase.co/')) return originalFetch(url, options);
    authRequest = { url: String(url), headers: options.headers };
    return Response.json({
      id: 'dew-user-1',
      user_metadata: { username: 'DewUserOne', minecraftUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      app_metadata: { minecraftUuid: canonicalPlayerUuid, minecraftUsername: 'PlayerOne' }
    });
  };

  try {
    await withServer({
      getCosmetics: async () => null,
      linkDewMinecraftIdentity: async () => true,
      getDewMinecraftIdentity: async () => ({ playerUuid: canonicalPlayerUuid, username: 'PlayerOne' })
    }, {}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/client/mod-sessions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer dew-user-access-token', 'x-minecraft-access-token': 'minecraft-profile-token', 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionRequest)
      });
      const result = await response.json();
      assert.equal(response.status, 201);
      assert.equal(authRequest.url, 'https://test-project.supabase.co/auth/v1/user');
      assert.equal(authRequest.headers.apikey, 'test-anon-key');
      assert.equal(authRequest.headers.Authorization, 'Bearer dew-user-access-token');
      assert.equal(result.data.protocolVersion, 1);
      assert.equal(result.data.apiBaseUrl, 'https://server.example.test/api/v1');
      assert.equal(result.data.wsUrl, '');
      assert.ok(Date.parse(result.data.expiresAt) > Date.now());
      assert.equal(result.data.accessToken.length >= 40, true);
      assert.equal(JSON.stringify(result).includes('dew-user-access-token'), false);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mod session rejects invalid protocol, invalid Dew session, and expired mod tokens', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => String(url).startsWith('https://test-project.supabase.co/')
    ? new Response('{}', { status: 401 })
    : originalFetch(url, options);

  try {
    await withServer({ getCosmetics: async () => null }, { dewCosmeticsSessionOptions: { ttlMs: 1 } }, async (baseUrl) => {
      const invalidProtocol = await fetch(`${baseUrl}/client/mod-sessions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sessionRequest, protocolVersion: 2 })
      });
      assert.equal(invalidProtocol.status, 400);

      const invalidAuth = await fetch(`${baseUrl}/client/mod-sessions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionRequest)
      });
      assert.equal(invalidAuth.status, 401);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  let now = 1000;
  const service = new DewCosmeticsSessionService({
    verifyAccessToken: async () => ({ status: 'authenticated', user: { id: 'dew-user-3', username: 'DewClockUser', minecraftUsername: 'ClockPlayer', minecraftUuid: canonicalPlayerUuid } }),
    verifyMinecraftAccessToken: async () => ({ status: 'authenticated', profile: { uuid: canonicalPlayerUuid, username: 'ClockPlayer' } }),
    linkMinecraftIdentity: async () => true,
    getLinkedIdentity: async () => ({ playerUuid: canonicalPlayerUuid, username: 'ClockPlayer' }),
    now: () => now,
    ttlMs: 10
  });
  const created = await service.createSession('valid-user-token', sessionRequest, 'minecraft-profile-token');
  assert.equal(created.status, 201);
  assert.ok(service.authenticate(created.data.accessToken));
  now += 11;
  assert.equal(service.authenticate(created.data.accessToken), null);
});

test('mod cosmetics endpoint is scoped to the verified Dew username identity', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => String(url) === 'https://api.minecraftservices.com/minecraft/profile'
    ? Response.json({ id: canonicalPlayerUuid.replace(/-/g, ''), name: 'OwnPlayer' })
    : String(url).startsWith('https://test-project.supabase.co/')
    ? Response.json({
      id: 'dew-user-2',
      user_metadata: { username: 'DewUserTwo', minecraftUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      app_metadata: { minecraftUuid: canonicalPlayerUuid, minecraftUsername: 'OwnPlayer' }
    })
    : originalFetch(url, options);
  const requestedUuids = [];
  const storage = {
    linkDewMinecraftIdentity: async () => true,
    getDewMinecraftIdentity: async () => ({ playerUuid: canonicalPlayerUuid, username: 'OwnPlayer' }),
    getCosmetics: async (uuid) => {
      requestedUuids.push(uuid);
      return {
        version: 7,
        skin: { enabled: true, assetId: 'a'.repeat(64) },
        cape: null,
        elytra: null,
        metadata: {}
      };
    }
  };

  try {
    await withServer(storage, {}, async (baseUrl) => {
      const created = await fetch(`${baseUrl}/client/mod-sessions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer user-token', 'x-minecraft-access-token': 'minecraft-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sessionRequest, playerUuid: 'not-trusted' })
      });
      const token = (await created.json()).data.accessToken;
      const response = await fetch(`${baseUrl}/client/cosmetics/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(requestedUuids, [canonicalPlayerUuid]);
      assert.equal(result.data.player.dewUserId, 'dew-user-2');
      assert.equal(result.data.player.minecraftUuid, canonicalPlayerUuid);
      assert.equal(result.data.equipped.revision, 7);
      assert.equal(result.data.equipped.items[0].cosmeticId, `skin:${'a'.repeat(64)}`);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a valid device signature alone cannot publish cosmetics for a Minecraft UUID', async () => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const clientId = 'client-authorized-device';
  const foreignUuid = '22222222-2222-4222-8222-222222222222';
  const storage = {
    getClient: async (id) => id === clientId ? { id: clientId, publicKey } : null,
    getCosmetics: async () => null,
    saveCosmetics: async (uuid, data) => ({ playerUuid: uuid, ...data, version: 1 })
  };
  const body = JSON.stringify({
    expectedVersion: 0,
    playerUuid: foreignUuid,
    username: 'ForeignPlayer',
    skin: null,
    cape: null,
    elytra: null
  });
  const timestamp = String(Date.now());
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const signedPayload = `${clientId}:${timestamp}:${bodyHash}`;
  const signature = crypto.sign(null, Buffer.from(signedPayload), keys.privateKey).toString('hex');

  await withServer(storage, {}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/cosmetics/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dewclient-id': clientId,
        'x-dewclient-player-uuid': foreignUuid,
        'x-dewclient-timestamp': timestamp,
        'x-dewclient-signature': signature
      },
      body
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
  });
});

test('cosmetics publishing enforces Dew user, Minecraft profile, device key, signature, and replay binding', async () => {
  const originalFetch = globalThis.fetch;
  const userId = '11111111-aaaa-4aaa-8aaa-111111111111';
  const clientId = 'client-authorized-device';
  const alternateClientId = 'client-unapproved-device';
  const deviceKeys = crypto.generateKeyPairSync('ed25519');
  const forgedKeys = crypto.generateKeyPairSync('ed25519');
  const publicKey = deviceKeys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const alternatePublicKey = forgedKeys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const identities = new Map();
  const authorizations = new Map();
  const usedRequests = new Set();
  const cosmetics = new Map();
  const storage = {
    async getClient(id) {
      if (id === clientId) return { id, publicKey };
      if (id === alternateClientId) return { id, publicKey: alternatePublicKey };
      return null;
    },
    async authorizeCosmeticsPublish(id, uuid, username, deviceId, key) {
      const existing = identities.get(id);
      if (existing && existing !== uuid) return false;
      if ([...identities.entries()].some(([otherId, otherUuid]) => otherId !== id && otherUuid === uuid)) return false;
      if (deviceId !== clientId || key !== publicKey) return false;
      identities.set(id, uuid);
      authorizations.set(`${id}:${uuid}:${deviceId}`, key);
      return true;
    },
    async claimPublishRequest(deviceId, requestId) {
      const key = `${deviceId}:${requestId}`;
      if (usedRequests.has(key)) return false;
      usedRequests.add(key);
      return true;
    },
    async getCosmetics(uuid) { return structuredClone(cosmetics.get(uuid) || null); },
    async saveCosmetics(uuid, data, expectedVersion) {
      const existing = cosmetics.get(uuid);
      if ((existing?.version || 0) !== expectedVersion) return null;
      const saved = { playerUuid: uuid, ...structuredClone(data), version: (existing?.version || 0) + 1 };
      cosmetics.set(uuid, saved);
      return structuredClone(saved);
    }
  };

  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    if (String(url) === 'https://test-project.supabase.co/auth/v1/user') {
      return Response.json({ id: userId, email: 'user@example.test', user_metadata: { username: 'DewUser' } });
    }
    if (String(url) === 'https://api.minecraftservices.com/minecraft/profile') {
      const token = options.headers?.Authorization?.replace(/^Bearer\s+/i, '');
      if (token === 'invalid-token') return new Response('{}', { status: 401 });
      const id = token === 'other-profile-token'
        ? '22222222222242228222222222222222'
        : '11111111111141118111111111111111';
      return Response.json({ id, name: token === 'other-profile-token' ? 'OtherPlayer' : 'PlayerOne' });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  const makePublish = async (baseUrl, overrides = {}) => {
    const requestClientId = overrides.clientId || clientId;
    const playerUuid = overrides.playerUuid || canonicalPlayerUuid;
    const body = JSON.stringify({
      expectedVersion: overrides.expectedVersion ?? (cosmetics.get(playerUuid)?.version || 0),
      playerUuid,
      username: overrides.username || 'PlayerOne',
      skin: null,
      cape: null,
      elytra: null,
      metadata: overrides.metadata || {
        badge: 'Tester',
        accentColor: '#22cc88',
        accessToken: 'private-token-must-not-be-published',
        internalNotes: 'private note'
      }
    });
    const timestamp = overrides.timestamp || String(Date.now());
    const requestId = overrides.requestId || crypto.randomUUID();
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const signingKey = overrides.signingKey || deviceKeys.privateKey;
    const signature = overrides.signature || crypto.sign(null,
      Buffer.from(`${requestClientId}:${timestamp}:${requestId}:${bodyHash}`), signingKey
    ).toString('hex');
    return fetch(`${baseUrl}/cosmetics/publish`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-dew-token',
        'x-minecraft-access-token': overrides.minecraftToken || 'valid-minecraft-token',
        'x-dewclient-id': requestClientId,
        'x-dewclient-player-uuid': overrides.headerUuid || overrides.playerUuid || canonicalPlayerUuid,
        'x-dewclient-timestamp': timestamp,
        'x-dewclient-request-id': requestId,
        'x-dewclient-signature': signature,
        'Content-Type': 'application/json'
      },
      body
    });
  };

  try {
    await withServer(storage, {}, async (baseUrl) => {
      const valid = await makePublish(baseUrl);
      assert.equal(valid.status, 200, 'authenticated Dew user with verified canonical profile and device key can publish');
      assert.equal(identities.get(userId), canonicalPlayerUuid);
      assert.equal(authorizations.has(`${userId}:${canonicalPlayerUuid}:${clientId}`), true);
      const publicManifestResponse = await fetch(`${baseUrl}/cosmetics/player/${canonicalPlayerUuid}`);
      const publicManifest = await publicManifestResponse.json();
      assert.deepEqual(publicManifest.data.metadata, { badge: 'Tester', accentColor: '#22cc88' });
      assert.equal(JSON.stringify(publicManifest).includes('private-token-must-not-be-published'), false);

      const foreignUuid = await makePublish(baseUrl, { playerUuid: '22222222-2222-4222-8222-222222222222' });
      assert.equal(foreignUuid.status, 403, 'foreign UUID is rejected');

      const mismatchedUsername = await makePublish(baseUrl, { username: 'OtherPlayer' });
      assert.equal(mismatchedUsername.status, 403, 'username must match the UUID returned by Minecraft Services');

      const otherIdentity = await makePublish(baseUrl, {
        playerUuid: '22222222-2222-4222-8222-222222222222',
        headerUuid: '22222222-2222-4222-8222-222222222222',
        username: 'OtherPlayer',
        minecraftToken: 'other-profile-token'
      });
      assert.equal(otherIdentity.status, 403, 'one Dew account cannot switch its established Minecraft UUID');

      const unauthorizedClient = await makePublish(baseUrl, { clientId: alternateClientId, signingKey: forgedKeys.privateKey });
      assert.equal(unauthorizedClient.status, 403, 'a registered but unapproved client ID is rejected');

      const forgedSignature = await makePublish(baseUrl, { signingKey: forgedKeys.privateKey });
      assert.equal(forgedSignature.status, 401, 'a forged client identity cannot sign for the registered key');

      const staleRequest = await makePublish(baseUrl, { timestamp: String(Date.now() - 10 * 60 * 1000) });
      assert.equal(staleRequest.status, 401, 'stale timestamps are rejected');

      const invalidSignature = await makePublish(baseUrl, { signature: '0'.repeat(128) });
      assert.equal(invalidSignature.status, 401, 'invalid Ed25519 signatures are rejected');

      const replayId = crypto.randomUUID();
      const replayFirst = await makePublish(baseUrl, { requestId: replayId });
      assert.equal(replayFirst.status, 200);
      const replaySecond = await makePublish(baseUrl, { requestId: replayId });
      assert.equal(replaySecond.status, 409, 'a previously accepted signed request ID cannot be reused');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
