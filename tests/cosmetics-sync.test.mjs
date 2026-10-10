import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-desktop-cosmetics-'));
process.env.NODE_ENV = 'test';
process.env.APPDATA = path.join(testRoot, 'appdata');
process.env.DEWCLIENT_DATA_DIR = path.join(testRoot, 'server-data');
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_KEY = 'test-service-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.COSMETIC_ASSET_ENCRYPTION_KEY = '22'.repeat(32);

const { createApp, isServerEntrypoint } = await import('../server/src/index.mjs');
const { SupabaseStorageAdapter } = await import('../server/src/adapters/supabaseStorage.mjs');
const { getCosmeticStorage } = await import('../electron/storage/cosmeticStorage.ts');
const { getAccountStorage } = await import('../electron/storage/accountStorage.ts');
const { AccountStorage } = await import('../electron/storage/accountStorage.ts');
const { getSettingsStorage } = await import('../electron/storage/settingsStorage.ts');
const { getClientIdentityService } = await import('../electron/remote/clientIdentityService.ts');
const { getHeartbeatService } = await import('../electron/remote/heartbeatService.ts');
const { getPathManager } = await import('../electron/storage/paths.ts');
const { CosmeticsSyncService, FileCosmeticsSyncStateStore } = await import('../electron/remote/cosmeticsSyncService.ts');

class TestServerStorage {
  clients = new Map();
  cosmetics = new Map();
  assets = new Map();
  accounts = new Map();
  identities = new Map();
  deviceAuthorizations = new Map();
  publishRequests = new Set();

