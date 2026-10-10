import { CONFIG } from '../config.mjs';
import { DiscordOAuthService } from './discordOAuthService.mjs';
import { fetchSupabase } from './supabaseHttp.mjs';

const normalizeEmail = (email) => typeof email === 'string' ? email.trim().toLowerCase() : '';
const validEmail = (email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validUsername = (username) => typeof username === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(username.trim());
const validPassword = (password) => typeof password === 'string'
  && password.length >= 8
  && password.length <= 256
  && /[A-Z]/.test(password)
  && /[a-z]/.test(password)
  && /\d/.test(password)
  && /[^A-Za-z0-9]/.test(password);

function reply(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function normalizeUuidLike(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed : '';
}

function normalizeMinecraftProfileUuid(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(normalized)) return '';
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

function safeUser(user, fallbackUsername = '') {
  const username = user?.user_metadata?.username || fallbackUsername;
  const minecraftUuid = normalizeUuidLike(user?.app_metadata?.minecraftUuid) || normalizeUuidLike(user?.app_metadata?.minecraft_uuid);
  const minecraftUsernameValue = user?.app_metadata?.minecraftUsername || user?.app_metadata?.minecraft_username;
  const minecraftUsername = typeof minecraftUsernameValue === 'string' ? minecraftUsernameValue.trim() : '';
  const safe = {
    id: typeof user?.id === 'string' ? user.id : '',
    email: normalizeEmail(user?.email),
    username: validUsername(username) ? username.trim() : '',
  };

  if (minecraftUuid) {
    safe.minecraftUuid = minecraftUuid;
  }
  if (validUsername(minecraftUsername)) {
    safe.minecraftUsername = minecraftUsername;
  }

  return safe;
}

function getSafeAuthFailure(operation, status, providerResult) {
  const signal = [providerResult?.code, providerResult?.error, providerResult?.error_code, providerResult?.msg, providerResult?.message]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  if (status === 429 || /rate.?limit|too many requests/.test(signal)) {
    return { status: 429, code: 'AUTH_RATE_LIMITED', message: 'Too many account attempts. Wait a few minutes, then try again.' };
  }
  if (/invalid api key|api key.*invalid|unauthorized.*key/.test(signal)) {
    return { status: 503, code: 'AUTH_CONFIGURATION', message: 'Dew account sign-in is temporarily misconfigured on the server.' };
  }
  if (operation === 'signup' && /already registered|already exists|user_already_exists|email_exists/.test(signal)) {
    return { status: 409, code: 'ACCOUNT_ALREADY_EXISTS', message: 'This email is already registered. Sign in to the existing Dew account instead.' };
  }
  if (operation === 'signup' && /signup.*disabled|signups not allowed|registration is disabled/.test(signal)) {
    return { status: 503, code: 'SIGNUP_DISABLED', message: 'New Dew account registration is currently disabled. Contact DewClient support.' };
  }
  if (operation === 'verify' && /otp|token|expired|invalid/.test(signal)) {
    return { status: 400, code: 'EMAIL_CODE_INVALID', message: 'That verification code is invalid or expired. Request a new code and try again.' };
  }
  if (/weak.?password|password.*(weak|strength|characters)|password_too_short/.test(signal)) {
    return { status: 400, code: 'WEAK_PASSWORD', message: 'Use at least 8 characters with an uppercase letter, a lowercase letter, a number, and a symbol.' };
  }
  if (operation !== 'signup' && /email_not_confirmed|email not confirmed/.test(signal)) {
    return { status: 401, code: 'EMAIL_NOT_CONFIRMED', message: 'Confirm your email address, then try signing in again.' };
  }
  if (operation !== 'signup' && /invalid login credentials|invalid_credentials|user not found/.test(signal)) {
    return { status: 401, code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' };
  }
  if (status >= 500) {
    return { status: 502, code: 'AUTH_PROVIDER_ERROR', message: 'The account service is temporarily unavailable. Try again shortly.' };
  }
  return operation === 'signup'
    ? { status: 400, code: 'AUTH_FAILED', message: 'Account could not be created. Check the username, email, and password requirements, or sign in if you already have an account.' }
    : { status: 401, code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' };
}

export class DewUserAuthService {
  static async verifyAccessToken(accessToken) {
    if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 8192) {
      return { status: 'invalid' };
    }
    const discordUser = DiscordOAuthService.verifySessionToken(accessToken);
    if (discordUser) return { status: 'authenticated', user: discordUser };
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      return { status: 'unavailable' };
    }

    try {
      const response = await fetchSupabase(`${CONFIG.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      });
      if (response.status === 401 || response.status === 403) return { status: 'invalid' };
      if (!response.ok) return { status: 'unavailable' };
      const user = safeUser(await response.json());
      return user.id ? { status: 'authenticated', user } : { status: 'invalid' };
    } catch {
      return { status: 'unavailable' };
    }
  }

  static async verifyMinecraftAccessToken(accessToken) {
    if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 8192) {
      return { status: 'invalid' };
    }

    try {
      const response = await fetch('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      });
      if (response.status === 401 || response.status === 403) return { status: 'invalid' };
      if (!response.ok) return { status: 'unavailable' };
      const profile = await response.json();
      const uuid = normalizeMinecraftProfileUuid(profile?.id);
      const username = typeof profile?.name === 'string' ? profile.name.trim() : '';
      if (!uuid || !/^[A-Za-z0-9_]{3,16}$/.test(username)) return { status: 'invalid' };
      return { status: 'authenticated', profile: { uuid, username } };
    } catch {
      return { status: 'unavailable' };
    }
  }

  static async handleAvailabilityCheck(res, body) {
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const email = normalizeEmail(body?.email);
    const hasUsername = body?.username !== undefined;
    const hasEmail = body?.email !== undefined;
    if ((!hasUsername && !hasEmail)
      || (hasUsername && !validUsername(username))
      || (hasEmail && !validEmail(email))) {
      return reply(res, 400, {
        ok: false,
        error: { code: 'INVALID_AVAILABILITY_CHECK', message: 'Enter a valid username or email address to check.' }
      });
    }
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
      return reply(res, 503, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'Dew account availability cannot be checked right now.' } });
    }

    try {
      const response = await fetchSupabase(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/dew_check_signup_availability`, {
        method: 'POST',
        headers: {
          apikey: CONFIG.SUPABASE_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_username: username || null, p_email: email || null }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        return reply(res, 503, { ok: false, error: { code: 'AVAILABILITY_UNAVAILABLE', message: 'Dew account availability cannot be checked right now.' } });
      }

      const result = await response.json();
      const row = Array.isArray(result) ? result[0] : result;
      if (typeof row?.username_available !== 'boolean' || typeof row?.email_available !== 'boolean') {
        return reply(res, 502, { ok: false, error: { code: 'AVAILABILITY_RESPONSE_INVALID', message: 'The account server returned an invalid availability response.' } });
      }

      return reply(res, 200, {
        ok: true,
        data: {
          usernameAvailable: hasUsername ? row.username_available : null,
          emailAvailable: hasEmail ? row.email_available : null
        }
      });
    } catch {
      return reply(res, 503, { ok: false, error: { code: 'AVAILABILITY_UNAVAILABLE', message: 'Dew account availability cannot be checked right now.' } });
    }
  }

  static async handleSignup(res, body) {
    const email = normalizeEmail(body?.email);
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = body?.password;
    if (!validEmail(email) || !validUsername(username) || !validPassword(password)) {
      return reply(res, 400, {
        ok: false,
        error: { code: 'INVALID_SIGNUP', message: 'Enter a valid email, a 3-16 character username, and a password meeting all requirements.' }
      });
    }

    return this.requestAuth(res, 'signup', {
      email,
      password,
      data: { username }
    }, username);
  }

  static async handleVerifySignupCode(res, body) {
    const email = normalizeEmail(body?.email);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!validEmail(email) || !/^\d{6,8}$/.test(token)) {
      return reply(res, 400, {
        ok: false,
        error: { code: 'INVALID_EMAIL_CODE', message: 'Enter the email address and the 6-8 digit verification code.' }
      });
    }
    return this.requestAuth(res, 'verify', { email, token, type: 'email' });
  }

  static async handleResendSignupCode(res, body) {
    const email = normalizeEmail(body?.email);
    if (!validEmail(email)) {
      return reply(res, 400, { ok: false, error: { code: 'INVALID_EMAIL', message: 'Enter a valid email address.' } });
    }
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      return reply(res, 503, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'Dew account sign-in is not configured on the server.' } });
    }
    try {
      const response = await fetchSupabase(`${CONFIG.SUPABASE_URL}/auth/v1/resend`, {
        method: 'POST',
        headers: { apikey: CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'signup', email }),
        signal: AbortSignal.timeout(15_000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = getSafeAuthFailure('signup', response.status, result);
        return reply(res, failure.status, { ok: false, error: { code: failure.code, message: failure.message } });
      }
      return reply(res, 200, { ok: true, data: { email } });
    } catch {
      return reply(res, 502, { ok: false, error: { code: 'AUTH_PROVIDER_UNAVAILABLE', message: 'Could not reach the account authentication service.' } });
    }
  }

  static async handleLogin(res, body) {
    const email = normalizeEmail(body?.email);
    const password = body?.password;
    if (!validEmail(email) || typeof password !== 'string' || password.length < 1 || password.length > 256) {
      return reply(res, 400, { ok: false, error: { code: 'INVALID_LOGIN', message: 'Enter a valid email and password.' } });
    }

    return this.requestAuth(res, 'token?grant_type=password', { email, password });
  }

  static async handleLogout(res, body) {
    const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : '';
    if (!accessToken || accessToken.length > 8192) {
      return reply(res, 400, { ok: false, error: { code: 'INVALID_SESSION', message: 'A valid session is required to sign out.' } });
    }
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      return reply(res, 503, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'Dew account sign-in is not configured on the server.' } });
    }

    try {
      const response = await fetchSupabase(`${CONFIG.SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`
        },
        signal: AbortSignal.timeout(10_000)
      });
      return reply(res, response.ok ? 200 : 502, response.ok
        ? { ok: true }
        : { ok: false, error: { code: 'SIGNOUT_FAILED', message: 'The server could not revoke the account session.' } });
    } catch {
      return reply(res, 502, { ok: false, error: { code: 'AUTH_PROVIDER_UNAVAILABLE', message: 'Could not reach the account authentication service.' } });
    }
  }

  static async requestAuth(res, operation, body, fallbackUsername = '') {
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      return reply(res, 503, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'Dew account sign-in is not configured on the server.' } });
    }

    try {
      const response = await fetchSupabase(`${CONFIG.SUPABASE_URL}/auth/v1/${operation}`, {
        method: 'POST',
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = getSafeAuthFailure(operation, response.status, result);
        return reply(res, failure.status, { ok: false, error: { code: failure.code, message: failure.message } });
      }

      const user = safeUser(result.user, fallbackUsername);
      const session = result.access_token && result.refresh_token
        ? {
          accessToken: result.access_token,
          refreshToken: result.refresh_token,
          expiresAt: Date.now() + Math.max(0, Number(result.expires_in) || 0) * 1000
        }
        : null;

      if (!user.id || !user.email) {
        return reply(res, 502, { ok: false, error: { code: 'AUTH_RESPONSE_INVALID', message: 'The authentication provider returned an invalid account.' } });
      }

      if (operation === 'signup' && !session) {
        return reply(res, 200, { ok: true, data: { user, session: null, emailConfirmationRequired: true } });
      }
      if (!session) {
        return reply(res, 502, { ok: false, error: { code: 'AUTH_SESSION_MISSING', message: 'The authentication provider did not issue a session.' } });
      }

      return reply(res, 200, { ok: true, data: { user, session, emailConfirmationRequired: false } });
    } catch {
      return reply(res, 502, { ok: false, error: { code: 'AUTH_PROVIDER_UNAVAILABLE', message: 'Could not reach the account authentication service.' } });
    }
  }
}
