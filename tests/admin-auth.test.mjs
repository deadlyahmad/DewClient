import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret-with-more-bytes';
process.env.TRUST_PROXY = 'true';
process.env.PUBLIC_DOMAIN = 'server.example.test';
process.env.CORS_ORIGINS = 'null,https://dewclient.example.test';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_KEY = 'test-service-key';
process.env.COSMETIC_ASSET_ENCRYPTION_KEY = '11'.repeat(32);
process.env.DEWCLIENT_RELEASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-releases-'));

const { AuthService } = await import('../server/src/services/authService.mjs');
const { CONFIG, validateServerConfig } = await import('../server/src/config.mjs');
const { createApp, getClientId } = await import('../server/src/index.mjs');

const testStaff = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.com',
  password_hash: AuthService.hashPassword('test-password'),
  display_name: 'Test Admin',
  role: 'admin',
  session_version: 1,
  is_active: true
};
const lookupDatabaseStaff = AuthService.getDatabaseAdmin.bind(AuthService);
AuthService.getDatabaseAdmin = async (email) => email === testStaff.email ? structuredClone(testStaff) : null;

const requestWithToken = (token) => ({
  headers: { authorization: `Bearer ${token}` }
});

test('rate limiting trusts only a single forwarded client IP from a loopback proxy', () => {
  assert.equal(getClientId({
    socket: { remoteAddress: '203.0.113.9' },
    headers: { 'x-forwarded-for': '198.51.100.7' }
  }), '203.0.113.9');
  assert.equal(getClientId({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.7' }
  }), '198.51.100.7');
  assert.equal(getClientId({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.7, 203.0.113.9' }
  }), '127.0.0.1');
});

test('admin dashboard safely renders client-controlled account image fields', () => {
  const table = { innerHTML: '' };
  const context = {
    document: {
      addEventListener() {},
      getElementById(id) { return id === 'accounts-tbody' ? table : null; }
    },
    window: {},
    URL,
    console
  };
  const dashboardPath = new URL('../server/public/js/dashboard.js', import.meta.url);
  vm.runInNewContext(fs.readFileSync(dashboardPath, 'utf8'), context);
  context.renderAccounts([{
    uuid: '11111111-1111-4111-8111-111111111111',
    username: '"><img src=x onerror=alert(1)>',
    avatarUrl: 'https://example.test/" onerror="alert(1)'
  }]);

  assert.match(table.innerHTML, /alt="&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;"/);
  assert.doesNotMatch(table.innerHTML, /src="https:\/\/example\.test\/" onerror=/);
});