  async getClient(clientId) { return this.clients.get(clientId) || null; }
  async getClientByPublicKey(publicKey) {
    return [...this.clients.values()].find((client) => client.publicKey === publicKey) || null;
  }
  async saveClient(client) { this.clients.set(client.id, structuredClone(client)); return client; }
  async saveAccount(account) { this.accounts.set(account.uuid, structuredClone(account)); return account; }
  async authorizeCosmeticsPublish(userId, playerUuid, username, clientId, publicKey) {
    const currentIdentity = this.identities.get(userId);
    if (currentIdentity && currentIdentity.playerUuid !== playerUuid) return false;
    if ([...this.identities.entries()].some(([id, identity]) => id !== userId && identity.playerUuid === playerUuid)) return false;
    this.identities.set(userId, { playerUuid, username });
    const key = `${userId}:${playerUuid}:${clientId}`;
    const currentKey = this.deviceAuthorizations.get(key);
    if (currentKey && currentKey !== publicKey) return false;
    this.deviceAuthorizations.set(key, publicKey);
    return true;
  }
  async claimPublishRequest(clientId, requestId) {
    const key = `${clientId}:${requestId}`;
    if (this.publishRequests.has(key)) return false;
    this.publishRequests.add(key);
    return true;
  }
  async getAccounts({ limit = 100 } = {}) { return [...this.accounts.values()].slice(0, limit); }
  async getManifest() { return { updatedAt: new Date().toISOString() }; }
  async getCosmetics(playerUuid) { return structuredClone(this.cosmetics.get(playerUuid) || null); }
  async saveCosmetics(playerUuid, data, expectedVersion) {
    if ((this.cosmetics.get(playerUuid)?.version || 0) !== expectedVersion) return null;
    const saved = {
      playerUuid,
      ...structuredClone(data),
      version: (this.cosmetics.get(playerUuid)?.version || 0) + 1,
      updatedAt: new Date().toISOString()
    };
    this.cosmetics.set(playerUuid, saved);
    return structuredClone(saved);
  }
  async saveAsset(sha256, buffer, contentType) {
    this.assets.set(sha256, { buffer: Buffer.from(buffer), contentType });
  }
  async getAsset(sha256) {
    const asset = this.assets.get(sha256);
    return asset ? { buffer: Buffer.from(asset.buffer), contentType: asset.contentType } : null;
  }
  async isAssetAssigned(sha256) {
    return [...this.cosmetics.values()].some((entry) => [entry.skin, entry.cape, entry.elytra, ...(entry.metadata?.capes || []), ...(entry.metadata?.elytras || [])]
      .some((asset) => asset?.enabled === true && asset.sha256 === sha256));
  }
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPng(color, width = 64, height = 64) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      raw[offset++] = color[0];
      raw[offset++] = color[1];
      raw[offset++] = color[2];
      raw[offset++] = 255;
    }
  }

  const chunk = (name, payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    const type = Buffer.from(name, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([type, payload])));
    return Buffer.concat([length, type, payload, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function account(idPrefix, uuid, username) {
  const normalizedUuid = uuid.toLowerCase();
  return {
    id: `${idPrefix}-${normalizedUuid}`,
    uuid: normalizedUuid,
    username,
    type: idPrefix === 'ms' ? 'microsoft' : 'offline',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    ...(idPrefix === 'ms' ? { hasActiveSession: true, expiresAt: Date.now() + 60_000 } : {})
  };
}

function createTestDependencies({ root, activeAccount, fetchImpl, heartbeat = async () => true }) {
  const state = { version: 1, assets: {}, manifests: {}, pending: {} };
  const settings = {
    remote: {
      enabled: true,
      autoSync: true,
      serverUrl: 'http://127.0.0.1:8787/api/v1'
    }
  };
  const identity = {
    getClientId: () => '11111111-1111-4111-8111-222222222222',
    registerWithServer: async () => '11111111-1111-4111-8111-222222222222',
    signPayload: () => '0'.repeat(128)
  };
  const stateStore = {
    read: () => structuredClone(state),
    write: (next) => {
      state.version = next.version;
      state.assets = structuredClone(next.assets);
      state.manifests = structuredClone(next.manifests);
      state.pending = structuredClone(next.pending || {});
    }
  };
  const service = new CosmeticsSyncService({
    accountStorage: { getActiveAccount: () => activeAccount.value },
    settingsStorage: { getSettings: () => structuredClone(settings) },
    identityService: identity,
    heartbeatService: { sendHeartbeat: heartbeat },
    pathManager: { getRootPath: () => root },
    stateStore,
    fetchImpl,
    dewAccessTokenProvider: () => 'test-dew-access-token',
    minecraftAccessTokenProvider: async () => 'test-minecraft-access-token',
    timeoutMs: 20,
    retryDelaysMs: []
  });
  return { service, state, settings, identity };
}

after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('server entrypoint detection supports PM2 script paths without starting on import', () => {
  const serverPath = fileURLToPath(new URL('../server/src/index.mjs', import.meta.url));
  assert.equal(isServerEntrypoint(serverPath), true);
  assert.equal(isServerEntrypoint('/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js'), false);
});

test('server entrypoint detection accepts symlinked or normalized entry paths', () => {
  const serverPath = fileURLToPath(new URL('../server/src/index.mjs', import.meta.url));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-entry-link-'));
  const linkPath = path.join(tempDir, 'index-linked.mjs');

  try {
    fs.symlinkSync(serverPath, linkPath, 'file');
    assert.equal(isServerEntrypoint(linkPath), true);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
      assert.equal(isServerEntrypoint(path.resolve(serverPath, '..')), false);
      return;
    }
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('local cosmetic storage validates skin, cape, and elytra image layouts before saving', () => {
  const storage = getCosmeticStorage();
  const accountId = 'offline-cosmetic-validation';
  assert.throws(() => storage.saveBuffer(accountId, 'skin', createPng([1, 2, 3], 32, 64), '.png'), /does not match a supported image format/);
  assert.throws(() => storage.saveBuffer(accountId, 'elytra', createPng([1, 2, 3]), '.png'), /Wing textures must be/);
  assert.throws(() => storage.saveBuffer(accountId, 'skin', createPng([1, 2, 3]), '.jpg'), /does not match a supported image format/);
  assert.equal(storage.saveBuffer(accountId, 'skin', createPng([1, 2, 3]), '.png').path.endsWith('skin.png'), true);
  assert.equal(storage.saveBuffer(accountId, 'cape', createPng([1, 2, 3], 64, 32), '.png').path.endsWith('cape.png'), true);
  assert.equal(storage.saveBuffer(accountId, 'elytra', createPng([1, 2, 3], 128, 64), '.png').path.endsWith('elytra.png'), true);
});

test('local cosmetic storage keeps four independent skin slots and uniquely named official capes', () => {
  const storage = getCosmeticStorage();
  const accountId = 'offline-cosmetic-slots';
  const sourcePath = path.join(testRoot, 'skin-slot-source.png');
  fs.writeFileSync(sourcePath, createPng([20, 80, 140]));
  const skinSlots = Array.from({ length: 4 }, (_, slot) => storage.saveSkinSlot(accountId, slot, sourcePath));
  assert.equal(new Set(skinSlots.map((asset) => asset.path)).size, 4);
  assert.ok(skinSlots.every((asset) => fs.existsSync(asset.path)));
  assert.match(storage.getPreviewDataUrl(accountId, skinSlots[0].path, 'skin'), /^data:image\/png;base64,/);
  assert.throws(() => storage.getPreviewDataUrl(accountId, sourcePath, 'skin'), /Invalid local cosmetic preview path/);
  assert.throws(() => storage.saveSkinSlot(accountId, 4, sourcePath), /four skin slots/);

  const capeOne = storage.saveOfficialCape(accountId, 'cape-one', createPng([220, 20, 20], 64, 32), '.png');
  const capeTwo = storage.saveOfficialCape(accountId, 'cape-two', createPng([20, 20, 220], 64, 32), '.png');
  assert.notEqual(capeOne.path, capeTwo.path);
  assert.match(storage.getPreviewDataUrl(accountId, capeOne.path, 'cape'), /^data:image\/png;base64,/);
  assert.deepEqual(fs.readFileSync(capeOne.path), createPng([220, 20, 20], 64, 32));
  assert.deepEqual(fs.readFileSync(capeTwo.path), createPng([20, 20, 220], 64, 32));
});

test('custom skin slots remain local and are not automatically published', async () => {
  const root = getPathManager().getRootPath();
  const storage = getCosmeticStorage();
  const player = account('offline', '44444444-4444-4444-8444-444444444444', 'LocalSkinPlayer');
  const sourcePath = path.join(testRoot, 'local-only-skin.png');
  fs.writeFileSync(sourcePath, createPng([30, 120, 210]));
  const stored = storage.saveSkinSlot(player.id, 0, sourcePath);
  player.skinAssetPath = stored.path;
  player.cosmetics = {
    skinSource: 'custom',
    skinAssetPath: stored.path,
    skinSlots: [{ id: 'skin-1', name: 'Skin 1', assetPath: stored.path, previewUrl: '' }]
  };
  const requests = [];
  const dependencies = createTestDependencies({
    root,
    activeAccount: { value: player },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method || 'GET' });
      return new Response('', { status: 404 });
    }
  });

  const result = await dependencies.service.syncNow();
  assert.notEqual(result.status, 'published');
  assert.equal(requests.some((request) => request.url.endsWith('/cosmetics/publish')), false);
  assert.equal(dependencies.state.pending[`${dependencies.settings.remote.serverUrl}|${player.uuid}`]?.skin, undefined);
});

test('Supabase cosmetics writes are compare-and-swap operations', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const version = requests.length;
    return new Response(JSON.stringify(version < 3 ? [{
      player_uuid: '99999999-9999-4999-8999-999999999999',
      username: 'StoragePlayer',
      version,
      skin: null,
      cape: null,
      metadata: {},
      updated_at: new Date().toISOString()
    }] : []), { status: 200 });
  };

  try {
    const storage = new SupabaseStorageAdapter();
    const uuid = '99999999-9999-4999-8999-999999999999';
    assert.equal((await storage.saveCosmetics(uuid, { username: 'StoragePlayer' }, 0)).version, 1);
    assert.equal(requests[0].options.method, 'POST');

    assert.equal((await storage.saveCosmetics(uuid, { username: 'StoragePlayer' }, 1)).version, 2);
    assert.equal(requests[1].options.method, 'PATCH');
    assert.match(requests[1].url, /version=eq\.1$/);

    assert.equal(await storage.saveCosmetics(uuid, { username: 'StoragePlayer' }, 2), null);
    assert.match(requests[2].url, /version=eq\.2$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Supabase player-cosmetics lookup accepts the mod batch size of 128', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response('[]', { status: 200 });
  };

  try {
    const storage = new SupabaseStorageAdapter();
    const uuids = Array.from({ length: 128 }, (_, index) =>
      `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`);
    assert.deepEqual(await storage.getCosmeticsForPlayers(uuids), []);
    assert.match(requestedUrl, /limit=128$/);
    await assert.rejects(
      storage.getCosmeticsForPlayers([...uuids, 'ffffffff-0000-4000-8000-000000000000']),
      /up to 128 valid Minecraft UUIDs/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Supabase asset writes surface persistence failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('storage unavailable', { status: 503 });

  try {
    const storage = new SupabaseStorageAdapter();
    await assert.rejects(
      storage.saveAsset('a'.repeat(64), Buffer.from('asset')),
      /Supabase saveAsset failed \(503\)/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Supabase manifest storage returns an empty snapshot and rejects persistence failures', async () => {
  const originalFetch = globalThis.fetch;
  let failRead = false;
  let failWrite = false;
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'POST') return new Response('unavailable', { status: failWrite ? 503 : 201 });
    return failRead ? new Response('unavailable', { status: 503 }) : new Response('[]', { status: 200 });
  };

  try {
    const storage = new SupabaseStorageAdapter();
    const manifest = await storage.getManifest();
    assert.deepEqual(manifest.news, []);
    assert.deepEqual(manifest.announcements, []);
    assert.deepEqual(manifest.featuredServers, []);
    assert.equal(manifest.client.latestVersion, '');

    failWrite = true;
    await assert.rejects(storage.saveManifest({ news: [{ title: 'unpersisted' }] }), /manifest save failed \(503\)/);
    failWrite = false;
    failRead = true;
    await assert.rejects(storage.getManifest(), /manifest lookup failed \(503\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Supabase account storage distinguishes an empty database from a failed read', async () => {
  const originalFetch = globalThis.fetch;
  let failRead = false;
  globalThis.fetch = async () => failRead
    ? new Response('unavailable', { status: 503 })
    : new Response('[]', { status: 200 });

  try {
    const storage = new SupabaseStorageAdapter();
    assert.deepEqual(await storage.getAccounts(), []);
    failRead = true;
    await assert.rejects(storage.getAccounts(), /Supabase account lookup failed \(503\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Supabase statistics preserve real empty counts and reject failed reads', async () => {
  const originalFetch = globalThis.fetch;
  let failAccounts = false;
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (failAccounts && requestUrl.includes('/dew_accounts?')) {
      return new Response('unavailable', { status: 503 });
    }
    if (requestUrl.includes('/dew_manifest?')) return new Response('[]', { status: 200 });

    assert.equal(options.headers.Range, '0-0');
    assert.equal(options.headers['Range-Unit'], 'items');
    assert.equal(options.headers.Prefer, 'count=exact');
    const total = requestUrl.includes('/dew_clients?')
      ? (requestUrl.includes('last_seen_at=') ? 2 : 5)
      : requestUrl.includes('/dew_accounts?') ? 4 : 3;
    return new Response('', { status: 200, headers: { 'content-range': `0-0/${total}` } });
  };

  try {
    const storage = new SupabaseStorageAdapter();
    const stats = await storage.getStats();
    assert.equal(stats.totalAccounts, 4);
    assert.equal(stats.totalClients, 5);
    assert.equal(stats.onlineClients, 2);
    assert.equal(stats.cosmeticsCount, 3);

    failAccounts = true;
    await assert.rejects(storage.getStats(), /Supabase statistics lookup failed \(503\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Supabase client, account, and cosmetic storage separate no-match results from outages', async () => {
  const originalFetch = globalThis.fetch;
  let failReads = false;
  let failWrites = false;
  globalThis.fetch = async (_url, options = {}) => {
    if (failReads || (failWrites && options.method === 'POST')) {
      return new Response('unavailable', { status: 503 });
    }
    return new Response(options.method === 'POST' ? null : '[]', { status: options.method === 'POST' ? 201 : 200 });
  };

  try {
    const storage = new SupabaseStorageAdapter();
    assert.deepEqual(await storage.getClients(), []);
    assert.equal(await storage.getClient('missing'), null);
    assert.equal(await storage.getClientByPublicKey('missing'), null);
    assert.equal(await storage.getAccount('missing'), null);
    assert.equal(await storage.getCosmetics('missing'), null);
    assert.equal(await storage.getAsset('a'.repeat(64)), null);

    failReads = true;
    await assert.rejects(storage.getClients(), /Supabase client lookup failed \(503\)/);
    await assert.rejects(storage.getClient('missing'), /Supabase client lookup failed \(503\)/);
    await assert.rejects(storage.getClientByPublicKey('missing'), /Supabase client lookup failed \(503\)/);
    await assert.rejects(storage.getAccount('missing'), /Supabase account lookup failed \(503\)/);
    await assert.rejects(storage.getCosmetics('missing'), /Supabase cosmetics lookup failed \(503\)/);
    await assert.rejects(storage.getAsset('a'.repeat(64)), /Supabase asset lookup failed \(503\)/);

    failReads = false;
    failWrites = true;
    await assert.rejects(storage.saveClient({ id: 'client-test' }), /real client version is required/);
    await assert.rejects(storage.saveClient({ id: 'client-test', clientVersion: '1.0.0' }), /Supabase client save failed \(503\)/);
    await assert.rejects(storage.saveAccount({ uuid: 'player-test', username: 'Player' }), /real account UUID, username, and type are required/);
    await assert.rejects(storage.saveAccount({ uuid: 'player-test', username: 'Player', type: 'offline' }), /Supabase account save failed \(503\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('desktop publisher syncs active-account skin/cape/elytra bytes, reuses hashes, updates, removes, and isolates accounts', async () => {
  const serverStorage = new TestServerStorage();
  const server = createApp(serverStorage);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const networkFetch = globalThis.fetch.bind(globalThis);
  const publishRequests = [];
  const heartbeatBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/client/heartbeat')) heartbeatBodies.push(JSON.parse(String(init.body)));
    if (String(url) === 'https://test-project.supabase.co/auth/v1/user') {
      return Response.json({ id: 'dew-user-cosmetics-test', email: 'player@example.test', user_metadata: { username: 'DewPlayer' } });
    }
    if (String(url) === 'https://api.minecraftservices.com/minecraft/profile') {
      return Response.json({ id: '11111111111141118111111111111111', name: 'PlayerA' });
    }
    return networkFetch(url, init);
  };
  const trackedFetch = async (url, init = {}) => {
    if (String(url).endsWith('/cosmetics/publish')) {
      publishRequests.push({ url: String(url), body: JSON.parse(String(init.body)) });
    }
    return networkFetch(url, init);
  };

  try {
    const accountStorage = getAccountStorage();
    const settingsStorage = getSettingsStorage();
    const cosmeticStorage = getCosmeticStorage();
    const accountA = account('ms', '11111111-1111-4111-8111-111111111111', 'PlayerA');
    accountA.avatarUrl = 'data:image/png;base64,c2VjcmV0';
    const accountB = account('offline', '22222222-2222-4222-8222-222222222222', 'PlayerB');
    const sourceDir = path.join(testRoot, 'source-images');
    fs.mkdirSync(sourceDir, { recursive: true });
    const skinOriginal = createPng([220, 30, 40]);
    const skinReplacement = createPng([30, 210, 70]);
    const capeOriginal = createPng([220, 30, 40], 64, 32);
    const capeReplacement = createPng([210, 180, 20], 64, 32);
    const elytraOriginal = createPng([100, 40, 200], 64, 32);
    const skinSource = path.join(sourceDir, 'skin.png');
    const skinReplacementSource = path.join(sourceDir, 'skin-new.png');
    const capeSource = path.join(sourceDir, 'cape.png');
    const capeReplacementSource = path.join(sourceDir, 'cape-new.png');
    const elytraSource = path.join(sourceDir, 'elytra.png');
    fs.writeFileSync(skinSource, skinOriginal);
    fs.writeFileSync(skinReplacementSource, skinReplacement);
    fs.writeFileSync(capeSource, capeOriginal);
    fs.writeFileSync(capeReplacementSource, capeReplacement);
    fs.writeFileSync(elytraSource, elytraOriginal);

    const storedSkin = cosmeticStorage.save(accountA.id, 'skin', skinSource);
    const storedCape = cosmeticStorage.save(accountA.id, 'cape', capeSource);
    const storedElytra = cosmeticStorage.save(accountA.id, 'elytra', elytraSource);
    accountStorage.saveAccount({
      ...accountA,
      skinAssetPath: storedSkin.path,
      capeAssetPath: storedCape.path,
      elytraAssetPath: storedElytra.path,
      cosmetics: { skinAssetPath: storedSkin.path, capeAssetPath: storedCape.path, elytraAssetPath: storedElytra.path, badge: 'alpha', accentColor: '#22cc88' }
    });
    accountStorage.updateAccount(accountA.id, {
      id: accountB.id,
      uuid: accountB.uuid,
      username: accountB.username,
      type: accountB.type
    });
    assert.equal(accountStorage.getActiveAccount().id, accountA.id);
    assert.equal(accountStorage.getActiveAccount().uuid, accountA.uuid);
    accountStorage.setActiveAccount(accountA.id);
    settingsStorage.updateSettings({ remote: { enabled: true, autoSync: true, serverUrl: baseUrl } });

    const syncStatePath = path.join(testRoot, 'sync-state.json');
    const publisher = new CosmeticsSyncService({
      accountStorage,
      settingsStorage,
      identityService: getClientIdentityService(),
      heartbeatService: getHeartbeatService(),
      pathManager: getPathManager(),
      stateStore: new FileCosmeticsSyncStateStore(syncStatePath),
      dewAccessTokenProvider: () => 'test-dew-access-token',
      minecraftAccessTokenProvider: async () => 'test-minecraft-access-token',
      fetchImpl: trackedFetch,
      debounceMs: 1000
    });

    publisher.markPendingChange(accountA.id, 'skin', 'set');
    publisher.markPendingChange(accountA.id, 'cape', 'set');
    publisher.markPendingChange(accountA.id, 'elytra', 'set');
    assert.equal((await publisher.syncNow()).status, 'published');
    assert.equal(publishRequests.length, 1);
    assert.equal(publishRequests[0].body.playerUuid, accountA.uuid);
    assert.ok(publishRequests[0].body.skin.data);
    assert.ok(publishRequests[0].body.cape.data);
    assert.ok(publishRequests[0].body.elytra.data);
    assert.equal(JSON.stringify(publishRequests[0].body).includes(storedSkin.path), false);
    assert.equal(heartbeatBodies.length, 1);
    assert.equal(Array.isArray(heartbeatBodies[0].accounts), true);
    assert.equal(heartbeatBodies[0].accounts.some((entry) => entry.uuid === accountA.uuid), true);
    assert.doesNotMatch(JSON.stringify(heartbeatBodies[0]), /email|accessToken|refreshToken|password/i);
    assert.equal(serverStorage.accounts.size, 0);

    const manifestResponse = await networkFetch(`${baseUrl}/cosmetics/player/${accountA.uuid}`);
    assert.equal(manifestResponse.status, 200);
    const initialManifest = (await manifestResponse.json()).data;
    assert.equal(initialManifest.skin.sha256, crypto.createHash('sha256').update(skinOriginal).digest('hex'));
    assert.equal(initialManifest.cape.sha256, crypto.createHash('sha256').update(capeOriginal).digest('hex'));
    assert.equal(initialManifest.elytra.sha256, crypto.createHash('sha256').update(elytraOriginal).digest('hex'));
    const persistedManifest = Object.values(JSON.parse(fs.readFileSync(syncStatePath, 'utf8')).manifests)
      .find((entry) => entry.accountId === accountA.id);
    assert.equal(persistedManifest.elytra.sha256, initialManifest.elytra.sha256);

    const clientIdentity = getClientIdentityService();
    const concurrentBody = JSON.stringify({
      expectedVersion: initialManifest.version,
      playerUuid: accountA.uuid,
      username: accountA.username,
      skin: { assetId: initialManifest.skin.assetId, sha256: initialManifest.skin.sha256 },
      cape: { assetId: initialManifest.cape.assetId, sha256: initialManifest.cape.sha256 },
      metadata: initialManifest.metadata
    });
    const sendConcurrentPublish = () => {
      const timestamp = String(Date.now());
      const requestId = crypto.randomUUID();
      const bodyHash = crypto.createHash('sha256').update(concurrentBody).digest('hex');
      const signature = clientIdentity.signPayload(`${clientIdentity.getClientId()}:${timestamp}:${requestId}:${bodyHash}`);
      return networkFetch(`${baseUrl}/cosmetics/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-dew-access-token',
          'x-minecraft-access-token': 'test-minecraft-access-token',
          'x-dewclient-id': clientIdentity.getClientId(),
          'x-dewclient-player-uuid': accountA.uuid,
          'x-dewclient-timestamp': timestamp,
          'x-dewclient-request-id': requestId,
          'x-dewclient-signature': signature
        },
        body: concurrentBody
      });
    };
    const concurrentResults = await Promise.all([sendConcurrentPublish(), sendConcurrentPublish()]);
    assert.deepEqual(concurrentResults.map((response) => response.status).sort(), [200, 409]);

    const assetResponse = await networkFetch(`${baseUrl}/cosmetics/assets/${initialManifest.skin.assetId}`);
    const downloadedSkin = Buffer.from(await assetResponse.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(downloadedSkin).digest('hex'), initialManifest.skin.sha256);
    const canonicalRead = await publisher.getActiveCosmetics();
    assert.equal(canonicalRead.source, 'server');
    assert.equal(canonicalRead.manifest.skin.assetId, initialManifest.skin.assetId);
    assert.ok(canonicalRead.skinPreviewUrl);

    const firstPublishCount = publishRequests.length;
    assert.equal((await publisher.syncNow()).status, 'unchanged');
    assert.equal(publishRequests.length, firstPublishCount);
    assert.equal((await publisher.syncNow()).status, 'unchanged');
    assert.equal(publishRequests.length, firstPublishCount);

    const nextSkin = cosmeticStorage.save(accountA.id, 'skin', skinReplacementSource);
    accountStorage.updateAccount(accountA.id, {
      skinAssetPath: nextSkin.path,
      cosmetics: { ...accountStorage.getActiveAccount().cosmetics, skinAssetPath: nextSkin.path }
    });
    publisher.markPendingChange(accountA.id, 'skin', 'set');
    assert.equal((await publisher.syncNow()).status, 'published');
    let currentManifest = (await (await networkFetch(`${baseUrl}/cosmetics/player/${accountA.uuid}`)).json()).data;
    assert.notEqual(currentManifest.skin.assetId, initialManifest.skin.assetId);

    const nextCape = cosmeticStorage.save(accountA.id, 'cape', capeReplacementSource);
    accountStorage.updateAccount(accountA.id, {
      capeAssetPath: nextCape.path,
      cosmetics: { ...accountStorage.getActiveAccount().cosmetics, capeAssetPath: nextCape.path }
    });
    publisher.markPendingChange(accountA.id, 'cape', 'set');
    assert.equal((await publisher.syncNow()).status, 'published');
    currentManifest = (await (await networkFetch(`${baseUrl}/cosmetics/player/${accountA.uuid}`)).json()).data;
    assert.notEqual(currentManifest.cape.assetId, initialManifest.cape.assetId);

    publisher.markPendingChange(accountA.id, 'skin', 'remove');
    assert.equal((await publisher.syncNow()).status, 'published');
    assert.equal(fs.existsSync(nextSkin.path), true);
    currentManifest = (await (await networkFetch(`${baseUrl}/cosmetics/player/${accountA.uuid}`)).json()).data;
    assert.equal(currentManifest.skin.enabled, false);
    assert.equal(currentManifest.cape.enabled, true);

    publisher.markPendingChange(accountA.id, 'cape', 'remove');
    assert.equal((await publisher.syncNow()).status, 'published');
    assert.equal(fs.existsSync(nextCape.path), true);
    currentManifest = (await (await networkFetch(`${baseUrl}/cosmetics/player/${accountA.uuid}`)).json()).data;
    assert.equal(currentManifest.cape.enabled, false);

    const sameSkinForB = cosmeticStorage.save(accountB.id, 'skin', skinSource);
    accountStorage.saveAccount({ ...accountB, skinAssetPath: sameSkinForB.path, cosmetics: { skinAssetPath: sameSkinForB.path } });
    accountStorage.setActiveAccount(accountB.id);
    publisher.markPendingChange(accountB.id, 'skin', 'set');
    const publishBeforeB = publishRequests.length;
    assert.equal((await publisher.syncNow(accountA.uuid)).status, 'failed');
    assert.equal(publishRequests.length, publishBeforeB + 1);
    assert.equal(await serverStorage.getCosmetics(accountB.uuid), null);

    publisher.stop();
  } finally {
    globalThis.fetch = networkFetch;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('desktop publisher leaves local cosmetics intact on offline, timeout, 429, and server failures', async () => {
  const root = path.join(testRoot, 'failure-case');
  const uuid = '33333333-3333-4333-8333-333333333333';
  const activeAccount = { value: account('offline', uuid, 'RetryPlayer') };
  const accountDir = path.join(root, 'cosmetics', activeAccount.value.id);
  fs.mkdirSync(accountDir, { recursive: true });
  const localFile = path.join(accountDir, 'skin.png');
  fs.writeFileSync(localFile, createPng([100, 110, 120]));
  activeAccount.value.skinAssetPath = localFile;

  const failures = [
    ['offline', async () => { throw new Error('ECONNREFUSED'); }],
    ['timeout', (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))],
    ['429', async () => new Response('{}', { status: 429 })],
    ['500', async () => new Response('{}', { status: 500 })]
  ];

  for (const [_name, fetchImpl] of failures) {
    const { service, state } = createTestDependencies({ root, activeAccount, fetchImpl });
    const result = await service.syncNow();
    assert.equal(result.status, 'failed');
    assert.equal(fs.existsSync(localFile), true);
    assert.equal(state.manifests[`http://127.0.0.1:8787/api/v1|${uuid}`].status, 'failed');
  }
});

test('desktop publisher derives identity only from the active account and rejects inconsistent account records', async () => {
  const root = path.join(testRoot, 'identity-case');
  const activeAccount = { value: account('ms', '44444444-4444-4444-8444-444444444444', 'IdentityPlayer') };
  activeAccount.value.id = 'ms-55555555-5555-4555-8555-555555555555';
  let requests = 0;
  const { service } = createTestDependencies({
    root,
    activeAccount,
    fetchImpl: async () => {
      requests += 1;
      return new Response('{}', { status: 200 });
    }
  });

  const result = await service.syncNow('55555555-5555-4555-8555-555555555555');
  assert.equal(result.status, 'skipped');
  assert.equal(requests, 0);

  const badImageRoot = path.join(testRoot, 'invalid-image-case');
  const validAccount = account('offline', '66666666-6666-4666-8666-666666666666', 'InvalidImage');
  const accountDir = path.join(badImageRoot, 'cosmetics', validAccount.id);
  fs.mkdirSync(accountDir, { recursive: true });
  const invalidFile = path.join(accountDir, 'skin.png');
  fs.writeFileSync(invalidFile, Buffer.from('not an image'));
  validAccount.skinAssetPath = invalidFile;
  let networkRequests = 0;
  const invalidDependencies = createTestDependencies({
    root: badImageRoot,
    activeAccount: { value: validAccount },
    fetchImpl: async () => {
      networkRequests += 1;
      return new Response('{}', { status: 200 });
    }
  });
  assert.equal((await invalidDependencies.service.syncNow()).status, 'failed');
  assert.equal(networkRequests, 0);
  assert.equal(fs.existsSync(invalidFile), true);

  const accountStore = new AccountStorage(path.join(testRoot, 'immutable-accounts.json'));
  accountStore.saveAccount(account('offline', '77777777-7777-4777-8777-777777777777', 'Immutable'));
  const immutable = accountStore.getActiveAccount();
  accountStore.updateAccount(immutable.id, {
    id: 'offline-88888888-8888-4888-8888-888888888888',
    uuid: '88888888-8888-4888-8888-888888888888',
    username: 'Impersonated',
    type: 'microsoft'
  });
  assert.equal(accountStore.getActiveAccount().id, immutable.id);
  assert.equal(accountStore.getActiveAccount().uuid, immutable.uuid);
  assert.equal(accountStore.getActiveAccount().username, immutable.username);
});

test('launcher sync stores assigned cosmetics in the DewCosmetics bridge state and removes legacy CustomSkinLoader cache', async () => {
  const playerAccount = account('ms', '33333333-3333-4333-8333-333333333333', 'AssignedPlayer');
  const png = createPng([120, 40, 220]);
  const sha256 = crypto.createHash('sha256').update(png).digest('hex');
  let assignments = [{
    playerUuid: playerAccount.uuid,
    username: playerAccount.username,
    skin: { enabled: true, assetId: sha256, sha256, contentType: 'image/png' },
    cape: null,
    elytra: null
  }];
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/cosmetics/assigned')) {
      return new Response(JSON.stringify({ ok: true, data: assignments }), { status: 200 });
    }
    throw new Error(`Unexpected assigned cosmetics request: ${url}`);
  };
  const root = path.join(testRoot, 'assigned-cosmetics-client');
  const { service } = createTestDependencies({ root, activeAccount: { value: playerAccount }, fetchImpl });
  const gameDirectory = path.join(root, 'game');
  const legacySkinRoot = path.join(gameDirectory, 'CustomSkinLoader', 'LocalSkin', 'skins');
  fs.mkdirSync(legacySkinRoot, { recursive: true });
  fs.writeFileSync(path.join(legacySkinRoot, 'AssignedPlayer.png'), png);

  const firstSync = await service.syncAssignedCosmetics(gameDirectory);
  const statePath = path.join(gameDirectory, 'config', '.dewclient-cosmetics.json');
  assert.equal(firstSync.playersSynced, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')).entries[0].username, playerAccount.username);
  assert.equal(fs.existsSync(path.join(gameDirectory, 'CustomSkinLoader')), false);

  assignments = [];
  const secondSync = await service.syncAssignedCosmetics(gameDirectory);
  assert.equal(secondSync.playersSynced, 0);
  assert.equal(fs.existsSync(statePath), true);
});

test('desktop publisher sends an elytra-only update and caches it for local preview', async () => {
  const playerAccount = account('ms', '44444444-4444-4444-8444-444444444444', 'ElytraPlayer');
  const root = path.join(testRoot, 'elytra-only-client');
  const accountDir = path.join(root, 'cosmetics', playerAccount.id);
  fs.mkdirSync(accountDir, { recursive: true });
  const texture = createPng([90, 170, 230], 64, 32);
  const texturePath = path.join(accountDir, 'elytra.png');
  fs.writeFileSync(texturePath, texture);
  playerAccount.elytraAssetPath = texturePath;
  playerAccount.cosmetics = { elytraAssetPath: texturePath, elytraSource: 'custom' };

  const sha256 = crypto.createHash('sha256').update(texture).digest('hex');
  let serverManifest = null;
  let publishBody;
  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith(`/cosmetics/player/${playerAccount.uuid}`)) {
      return serverManifest
        ? new Response(JSON.stringify({ ok: true, data: serverManifest }), { status: 200 })
        : new Response(JSON.stringify({ ok: false }), { status: 404 });
    }
    if (String(url).endsWith('/cosmetics/publish')) {
      publishBody = JSON.parse(String(init.body || '{}'));
      serverManifest = {
        playerUuid: playerAccount.uuid,
        username: playerAccount.username,
        version: 1,
        updatedAt: new Date().toISOString(),
        skin: null,
        cape: null,
        elytra: { enabled: true, assetId: sha256, sha256, contentType: 'image/png', byteSize: texture.length, width: 64, height: 32 }
      };
      return new Response(JSON.stringify({ ok: true, data: { manifest: serverManifest } }), { status: 200 });
    }
    if (String(url).endsWith(`/cosmetics/assets/${sha256}`)) {
      return new Response(texture, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    throw new Error(`Unexpected cosmetics request: ${url}`);
  };
  const state = { version: 1, assets: {}, manifests: {}, pending: {} };
  const service = new CosmeticsSyncService({
    accountStorage: { getActiveAccount: () => playerAccount, getAccounts: () => [playerAccount], updateAccount: () => playerAccount },
    settingsStorage: { getSettings: () => ({ remote: { enabled: true, autoSync: true, serverUrl: 'https://server.dewclient.fun/api/v1' } }) },
    identityService: {
      getClientId: () => '11111111-1111-4111-8111-222222222222',
      registerWithServer: async () => '11111111-1111-4111-8111-222222222222',
      signPayload: () => '0'.repeat(128)
    },
    heartbeatService: { sendHeartbeat: async () => true },
    pathManager: { getRootPath: () => root, getCachePath: () => path.join(root, 'cache') },
    stateStore: {
      read: () => structuredClone(state),
      write: (next) => Object.assign(state, structuredClone(next))
    },
    dewAccessTokenProvider: () => 'test-dew-access-token',
    minecraftAccessTokenProvider: async () => 'test-minecraft-access-token',
    fetchImpl,
    timeoutMs: 100
  });

  service.markPendingChange(playerAccount.id, 'elytra', 'set');
  assert.equal((await service.syncNow()).status, 'published');
  assert.ok(publishBody.elytra.data);
  assert.equal(publishBody.skin, null);
  assert.equal(publishBody.cape, null);
  const preview = await service.getActiveCosmetics();
  assert.match(preview.elytraPreviewUrl, /^data:image\/png;base64,/);
  assert.deepEqual(Buffer.from(preview.elytraPreviewUrl.split(',')[1], 'base64'), texture);
});
