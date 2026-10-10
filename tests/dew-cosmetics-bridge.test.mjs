import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DewCosmeticsBridgeService } from '../electron/remote/dewCosmeticsBridgeService.ts';
import { DewCosmeticsSessionClient } from '../electron/remote/dewCosmeticsSessionClient.ts';
import { LaunchService } from '../electron/minecraft/launchService.ts';

test('per-instance cosmetics bridge is loopback-only and requires its launch token', async () => {
  const bridge = new DewCosmeticsBridgeService();
  const connection = await bridge.start({
    instanceId: 'instance-bridge-test',
    minecraftVersion: '26.3',
    modVersion: '0.3.0',
    apiBaseUrl: 'https://server.dewclient.fun/api/v1',
    session: null,
    cosmetics: {
      accountId: null,
      playerUuid: null,
      source: 'empty',
      manifest: null,
      skinPreviewUrl: null,
      capePreviewUrl: null,
      elytraPreviewUrl: null
    }
  });

  try {
    assert.match(connection.url, /^http:\/\/127\.0\.0\.1:/);
    const denied = await fetch(`${connection.url}/v1/mod/config`);
    assert.equal(denied.status, 401);

    const response = await fetch(`${connection.url}/v1/mod/config`, {
      headers: { Authorization: `Bearer ${connection.token}` }
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.data.instanceId, 'instance-bridge-test');
    assert.equal(result.data.minecraftVersion, '26.3');
    assert.equal(result.data.apiBaseUrl, 'https://server.dewclient.fun/api/v1');
    assert.deepEqual(result.data.equipped, { revision: 0, items: [] });
    assert.equal(result.data.session, null);
  } finally {
    await bridge.stop();
  }
});

test('Minecraft child process receives bridge discovery through its environment', async () => {
  const gameDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-env-test-'));
  const launchService = new LaunchService();
  let captured = '';
  try {
    await launchService.launchProcess(
      'bridge-env-test',
      process.execPath,
      ['-e', 'process.stdout.write(process.env.DEWCLIENT_BRIDGE_TOKEN || "")'],
      gameDirectory,
      undefined,
      (log) => { captured += log.message; },
      { env: { DEWCLIENT_BRIDGE_TOKEN: 'one-time-bridge-secret' } }
    );
    assert.equal(captured, '[STDOUT] one-time-bridge-secret');
  } finally {
    fs.rmSync(gameDirectory, { recursive: true, force: true });
  }
});

test('Electron creates a scoped mod session with the stored Dew access token', async () => {
  let request;
  const client = new DewCosmeticsSessionClient({
    accountStorage: {
      getAccounts: () => [],
      getAccountTokens: () => ({ accessToken: 'stored-dew-access-token', refreshToken: 'refresh', expiresAt: Date.now() + 60_000 })
    },
    settingsStorage: { getSettings: () => ({ remote: { enabled: true, serverUrl: 'https://server.dewclient.fun/api/v1' } }) },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return Response.json({ ok: true, data: {
        sessionId: 'session-1',
        accessToken: 'short-lived-mod-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        apiBaseUrl: 'https://server.dewclient.fun/api/v1',
        wsUrl: 'wss://server.dewclient.fun/api/v1/cosmetics/ws',
        protocolVersion: 1,
        heartbeatSeconds: 20
      } });
    }
  });
  const account = { id: 'offline-account-1', authUserId: 'dew-user-1' };
  const session = await client.createSession(account, {
    instanceId: 'instance-1',
    minecraftVersion: '26.3',
    modVersion: '0.3.0',
    protocolVersion: 1,
    loaderFamily: 'fabric',
    capabilities: ['skin', 'cape']
  }, 'minecraft-profile-token');

  assert.equal(request.url, 'https://server.dewclient.fun/api/v1/client/mod-sessions');
  assert.equal(request.options.headers.Authorization, 'Bearer stored-dew-access-token');
  assert.equal(request.options.headers['x-minecraft-access-token'], 'minecraft-profile-token');
  assert.equal(JSON.parse(request.options.body).instanceId, 'instance-1');
  assert.equal(session.accessToken, 'short-lived-mod-token');
});

test('Electron never sends a Dew access token to a renderer-configured API host', async () => {
  let fetchCalled = false;
  const client = new DewCosmeticsSessionClient({
    accountStorage: {
      getAccounts: () => [],
      getAccountTokens: () => ({ accessToken: 'must-not-leak', refreshToken: 'refresh', expiresAt: Date.now() + 60_000 })
    },
    settingsStorage: { getSettings: () => ({ remote: { enabled: true, serverUrl: 'https://attacker.example/api/v1' } }) },
    fetchImpl: async () => {
      fetchCalled = true;
      return Response.json({ ok: true });
    }
  });

  await assert.rejects(() => client.createSession({ id: 'offline-account-1', authUserId: 'dew-user-1' }, {
    instanceId: 'instance-1',
    minecraftVersion: '26.3',
    modVersion: '0.3.0',
    protocolVersion: 1,
    loaderFamily: 'fabric',
    capabilities: ['skin']
  }, 'minecraft-profile-token'), /Only the official DewClient API server/);
  assert.equal(fetchCalled, false);
});