test('admin dashboard does not invent a player identity or avatar when account fields are absent', () => {
  const table = { innerHTML: '' };
  const context = {
    document: {
      addEventListener() {},
      getElementById(id) { return id === 'accounts-tbody' ? table : null; }
    },
    window: {},
    URL,
    console
  };
  const dashboardPath = new URL('../server/public/js/dashboard.js', import.meta.url);
  vm.runInNewContext(fs.readFileSync(dashboardPath, 'utf8'), context);
  context.renderAccounts([{ uuid: '11111111-1111-4111-8111-111111111111' }]);

  assert.match(table.innerHTML, /player-avatar" aria-hidden="true"[^>]*>\?<\/div>/);
  assert.doesNotMatch(table.innerHTML, /MHF_Steve|>Player<|Just now/);
});

test('admin dashboard binds the staff creation form when modals initialize', () => {
  const listeners = {};
  const staffForm = { addEventListener(event, handler) { listeners[event] = handler; } };
  const context = {
    document: {
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getElementById(id) { return id === 'form-staff' ? staffForm : null; }
    },
    window: {},
    URL,
    console
  };
  const dashboardPath = new URL('../server/public/js/dashboard.js', import.meta.url);
  vm.runInNewContext(fs.readFileSync(dashboardPath, 'utf8'), context);

  context.initModals();
  assert.equal(typeof listeners.submit, 'function');
});

test('admin dashboard binds announcement and maintenance forms', () => {
  const listeners = new Map();
  const elements = new Map(['form-announcement', 'form-maintenance'].map((id) => [id, {
    addEventListener(event, handler) { listeners.set(id, handler); }
  }]));
  const context = {
    document: {
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getElementById(id) { return elements.get(id) || null; }
    },
    window: {},
    URL,
    console
  };
  const dashboardPath = new URL('../server/public/js/dashboard.js', import.meta.url);
  vm.runInNewContext(fs.readFileSync(dashboardPath, 'utf8'), context);

  context.initModals();
  assert.equal(typeof listeners.get('form-announcement'), 'function');
  assert.equal(typeof listeners.get('form-maintenance'), 'function');
});

test('admin dashboard shows every section without role permission data', () => {
  const createElement = (tab, permission, active = false) => {
    const classes = new Set(active ? ['active'] : []);
    return {
      dataset: { tab, permission },
      hidden: false,
      attributes: new Set(),
      classList: {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        contains(name) { return classes.has(name); }
      },
      setAttribute(name) { this.attributes.add(name); },
      removeAttribute(name) { this.attributes.delete(name); }
    };
  };
  const navItems = [
    createElement('overview', 'accounts:read', true),
    createElement('clients', 'clients:read')
  ];
  const panels = [
    createElement('overview', 'accounts:read'),
    createElement('clients', 'clients:read')
  ].map((panel) => ({ ...panel, id: `panel-${panel.dataset.tab}` }));
  const elements = [...navItems, ...panels];
  const context = {
    document: {
      addEventListener() {},
      querySelector(selector) {
        if (selector === '.nav-item.active:not([hidden])') return navItems.find((item) => !item.hidden && item.classList.contains('active')) || null;
        if (selector === '.nav-item:not([hidden])') return navItems.find((item) => !item.hidden) || null;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-permission]') return elements;
        if (selector === '.nav-item') return navItems;
        if (selector === '.tab-panel') return panels;
        return [];
      }
    },
    window: {},
    URL,
    console
  };
  const dashboardPath = new URL('../server/public/js/dashboard.js', import.meta.url);
  vm.runInNewContext(fs.readFileSync(dashboardPath, 'utf8'), context);

  context.applyAdminAccess();

  assert.ok(navItems.every((item) => !item.hidden));
  assert.equal(navItems[0].classList.contains('active'), true);
  assert.equal(panels[0].classList.contains('active'), true);
  assert.equal(panels[1].classList.contains('active'), false);
});

test('admin sessions require a valid HMAC signature and an active database staff record', async () => {
  const token = AuthService.createSessionToken('admin@example.com');
  const authorized = await AuthService.verifySession(requestWithToken(token));
  assert.equal(authorized?.email, 'admin@example.com');
  assert.equal('role' in authorized, false);
  assert.equal('permissions' in authorized, false);

  const forgedPayload = Buffer.from(JSON.stringify({
    email: 'admin@example.com',
    exp: Date.now() + 60_000,
    v: 'dewclient-admin-v1'
  })).toString('base64url');
  assert.equal(await AuthService.verifySession(requestWithToken(forgedPayload)), null);

  const [encodedPayload, signature] = token.split('.');
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  payload.exp += 60_000;
  const modifiedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.equal(await AuthService.verifySession(requestWithToken(`${modifiedPayload}.${signature}`)), null);

  const originalNow = Date.now;
  let expiredToken;
  try {
    Date.now = () => 1_000;
    expiredToken = AuthService.createSessionToken('admin@example.com');
    Date.now = () => 10 * 60 * 60 * 1000;
    assert.equal(await AuthService.verifySession(requestWithToken(expiredToken)), null);
  } finally {
    Date.now = originalNow;
  }

  testStaff.is_active = false;
  assert.equal(await AuthService.verifySession(requestWithToken(token)), null);
  testStaff.is_active = true;
});

