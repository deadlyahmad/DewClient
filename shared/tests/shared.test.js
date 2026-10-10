import test from 'node:test';
import assert from 'node:assert';

import {
  PRODUCT_NAME,
  PRODUCT_VERSION,
  CLIENT_API_VERSION,
  MINIMUM_SUPPORTED_VERSION,
  CURRENT_MINECRAFT_PRIMARY_TARGET,
  DEFAULT_MINECRAFT_CHANNEL,
  MICROSOFT_CLIENT_ID,
  ENDPOINTS,
  IPC_CHANNELS,
  validateUsername,
  validateInstanceName,
  validateEmail,
  validatePassword,
  validateOfflineSignup,
  isUuid,
  validateId,
  validateNumericRange,
  validateVersionString,
  parseSafeUrl,
  isValidEd25519PublicKey,
  sanitizeLogString,
  validateClientRegisterBody,
  validateClientHeartbeatHeaders,
  validateClientHeartbeatBody,
  validateAdminMaintenanceBody,
  validateAdminClientReleaseBody,
  validateAdminNewsBody,
  validateAdminAnnouncementBody,
  validateAdminServerBody,
  validateAdminFeatureFlagsBody,
  compareSemver,
  isVersionOutdated
} from '../index.ts';

test('1. Versions & Single Source of Truth', () => {
  assert.strictEqual(PRODUCT_NAME, 'DewClient');
  assert.strictEqual(PRODUCT_VERSION, '1.0.1');
  assert.strictEqual(CLIENT_API_VERSION, 'v1');
  assert.strictEqual(MINIMUM_SUPPORTED_VERSION, '1.0.0');
  assert.strictEqual(CURRENT_MINECRAFT_PRIMARY_TARGET, '26.3');
  assert.strictEqual(DEFAULT_MINECRAFT_CHANNEL, 'release');
});

test('2. Public Microsoft Client ID and Key Endpoints', () => {
  assert.strictEqual(MICROSOFT_CLIENT_ID, '00000000402b5328');
  assert.ok(ENDPOINTS.MOJANG_MANIFEST_V2.includes('piston-meta.mojang.com'));
  assert.ok(ENDPOINTS.MODRINTH_API.includes('api.modrinth.com/v2'));
  assert.ok(ENDPOINTS.MINECRAFT_SERVICES_LOGIN.includes('api.minecraftservices.com'));
});

test('3. IPC Channel Constants Integrity', () => {
  assert.strictEqual(IPC_CHANNELS.AUTH_START_MICROSOFT, 'auth.startMicrosoft');
  assert.strictEqual(IPC_CHANNELS.MINECRAFT_LAUNCH, 'minecraft.launch');
  assert.strictEqual(IPC_CHANNELS.INSTANCES_CREATE, 'instances.create');
  assert.strictEqual(IPC_CHANNELS.UPDATER_OPEN_DOWNLOADED, 'updater.openDownloaded');
  assert.strictEqual(IPC_CHANNELS.EVENT_DOWNLOAD_PROGRESS, 'event.downloadProgress');
});

test('4. Validation: validateUsername', () => {
  assert.deepStrictEqual(validateUsername('Steve'), { valid: true });
  assert.deepStrictEqual(validateUsername('Alex_99'), { valid: true });
  assert.strictEqual(validateUsername('ab').valid, false); // < 3 chars
  assert.strictEqual(validateUsername('this_name_is_way_too_long_for_minecraft').valid, false); // > 16 chars
  assert.strictEqual(validateUsername('bad name!').valid, false); // special chars
});

test('5. Validation: validateInstanceName', () => {
  assert.deepStrictEqual(validateInstanceName('Survival 26.3'), { valid: true });
  assert.strictEqual(validateInstanceName('').valid, false);
  assert.strictEqual(validateInstanceName('Invalid/Name').valid, false);
  assert.strictEqual(validateInstanceName('Invalid:Name').valid, false);
  assert.strictEqual(validateInstanceName('Invalid*Name').valid, false);
});

test('5b. Validation: email, password, and offline signup requirements', () => {
  assert.strictEqual(validateEmail('player@example.com').valid, true);
  assert.strictEqual(validateEmail('not-an-email').valid, false);

  const strong = validatePassword('S3cure!Pass');
  assert.strictEqual(strong.valid, true);
  assert.ok(strong.requirements.every((item) => item.met));

  const weak = validatePassword('short');
  assert.strictEqual(weak.valid, false);
  assert.ok(weak.requirements.some((item) => !item.met));

  const signup = validateOfflineSignup({
    username: 'Player_1',
    email: 'player@example.com',
    password: 'S3cure!Pass',
    confirmPassword: 'S3cure!Pass'
  });
  assert.strictEqual(signup.valid, true);

  const mismatch = validateOfflineSignup({
    username: 'Player_1',
    email: 'player@example.com',
    password: 'S3cure!Pass',
    confirmPassword: 'Wrong!Pass'
  });
  assert.strictEqual(mismatch.valid, false);
});

