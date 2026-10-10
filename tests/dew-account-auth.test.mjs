import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret-with-more-bytes';
process.env.PUBLIC_DOMAIN = 'server.example.test';
process.env.CORS_ORIGINS = 'null';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_KEY = 'test-service-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.DEWCLIENT_RELEASE_DIR = 'test-releases';

const { createApp } = await import('../server/src/index.mjs');

async function withServer(run) {
  const server = createApp({});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/v1/auth`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Dew signup proxies credentials to Supabase Auth and returns only a sanitized session', async () => {
  const originalFetch = globalThis.fetch;
  let authRequest;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://test-project.supabase.co/')) return originalFetch(url, options);
    authRequest = { url: String(url), options, body: JSON.parse(options.body) };
    return Response.json({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      user: { id: 'user-uuid', email: 'player@example.com', user_metadata: { username: 'PlayerOne' }, app_metadata: { role: 'service_role' } }
    });
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'PlayerOne', email: 'PLAYER@example.com', password: 'StrongPass1!' })
      });
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(authRequest.url, 'https://test-project.supabase.co/auth/v1/signup');
      assert.equal(authRequest.options.headers.apikey, 'test-anon-key');
      assert.deepEqual(authRequest.body, {
        email: 'player@example.com',
        password: 'StrongPass1!',
        data: { username: 'PlayerOne' }
      });
      assert.deepEqual(result.data.user, { id: 'user-uuid', email: 'player@example.com', username: 'PlayerOne' });
      assert.equal(result.data.session.accessToken, 'access-token');
      assert.equal(result.data.session.refreshToken, 'refresh-token');
      assert.equal(typeof result.data.session.expiresAt, 'number');
      assert.equal(JSON.stringify(result).includes('service_role'), false);
      assert.equal(JSON.stringify(result).includes('StrongPass1!'), false);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Dew login proxies email and password to the password grant endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let authRequest;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://test-project.supabase.co/')) return originalFetch(url, options);
    authRequest = { url: String(url), options, body: JSON.parse(options.body) };
    return Response.json({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 1800,
      user: { id: 'user-uuid', email: 'player@example.com', user_metadata: { username: 'PlayerOne' } }
    });
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'PLAYER@example.com', password: 'StrongPass1!' })
      });
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(authRequest.url, 'https://test-project.supabase.co/auth/v1/token?grant_type=password');
      assert.deepEqual(authRequest.body, { email: 'player@example.com', password: 'StrongPass1!' });
      assert.equal(result.data.user.username, 'PlayerOne');
      assert.equal(result.data.session.accessToken, 'access-token');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Dew signup reports email confirmation without inventing an authenticated session', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://test-project.supabase.co/')) return originalFetch(url, options);
    return Response.json({ user: { id: 'user-uuid', email: 'player@example.com', user_metadata: { username: 'PlayerOne' } }, session: null });
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'PlayerOne', email: 'player@example.com', password: 'StrongPass1!' })
      });
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(result.data.emailConfirmationRequired, true);
      assert.equal(result.data.session, null);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Dew signup rejects invalid fields before calling Supabase', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://test-project.supabase.co/')) return originalFetch(url, options);
    called = true;
    return Response.json({});
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'x', email: 'nope', password: 'bad' })
      });
      assert.equal(response.status, 400);
      assert.equal(called, false);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Dew account availability checks use the private Supabase RPC and return per-field results', async () => {
  const originalFetch = globalThis.fetch;
  let availabilityRequest;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://test-project.supabase.co/')) return originalFetch(url, options);
    availabilityRequest = { url: String(url), options, body: JSON.parse(options.body) };
    return Response.json([{ username_available: false, email_available: true }]);
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/check-availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'PlayerOne', email: 'NEW@example.com' })
      });
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(availabilityRequest.url, 'https://test-project.supabase.co/rest/v1/rpc/dew_check_signup_availability');
      assert.equal(availabilityRequest.options.headers.apikey, 'test-service-key');
      assert.equal(availabilityRequest.options.headers.Authorization, 'Bearer test-service-key');
      assert.deepEqual(availabilityRequest.body, { p_username: 'PlayerOne', p_email: 'new@example.com' });
      assert.deepEqual(result.data, { usernameAvailable: false, emailAvailable: true });
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Dew account availability rejects malformed values without querying Supabase', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://test-project.supabase.co/')) return originalFetch(url, options);
    called = true;
    return Response.json({});
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/check-availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'x' })
      });
      assert.equal(response.status, 400);
      assert.equal(called, false);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Dew logout revokes the access token through Supabase Auth', async () => {
  const originalFetch = globalThis.fetch;
  let authRequest;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://test-project.supabase.co/')) return originalFetch(url, options);
    authRequest = { url: String(url), options };
    return new Response(null, { status: 204 });
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: 'session-access-token' })
      });
      assert.equal(response.status, 200);
      assert.equal(authRequest.url, 'https://test-project.supabase.co/auth/v1/logout');
      assert.equal(authRequest.options.headers.Authorization, 'Bearer session-access-token');
      assert.equal(authRequest.options.headers.apikey, 'test-anon-key');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});