test('server admin auth stays single-tier without role fields or role filters', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/dew_admins') && init.method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => [{
          id: 'admin-ops-uuid',
          email: 'ops@example.com',
          display_name: 'Ops Admin',
          is_active: true,
          created_at: new Date().toISOString()
        }]
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => []
    };
  };

  try {
    await AuthService.countActiveAdmins();
    await AuthService.createStaff({ email: 'ops@example.com', password: 'StrongPass!23', displayName: 'Ops Admin' });

    assert.equal(calls[0].url.includes('role=eq.admin'), false);
    const createPayload = JSON.parse(calls[1].init.body);
    assert.equal('role' in createPayload, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('login returns an admin session without role data and rate limits attempts', async (t) => {
  const server = createApp({});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/admin/login`;
  const successfulLogin = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testStaff.email, password: 'test-password' })
  });
  const session = await successfulLogin.json();
  assert.equal(successfulLogin.status, 200);
  assert.deepEqual(Object.keys(session.data.user).sort(), ['email', 'id', 'name']);

  const invalidResponses = [];
  for (let attempt = 0; attempt < 9; attempt++) {
    invalidResponses.push(await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'missing@example.com', password: 'wrong-password' })
    }));
  }
  assert.ok(invalidResponses.every((response) => response.status === 401));
  const throttled = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'missing@example.com', password: 'wrong-password' })
  });
  assert.equal(throttled.status, 429);
});

test('production configuration rejects missing service credentials and weak session secrets', () => {
  assert.doesNotThrow(validateServerConfig);
  const originalSecret = CONFIG.ADMIN_SESSION_SECRET;
  const originalKey = CONFIG.SUPABASE_KEY;
  try {
    CONFIG.ADMIN_SESSION_SECRET = 'too-short';
    assert.throws(validateServerConfig, /ADMIN_SESSION_SECRET/);
    CONFIG.ADMIN_SESSION_SECRET = originalSecret;
    CONFIG.SUPABASE_KEY = '';
    assert.throws(validateServerConfig, /SUPABASE_KEY/);
  } finally {
    CONFIG.ADMIN_SESSION_SECRET = originalSecret;
    CONFIG.SUPABASE_KEY = originalKey;
  }
});

test('public manifest filters unpublished content and reflects the configured CORS allowlist', async (t) => {
  const storage = {
    async getManifest() {
      return {
        news: [{ id: 'visible', enabled: true }, { id: 'draft', enabled: false }, { id: 'unknown' }],
        announcements: [{ id: 'published', enabled: true }, { id: 'draft', enabled: false }],
        featuredServers: [{ id: 'live', enabled: true }, { id: 'disabled', enabled: false }],
        client: { latestVersion: '' }
      };
    }
  };
  const server = createApp(storage);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/api/v1/manifest`;
  const allowed = await fetch(url, { headers: { Origin: 'https://dewclient.example.test' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://dewclient.example.test');
  const manifest = await allowed.json();
  assert.deepEqual(manifest.news.map((item) => item.id), ['visible']);
  assert.deepEqual(manifest.announcements.map((item) => item.id), ['published']);
  assert.deepEqual(manifest.featuredServers.map((item) => item.id), ['live']);
  assert.equal(manifest.client.latestVersion, '');

  const denied = await fetch(url, { headers: { Origin: 'https://attacker.example' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('content managers can publish announcements and persist maintenance settings', async (t) => {
  let manifest = {
    maintenance: { enabled: false, mode: 'soft', title: '', message: '' },
    announcements: [],
    news: [],
    featuredServers: [],
    client: {}
  };
  const storage = {
    async getManifest() { return structuredClone(manifest); },
    async saveManifest(nextManifest) { manifest = structuredClone(nextManifest); }
  };
  const server = createApp(storage);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    ...requestWithToken(AuthService.createSessionToken(testStaff.email)).headers,
    'Content-Type': 'application/json'
  };
  const maintenanceResponse = await fetch(`${baseUrl}/api/v1/admin/maintenance`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ enabled: true, mode: 'hard', title: 'Maintenance', message: 'Back soon.' })
  });
  assert.equal(maintenanceResponse.status, 200);
  assert.equal(manifest.maintenance.mode, 'hard');

  const announcementResponse = await fetch(`${baseUrl}/api/v1/admin/announcements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Planned update', message: 'Servers restart at 20:00.', severity: 'info', priority: 10 })
  });
  assert.equal(announcementResponse.status, 200);
  const announcement = (await announcementResponse.json()).data;

  const publicManifestResponse = await fetch(`${baseUrl}/api/v1/manifest`);
  const publicManifest = await publicManifestResponse.json();
  assert.equal(publicManifest.maintenance.enabled, true);
  assert.equal(publicManifest.announcements[0].id, announcement.id);

  const deleteResponse = await fetch(`${baseUrl}/api/v1/admin/announcements/${encodeURIComponent(announcement.id)}`, {
    method: 'DELETE',
    headers
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(manifest.announcements, []);
});

test('a legacy non-admin role value does not restrict a valid administrator session', async (t) => {
  const storage = {
    async getStats() { return { totalAccounts: 3 }; },
    async getManifest() { return { client: { latestVersion: '1.0.0' } }; },
    async saveManifest(manifest) { return manifest; }
  };
  const server = createApp(storage);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const staleToken = AuthService.createSessionToken(testStaff.email, testStaff.session_version);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  testStaff.role = 'support';
  testStaff.session_version += 1;
  try {
    const staleSession = await fetch(`${baseUrl}/api/v1/stats`, { headers: { Authorization: `Bearer ${staleToken}` } });
    assert.equal(staleSession.status, 401);

    const token = AuthService.createSessionToken(testStaff.email, testStaff.session_version);
    const allowedRead = await fetch(`${baseUrl}/api/v1/stats`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(allowedRead.status, 200);

    const allowedWrite = await fetch(`${baseUrl}/api/v1/admin/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ latestVersion: '2.0.0' })
    });
    assert.equal(allowedWrite.status, 200);

    const uploadValidation = await fetch(`${baseUrl}/api/v1/admin/release/upload?version=2.0.0`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('')
    });
    assert.equal(uploadValidation.status, 400);

    const originalListStaff = AuthService.listStaff;
    AuthService.listStaff = async () => [];
    const allowedAdminList = await fetch(`${baseUrl}/api/v1/admin/staff`, { headers: { Authorization: `Bearer ${token}` } });
    AuthService.listStaff = originalListStaff;
    assert.equal(allowedAdminList.status, 200);
  } finally {
    testStaff.role = 'admin';
    testStaff.session_version = 1;
  }
});

test('legacy role values receive the same full administrator access', async (t) => {
  const originalStaff = { role: testStaff.role, is_active: testStaff.is_active, session_version: testStaff.session_version };
  const originalListStaff = AuthService.listStaff;
  const storage = {
    async getStats() { return {}; },
    async getAccounts() { return []; },
    async getClients() { return []; },
    async getManifest() { return { news: [], announcements: [], featuredServers: [], client: {} }; },
    async saveManifest(manifest) { return manifest; },
    async getCosmeticLibrary() { return []; }
  };
  const server = createApp(storage);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const checks = [
    ['GET', '/stats', null],
    ['GET', '/accounts', null],
    ['GET', '/clients', null],
    ['GET', '/admin/cosmetics/library', null],
    ['POST', '/admin/news', { title: 'News', summary: 'Published content' }],
    ['POST', '/admin/release', { latestVersion: '2.0.0' }],
    ['POST', '/admin/cosmetics/library', {}],
    ['GET', '/admin/staff', null]
  ];
  const expectedStatuses = [200, 200, 200, 200, 200, 200, 400, 200];

  AuthService.listStaff = async () => [];
  try {
    for (const role of ['admin', 'moderator', 'support', 'content_manager']) {
      testStaff.role = role;
      testStaff.is_active = true;
      testStaff.session_version += 1;
      const token = AuthService.createSessionToken(testStaff.email, testStaff.session_version);
      for (let index = 0; index < checks.length; index += 1) {
        const [method, route, body] = checks[index];
        const response = await fetch(`${baseUrl}${route}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {})
          },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
        assert.equal(response.status, expectedStatuses[index], `${role} ${method} ${route}`);
      }
    }

    testStaff.role = 'admin';
    testStaff.is_active = false;
    testStaff.session_version += 1;
    const disabledToken = AuthService.createSessionToken(testStaff.email, testStaff.session_version);
    const disabledResponse = await fetch(`${baseUrl}/stats`, { headers: { Authorization: `Bearer ${disabledToken}` } });
    assert.equal(disabledResponse.status, 401);
  } finally {
    AuthService.listStaff = originalListStaff;
    Object.assign(testStaff, originalStaff);
  }
});

test('admin API ignores role changes and prevents self-disable', async (t) => {
  const originalList = AuthService.listStaff;
  const originalUpdate = AuthService.updateStaff;
  let updateCalled = false;
  AuthService.listStaff = async () => [{
    id: testStaff.id,
    email: testStaff.email,
    role: 'admin',
    isActive: true
  }];
  AuthService.updateStaff = async () => { updateCalled = true; };
  const server = createApp({});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    AuthService.listStaff = originalList;
    AuthService.updateStaff = originalUpdate;
    await new Promise((resolve) => server.close(resolve));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/admin/staff/${testStaff.id}`;
  const headers = { Authorization: `Bearer ${AuthService.createSessionToken(testStaff.email, testStaff.session_version)}`, 'Content-Type': 'application/json' };
  const ignoredRole = await fetch(baseUrl, {
    method: 'PATCH', headers, body: JSON.stringify({ role: 'support' })
  });
  assert.equal(ignoredRole.status, 400);
  const disableResponse = await fetch(baseUrl, {
    method: 'PATCH', headers, body: JSON.stringify({ isActive: false })
  });
  assert.equal(disableResponse.status, 403);
  assert.equal(updateCalled, false);
});

test('public online players stays empty until server-verified player presence exists', async (t) => {
  let failRead = false;
  const server = createApp({
    async getAccounts() {
      if (failRead) throw new Error('database unavailable');
      return [];
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/players/online`;

  const emptyResponse = await fetch(url);
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual((await emptyResponse.json()).data, []);

  failRead = true;
  const failedResponse = await fetch(url);
  assert.equal(failedResponse.status, 200);
  assert.deepEqual((await failedResponse.json()).data, []);
});

test('admin account API creates full-access admins and protects the last active admin', async (t) => {
  const originals = {
    list: AuthService.listStaff,
    create: AuthService.createStaff,
    update: AuthService.updateStaff,
    count: AuthService.countActiveAdmins
  };
  const staffRows = [];
  let activeAdminCount = 2;
  AuthService.listStaff = async () => structuredClone(staffRows);
  AuthService.createStaff = async ({ email, displayName }) => {
    const row = { id: '22222222-2222-4222-8222-222222222222', email, displayName, isActive: true };
    staffRows.push(row);
    return structuredClone(row);
  };
  AuthService.updateStaff = async (id, changes) => {
    const row = staffRows.find((entry) => entry.id === id);
    if (!row) return null;
    if (changes.is_active !== undefined) row.isActive = changes.is_active;
    return structuredClone(row);
  };
  AuthService.countActiveAdmins = async () => activeAdminCount;

  const server = createApp({});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    AuthService.listStaff = originals.list;
    AuthService.createStaff = originals.create;
    AuthService.updateStaff = originals.update;
    AuthService.countActiveAdmins = originals.count;
    await new Promise((resolve) => server.close(resolve));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/admin/staff`;
  const headers = { Authorization: `Bearer ${AuthService.createSessionToken(testStaff.email)}`, 'Content-Type': 'application/json' };
  const shortPassword = await fetch(baseUrl, {
    method: 'POST', headers,
    body: JSON.stringify({ email: 'support@example.com', password: 'short', role: 'support' })
  });
  assert.equal(shortPassword.status, 400);

  const created = await fetch(baseUrl, {
    method: 'POST', headers,
    body: JSON.stringify({ email: 'support@example.com', displayName: 'Support', password: 'long-test-password', role: 'support' })
  });
  const createdResult = await created.json();
  assert.equal(created.status, 201);
  assert.equal('role' in createdResult.data, false);
  assert.equal('password' in createdResult.data, false);
  assert.equal('password_hash' in createdResult.data, false);

  const targetId = staffRows[0].id;
  const updated = await fetch(`${baseUrl}/${targetId}`, {
    method: 'PATCH', headers, body: JSON.stringify({ role: 'content_manager', isActive: true })
  });
  assert.equal(updated.status, 200);
  assert.equal('role' in (await updated.json()).data, false);

  staffRows.splice(0, staffRows.length, {
    id: targetId, email: 'only-admin@example.com', displayName: 'Only Admin', role: 'admin', isActive: true
  });
  activeAdminCount = 1;
  const disableLastAdmin = await fetch(`${baseUrl}/${targetId}`, {
    method: 'PATCH', headers, body: JSON.stringify({ isActive: false })
  });
  assert.equal(disableLastAdmin.status, 409);
  assert.equal((await disableLastAdmin.json()).error.code, 'LAST_ACTIVE_ADMIN');
});

test('server rejects oversized JSON request bodies with 413', async (t) => {
  const storage = { async getManifest() { return {}; } };
  const server = createApp(storage);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.alloc(10 * 1024 * 1024 + 1)
  });
  const result = await response.json();
  assert.equal(response.status, 413);
  assert.equal(result.error.code, 'PAYLOAD_TOO_LARGE');
});

test('server rejects stale heartbeat and unauthenticated cosmetic publish requests', async (t) => {
  const keyPair = crypto.generateKeyPairSync('ed25519');
  const publicDer = keyPair.publicKey.export({ type: 'spki', format: 'der' });
  const client = { id: 'client-stale-test', publicKey: publicDer.subarray(-32).toString('hex') };
  const storage = { async getClient() { return client; } };
  const server = createApp(storage);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const body = JSON.stringify({ accounts: [], playerUuid: '11111111-1111-4111-8111-111111111111' });
  const timestamp = String(Date.now() - 10 * 60 * 1000);
  const requestId = crypto.randomUUID();
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const canonical = `${client.id}:${timestamp}:${requestId}:${bodyHash}`;
  const signature = crypto.sign(null, Buffer.from(canonical), keyPair.privateKey).toString('hex');
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const headers = {
    'Content-Type': 'application/json',
    'x-dewclient-id': client.id,
    'x-dewclient-timestamp': timestamp,
    'x-dewclient-request-id': requestId,
    'x-dewclient-signature': signature
  };

  const heartbeat = await fetch(`${baseUrl}/client/heartbeat`, { method: 'POST', headers, body });
  assert.equal(heartbeat.status, 401);
  assert.equal((await heartbeat.json()).error.code, 'STALE_TIMESTAMP');

  const cosmetics = await fetch(`${baseUrl}/cosmetics/publish`, {
    method: 'POST',
    headers: { ...headers, 'x-dewclient-player-uuid': '11111111-1111-4111-8111-111111111111' },
    body
  });
  assert.equal(cosmetics.status, 401);
  assert.equal((await cosmetics.json()).error.code, 'AUTH_REQUIRED');
});

test('legacy password hashes are upgraded after successful verification', async () => {
  const originalLookup = AuthService.getDatabaseAdmin;
  const originalUpdate = AuthService.updatePasswordHash;
  let upgradedHash = '';
  AuthService.getDatabaseAdmin = async () => ({
    id: 'legacy-staff-id',
    email: 'admin@example.com',
    password_hash: crypto.createHash('sha256').update('old-database-password').digest('hex'),
    is_active: true
  });
  AuthService.updatePasswordHash = async (_id, passwordHash) => { upgradedHash = passwordHash; };

  try {
    assert.equal(await AuthService.verifyCredentials('admin@example.com', 'old-database-password'), true);
    assert.match(upgradedHash, /^scrypt\$/);
    assert.equal(await AuthService.verifyCredentials('admin@example.com', 'wrong-password'), false);
  } finally {
    AuthService.getDatabaseAdmin = originalLookup;
    AuthService.updatePasswordHash = originalUpdate;
  }
});

test('database staff lookup selects the persisted session version', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([{ id: testStaff.id, email: testStaff.email, session_version: 7 }]), { status: 200 });
  };
  try {
    const record = await lookupDatabaseStaff(testStaff.email);
    assert.match(requestedUrl, /select=[^&]*session_version/);
    assert.equal(record.session_version, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin release metadata rejects insecure HTTP installer URLs', async (t) => {
  const manifest = { client: { latestVersion: '1.0.0', minimumVersion: '1.0.0', updateUrl: '' } };
  const storage = {
    async getManifest() { return structuredClone(manifest); },
    async saveManifest(next) { Object.assign(manifest, structuredClone(next)); }
  };
  const server = createApp(storage);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const token = AuthService.createSessionToken('admin@example.com');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/admin/release`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ latestVersion: '2.0.0', updateUrl: 'http://updates.example.test/DewClient-2.0.0.exe' })
  });
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.equal(result.error.code, 'INVALID_URL');

  const missingIntegrityResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/admin/release`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ latestVersion: '2.0.0', updateUrl: 'https://server.example.test/downloads/DewClient-2.0.0.exe' })
  });
  assert.equal(missingIntegrityResponse.status, 400);
  assert.equal((await missingIntegrityResponse.json()).error.code, 'INVALID_INTEGRITY_METADATA');
});

test('admin can upload a Windows installer and publish verifiable release metadata', async (t) => {
  const manifest = { client: { latestVersion: '1.0.0', minimumVersion: '1.0.0', updateUrl: '' } };
  const storage = {
    async getManifest() { return structuredClone(manifest); },
    async saveManifest(next) { Object.assign(manifest, structuredClone(next)); }
  };
  const server = createApp(storage);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DEWCLIENT_RELEASE_DIR, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = AuthService.createSessionToken('admin@example.com');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' };
  const installer = Buffer.from([0x4d, 0x5a, 0x01, 0x02, 0x03, 0x04]);
  const uploadResponse = await fetch(`${baseUrl}/api/v1/admin/release/upload?version=2.0.0`, {
    method: 'POST', headers, body: installer
  });
  const upload = await uploadResponse.json();

  assert.equal(uploadResponse.status, 201);
  assert.equal(upload.data.sizeBytes, installer.length);
  assert.equal(upload.data.sha256, (await import('node:crypto')).default.createHash('sha256').update(installer).digest('hex'));

  const publishResponse = await fetch(`${baseUrl}/api/v1/admin/release`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latestVersion: '2.0.0',
      minimumVersion: '1.0.0',
      updateUrl: upload.data.updateUrl,
      sha256: upload.data.sha256,
      sizeBytes: upload.data.sizeBytes
    })
  });
  assert.equal(publishResponse.status, 200);

  const manifestResponse = await fetch(`${baseUrl}/api/v1/manifest`);
  const publishedManifest = await manifestResponse.json();
  assert.equal(publishedManifest.client.latestVersion, '2.0.0');
  assert.equal(publishedManifest.client.sha256, upload.data.sha256);

  const installerResponse = await fetch(`${baseUrl}${new URL(upload.data.updateUrl).pathname}`);
  assert.equal(installerResponse.status, 200);
  assert.deepEqual(Buffer.from(await installerResponse.arrayBuffer()), installer);
});