test('6. Validation: isUuid & validateId', () => {
  assert.strictEqual(isUuid('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.strictEqual(isUuid('not-a-uuid'), false);
  assert.strictEqual(isUuid(123), false);
  assert.strictEqual(isUuid(null), false);

  assert.strictEqual(validateId('default-instance').valid, true);
  assert.strictEqual(validateId('bad/id').valid, false);
  assert.strictEqual(validateId('').valid, false);
});

test('7. Validation: numeric ranges & version strings', () => {
  assert.strictEqual(validateNumericRange(25565, 1, 65535, 'port').valid, true);
  assert.strictEqual(validateNumericRange(70000, 1, 65535, 'port').valid, false);
  assert.strictEqual(validateNumericRange('not-a-number', 1, 10).valid, false);

  assert.strictEqual(validateVersionString('2.0.0').valid, true);
  assert.strictEqual(validateVersionString('26.3').valid, true);
  assert.strictEqual(validateVersionString('1.20.4-rc1').valid, true);
  assert.strictEqual(validateVersionString('invalid..ver').valid, false);
});

test('8. Validation: parseSafeUrl', () => {
  assert.strictEqual(parseSafeUrl('https://example.com/api'), 'https://example.com/api');
  assert.strictEqual(parseSafeUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787/');
  assert.strictEqual(parseSafeUrl('', { allowEmpty: true }), '');
  assert.throws(() => parseSafeUrl('javascript:alert(1)'), /Invalid URL/);
  assert.throws(() => parseSafeUrl('ftp://example.com'), /Invalid URL/);
});

test('9. Validation: isValidEd25519PublicKey', () => {
  // 64-char Hex (32 bytes)
  const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  assert.strictEqual(isValidEd25519PublicKey(hexKey), true);

  // 44-char Base64 (32 bytes with padding)
  const base64Key = Buffer.from(hexKey, 'hex').toString('base64');
  assert.strictEqual(isValidEd25519PublicKey(base64Key), true);

  // Invalid formats
  assert.strictEqual(isValidEd25519PublicKey('short'), false);
  assert.strictEqual(isValidEd25519PublicKey(''), false);
  assert.strictEqual(isValidEd25519PublicKey(null), false);
});

test('10. Validation: Client Register & Heartbeat Payloads', () => {
  const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // Valid registration
  const regRes = validateClientRegisterBody({
    publicKey: hexKey,
    clientVersion: '2.0.0',
    os: 'Windows',
    osVersion: '10.0.19045',
    architecture: 'x64'
  });
  assert.strictEqual(regRes.valid, true);
  assert.strictEqual(regRes.data?.publicKey, hexKey);

  // Invalid registration (bad key)
  const badReg = validateClientRegisterBody({
    publicKey: 'not-valid-key',
    clientVersion: '2.0.0'
  });
  assert.strictEqual(badReg.valid, false);

  // Valid heartbeat headers
  const sig = 'a'.repeat(128); // 128 hex chars
  const hbHeadersRes = validateClientHeartbeatHeaders({
    'x-dewclient-id': '550e8400-e29b-41d4-a716-446655440000',
    'x-dewclient-timestamp': String(Date.now()),
    'x-dewclient-signature': sig,
    'x-dewclient-version': '2.0.0'
  });
  assert.strictEqual(hbHeadersRes.valid, true);

  // Expired heartbeat
  const expiredHb = validateClientHeartbeatHeaders({
    'x-dewclient-id': '550e8400-e29b-41d4-a716-446655440000',
    'x-dewclient-timestamp': String(Date.now() - 600_000), // 10 mins ago
    'x-dewclient-signature': sig
  });
  assert.strictEqual(expiredHb.valid, false);
});

test('11. Validation: Admin DTO Payloads', () => {
  // Maintenance
  const maint = validateAdminMaintenanceBody({ enabled: true, mode: 'soft', title: 'Maintenance' });
  assert.strictEqual(maint.valid, true);
  assert.strictEqual(maint.data?.mode, 'soft');

  const badMaint = validateAdminMaintenanceBody({ enabled: 'yes' });
  assert.strictEqual(badMaint.valid, false);

  // Client release
  const rel = validateAdminClientReleaseBody({
    latestVersion: '2.0.1',
    minimumVersion: '2.0.0',
    updateUrl: 'https://example.com/downloads/v2.0.1.exe'
  });
  assert.strictEqual(rel.valid, true);

  // Server item
  const srv = validateAdminServerBody({
    name: 'DewCraft Official',
    host: 'play.dewclient.com',
    port: 25565,
    tags: ['Survival', 'Official']
  });
  assert.strictEqual(srv.valid, true);
  assert.strictEqual(srv.data?.port, 25565);
});

test('12. Sanitization: sanitizeLogString', () => {
  const sensitive = 'Authorization: Bearer secret_token_xyz with accessToken="mc_secret_123" and Cookie: session=abc';
  const sanitized = sanitizeLogString(sensitive);
  assert.ok(!sanitized.includes('secret_token_xyz'));
  assert.ok(!sanitized.includes('mc_secret_123'));
  assert.ok(!sanitized.includes('session=abc'));
  assert.ok(sanitized.includes('Bearer [REDACTED]'));
  assert.ok(sanitized.includes('[REDACTED]'));
});

test('13. Semver: compareSemver and isVersionOutdated', () => {
  assert.strictEqual(compareSemver('2.0.0', '1.1.4') > 0, true);
  assert.strictEqual(compareSemver('2.0.0', '2.0.0'), 0);
  assert.strictEqual(compareSemver('2.0.0', '2.0.1') < 0, true);
  assert.strictEqual(isVersionOutdated('1.1.4', '2.0.0'), true);
  assert.strictEqual(isVersionOutdated('2.0.0', '1.1.4'), false);
});
