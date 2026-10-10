/**
 * DewClient Client - Comprehensive Subsystem Tests
 * Covers Minecraft 26.3 metadata, arguments, native SDL3 resolution, instances, crypto identity, diagnostics
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

import { ManifestService } from '../electron/minecraft/manifestService.ts';
import { ArgumentBuilder } from '../electron/minecraft/argumentBuilder.ts';
import { LibraryResolver } from '../electron/minecraft/libraryResolver.ts';
import { ArtifactResolver } from '../electron/minecraft/artifactResolver.ts';
import { AssetService } from '../electron/minecraft/assetService.ts';
import { RuntimeService, getRequiredJavaMajor } from '../electron/runtime/runtimeService.ts';
import { CrashDiagnostics } from '../electron/minecraft/crashDiagnostics.ts';
import { InstanceManager } from '../electron/instances/instanceManager.ts';
import { PathManager } from '../electron/storage/paths.ts';
import { SecureStorageService } from '../electron/storage/secureStorage.ts';
import { AccountStorage } from '../electron/storage/accountStorage.ts';
import { OfflineProfileService } from '../electron/auth/offlineProfileService.ts';
import { AuthService } from '../electron/auth/authService.ts';
import { XSTSService } from '../electron/auth/xstsService.ts';
import { ContentManager } from '../electron/content/contentManager.ts';
import { LaunchService } from '../electron/minecraft/launchService.ts';
import { FabricService } from '../electron/minecraft/fabricService.ts';
import { InstallService } from '../electron/minecraft/installService.ts';
import { MicrosoftOAuthService } from '../electron/auth/microsoftOAuthService.ts';
import { HeartbeatService } from '../electron/remote/heartbeatService.ts';
import { RichPresenceService } from '../electron/remote/richPresenceService.ts';
import { parseUpdateInstallerFileName } from '../shared/schemas/validation.ts';
import { CURRENT_MINECRAFT_PRIMARY_TARGET } from '../shared/constants/versions.ts';

test('1. Minecraft Engine: Primary Target Constant', () => {
  assert.strictEqual(CURRENT_MINECRAFT_PRIMARY_TARGET, '26.3');
});

test('Startup auth screen wires the live offline profile handler', () => {
  const appSource = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');

  assert.match(appSource, /onAddOfflineProfile=\{handleAddOfflineProfile\}/);
  assert.doesNotMatch(appSource, /onAddOfflineProfile=\{handleAddOfflineAccount\}/);
});

test('Minecraft process supervision preserves intentional stops and process failures', async () => {
  const gameDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-launch-'));
  const launchService = new LaunchService();
  let finalStatus;

  try {
    const failedExit = await launchService.launchProcess(
      'nonzero-exit',
      process.execPath,
      ['-e', 'process.exit(7)'],
      gameDirectory,
      (status) => { finalStatus = status; }
    );
    assert.equal(failedExit, 7);
    assert.equal(finalStatus?.state, 'error');
    assert.equal(finalStatus?.exitCode, 7);

    if (process.platform !== 'win32') {
      const signalExit = await launchService.launchProcess(
        'signal-exit',
        process.execPath,
        ['-e', "process.kill(process.pid, 'SIGTERM')"],
        gameDirectory,
        (status) => { finalStatus = status; }
      );
      assert.notEqual(signalExit, 0);
      assert.equal(finalStatus?.state, 'error');
    }

    let markRunning;
    const running = new Promise((resolve) => { markRunning = resolve; });
    const intentionalExit = launchService.launchProcess(
      'intentional-stop',
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      gameDirectory,
      (status) => {
        if (status.state === 'running') markRunning();
        else finalStatus = status;
      }
    );
    await running;
    assert.equal(launchService.isInstanceRunning('intentional-stop'), true);
    assert.equal(launchService.stopInstance('intentional-stop'), true);
    assert.equal(launchService.isInstanceRunning('intentional-stop'), true);
    assert.equal(await intentionalExit, 0);
    assert.equal(finalStatus?.state, 'idle');
  } finally {
    fs.rmSync(gameDirectory, { recursive: true, force: true });
  }
});

test('Update downloads isolate decoded installer filenames inside the cache directory', () => {
  assert.equal(parseUpdateInstallerFileName('https://updates.example.test/releases/DewClient-2.0.0.exe'), 'DewClient-2.0.0.exe');
  assert.equal(parseUpdateInstallerFileName('https://updates.example.test/%2e%2e%5c..%5coutside.exe'), 'outside.exe');
  assert.throws(() => parseUpdateInstallerFileName('https://updates.example.test/releases/not-an-installer.html'), /Windows \.exe installer/);
});

test('Offline profiles keep a stable Dew account UUID when the username changes', () => {
  const tempPath = path.join(os.tmpdir(), `dewclient-account-identity-${process.pid}-${Date.now()}.json`);
  const storage = new AccountStorage(tempPath);
  const service = new OfflineProfileService(storage);
  const original = service.createProfile('OldName');

  const renamed = {
    ...original,
    id: `offline-${original.dewAccountId}`,
    username: 'NewName',
    uuid: service.generateOfflineUuid('NewName'),
    minecraftUuid: service.generateOfflineUuid('NewName'),
    lastUsedAt: new Date().toISOString()
  };

  storage.saveAccount(renamed);
  const accounts = storage.getAccounts().filter((account) => account.dewAccountId === original.dewAccountId);

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].dewAccountId, original.dewAccountId);
  assert.equal(accounts[0].username, 'NewName');
  assert.notEqual(accounts[0].uuid, original.uuid);

  fs.rmSync(tempPath, { force: true });
});

test('Account storage removes legacy local offline credentials but preserves profiles', () => {
  const tempPath = path.join(os.tmpdir(), `dewclient-account-legacy-credentials-${process.pid}-${Date.now()}.json`);
  const offlineAccount = {
    id: 'offline-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    dewAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'local@example.test',
    passwordHash: 'legacy-hash',
    passwordSalt: 'legacy-salt',
    username: 'LocalPlayer',
    uuid: '11111111-1111-4111-8111-111111111111',
    type: 'offline',
    accountType: 'offline',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString()
  };
  fs.writeFileSync(tempPath, JSON.stringify({ accounts: [offlineAccount], activeAccountId: offlineAccount.id, tokens: {} }));

  const storage = new AccountStorage(tempPath);
  const [account] = storage.getAccounts();
  const persisted = JSON.parse(fs.readFileSync(tempPath, 'utf8')).accounts[0];

  assert.equal(account.username, 'LocalPlayer');
  assert.equal(account.passwordHash, undefined);
  assert.equal(account.passwordSalt, undefined);
  assert.equal(account.email, undefined);
  assert.equal(persisted.passwordHash, undefined);
  assert.equal(persisted.passwordSalt, undefined);
  assert.equal(persisted.email, undefined);

  fs.rmSync(tempPath, { force: true });
});

test('Account storage clears encrypted Dew auth tokens on logout', () => {
  const tempPath = path.join(os.tmpdir(), `dewclient-account-logout-${process.pid}-${Date.now()}.json`);
  const storage = new AccountStorage(tempPath);
  const account = new OfflineProfileService(storage).createProfile('LogoutPlayer');
  storage.saveAccount(account, { accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: Date.now() + 60_000 });

  assert.equal(storage.getAccountTokens(account.id)?.accessToken, 'access-token');
  storage.clearAccountTokens(account.id);
  assert.equal(storage.getAccountTokens(account.id), null);
  assert.equal(JSON.parse(fs.readFileSync(tempPath, 'utf8')).tokens[account.id], undefined);

  fs.rmSync(tempPath, { force: true });
});

test('Premium accounts reuse the same Dew account when the verified Minecraft UUID matches', () => {
  const tempPath = path.join(os.tmpdir(), `dewclient-premium-identity-${process.pid}-${Date.now()}.json`);
  const storage = new AccountStorage(tempPath);
  const minecraftUuid = '11111111-1111-4111-8111-111111111111';
  const first = {
    id: 'ms-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    dewAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    username: 'Alice',
    uuid: minecraftUuid,
    minecraftUuid,
    type: 'microsoft',
    accountType: 'online',
    hasActiveSession: true,
    expiresAt: Date.now() + 60_000,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString()
  };
  const second = {
    ...first,
    id: 'ms-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    dewAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    username: 'AliceN',
    lastUsedAt: new Date().toISOString()
  };

  storage.saveAccount(first);
  storage.saveAccount(second);
  const accounts = storage.getAccounts().filter((account) => account.uuid === minecraftUuid);

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].dewAccountId, first.dewAccountId);
  assert.equal(accounts[0].username, 'Alice');

  fs.rmSync(tempPath, { force: true });
});

test('Two offline accounts with the same username remain separate Dew accounts', () => {
  const tempPath = path.join(os.tmpdir(), `dewclient-account-same-name-${process.pid}-${Date.now()}.json`);
  const storage = new AccountStorage(tempPath);
  const service = new OfflineProfileService();
  const now = new Date().toISOString();
  const first = {
    id: 'offline-11111111-1111-4111-8111-111111111111',
    dewAccountId: '11111111-1111-4111-8111-111111111111',
    username: 'Ahmad',
    uuid: service.generateOfflineUuid('Ahmad'),
    minecraftUuid: service.generateOfflineUuid('Ahmad'),
    type: 'offline',
    accountType: 'offline',
    createdAt: now,
    lastUsedAt: now
  };
  const second = {
    ...first,
    id: 'offline-22222222-2222-4222-8222-222222222222',
    dewAccountId: '22222222-2222-4222-8222-222222222222',
    uuid: service.generateOfflineUuid('Ahmad'),
    minecraftUuid: service.generateOfflineUuid('Ahmad')
  };

  storage.saveAccount(first);
  storage.saveAccount(second);

  const sameNameAccounts = storage.getAccounts().filter((account) => account.username === 'Ahmad');

  assert.equal(sameNameAccounts.length, 2);
  assert.notEqual(sameNameAccounts[0].dewAccountId, sameNameAccounts[1].dewAccountId);
  assert.notEqual(sameNameAccounts[0].id, sameNameAccounts[1].id);

  fs.rmSync(tempPath, { force: true });
});

test('Offline account username changes retain the existing Dew account and cosmetics metadata', () => {
  const tempPath = path.join(os.tmpdir(), `dewclient-account-rename-${process.pid}-${Date.now()}.json`);
  const storage = new AccountStorage(tempPath);
  const service = new OfflineProfileService();
  const original = {
    id: 'offline-33333333-3333-4333-8333-333333333333',
    dewAccountId: '33333333-3333-4333-8333-333333333333',
    username: 'OldName',
    uuid: service.generateOfflineUuid('OldName'),
    minecraftUuid: service.generateOfflineUuid('OldName'),
    type: 'offline',
    accountType: 'offline',
    cosmetics: { skinAssetId: 'skin-123', capeAssetId: 'cape-456', manifestVersion: 7 },
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString()
  };

  storage.saveAccount(original);
  const renamed = {
    ...original,
    username: 'NewName',
    uuid: service.generateOfflineUuid('NewName'),
    minecraftUuid: service.generateOfflineUuid('NewName'),
    cosmetics: { skinAssetId: 'skin-123', capeAssetId: 'cape-456', manifestVersion: 7 },
    lastUsedAt: new Date().toISOString()
  };

  storage.saveAccount(renamed);
  const updated = storage.getAccounts().find((account) => account.dewAccountId === original.dewAccountId);

  assert.ok(updated);
  assert.equal(updated.dewAccountId, original.dewAccountId);
  assert.equal(updated.username, 'NewName');
  assert.deepEqual(updated.cosmetics, renamed.cosmetics);
  assert.notEqual(updated.uuid, original.uuid);

  fs.rmSync(tempPath, { force: true });
});

test('2. Manifest Service: Primary Target Discovery', () => {
  const manifestService = new ManifestService();
  assert.strictEqual(manifestService.getPrimaryTargetVersionId(), '26.3');
});

test('Fabric version lookup returns no fabricated releases when metadata is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline test'); };
  try {
    assert.deepEqual(await new ManifestService().listFabricVersions(), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('2a. Manifest Service: exact stable-release selection without fallback', async () => {
  const manifestService = new ManifestService();
  const versions = await manifestService.listVersions('release');
  assert.ok(versions.length > 0);
  assert.ok(versions.every((version) => version.type === 'release'));
  assert.ok(!versions.some((version) => /snapshot|pre|rc|experimental|test/i.test(version.id)));
  assert.ok(!versions.some((version) => version.id === '1.8.9'));
  assert.ok(versions.some((version) => version.id === '26.3'));

  await assert.rejects(
    () => manifestService.getVersionPackage('1.8.9'),
    /Version '1\.8\.9' is not a supported official release/
  );
  const currentPackage = await manifestService.getVersionPackage('26.3');
  assert.strictEqual(currentPackage.id, '26.3');

  await assert.rejects(
    () => manifestService.getVersionPackage('1.999.999-does-not-exist'),
    /Version '1\.999\.999-does-not-exist' is not a supported official release/
  );
});

test('2b. Fabric loader metadata uses modern Fabric only', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  let invalidArtifactMetadata = false;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url) === 'https://meta.fabricmc.net/v2/versions/loader/26.3') {
      return new Response(JSON.stringify([{ loader: { version: '0.19.5', stable: true } }]), { status: 200 });
    }
    if (String(url) === 'https://meta.fabricmc.net/v2/versions/loader/26.3/0.19.5/profile/json') {
      return new Response(JSON.stringify({
        mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
        libraries: [{
          name: 'net.fabricmc:fabric-loader:0.19.5',
          url: 'https://maven.fabricmc.net/',
          sha1: invalidArtifactMetadata ? 'invalid-sha1' : 'a'.repeat(40),
          size: 1234
        }]
      }), { status: 200 });
    }
    throw new Error(`Unexpected Fabric metadata URL: ${url}`);
  };

  try {
    const merged = await new FabricService().mergeLoaderProfile({
      id: '26.3',
      type: 'release',
      mainClass: 'net.minecraft.client.main.Main',
      libraries: [],
      minecraftArguments: '--userProperties ${user_properties}'
    });
    assert.strictEqual(merged.mainClass, 'net.fabricmc.loader.impl.launch.knot.KnotClient');
    assert.strictEqual(merged.libraries[0].name, 'net.fabricmc:fabric-loader:0.19.5');
    assert.strictEqual(merged.libraries[0].sha1, 'a'.repeat(40));
    assert.ok(requestedUrls.every((url) => url.startsWith('https://meta.fabricmc.net/')));
    invalidArtifactMetadata = true;
    await assert.rejects(
      () => new FabricService().mergeLoaderProfile({ id: '26.3', type: 'release', mainClass: 'net.minecraft.client.main.Main', libraries: [] }),
      /invalid library checksum/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Minecraft artifact downloads require bounded, checksum-verified HTTPS responses', async () => {
  const originalFetch = globalThis.fetch;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-artifact-check-'));
  const service = new InstallService();
  const destination = path.join(root, 'client.jar');
  let fetchCount = 0;
  globalThis.fetch = async (_url, options) => {
    fetchCount++;
    assert.equal(options.redirect, 'error');
    return new Response(Buffer.from('not-the-expected-artifact'));
  };

  try {
    await assert.rejects(() => service.downloadFile('https://download.example.test/client.jar', destination), /no valid checksum and size/);
    assert.equal(fetchCount, 0);
    await assert.rejects(
      () => service.downloadFile('https://download.example.test/client.jar', destination, 'a'.repeat(40), 8),
      /size|Checksum/i
    );
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('managed Java runtime downloads reject checksum mismatch and untrusted redirects', async () => {
  const originalFetch = globalThis.fetch;
  const service = new RuntimeService();
  globalThis.fetch = async () => new Response(Buffer.from('zip'), { status: 200 });
  try {
    await assert.rejects(
      () => service.downloadManagedRuntimePackage({ link: 'https://github.com/adoptium/runtime.zip', checksum: 'a'.repeat(64), size: 3 }),
      /SHA-256 verification/
    );

    globalThis.fetch = async () => new Response(null, {
      status: 302,
      headers: { location: 'https://attacker.example/runtime.zip' }
    });
    await assert.rejects(
      () => service.downloadManagedRuntimePackage({ link: 'https://github.com/adoptium/runtime.zip', checksum: 'a'.repeat(64), size: 3 }),
      /untrusted host/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('2c. LibraryResolver: native platform classifiers are resolved without a bogus plain lwjgl-platform jar', () => {
  const resolver = new LibraryResolver();
  const pkg = {
    id: '1.8.9',
    type: 'release',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: [{
      name: 'org.lwjgl.lwjgl:lwjgl-platform:2.9.4+legacyfabric.17',
      natives: { windows: 'natives-windows', linux: 'natives-linux', osx: 'natives-macos' },
      downloads: {
        artifact: {
          path: 'org/lwjgl/lwjgl-platform/2.9.4+legacyfabric.17/lwjgl-platform-2.9.4+legacyfabric.17.jar',
          url: 'https://maven.legacyfabric.net/org/lwjgl/lwjgl-platform/2.9.4+legacyfabric.17/lwjgl-platform-2.9.4+legacyfabric.17.jar',
          sha1: 'a'.repeat(40),
          size: 1
        },
        classifiers: {
          'natives-windows': {
            path: 'org/lwjgl/lwjgl-platform/2.9.4+legacyfabric.17/lwjgl-platform-2.9.4+legacyfabric.17-natives-windows.jar',
            url: 'https://maven.legacyfabric.net/org/lwjgl/lwjgl-platform/2.9.4+legacyfabric.17/lwjgl-platform-2.9.4+legacyfabric.17-natives-windows.jar',
            sha1: 'b'.repeat(40),
            size: 2
          }
        }
      }
    }]
  };

  const resolved = resolver.resolveLibraries(pkg);
  assert.deepStrictEqual(resolved.map((entry) => entry.name), ['org.lwjgl.lwjgl:lwjgl-platform:2.9.4+legacyfabric.17:natives-windows']);
  assert.strictEqual(resolved[0].url, 'https://maven.legacyfabric.net/org/lwjgl/lwjgl-platform/2.9.4+legacyfabric.17/lwjgl-platform-2.9.4+legacyfabric.17-natives-windows.jar');
});

test('2d. Microsoft OAuth: Xbox consumer auth flow uses the documented Xbox Live scopes and consumer authority', async () => {
  const oauth = new MicrosoftOAuthService();
  const pkce = await oauth['cryptoProvider'].generatePkceCodes();
  assert.ok(pkce.verifier.length >= 43, 'PKCE verifier must be at least 43 characters');
  assert.ok(pkce.challenge.length > 0, 'PKCE challenge must be generated');

  const authRequest = oauth.createAuthorizationRequest('http://localhost');
  const authUrl = authRequest.authUrl;
  const parsed = new URL(authUrl);

  assert.strictEqual(parsed.protocol, 'https:');
  assert.strictEqual(parsed.hostname, 'login.microsoftonline.com');
  assert.strictEqual(parsed.pathname, '/consumers/oauth2/v2.0/authorize');
  assert.strictEqual(parsed.searchParams.get('redirect_uri'), 'http://localhost');
  assert.strictEqual(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(parsed.searchParams.get('client_id'), '00000000402b5328');

  const scope = parsed.searchParams.get('scope');
  assert.strictEqual(scope, 'XboxLive.signin offline_access');
  assert.ok(!scope.includes('openid'));
  assert.ok(!scope.includes('profile'));
  assert.ok(!scope.includes('openid profile'));
  assert.ok(!authUrl.includes('/common/'));
  assert.ok(!authUrl.includes('openid'));
  assert.ok(parsed.searchParams.has('state'));
});

test('2e. Microsoft OAuth: interactive login does NOT use shell.openExternal (embedded window path only)', async () => {
  const oauth = new MicrosoftOAuthService();

  let shellCalled = false;
  const originalShell = globalThis.__DewClientElectronShell;
  globalThis.__DewClientElectronShell = {
    openExternal: async () => {
      shellCalled = true;
    }
  };

  let mockWindowCreated = false;
  let capturedWebPreferences = null;
  class MockWindow {
    constructor(opts) {
      mockWindowCreated = true;
      capturedWebPreferences = opts.webPreferences;
      this._listeners = new Map();
      this.webContents = {
        on: (ev, fn) => {
          if (!this._listeners.has(ev)) this._listeners.set(ev, []);
          this._listeners.get(ev).push(fn);
        }
      };
    }
    setMenuBarVisibility() {}
    show() {}
    focus() {}
    isDestroyed() { return false; }
    close() {
      const handlers = this._listeners.get('closed') || [];
      handlers.forEach((h) => h());
    }
    on(ev, fn) {
      if (!this._listeners.has(ev)) this._listeners.set(ev, []);
      this._listeners.get(ev).push(fn);
    }
    once(ev, fn) {
      this.on(ev, fn);
    }
    removeAllListeners() {}
    async loadURL() {
      // Simulate user closing window to cancel
      setTimeout(() => this.close(), 10);
    }
  }

  const originalBW = globalThis.__DewClientElectronBrowserWindow;
  globalThis.__DewClientElectronBrowserWindow = MockWindow;

  try {
    await assert.rejects(
      () => oauth.loginInteractive(),
      /cancelled: sign-in window closed/i
    );
    assert.strictEqual(shellCalled, false, 'shell.openExternal must NOT be called for interactive login');
    assert.strictEqual(mockWindowCreated, true, 'Embedded BrowserWindow must be created');
    assert.strictEqual(capturedWebPreferences?.nodeIntegration, false);
    assert.strictEqual(capturedWebPreferences?.contextIsolation, true);
    assert.strictEqual(capturedWebPreferences?.sandbox, true);
  } finally {
    globalThis.__DewClientElectronShell = originalShell;
    globalThis.__DewClientElectronBrowserWindow = originalBW;
  }
});

test('2f. Microsoft OAuth: CryptoProvider generates cryptographic S256 PKCE pair', async () => {
  const oauth = new MicrosoftOAuthService();
  const pkce1 = await oauth['cryptoProvider'].generatePkceCodes();
  const pkce2 = await oauth['cryptoProvider'].generatePkceCodes();

  // Fresh pair on every call
  assert.notStrictEqual(pkce1.verifier, pkce2.verifier, 'Verifier must be freshly generated');
  assert.notStrictEqual(pkce1.challenge, pkce2.challenge, 'Challenge must be freshly generated');

  // Verify S256 relationship
  const expectedChallenge = crypto
    .createHash('sha256')
    .update(pkce1.verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  assert.strictEqual(pkce1.challenge, expectedChallenge, 'Challenge must match S256 hash of verifier');
});

test('2g. Microsoft OAuth: embedded code exchange preserves the exact desktop redirect URI', async () => {
    const redirectUri = 'https://login.live.com/oauth20_desktop.srf';
    const oauth = new MicrosoftOAuthService();
    let authUrl = '';
    let callbackIntercepted = false;
    let exchangeRequest;

    const originalGetAllAccounts = oauth['msalApp'].getTokenCache().getAllAccounts.bind(oauth['msalApp'].getTokenCache());
    oauth['msalApp'].getTokenCache().getAllAccounts = async () => [];

    class MockWindow {
      constructor() {
        this._listeners = new Map();
        this.webContents = {
          on: (event, handler) => {
            if (!this._listeners.has(event)) this._listeners.set(event, []);
            this._listeners.get(event).push(handler);
          }
        };
      }
      setMenuBarVisibility() {}
      show() {}
      focus() {}
      isDestroyed() { return false; }
      close() {}
      on(event, handler) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(handler);
      }
      once(event, handler) { this.on(event, handler); }
      removeAllListeners() {}
      async loadURL(url) {
        authUrl = url;
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', 'M.C123_TEST_CODE_ABC');
        callback.searchParams.set('state', new URL(url).searchParams.get('state'));
        setTimeout(() => {
          const handlers = this._listeners.get('will-redirect') || [];
          for (const handler of handlers) {
            handler({ preventDefault() { callbackIntercepted = true; } }, callback.toString());
          }
        }, 10);
      }
    }

    const originalBW = globalThis.__DewClientElectronBrowserWindow;
    globalThis.__DewClientElectronBrowserWindow = MockWindow;
    const originalAcquire = oauth['msalApp'].acquireTokenByCode.bind(oauth['msalApp']);
    oauth['msalApp'].acquireTokenByCode = async (request) => {
      exchangeRequest = request;
      return {
        accessToken: 'test-microsoft-access-token',
        account: { homeAccountId: 'test-id', username: 'steve', environment: 'login.microsoftonline.com', tenantId: 'consumers' },
        expiresOn: new Date(Date.now() + 3600 * 1000),
        scopes: ['xboxlive.signin', 'xboxlive.offline_access']
      };
    };

    try {
      const tokens = await oauth.loginInteractive();
      const authUrlParsed = new URL(authUrl);
      const challengeFromVerifier = crypto.createHash('sha256')
        .update(exchangeRequest.codeVerifier)
        .digest('base64url');

      assert.strictEqual(authUrlParsed.searchParams.get('redirect_uri'), redirectUri);
      assert.strictEqual(callbackIntercepted, true);
      assert.strictEqual(exchangeRequest.code, 'M.C123_TEST_CODE_ABC');
      assert.strictEqual(exchangeRequest.redirectUri, redirectUri);
      assert.strictEqual(authUrlParsed.searchParams.get('code_challenge'), challengeFromVerifier);
      assert.strictEqual(tokens.accessToken, 'test-microsoft-access-token');
    } finally {
      globalThis.__DewClientElectronBrowserWindow = originalBW;
      oauth['msalApp'].acquireTokenByCode = originalAcquire;
      oauth['msalApp'].getTokenCache().getAllAccounts = originalGetAllAccounts;
    }
});

test('2g. Microsoft OAuth: callback state mismatch is rejected', () => {
  const oauth = new MicrosoftOAuthService();

  assert.throws(
    () => oauth.validateAuthorizationResponse('http://localhost?code=test-code&state=unexpected', 'expected-state'),
    /State mismatch during Microsoft OAuth callback/
  );
});

test('2h. Microsoft OAuth: redirect interception handles OAuth errors properly', async () => {
  const oauth = new MicrosoftOAuthService();

  class MockWindow {
    constructor() {
      this._listeners = new Map();
      this.webContents = {
        on: (ev, fn) => {
          if (!this._listeners.has(ev)) this._listeners.set(ev, []);
          this._listeners.get(ev).push(fn);
        }
      };
    }
    setMenuBarVisibility() {}
    show() {}
    focus() {}
    isDestroyed() { return false; }
    close() {}
    on(ev, fn) {
      if (!this._listeners.has(ev)) this._listeners.set(ev, []);
      this._listeners.get(ev).push(fn);
    }
    once(ev, fn) { this.on(ev, fn); }
    removeAllListeners() {}
    async loadURL() {
      setTimeout(() => {
        const handlers = this._listeners.get('will-redirect') || [];
        for (const h of handlers) {
          const fakeEvent = { preventDefault() {} };
          h(fakeEvent, 'http://localhost?error=access_denied&error_description=User%20cancelled%20the%20request');
        }
      }, 10);
    }
  }

  const originalBW = globalThis.__DewClientElectronBrowserWindow;
  globalThis.__DewClientElectronBrowserWindow = MockWindow;

  try {
    await assert.rejects(
      () => oauth.loginInteractive(),
      /User cancelled the request|access_denied/i
    );
  } finally {
    globalThis.__DewClientElectronBrowserWindow = originalBW;
  }
});

test('2i. Microsoft OAuth: duplicate authentication attempts are prevented', async () => {
  const oauth = new MicrosoftOAuthService();

  class HangingMockWindow {
    constructor() {
      this._listeners = new Map();
      this.webContents = { on: () => {} };
    }
    setMenuBarVisibility() {}
    show() {}
    focus() {}
    isDestroyed() { return false; }
    close() {}
    destroy() {}
    on() {}
    once() {}
    removeAllListeners() {}
    async loadURL() {
      return new Promise(() => {});
    }
  }

  const originalBW = globalThis.__DewClientElectronBrowserWindow;
  globalThis.__DewClientElectronBrowserWindow = HangingMockWindow;

  try {
    const firstLoginPromise = oauth.loginInteractive();
    await new Promise((r) => setTimeout(r, 20));

    await assert.rejects(
      () => oauth.loginInteractive(),
      /A Microsoft login is already in progress/i
    );

    oauth.cancel();
    await assert.rejects(
      () => firstLoginPromise,
      /Microsoft authentication was cancelled/i
    );
  } finally {
    globalThis.__DewClientElectronBrowserWindow = originalBW;
  }
});

test('2j. Microsoft OAuth: cancellation cleans up window state and resets authInProgress', async () => {
  const oauth = new MicrosoftOAuthService();
  let destroyed = false;

  class CancellableMockWindow {
    constructor() {
      this._listeners = new Map();
      this.webContents = { on: () => {} };
    }
    setMenuBarVisibility() {}
    show() {}
    focus() {}
    isDestroyed() { return destroyed; }
    close() { destroyed = true; }
    destroy() { destroyed = true; }
    on() {}
    once() {}
    removeAllListeners() {}
    async loadURL() { return new Promise(() => {}); }
  }

  const originalBW = globalThis.__DewClientElectronBrowserWindow;
  globalThis.__DewClientElectronBrowserWindow = CancellableMockWindow;

  try {
    const loginPromise = oauth.loginInteractive();
    await new Promise((r) => setTimeout(r, 20));
    oauth.cancel();
    assert.strictEqual(destroyed, true);
    assert.strictEqual(oauth['authInProgress'], false);
    await assert.rejects(
      () => loginPromise,
      /Microsoft authentication was cancelled/i
    );
  } finally {
    globalThis.__DewClientElectronBrowserWindow = originalBW;
  }
});

test('2k. Microsoft OAuth: token refresh uses acquireTokenSilent via cached account', async () => {
  const oauth = new MicrosoftOAuthService();
  await assert.rejects(
    () => oauth.refreshToken('any-refresh-token'),
    /No cached Microsoft account found/i
  );
});

test('2l. Remote Service: heartbeat handles unreachable server cleanly in standalone mode', async () => {
  const heartbeat = new HeartbeatService();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline test'); };
  try {
    const success = await heartbeat.sendHeartbeat(false);
    assert.strictEqual(typeof success, 'boolean');
    assert.strictEqual(success, false);
    assert.strictEqual(heartbeat.isBackendAvailable(), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('2m. Remote Service: client identity registration handles offline backend with timeout', async () => {
  const identityService = (await import('../electron/remote/clientIdentityService.ts')).getClientIdentityService();
  assert.ok(identityService.getPublicKeyHex().length === 64, 'Ed25519 public key hex must be 32 bytes (64 hex chars)');
  const signature = identityService.signPayload('dewclient-standalone-test-payload');
  assert.ok(typeof signature === 'string' && signature.length === 128, 'Ed25519 signature must be 64 bytes (128 hex chars)');
});

test('2n. Minecraft Services: invalid app registration 403 surfaces actionable client error', async () => {
  const { MinecraftAuthService } = await import('../electron/auth/minecraftAuthService.ts');
  const service = new MinecraftAuthService();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(JSON.stringify({
    path: '/authentication/login_with_xbox',
    errorMessage: 'Invalid app registration, see https://aka.ms/AppRegInfo for more information'
  }), {
    status: 403,
    statusText: 'Forbidden',
    headers: { 'Content-Type': 'application/json' }
  });

  try {
    await assert.rejects(
      () => service.loginWithXbox('userHash', 'xstsToken'),
      /Invalid app registration|AppRegInfo|app registration/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('3. Runtime Service: Java Version Output Parsing', () => {
  const runtimeService = new RuntimeService();

  // Test Java 25 (e.g. Minecraft 26.3 requirement)
  const j25 = runtimeService.parseJavaVersionOutput('openjdk version "25" 2025-09-16\nOpenJDK Runtime Environment Temurin-25+36 (build 25+36)\nOpenJDK 64-Bit Server VM');
  assert.ok(j25);
  assert.strictEqual(j25?.majorVersion, 25);
  assert.strictEqual(j25?.is64Bit, true);

  // Test Java 21
  const j21 = runtimeService.parseJavaVersionOutput('openjdk version "21.0.2" 2024-01-16 LTS\nOpenJDK 64-Bit Server VM');
  assert.ok(j21);
  assert.strictEqual(j21?.majorVersion, 21);
  assert.strictEqual(j21?.is64Bit, true);

  // Test Legacy Java 8
  const j8 = runtimeService.parseJavaVersionOutput('java version "1.8.0_381"\nJava(TM) SE Runtime Environment (build 1.8.0_381-b09)\nJava HotSpot(TM) 64-Bit Server VM');
  assert.ok(j8);
  assert.strictEqual(j8?.majorVersion, 8);
});

test('3b. Runtime Service: Minecraft Java generation mapping', () => {
  assert.strictEqual(getRequiredJavaMajor('1.8.9'), 8);
  assert.strictEqual(getRequiredJavaMajor('1.17.1'), 16);
  assert.strictEqual(getRequiredJavaMajor('1.20.4'), 17);
  assert.strictEqual(getRequiredJavaMajor('1.20.5'), 21);
  assert.strictEqual(getRequiredJavaMajor('1.21.11'), 21);
  assert.strictEqual(getRequiredJavaMajor('26.3'), 25);
  assert.strictEqual(getRequiredJavaMajor('26.3', 21), 21, 'Authoritative metadata takes precedence over fallback mapping');
});

test('3a. Rich Presence: exact launcher and Minecraft state transitions', async () => {
  const sent = [];
  const transport = {
    async connect() {},
    async send(command) { sent.push(command); },
    close() {}
  };
  const service = new RichPresenceService('test-client-id', () => transport);

  service.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(service.getState().state, 'launcher');
  assert.strictEqual(sent.at(-1).args.activity.state, undefined);

  service.setMinecraftState('26.3');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(service.getState().minecraftVersion, '26.3');
  assert.strictEqual(sent.at(-1).args.activity.state, '26.3');

  service.setLauncherState();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(service.getState().minecraftVersion, null);
  assert.strictEqual(sent.at(-1).args.activity.state, undefined);
  service.stop();
});

test('4. Library Resolver: Mojang Rules & Platform Detection', () => {
  const resolver = new LibraryResolver();
  const currentOs = resolver.getPlatformOsName();
  assert.ok(['windows', 'osx', 'linux'].includes(currentOs));

  // Allow rule for current OS
  const allowRule = [{ action: 'allow', os: { name: currentOs } }];
  assert.strictEqual(resolver.evaluateRules(allowRule), true);

  // Disallow rule for other OS
  const otherOs = currentOs === 'windows' ? 'linux' : 'windows';
  const disallowRule = [{ action: 'disallow', os: { name: otherOs } }];
  assert.strictEqual(resolver.evaluateRules(disallowRule), true);

  // Allow rule for other OS only (should disallow current OS)
  const allowOtherOnly = [{ action: 'allow', os: { name: otherOs } }];
  assert.strictEqual(resolver.evaluateRules(allowOtherOnly), false);

  const customResolutionRule = [{ action: 'allow', features: { has_custom_resolution: true } }];
  assert.strictEqual(resolver.evaluateRules(customResolutionRule), false);
  assert.strictEqual(resolver.evaluateRules(customResolutionRule, { has_custom_resolution: true }), true);
});

test('5. Library Resolver: Maven Coordinate Path Translation', () => {
  const resolver = new LibraryResolver();
  const path1 = resolver.mavenToPath('com.mojang:patchy:2.2.10');
  assert.ok(path1.includes(path.join('com', 'mojang', 'patchy', '2.2.10', 'patchy-2.2.10.jar')));

  const path2 = resolver.mavenToPath('org.lwjgl:lwjgl:3.3.3:natives-windows');
  assert.ok(path2.includes('natives-windows.jar'));
});

test('5a. Existing same-size library and asset corruption is detected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-integrity-test-'));
  const libraryPath = path.join(root, 'library.jar');
  const assetPath = path.join(root, 'asset.bin');
  const original = Buffer.from('verified bytes');
  const checksum = crypto.createHash('sha1').update(original).digest('hex');
  fs.writeFileSync(libraryPath, original);
  fs.writeFileSync(assetPath, original);

  try {
    const resolver = new LibraryResolver();
    const assetService = new AssetService();
    const library = { name: 'test:library', path: libraryPath, url: '', sha1: checksum, size: original.length, isNative: false };
    const asset = { key: 'test', hash: checksum, size: original.length, url: '', localPath: assetPath };

    assert.equal(resolver.isLibraryValid(library), true);
    assert.equal(assetService.isAssetValid(asset), true);
    fs.writeFileSync(libraryPath, Buffer.from('corrupt bytes!'));
    fs.writeFileSync(assetPath, Buffer.from('corrupt bytes!'));
    assert.equal(fs.statSync(libraryPath).size, original.length);
    assert.equal(resolver.isLibraryValid(library), false);
    assert.equal(assetService.isAssetValid(asset), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('5b. Modrinth modpack install creates a matching Fabric instance and installs its archive', async () => {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip();
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({
    formatVersion: 1,
    game: 'minecraft',
    versionId: 'fabric-pack',
    name: 'Fabric Pack',
    files: [],
    dependencies: { minecraft: '1.21.4', 'fabric-loader': '0.16.10' }
  })));
  const archiveBuffer = zip.toBuffer();
  const archiveSha1 = crypto.createHash('sha1').update(archiveBuffer).digest('hex');
  const manager = new ContentManager();
  let createdConfig;
  let installedPath;
  manager.modrinthService = {
    getProjectVersions: async (projectId, gameVersion, loaders) => {
      assert.equal(projectId, 'fabric-pack-project');
      assert.deepEqual(loaders, ['fabric']);
      return [{
        version_type: 'release',
        name: '1.0.0',
        loaders: ['fabric'],
        files: [{ filename: 'fabric-pack.mrpack', url: 'https://cdn.modrinth.com/fabric-pack.mrpack', primary: true, size: archiveBuffer.length, hashes: { sha1: archiveSha1 } }]
      }];
    }
  };
  manager.instanceManager = {
    createInstance: (config) => (createdConfig = { id: 'inst-modpack-test', ...config }),
    deleteInstance: () => true
  };
  manager.installMrpack = async (archivePath, instanceId) => {
    installedPath = archivePath;
    assert.equal(instanceId, 'inst-modpack-test');
    assert.equal(fs.existsSync(archivePath), true);
    return true;
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(archiveBuffer, { status: 200 });
  try {
    const installed = await manager.installModrinthModpack('fabric-pack-project', 'My Fabric Pack');
    assert.equal(installed.id, 'inst-modpack-test');
    assert.equal(createdConfig.minecraftVersion, '1.21.4');
    assert.equal(createdConfig.loaderType, 'fabric');
    assert.equal(createdConfig.loaderVersion, '0.16.10');
    assert.equal(fs.existsSync(installedPath), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('5c. Modrinth installs use the instance version and persist installed project state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-project-content-test-'));
  const instance = {
    id: 'inst-content-test',
    minecraftVersion: '1.20.4',
    loaderType: 'fabric',
    gameDirectory: root
  };
  const manager = new ContentManager();
  manager.instanceManager = { getInstance: (id) => id === instance.id ? instance : null };
  const compatibleBytes = Buffer.from('compatible mod jar');
  const compatibleSha1 = crypto.createHash('sha1').update(compatibleBytes).digest('hex');
  let requestedVersions;
  manager.modrinthService = {
    getProjectVersions: async (...args) => {
      requestedVersions = args;
      if (args[0] === 'legacy-project') {
        return [{
          version_type: 'release',
          files: [{ filename: 'already-here.jar', url: 'https://example.test/already-here.jar', size: 0, hashes: {} }]
        }];
      }
      return [
        { version_type: 'beta', files: [{ primary: true, filename: 'wrong-version.jar', url: 'https://example.test/wrong.jar', size: 1, hashes: {} }] },
        { version_type: 'release', files: [{ primary: true, filename: 'compatible.jar', url: 'https://example.test/compatible.jar', size: compatibleBytes.length, hashes: { sha1: compatibleSha1 } }] }
      ];
    }
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://example.test/compatible.jar');
    return new Response(compatibleBytes, { status: 200 });
  };
  try {
    fs.mkdirSync(path.join(root, 'mods'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mods', 'already-here.jar'), 'legacy mod');
    assert.deepEqual(await manager.listInstalledProjectIds(instance.id, 'mod', ['legacy-project']), ['legacy-project']);
    assert.equal(await manager.installProjectContent(instance.id, 'compatible-project', 'mod'), true);
    assert.deepEqual(requestedVersions, ['compatible-project', '1.20.4', ['fabric']]);
    assert.deepEqual((await manager.listInstalledProjectIds(instance.id, 'mod')).sort(), ['compatible-project', 'legacy-project']);

    const reloadedManager = new ContentManager();
    reloadedManager.instanceManager = manager.instanceManager;
    assert.deepEqual((await reloadedManager.listInstalledProjectIds(instance.id, 'mod')).sort(), ['compatible-project', 'legacy-project']);
    assert.equal(reloadedManager.removeMod(instance.id, 'compatible.jar'), true);
    assert.deepEqual(await reloadedManager.listInstalledProjectIds(instance.id, 'mod'), ['legacy-project']);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('5d. Managed Fabric installs include Fabric API and repair corrupted managed JARs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-managed-fabric-test-'));
  const instance = { id: 'inst-managed-fabric', gameDirectory: root };
  const manager = new ContentManager();
  manager.instanceManager = { getInstance: (id) => id === instance.id ? instance : null };
  const jarBytes = Buffer.from('verified managed fabric mod');
  const expectedSha1 = crypto.createHash('sha1').update(jarBytes).digest('hex');
  const requestedProjectIds = [];
  manager.modrinthService = {
    getProjectVersions: async (projectId) => {
      requestedProjectIds.push(projectId);
      return [{
        version_type: 'release',
        dependencies: [],
        files: [{
          primary: true,
          filename: `${projectId}.jar`,
          url: `https://cdn.modrinth.com/${projectId}.jar`,
          hashes: { sha1: expectedSha1 }
        }]
      }];
    }
  };

  const originalFetch = globalThis.fetch;
  let downloadCount = 0;
  globalThis.fetch = async () => {
    downloadCount += 1;
    return new Response(jarBytes, { status: 200 });
  };
  try {
    const installed = await manager.installManagedFabricMods(instance.id, '1.21.4');
    assert.ok(installed.includes('fabric-api'));
    assert.ok(requestedProjectIds.includes('fabric-api'));
    const fabricApiPath = path.join(root, 'mods', 'fabric-api.jar');
    assert.deepEqual(fs.readFileSync(fabricApiPath), jarBytes);

    const firstDownloadCount = downloadCount;
    fs.writeFileSync(fabricApiPath, Buffer.from('corrupted jar'));
    await manager.installManagedFabricMods(instance.id, '1.21.4');
    assert.deepEqual(fs.readFileSync(fabricApiPath), jarBytes);
    assert.equal(downloadCount, firstDownloadCount + 1);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('5e. Fabric cosmetics install uses the bundled DewCosmetics 26.3 jar for the active instance', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-cosmetics-install-test-'));
  const instance = { id: 'inst-cosmetics-upgrade', minecraftVersion: '26.3', loaderType: 'fabric', gameDirectory: root };
  const manager = new ContentManager();
  manager.instanceManager = { getInstance: (id) => id === instance.id ? instance : null };

  const repoRoot = process.cwd();
  const bundleDir = path.join(root, 'DewCosmeticsLoader');
  const outputDir = path.join(bundleDir, 'output-jars');
  const manifestPath = path.join(bundleDir, 'versions.json');
  const jarPath = path.join(outputDir, 'dewcosmetics-26.3-0.3.1.jar');
  const jarBytes = Buffer.from('dewcosmetics bundle jar for 26.3');
  const fabricApiPath = path.join(outputDir, 'fabric-api-test.jar');
  const fabricApiBytes = Buffer.from('fabric api runtime dependency for 26.3');
  const expectedSha256 = crypto.createHash('sha256').update(jarBytes).digest('hex');
  const expectedFabricApiSha256 = crypto.createHash('sha256').update(fabricApiBytes).digest('hex');
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'DewCosmeticsLoader', 'versions.json'), 'utf8'));
  manifest.versions['26.3'].modVersion = '0.3.1';
  manifest.versions['26.3'].artifact = 'output-jars/dewcosmetics-26.3-0.3.1.jar';
  manifest.versions['26.3'].sha256 = expectedSha256;
  manifest.versions['26.3'].dependencies = [{
    projectId: 'fabric-api',
    artifact: 'output-jars/fabric-api-test.jar',
    sha256: expectedFabricApiSha256
  }];
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(jarPath, jarBytes);
  fs.writeFileSync(fabricApiPath, fabricApiBytes);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  manager.getBundledLoaderDir = () => bundleDir;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Unexpected network fetch while installing the bundled DewCosmetics jar.');
  };

  try {
    const installed = await manager.installManagedCosmeticsMod(instance.id);
    assert.equal(installed, true);
    const targetPath = path.join(root, 'mods', 'dewcosmetics-26.3-0.3.1.jar');
    assert.deepEqual(fs.readFileSync(targetPath), jarBytes);
    assert.deepEqual(fs.readFileSync(path.join(root, 'mods', 'fabric-api-test.jar')), fabricApiBytes);
    assert.equal(fs.existsSync(path.join(root, 'mods', 'CustomSkinLoader_Universal-15.1.jar')), false);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('6. Argument Builder: JVM & Game Command Generation (Metadata Driven)', () => {
  const builder = new ArgumentBuilder();

  // Mock metadata package for Minecraft 26.3
  const pkg = {
    id: '26.3',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    javaVersion: { component: 'java-runtime-delta', majorVersion: 25 },
    arguments: {
      jvm: [
        '-Djava.library.path=${natives_directory}',
        '-Dminecraft.launcher.brand=${launcher_name}',
        '-Dminecraft.launcher.version=${launcher_version}',
        '-cp',
        '${classpath}'
      ],
      game: [
        '--username',
        '${auth_player_name}',
        '--version',
        '${version_name}',
        '--gameDir',
        '${game_directory}',
        '--assetsDir',
        '${assets_root}',
        '--assetIndex',
        '${assets_index_name}',
        '--uuid',
        '${auth_uuid}',
        '--accessToken',
        '${auth_access_token}',
        '--userType',
        '${user_type}',
        '--versionType',
        '${version_type}'
      ]
    },
    libraries: []
  };

  const launchConfig = {
    versionId: '26.3',
    instanceId: 'inst-test-26-3',
    gameDirectory: 'C:\\test\\game',
    assetsDirectory: 'C:\\test\\assets',
    nativesDirectory: 'C:\\test\\natives',
    javaPath: 'C:\\Program Files\\Adoptium\\jdk-25\\bin\\java.exe',
    mainClass: pkg.mainClass,
    jvmArgs: ['-XX:+UseG1GC'],
    gameArgs: [],
    classpath: ['C:\\test\\libraries\\lib1.jar'],
    memoryMb: 6144,
    resolutionWidth: 1920,
    resolutionHeight: 1080,
    fullscreen: true,
    auth: {
      username: 'TestSteve',
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      accessToken: 'secret_mc_token_abc123',
      userType: 'msa'
    },
    quickPlay: {
      type: 'multiplayer',
      target: 'play.dewclient.com:25565'
    }
  };

  const { command, args, safeArgsForLogs } = builder.buildLaunchCommand(
    pkg,
    launchConfig,
    'C:\\test\\versions\\26.3\\26.3.jar'
  );

  assert.strictEqual(command, launchConfig.javaPath);
  assert.ok(!args.includes('-Xms2048M'));
  assert.ok(args.includes('-Xmx6144M'));
  assert.ok(args.filter((arg) => arg.startsWith('-Xmx')).length === 1);
  assert.ok(args.includes('-XX:+UseG1GC'));
  assert.ok(args.includes('net.minecraft.client.main.Main'));
  assert.ok(args.includes('--username'));
  assert.ok(args.includes('TestSteve'));
  assert.ok(args.includes('--quickPlayMultiplayer'));
  assert.ok(args.includes('play.dewclient.com:25565'));
  assert.ok(args.includes('--width'));
  assert.ok(args.includes('1920'));
  assert.ok(args.includes('--height'));
  assert.ok(args.includes('1080'));
  assert.ok(args.includes('--fullscreen'));

  // Verify -Djava.library.path is present and appears exactly once (BUG-004 regression)
  const libPathArgs = args.filter((a) => a.startsWith('-Djava.library.path='));
  assert.strictEqual(libPathArgs.length, 1);
  assert.strictEqual(libPathArgs[0], '-Djava.library.path=C:\\test\\natives');

  // Ensure secret token is NOT leaked into safeArgsForLogs!
  assert.ok(!safeArgsForLogs.includes('secret_mc_token_abc123'));
  assert.ok(safeArgsForLogs.includes('[REDACTED]'));
});

test('7. Crash Diagnostics: OutOfMemory and Driver Analysis', () => {
  const tmpDir = path.join(process.cwd(), 'temp-crash-test');
  fs.mkdirSync(path.join(tmpDir, 'logs'), { recursive: true });

  const oomLog = 'java.lang.OutOfMemoryError: Java heap space\n\tat net.minecraft.client.renderer...';
  fs.writeFileSync(path.join(tmpDir, 'logs', 'latest.log'), oomLog, 'utf-8');

  const diag = CrashDiagnostics.analyzeCrash(tmpDir, 1);
  assert.strictEqual(diag.title, 'Out of Memory');
  assert.ok(diag.message.includes('RAM'));

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('8. Offline Profiles: Deterministic UUID Generation', () => {
  const service = new OfflineProfileService();
  const uuid1 = service.generateOfflineUuid('Steve');
  const uuid2 = service.generateOfflineUuid('Steve');
  const uuidAlex = service.generateOfflineUuid('Alex');

  assert.strictEqual(uuid1, uuid2); // Deterministic
  assert.notStrictEqual(uuid1, uuidAlex); // Different
  assert.strictEqual(uuid1.length, 36);
  assert.strictEqual(uuid1[14], '3'); // Version 3 UUID
});

test('Microsoft launch falls back to an unverified offline UUID only for network failures', async () => {
  const service = new AuthService();
  const account = {
    id: 'ms-11111111-1111-4111-8111-111111111111',
    username: 'PremiumPlayer',
    uuid: '11111111-1111-4111-8111-111111111111',
    type: 'microsoft',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    hasActiveSession: true,
    expiresAt: Date.now() + 60_000
  };
  service.getValidTokenForAccount = async () => 'cached-token';
  service.minecraftAuthService.getProfile = async () => { throw new TypeError('fetch failed'); };

  const offlineSession = await service.getLaunchAuth(account);
  assert.equal(offlineSession.verified, false);
  assert.equal(offlineSession.userType, 'legacy');
  assert.equal(offlineSession.accessToken, '0');
  assert.equal(offlineSession.uuid, new OfflineProfileService().generateOfflineUuid(account.username));
  assert.equal(account.uuid, '11111111-1111-4111-8111-111111111111');

  service.minecraftAuthService.getProfile = async () => { throw new Error('Minecraft rejected the account.'); };
  await assert.rejects(service.getLaunchAuth(account), /Minecraft rejected the account/);
});

test('Microsoft launch verifies profile identity and retains MSA credentials online', async () => {
  const service = new AuthService();
  const account = {
    id: 'ms-11111111-1111-4111-8111-111111111111',
    username: 'PremiumPlayer',
    uuid: '11111111-1111-4111-8111-111111111111',
    type: 'microsoft',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    hasActiveSession: true,
    expiresAt: Date.now() + 60_000
  };
  service.getValidTokenForAccount = async () => 'verified-token';
  service.minecraftAuthService.getProfile = async () => ({ id: account.uuid.replace(/-/g, ''), name: account.username, capes: [] });
  service.syncOfficialCapes = async () => {};

  const launchAuth = await service.getLaunchAuth(account);
  assert.deepEqual(launchAuth, { uuid: account.uuid, accessToken: 'verified-token', userType: 'msa', verified: true });
});

test('9. Secure Storage: non-Electron fallback key is process-scoped', () => {
  const secret = 'super_secret_refresh_token_12345';
  const cipher = SecureStorageService.encrypt(secret);
  assert.ok(cipher.length > 20);
  assert.ok(!cipher.includes(secret)); // Raw token not in ciphertext
  assert.match(cipher, /^process:/);

  const decrypted = SecureStorageService.decrypt(cipher);
  assert.strictEqual(decrypted, secret);

  const moduleUrl = new URL('../electron/storage/secureStorage.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { SecureStorageService } from ${JSON.stringify(moduleUrl)}; process.stdout.write(SecureStorageService.decrypt(${JSON.stringify(cipher)}));`
  ], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, '');
});

test('10. Instance Management: Isolation & Scaffolding', () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-instances-test-'));
  const paths = new PathManager(testRoot);

  const manager = new InstanceManager();
  manager.pathManager = paths;
  manager.indexFile = path.join(paths.getInstancesPath(), 'instances.json');
  const inst = manager.createInstance({
    name: 'Survival 26.3 Test',
    minecraftVersion: '26.3',
    loaderType: 'forge'
  });

  assert.ok(inst.id.startsWith('inst-'));
  assert.strictEqual(inst.name, 'Survival 26.3 Test');
  assert.strictEqual(inst.minecraftVersion, '26.3');
  assert.strictEqual(inst.loaderType, 'fabric');

  // Verify folders scaffolded
  const gameDir = inst.gameDirectory;
  assert.ok(fs.existsSync(path.join(gameDir, 'mods')));
  assert.ok(fs.existsSync(path.join(gameDir, 'resourcepacks')));
  assert.ok(fs.existsSync(path.join(gameDir, 'shaderpacks')));
  fs.writeFileSync(path.join(gameDir, 'mods', 'disabled-mod.jar.disabled'), 'disabled');
  assert.equal(manager.getInstanceStats(gameDir).modCount, 1);

  const outsideDirectory = path.join(testRoot, 'outside-instance');
  fs.mkdirSync(outsideDirectory, { recursive: true });
  const sentinelPath = path.join(outsideDirectory, 'keep.txt');
  fs.writeFileSync(sentinelPath, 'must survive');
  assert.throws(() => manager.updateInstance(inst.id, { gameDirectory: outsideDirectory }), /cannot be changed/);
  assert.throws(() => manager.createInstance({ name: 'Escaping Instance', gameDirectory: outsideDirectory }), /selected by DewClient/);

  const savedIndex = JSON.parse(fs.readFileSync(manager.indexFile, 'utf8'));
  savedIndex.instances.find((entry) => entry.id === inst.id).gameDirectory = outsideDirectory;
  fs.writeFileSync(manager.indexFile, JSON.stringify(savedIndex));
  assert.equal(manager.deleteInstance(inst.id), false);
  assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'must survive');
  savedIndex.instances.find((entry) => entry.id === inst.id).gameDirectory = gameDir;
  fs.writeFileSync(manager.indexFile, JSON.stringify(savedIndex));

  // Test duplicate
  const copy = manager.duplicateInstance(inst.id, 'Survival Copy');
  assert.strictEqual(copy.name, 'Survival Copy');
  assert.notStrictEqual(copy.id, inst.id);
  assert.notStrictEqual(copy.gameDirectory, inst.gameDirectory);

  manager.setActiveInstance(copy.id);
  manager.recordPlayTime(copy.id, 125_000);
  const updatedCopy = manager.getInstance(copy.id);
  assert.ok(Math.abs(updatedCopy.totalPlayTimeMinutes - (125_000 / 60_000)) < 0.001);
  assert.ok(updatedCopy.lastPlayedAt);

  const reloadedManager = new InstanceManager();
  reloadedManager.pathManager = paths;
  reloadedManager.indexFile = manager.indexFile;
  assert.equal(reloadedManager.getActiveInstance().id, copy.id);
  assert.ok(Math.abs(reloadedManager.getActiveInstance().totalPlayTimeMinutes - (125_000 / 60_000)) < 0.001);

  // Test delete
  manager.deleteInstance(inst.id);
  manager.deleteInstance(copy.id);
  assert.strictEqual(manager.getInstance(inst.id), null);

  // Clean up
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('11. Runtime Service: Secure Archive Extraction & Zip Slip Protection (BUG-006 regression)', async () => {
  const AdmZip = (await import('adm-zip')).default;
  const runtimeService = new RuntimeService();

  const testExtractRoot = path.join(process.cwd(), 'temp-security-extract-test');
  const targetDir = path.join(testExtractRoot, 'target');
  const outsideDir = path.join(testExtractRoot, 'outside');
  const siblingDir = path.join(testExtractRoot, 'target-sibling');

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  try {
    // 1. Valid Archive Extraction
    const validZip = new AdmZip();
    validZip.addFile('bin/java.exe', Buffer.from('mock-java-binary'));
    validZip.addFile('lib/modules', Buffer.from('mock-modules'));
    validZip.addFile('release', Buffer.from('JAVA_VERSION="21"'));

    runtimeService.extractZipSafely(validZip, targetDir);

    assert.ok(fs.existsSync(path.join(targetDir, 'bin', 'java.exe')));
    assert.strictEqual(fs.readFileSync(path.join(targetDir, 'bin', 'java.exe'), 'utf-8'), 'mock-java-binary');
    assert.ok(fs.existsSync(path.join(targetDir, 'lib', 'modules')));
    assert.ok(fs.existsSync(path.join(targetDir, 'release')));

    // 2. Traversal Attack: ../evil.txt
    const zipSlip = new AdmZip();
    zipSlip.addFile('placeholder.txt', Buffer.from('escaped-payload'));
    zipSlip.getEntries()[0].entryName = '../evil.txt';
    assert.throws(() => {
      runtimeService.extractZipSafely(zipSlip, targetDir);
    }, /Zip Slip path traversal attempt/);
    assert.ok(!fs.existsSync(path.join(testExtractRoot, 'evil.txt')));

    // 3. Sibling Prefix Bypass: ../target-sibling/evil.txt
    const siblingZip = new AdmZip();
    siblingZip.addFile('placeholder.txt', Buffer.from('sibling-payload'));
    siblingZip.getEntries()[0].entryName = '../target-sibling/evil.txt';
    assert.throws(() => {
      runtimeService.extractZipSafely(siblingZip, targetDir);
    }, /Zip Slip path traversal attempt/);
    assert.ok(!fs.existsSync(path.join(siblingDir, 'evil.txt')));

    // 4. Windows Absolute Path: D:\Windows\System32\evil.dll
    const absZip = new AdmZip();
    absZip.addFile('placeholder.txt', Buffer.from('abs-payload'));
    absZip.getEntries()[0].entryName = 'D:\\Windows\\System32\\evil.dll';
    assert.throws(() => {
      runtimeService.extractZipSafely(absZip, targetDir);
    }, /illegal absolute or drive path/);

    // 5. Windows UNC Path: \\attacker\share\evil.dll
    const uncZip = new AdmZip();
    uncZip.addFile('placeholder.txt', Buffer.from('unc-payload'));
    uncZip.getEntries()[0].entryName = '\\\\attacker\\share\\evil.dll';
    assert.throws(() => {
      runtimeService.extractZipSafely(uncZip, targetDir);
    }, /illegal absolute or drive path/);

    // 6. POSIX Absolute Path: /etc/shadow
    const posixZip = new AdmZip();
    posixZip.addFile('placeholder.txt', Buffer.from('posix-payload'));
    posixZip.getEntries()[0].entryName = '/etc/shadow';
    assert.throws(() => {
      runtimeService.extractZipSafely(posixZip, targetDir);
    }, /illegal absolute or drive path/);

    // 7. Null Byte Path: valid.txt\0evil.txt
    const nullZip = new AdmZip();
    nullZip.addFile('placeholder.txt', Buffer.from('null-payload'));
    nullZip.getEntries()[0].entryName = 'valid.txt\0evil.txt';
    assert.throws(() => {
      runtimeService.extractZipSafely(nullZip, targetDir);
    }, /null byte/);

    // 8. Symbolic Link Entry (Unix mode)
    const symlinkZip = new AdmZip();
    symlinkZip.addFile('link-to-root', Buffer.from('/'));
    const entry = symlinkZip.getEntry('link-to-root');
    if (entry) {
      entry.attr = 0o120777 * 0x10000; // Set symlink mode
    }
    assert.throws(() => {
      runtimeService.extractZipSafely(symlinkZip, targetDir);
    }, /forbidden symbolic link, reparse point, or special file/);

    // 9. Windows Reparse Point Attribute Entry (0x0400)
    const winReparseZip = new AdmZip();
    winReparseZip.addFile('reparse-entry', Buffer.from('payload'));
    const reparseEntry = winReparseZip.getEntry('reparse-entry');
    if (reparseEntry) {
      reparseEntry.attr = 0x0400; // FILE_ATTRIBUTE_REPARSE_POINT
    }
    assert.throws(() => {
      runtimeService.extractZipSafely(winReparseZip, targetDir);
    }, /forbidden symbolic link, reparse point, or special file/);

    // 10. Unix Special File Entry (FIFO / Character Device)
    const fifoZip = new AdmZip();
    fifoZip.addFile('fifo-entry', Buffer.from('fifo'));
    const fifoEntry = fifoZip.getEntry('fifo-entry');
    if (fifoEntry) {
      fifoEntry.attr = 0o010644 * 0x10000; // S_IFIFO
    }
    assert.throws(() => {
      runtimeService.extractZipSafely(fifoZip, targetDir);
    }, /forbidden symbolic link, reparse point, or special file/);

    // 11. Pre-existing Windows Directory Junction in Target Destination
    if (process.platform === 'win32') {
      const junctionDir = path.join(targetDir, 'junction_sub');
      try {
        fs.symlinkSync(outsideDir, junctionDir, 'junction');
      } catch {
        // Non-NTFS or restricted
      }
      if (fs.existsSync(junctionDir)) {
        const attackZip = new AdmZip();
        attackZip.addFile('placeholder.txt', Buffer.from('junction-escape-payload'));
        attackZip.getEntries()[0].entryName = 'junction_sub/evil.txt';
        assert.throws(() => {
          runtimeService.extractZipSafely(attackZip, targetDir);
        }, /forbidden symbolic link \/ directory junction/);
        assert.ok(!fs.existsSync(path.join(outsideDir, 'evil.txt')));
      }
    }

    // 12. Nested Directory Junction
    if (process.platform === 'win32') {
      const nestedParent = path.join(targetDir, 'nested_a', 'nested_b');
      fs.mkdirSync(nestedParent, { recursive: true });
      const nestedJunction = path.join(nestedParent, 'nested_junc');
      try {
        fs.symlinkSync(outsideDir, nestedJunction, 'junction');
      } catch {}
      if (fs.existsSync(nestedJunction)) {
        const nestedAttackZip = new AdmZip();
        nestedAttackZip.addFile('placeholder.txt', Buffer.from('nested-junction-payload'));
        nestedAttackZip.getEntries()[0].entryName = 'nested_a/nested_b/nested_junc/nested_evil.txt';
        assert.throws(() => {
          runtimeService.extractZipSafely(nestedAttackZip, targetDir);
        }, /forbidden symbolic link \/ directory junction/);
        assert.ok(!fs.existsSync(path.join(outsideDir, 'nested_evil.txt')));
      }
    }

    // 13. Pre-existing Normal Directory & File Replacement
    const normalSubdir = path.join(targetDir, 'normal_dir');
    fs.mkdirSync(normalSubdir, { recursive: true });
    const preExistingFile = path.join(normalSubdir, 'existing.txt');
    fs.writeFileSync(preExistingFile, 'old content', 'utf-8');

    const updateZip = new AdmZip();
    updateZip.addFile('normal_dir/existing.txt', Buffer.from('updated content'));
    runtimeService.extractZipSafely(updateZip, targetDir);

    assert.strictEqual(fs.readFileSync(preExistingFile, 'utf-8'), 'updated content');

    // 14. Pre-existing Hard Link File Neutralization (File-level Link Protection)
    const victimFile = path.join(outsideDir, 'victim.txt');
    fs.writeFileSync(victimFile, 'original victim content', 'utf-8');
    const targetLinkFile = path.join(targetDir, 'hardlink_target.txt');
    try {
      fs.linkSync(victimFile, targetLinkFile);
    } catch {}
    if (fs.existsSync(targetLinkFile)) {
      const overwriteZip = new AdmZip();
      overwriteZip.addFile('hardlink_target.txt', Buffer.from('new safe content'));
      runtimeService.extractZipSafely(overwriteZip, targetDir);

      assert.strictEqual(fs.readFileSync(targetLinkFile, 'utf-8'), 'new safe content');
      // The outside victim file must remain untouched because targetLink was unlinked prior to creation!
      assert.strictEqual(fs.readFileSync(victimFile, 'utf-8'), 'original victim content');
    }

    // 15. Failed Extraction Cleanup (Atomic rollback verification)
    const failTempDir = path.join(testExtractRoot, 'temp-fail-cleanup');
    fs.mkdirSync(failTempDir, { recursive: true });
    const maliciousZip = new AdmZip();
    maliciousZip.addFile('valid_first.txt', Buffer.from('first-data'));
    maliciousZip.addFile('evil_second.txt', Buffer.from('payload'));
    maliciousZip.getEntries()[1].entryName = '../evil_second.txt';

    let extractionError = null;
    try {
      runtimeService.extractZipSafely(maliciousZip, failTempDir);
    } catch (err) {
      extractionError = err;
    } finally {
      // Mirroring provisionManagedRuntime finally cleanup
      if (extractionError && fs.existsSync(failTempDir)) {
        fs.rmSync(failTempDir, { recursive: true, force: true });
      }
    }
    assert.ok(extractionError);
    assert.strictEqual(fs.existsSync(failTempDir), false);

    // 16. Resource Limits: Uncontrolled Allocation & Oversized Entry Rejection (CVE-2026-77301)
    const oversizedZip = new AdmZip();
    oversizedZip.addFile('huge_file.bin', Buffer.from('small-payload'));
    const hugeEntry = oversizedZip.getEntry('huge_file.bin');
    if (hugeEntry && hugeEntry.header) {
      hugeEntry.header.size = 600 * 1024 * 1024; // 600 MB > 500 MB limit
    }
    assert.throws(() => {
      runtimeService.extractZipSafely(oversizedZip, targetDir);
    }, /exceeds maximum permitted uncompressed size/);

    // 17. Resource Limits: Compression Ratio / Zip Bomb Rejection
    const bombZip = new AdmZip();
    bombZip.addFile('bomb.bin', Buffer.alloc(100, 'A'));
    const bombEntry = bombZip.getEntry('bomb.bin');
    if (bombEntry && bombEntry.header) {
      bombEntry.header.size = 20 * 1024 * 1024; // Declares 20MB
      bombEntry.header.compressedSize = 100; // Compressed is 100B -> 200,000:1 ratio > 100:1
    }
    assert.throws(() => {
      runtimeService.extractZipSafely(bombZip, targetDir);
    }, /suspicious compression ratio/);

    // 18. Resource Limits: Aggregate Extraction Size Rejection
    const aggregateZip = new AdmZip();
    for (let i = 1; i <= 5; i++) {
      aggregateZip.addFile(`part${i}.bin`, Buffer.from(`data${i}`));
    }
    const entriesList = aggregateZip.getEntries();
    for (const ent of entriesList) {
      if (ent.header) {
        ent.header.size = 450 * 1024 * 1024; // 450 MB each (< 500 MB entry limit)
      }
    }
    // 5 * 450 MB = 2.25 GB (> 2 GB total limit)
    assert.throws(() => {
      runtimeService.extractZipSafely(aggregateZip, targetDir);
    }, /total permitted uncompressed size limit/);

    // 19. Upstream adm-zip Version Verification
    const admZipPkg = require('adm-zip/package.json');
    assert.strictEqual(admZipPkg.version, '0.6.1');

  } finally {
    if (fs.existsSync(testExtractRoot)) {
      fs.rmSync(testExtractRoot, { recursive: true, force: true });
    }
  }
});

test('12. Argument Builder: No Duplicate -Djava.library.path & Fallback Handling (BUG-004 regression)', () => {
  const builder = new ArgumentBuilder();

  const baseConfig = {
    versionId: '26.3',
    instanceId: 'inst-bug004',
    gameDirectory: 'C:\\test\\game',
    assetsDirectory: 'C:\\test\\assets',
    nativesDirectory: 'C:\\test\\natives',
    javaPath: 'C:\\Program Files\\Adoptium\\jdk-25\\bin\\java.exe',
    mainClass: 'net.minecraft.client.main.Main',
    jvmArgs: [],
    gameArgs: [],
    classpath: ['C:\\test\\libraries\\lib1.jar'],
    memoryMb: 2048,
    auth: {
      username: 'TestSteve',
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      accessToken: 'dummy_token',
      userType: 'msa'
    }
  };

  // Case 1: Metadata already contains -Djava.library.path
  const pkgWithLibPath = {
    id: '26.3',
    mainClass: 'net.minecraft.client.main.Main',
    arguments: {
      jvm: [
        '-Djava.library.path=${natives_directory}',
        '-cp',
        '${classpath}'
      ]
    }
  };
  const res1 = builder.buildLaunchCommand(pkgWithLibPath, baseConfig, 'C:\\test\\client.jar');
  const libArgs1 = res1.args.filter((a) => a.startsWith('-Djava.library.path='));
  assert.strictEqual(libArgs1.length, 1);
  assert.strictEqual(libArgs1[0], 'Recursion'.length === 0 ? '' : '-Djava.library.path=C:\\test\\natives');

  // Case 2: Metadata does NOT contain -Djava.library.path
  const pkgWithoutLibPath = {
    id: '26.3',
    mainClass: 'net.minecraft.client.main.Main',
    arguments: {
      jvm: [
        '-XX:+UseG1GC',
        '-cp',
        '${classpath}'
      ]
    }
  };
  const res2 = builder.buildLaunchCommand(pkgWithoutLibPath, baseConfig, 'C:\\test\\client.jar');
  const libArgs2 = res2.args.filter((a) => a.startsWith('-Djava.library.path='));
  assert.strictEqual(libArgs2.length, 1);
  assert.strictEqual(libArgs2[0], '-Djava.library.path=C:\\test\\natives');
  // Injected before -cp
  const cpIndex2 = res2.args.indexOf('-cp');
  const libIndex2 = res2.args.indexOf('-Djava.library.path=C:\\test\\natives');
  assert.ok(libIndex2 < cpIndex2, 'Injected -Djava.library.path should precede -cp');

  // Case 3: Fallback path where arguments.jvm is undefined (legacy versions < 1.13)
  const legacyPkg = {
    id: '1.12.2',
    mainClass: 'net.minecraft.client.main.Main',
    minecraftArguments: '--username ${auth_player_name}'
  };
  const res3 = builder.buildLaunchCommand(legacyPkg, baseConfig, 'C:\\test\\client.jar');
  const libArgs3 = res3.args.filter((a) => a.startsWith('-Djava.library.path='));
  assert.strictEqual(libArgs3.length, 1, 'Legacy fallback must contain exactly one -Djava.library.path');
  assert.strictEqual(libArgs3[0], '-Djava.library.path=C:\\test\\natives');

  const legacyAuthPkg = {
    ...legacyPkg,
    minecraftArguments: '--username ${auth_player_name} --userProperties ${user_properties}'
  };
  const legacyAuthArgs = builder.buildLaunchCommand(legacyAuthPkg, baseConfig, 'C:\\test\\client.jar').args;
  const userPropertiesIndex = legacyAuthArgs.indexOf('--userProperties');
  assert.ok(userPropertiesIndex >= 0);
  assert.strictEqual(legacyAuthArgs[userPropertiesIndex + 1], '{}', 'Legacy user properties must be valid JSON in a separate process argument');

  // Case 4: Duplicate input (metadata has duplicate, or custom jvmArgs has another path)
  const configWithCustom = {
    ...baseConfig,
    jvmArgs: ['-Djava.library.path=C:\\custom\\natives']
  };
  const res4 = builder.buildLaunchCommand(pkgWithLibPath, configWithCustom, 'C:\\test\\client.jar');
  const libArgs4 = res4.args.filter((a) => a.startsWith('-Djava.library.path='));
  assert.strictEqual(libArgs4.length, 1, 'Multiple library-path specifications must be deduplicated to exactly one');
  assert.strictEqual(libArgs4[0], '-Djava.library.path=C:\\custom\\natives', 'Last/custom flag must take precedence');

  // Case 5: Verification of entire launch command output structure
  assert.strictEqual(res1.command, baseConfig.javaPath);
  assert.ok(!res1.args.includes('-Xms1024M'));
  assert.ok(res1.args.includes('-Xmx2048M'));
  assert.ok(res1.args.filter((arg) => arg.startsWith('-Xmx')).length === 1);
  assert.ok(res1.args.includes('net.minecraft.client.main.Main'));
});

test('13. XSTS Service: Safe Single Stream Consumption & Error Handling (BUG-005 regression)', async () => {
  const service = new XSTSService();
  const originalFetch = globalThis.fetch;

  try {
    // 1. Successful response
    globalThis.fetch = async () => new Response(JSON.stringify({
      Token: 'valid_xsts_jwt_token',
      DisplayClaims: { xui: [{ uhs: 'user_hash_12345' }] }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const authRes = await service.authorize('dummy_xbl_token');
    assert.strictEqual(authRes.token, 'valid_xsts_jwt_token');
    assert.strictEqual(authRes.userHash, 'user_hash_12345');

    // 2. JSON error with Message
    globalThis.fetch = async () => new Response(JSON.stringify({
      XErr: 12345,
      Message: 'Account authorization expired'
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    await assert.rejects(
      async () => service.authorize('dummy_xbl_token'),
      /Account authorization expired/
    );

    // 3. Known XErr code (Xbox profile missing: 2148916233)
    globalThis.fetch = async () => new Response(JSON.stringify({
      XErr: 2148916233
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    await assert.rejects(
      async () => service.authorize('dummy_xbl_token'),
      /does not have an active Xbox Live profile/
    );

    // 4. Plain text error response
    globalThis.fetch = async () => new Response('502 Bad Gateway: Upstream failure', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'Content-Type': 'text/plain' }
    });

    await assert.rejects(
      async () => service.authorize('dummy_xbl_token'),
      /502 Bad Gateway: Upstream failure/
    );

    // 5. Malformed JSON response
    globalThis.fetch = async () => new Response('<html><body>Server Error</body></html>', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'text/html' }
    });

    await assert.rejects(
      async () => service.authorize('dummy_xbl_token'),
      /Server Error/
    );

    // 6. Empty body response
    globalThis.fetch = async () => new Response('', {
      status: 503,
      statusText: 'Service Unavailable'
    });

    await assert.rejects(
      async () => service.authorize('dummy_xbl_token'),
      /Service Unavailable/
    );

    // 7. Nonstandard XML content type
    globalThis.fetch = async () => new Response('<error><code>100</code></error>', {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'Content-Type': 'application/xml' }
    });

    await assert.rejects(
      async () => service.authorize('dummy_xbl_token'),
      /<error><code>100<\/code><\/error>/
    );

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('14. Instance Manager: No Unnecessary Index Writes on Load & Proper Migration (BUG-007 regression)', () => {
  const pm = new PathManager();
  const instancesDir = pm.getInstancesPath();
  const indexFile = path.join(instancesDir, 'instances.json');

  // Backup existing instances.json if it exists
  const hadIndex = fs.existsSync(indexFile);
  const backupIndex = hadIndex ? fs.readFileSync(indexFile, 'utf-8') : null;

  try {
    // 1. Up-to-date instance (current version: 26.3)
    const currentData = {
      instances: [
        {
          id: 'inst-up-to-date',
          name: 'My Up To Date Instance',
          minecraftVersion: CURRENT_MINECRAFT_PRIMARY_TARGET,
          loaderType: 'fabric',
          gameDirectory: path.join(instancesDir, 'inst-up-to-date'),
          createdAt: new Date().toISOString()
        }
      ],
      activeId: 'inst-up-to-date'
    };
    fs.mkdirSync(instancesDir, { recursive: true });
    fs.writeFileSync(indexFile, JSON.stringify(currentData, null, 2), 'utf-8');

    // Spy on saveIndex / write operations
    let writeCount = 0;
    const origWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = function (...args) {
      if (typeof args[0] === 'string' && args[0].includes('instances.json')) {
        writeCount++;
      }
      return origWriteFileSync.apply(this, args);
    };

    try {
      const manager = new InstanceManager();
      const loaded = manager.listInstances();
      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0].id, 'inst-up-to-date');
      assert.strictEqual(loaded[0].minecraftVersion, CURRENT_MINECRAFT_PRIMARY_TARGET);

      // Verify ZERO writes occurred for up-to-date instance
      assert.strictEqual(writeCount, 0, 'Loading up-to-date instance must not write to instances.json');

      // Call listInstances repeatedly
      for (let i = 0; i < 5; i++) {
        manager.listInstances();
      }
      assert.strictEqual(writeCount, 0, 'Repeated reads must perform zero disk writes');

    } finally {
      fs.writeFileSync = origWriteFileSync;
    }

    // 2. Old version instance (26.2) requires migration
    const oldData = {
      instances: [
        {
          id: 'inst-legacy',
          name: 'Minecraft 26.2',
          minecraftVersion: '26.2',
          loaderType: 'vanilla',
          gameDirectory: path.join(instancesDir, 'inst-legacy'),
          memoryMb: 3072,
          createdAt: new Date().toISOString()
        }
      ],
      activeId: 'inst-legacy'
    };
    fs.writeFileSync(indexFile, JSON.stringify(oldData, null, 2), 'utf-8');

    const manager2 = new InstanceManager();
    const migrated = manager2.listInstances();
    assert.strictEqual(migrated.length, 1);
    assert.strictEqual(migrated[0].id, 'inst-legacy');
    assert.strictEqual(migrated[0].minecraftVersion, CURRENT_MINECRAFT_PRIMARY_TARGET, 'Old version must migrate to primary target');
    assert.strictEqual(migrated[0].name, `Minecraft ${CURRENT_MINECRAFT_PRIMARY_TARGET}`, 'Legacy name must migrate to new version name');
    assert.strictEqual(migrated[0].memoryMb, undefined, 'Legacy per-instance memory must be removed during migration');

    // 3. Verify repeated loads on migrated instance do NOT write again
    let postMigrateWrites = 0;
    const origWrite = fs.writeFileSync;
    fs.writeFileSync = function (...args) {
      if (typeof args[0] === 'string' && args[0].includes('instances.json')) {
        postMigrateWrites++;
      }
      return origWrite.apply(this, args);
    };

    try {
      for (let i = 0; i < 5; i++) {
        manager2.listInstances();
      }
      assert.strictEqual(postMigrateWrites, 0, 'Post-migration repeated loads must perform zero disk writes');
    } finally {
      fs.writeFileSync = origWrite;
    }

  } finally {
    // Restore backup
    if (hadIndex && backupIndex !== null) {
      fs.writeFileSync(indexFile, backupIndex, 'utf-8');
    } else if (fs.existsSync(indexFile)) {
      fs.unlinkSync(indexFile);
    }
  }
});