test('admin-assigned skin, cape collections, and wing collections are exposed to launcher clients', async (t) => {
  const playerUuid = '11111111-1111-4111-8111-111111111111';
  const accounts = new Map([[playerUuid, { uuid: playerUuid, username: 'CosmeticPlayer', type: 'microsoft' }]]);
  const cosmetics = new Map();
  const assets = new Map();
  const library = new Map();
  const storage = {
    async getAccount(uuid) { return accounts.get(uuid) || null; },
    async getAccountByUsername(username) {
      return [...accounts.values()].find((account) => account.username.toLowerCase() === username.toLowerCase()) || null;
    },
    async getCosmetics(uuid) { return structuredClone(cosmetics.get(uuid) || null); },
    async getAllCosmetics() { return [...cosmetics.values()].map((entry) => structuredClone(entry)); },
    async isAssetAssigned(sha256) {
      return [...cosmetics.values()].some((entry) => [entry.skin, entry.cape, entry.elytra, ...(entry.metadata?.capes || []), ...(entry.metadata?.elytras || [])]
        .some((asset) => asset?.enabled === true && asset.sha256 === sha256));
    },
    async getCosmeticLibrary() { return [...library.values()].map((item) => structuredClone(item)); },
    async getCosmeticLibraryItem(assetId) { return structuredClone(library.get(assetId) || null); },
    async saveCosmeticLibraryItem(item) { library.set(item.assetId, structuredClone(item)); return structuredClone(item); },
    async deleteCosmeticLibraryItem(assetId) { return library.delete(assetId); },
    async saveAsset(hash, bytes, contentType) { assets.set(hash, { buffer: Buffer.from(bytes), contentType }); },
    async getAsset(hash) { return assets.get(hash) || null; },
    async saveCosmetics(uuid, data, expectedVersion) {
      const currentVersion = Number(cosmetics.get(uuid)?.version || 0);
      if (currentVersion !== expectedVersion) return null;
      const updated = { playerUuid: uuid, ...structuredClone(data), version: currentVersion + 1, updatedAt: new Date().toISOString() };
      cosmetics.set(uuid, updated);
      return structuredClone(updated);
    }
  };
  const server = createApp(storage);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = AuthService.createSessionToken('admin@example.com');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const makePngHeader = (width, height) => {
    const header = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    Buffer.from('IHDR').copy(header, 12);
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return header;
  };
  const png = makePngHeader(64, 64);
  const uploadResponse = await fetch(`${baseUrl}/api/v1/admin/cosmetics/library`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Admin skin', kind: 'skin', contentType: 'image/png', data: png.toString('base64') })
  });
  assert.equal(uploadResponse.status, 201);
  const uploaded = await uploadResponse.json();
  const privateBeforeAssignment = await fetch(`${baseUrl}/api/v1/cosmetics/assets/${uploaded.data.sha256}`);
  assert.equal(privateBeforeAssignment.status, 404);
  const uploadLibraryItem = async (name, kind) => {
    const baseTexture = kind === 'skin' ? makePngHeader(64, 64) : makePngHeader(64, 32);
    const texture = Buffer.concat([baseTexture, Buffer.from(name)]);
    const response = await fetch(`${baseUrl}/api/v1/admin/cosmetics/library`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, kind, contentType: 'image/png', data: texture.toString('base64') })
    });
    assert.equal(response.status, 201);
    return (await response.json()).data;
  };
  const capeOne = await uploadLibraryItem('Cape one', 'cape');
  const capeTwo = await uploadLibraryItem('Cape two', 'cape');
  const wingsOne = await uploadLibraryItem('Wings one', 'elytra');
  const wingsTwo = await uploadLibraryItem('Wings two', 'elytra');

  const publicBeforeAssignment = await fetch(`${baseUrl}/api/v1/cosmetics/assigned`);
  assert.deepEqual((await publicBeforeAssignment.json()).data, []);
  const unauthorizedLibrary = await fetch(`${baseUrl}/api/v1/admin/cosmetics/library`);
  assert.equal(unauthorizedLibrary.status, 401);
  const privateLibrary = await fetch(`${baseUrl}/api/v1/admin/cosmetics/library`, { headers });
  assert.ok((await privateLibrary.json()).data.some((item) => item.name === 'Admin skin'));

  const assignmentResponse = await fetch(`${baseUrl}/api/v1/admin/cosmetics/CosmeticPlayer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expectedVersion: 0,
      skin: { assetId: uploaded.data.assetId, sha256: uploaded.data.sha256 },
      capes: [capeOne, capeTwo].map(({ assetId, sha256 }) => ({ assetId, sha256 })),
      elytras: [wingsOne, wingsTwo].map(({ assetId, sha256 }) => ({ assetId, sha256 }))
    })
  });
  assert.equal(assignmentResponse.status, 200);

  const feedResponse = await fetch(`${baseUrl}/api/v1/cosmetics/assigned`);
  const feed = await feedResponse.json();
  assert.equal(feed.data.length, 1);
  assert.equal(feed.data[0].username, 'CosmeticPlayer');
  assert.equal(feed.data[0].skin.assetId, uploaded.data.assetId);
  assert.deepEqual(feed.data[0].capes.map((item) => item.assetId), [capeOne.assetId, capeTwo.assetId]);
  assert.deepEqual(feed.data[0].elytras.map((item) => item.assetId), [wingsOne.assetId, wingsTwo.assetId]);
  assert.equal(feed.data[0].cape.assetId, capeOne.assetId);
  assert.ok(assets.has(feed.data[0].skin.assetId));
  const assignedAsset = await fetch(`${baseUrl}/api/v1/cosmetics/assets/${uploaded.data.sha256}`);
  assert.equal(assignedAsset.status, 200);

  const removalResponse = await fetch(`${baseUrl}/api/v1/admin/cosmetics/${playerUuid}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedVersion: 1, skin: { enabled: false } })
  });
  const removal = await removalResponse.json();
  assert.equal(removalResponse.status, 200);
  assert.equal(removal.data.metadata.adminAssignedKinds.includes('skin'), false);
  assert.equal(removal.data.metadata.adminAssignedKinds.includes('cape'), true);
  assert.ok(removal.data.metadata.capes.some((item) => item.assetId === capeOne.assetId));

  const deletionWhileAssigned = await fetch(`${baseUrl}/api/v1/admin/cosmetics/library/${uploaded.data.assetId}`, {
    method: 'DELETE', headers
  });
  assert.equal(deletionWhileAssigned.status, 200);

  const deletionWhileCollectionAssigned = await fetch(`${baseUrl}/api/v1/admin/cosmetics/library/${capeOne.assetId}`, {
    method: 'DELETE', headers
  });
  assert.equal(deletionWhileCollectionAssigned.status, 409);

  const finalRemoval = await fetch(`${baseUrl}/api/v1/admin/cosmetics/${playerUuid}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedVersion: 2, capes: [], elytras: [] })
  });
  assert.equal(finalRemoval.status, 200);
  const capeDelete = await fetch(`${baseUrl}/api/v1/admin/cosmetics/library/${capeOne.assetId}`, { method: 'DELETE', headers });
  assert.equal(capeDelete.status, 200);
});
