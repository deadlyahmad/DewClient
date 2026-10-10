import crypto from 'node:crypto';
import { CONFIG } from '../config.mjs';

const AUTH_TTL_MS = 5 * 60 * 1000;
const TICKET_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const pendingStates = new Map();
const pendingTickets = new Map();

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function redirectHtml(res, ticket) {
  const target = `dewclient://auth/discord?ticket=${encodeURIComponent(ticket)}`;
  const escaped = target.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Discord sign-in · DewClient</title><style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#f7f7f8;background:#09090b;font-synthesis:none;text-rendering:optimizeLegibility}
    *{box-sizing:border-box}body{min-height:100svh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 38%,rgba(88,101,242,.13),transparent 44%),linear-gradient(145deg,#0b0b0d,#111114 58%,#09090b)}
    .shell{width:min(100%,540px)}.brand{display:flex;align-items:center;gap:10px;margin:0 0 18px 5px;color:#c7c7cf;font-size:13px;font-weight:700;letter-spacing:.02em}.mark{display:block;width:32px;height:32px;border:1px solid #38383e;border-radius:10px;background:#17171b;object-fit:cover}
    .card{padding:clamp(25px,6vw,40px);border:1px solid #323238;border-radius:22px;background:linear-gradient(155deg,rgba(26,26,30,.97),rgba(17,17,20,.98));box-shadow:0 28px 100px rgba(0,0,0,.42),inset 0 1px rgba(255,255,255,.035)}
    .status{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid rgba(52,211,153,.22);border-radius:999px;background:rgba(16,185,129,.08);color:#a7f3d0;font-size:12px;font-weight:700}.dot{width:7px;height:7px;border-radius:50%;background:#34d399;box-shadow:0 0 12px #34d399}
    h1{margin:19px 0 9px;font-size:clamp(25px,6vw,34px);line-height:1.15;letter-spacing:-.035em}p{margin:0;color:#b4b4be;font-size:15px;line-height:1.65}.steps{display:grid;gap:10px;margin:23px 0;padding:15px 16px;border:1px solid #303036;border-radius:13px;background:rgba(255,255,255,.025);color:#c8c8d0;font-size:13px;line-height:1.5}.steps span{display:flex;gap:10px}.steps b{color:#a5b4fc}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:23px}.button{display:inline-flex;min-height:46px;align-items:center;justify-content:center;padding:0 18px;border:1px solid #626cf2;border-radius:11px;background:#5865f2;color:white;text-decoration:none;font-size:14px;font-weight:750;box-shadow:0 7px 20px rgba(88,101,242,.22);transition:transform .18s,filter .18s}.button:hover{filter:brightness(1.08);transform:translateY(-1px)}.quiet{margin-top:16px;color:#858590;font-size:11px;line-height:1.5}
    @media(prefers-color-scheme:light){:root{color:#17171b;background:#f5f5f7}body{background:radial-gradient(ellipse at 50% 38%,rgba(88,101,242,.12),transparent 45%),linear-gradient(145deg,#f7f7f9,#ececf2)}.brand{color:#555560}.mark{border-color:#dddde4;background:#fff;color:#202027}.card{border-color:#dedee5;background:linear-gradient(155deg,rgba(255,255,255,.98),rgba(249,249,252,.98));box-shadow:0 28px 90px rgba(25,25,45,.12)}p{color:#5f5f6b}.steps{border-color:#e4e4ea;background:#f7f7fa;color:#555560}.quiet{color:#777783}}
    @media(prefers-reduced-motion:reduce){.button{transition:none}}
  </style></head><body><main class="shell"><div class="brand"><img class="mark" src="/favicon.ico" alt="" width="32" height="32"><span>DewClient</span></div><section class="card"><div class="status"><span class="dot"></span>Discord verified</div><h1>You're signed in</h1><p>Your Discord sign-in is complete. Switch back to DewClient to finish creating or opening your in-game profile.</p><div class="steps"><span><b>01</b> Return to the DewClient launcher.</span><span><b>02</b> Choose your Minecraft name if this is your first sign-in.</span></div><div class="actions"><a class="button" id="open-client" href="${escaped}">Open DewClient</a></div><div class="quiet" id="redirect-note">DewClient should open automatically. If it does not, use the button above or return to the launcher.</div></section></main><script>
    history.replaceState(null,'',location.pathname);const target=${JSON.stringify(target)};setTimeout(()=>{try{location.href=target}catch{}},1100);
  </script></body></html>`);
}

function cleanup() {
  const now = Date.now();
  for (const [key, expiresAt] of pendingStates) if (expiresAt <= now) pendingStates.delete(key);
  for (const [key, value] of pendingTickets) if (value.expiresAt <= now) pendingTickets.delete(key);
}

function redirectUri() {
  if (!CONFIG.PUBLIC_DOMAIN) return '';
  return `https://${CONFIG.PUBLIC_DOMAIN}/api/v1/auth/discord/callback`;
}

function discordSession(account, discordProfile) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    typ: 'access',
    iss: 'dewclient',
    aud: 'dewclient-api',
    sub: `discord:${discordProfile.id}`,
    discordUserId: discordProfile.id,
    uuid: account.player_uuid,
    username: account.username,
    createdAt: account.created_at || null,
    lastUsernameChangeAt: account.last_username_change_at || null,
    nextUsernameChangeAt: account.last_username_change_at
      ? new Date(new Date(account.last_username_change_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
    iat: now,
    exp: now + SESSION_TTL_MS / 1000
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', CONFIG.ADMIN_SESSION_SECRET)
    .update(`dewclient-discord-v1.${encoded}`)
    .digest('base64url');
  const accessToken = `dc1.${encoded}.${signature}`;
  return {
    user: {
      id: payload.sub,
      discordUserId: discordProfile.id,
      username: account.username,
      minecraftUuid: account.player_uuid,
      createdAt: account.created_at || null,
      lastUsernameChangeAt: account.last_username_change_at || null,
      nextUsernameChangeAt: account.last_username_change_at
        ? new Date(new Date(account.last_username_change_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
      provider: 'discord',
      avatarUrl: discordProfile.avatarUrl || null
    },
    session: {
      accessToken,
      refreshToken: accessToken,
      expiresAt: Date.now() + SESSION_TTL_MS
    }
  };
}

export class DiscordOAuthService {
  static getRedirectUri() { return redirectUri(); }

  static verifySessionToken(token) {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const match = /^dc1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match || !CONFIG.ADMIN_SESSION_SECRET) return null;
    const expected = crypto.createHmac('sha256', CONFIG.ADMIN_SESSION_SECRET)
      .update(`dewclient-discord-v1.${match[1]}`)
      .digest();
    let provided;
    try { provided = Buffer.from(match[2], 'base64url'); } catch { return null; }
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      if (payload.typ !== 'access' || payload.iss !== 'dewclient' || payload.aud !== 'dewclient-api'
        || !/^\d{17,20}$/.test(payload.discordUserId || '')
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.uuid || '')
        || !/^[A-Za-z0-9_]{3,16}$/.test(payload.username || '')
        || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
      return {
        id: payload.sub,
        discordUserId: payload.discordUserId,
        username: payload.username,
        minecraftUuid: payload.uuid,
        provider: 'discord'
      };
    } catch { return null; }
  }

  static async handleStart(res) {
    cleanup();
    if (!CONFIG.DISCORD_APPLICATION_ID || !CONFIG.DISCORD_OAUTH_CLIENT_SECRET || !redirectUri()) {
      return sendJson(res, 503, { ok: false, error: { code: 'DISCORD_OAUTH_NOT_CONFIGURED', message: 'Discord sign-in needs the Discord OAuth2 client secret on the server.' } });
    }
    const state = crypto.randomBytes(32).toString('base64url');
    pendingStates.set(state, Date.now() + AUTH_TTL_MS);
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', CONFIG.DISCORD_APPLICATION_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    return sendJson(res, 200, { ok: true, data: { authorizationUrl: url.toString(), redirectUri: redirectUri() } });
  }

  static async handleCallback(req, res, query) {
    cleanup();
    const state = typeof query.state === 'string' ? query.state : '';
    const code = typeof query.code === 'string' ? query.code : '';
    if (query.error || !/^[A-Za-z0-9_-]{24,128}$/.test(state) || !pendingStates.has(state) || !code || code.length > 2048) {
      return sendJson(res, 400, { ok: false, error: { code: 'DISCORD_OAUTH_INVALID', message: 'Discord sign-in expired or was cancelled. Return to DewClient and try again.' } });
    }
    pendingStates.delete(state);
    try {
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: CONFIG.DISCORD_APPLICATION_ID,
          client_secret: CONFIG.DISCORD_OAUTH_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri()
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || typeof tokenData.access_token !== 'string') throw new Error('OAuth token exchange failed.');
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      });
      const profile = await userResponse.json().catch(() => ({}));
      if (!userResponse.ok || !/^\d{17,20}$/.test(String(profile.id || ''))) throw new Error('Discord profile verification failed.');
      const ticket = crypto.randomBytes(32).toString('base64url');
      const avatarUrl = profile.avatar && /^[a-f0-9]{32}$/i.test(profile.avatar)
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128` : null;
      const display = typeof profile.global_name === 'string' && profile.global_name.trim()
        ? profile.global_name.trim() : String(profile.username || '');
      pendingTickets.set(ticket, {
        discord: { id: String(profile.id), username: String(profile.username || ''), displayName: display, avatarUrl },
        expiresAt: Date.now() + TICKET_TTL_MS
      });
      return redirectHtml(res, ticket);
    } catch {
      return sendJson(res, 502, { ok: false, error: { code: 'DISCORD_OAUTH_FAILED', message: 'Discord could not finish sign-in. Check your OAuth redirect settings and try again.' } });
    }
  }

  static async handleExchange(res, body, storage) {
    cleanup();
    const ticket = typeof body?.ticket === 'string' ? body.ticket : '';
    const pending = pendingTickets.get(ticket);
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(ticket) || !pending) {
      return sendJson(res, 401, { ok: false, error: { code: 'DISCORD_TICKET_EXPIRED', message: 'Discord sign-in expired. Start the sign-in flow again.' } });
    }
    let existing;
    try {
      existing = await storage.getDiscordAccount(pending.discord.id);
    } catch (error) {
      console.error('[DISCORD] Account lookup failed:', error?.message || 'storage error');
      return sendJson(res, 503, { ok: false, error: { code: 'DISCORD_ACCOUNT_LOOKUP_FAILED', message: 'Discord sign-in succeeded, but DewClient could not check your profile right now. Please try again shortly.' } });
    }
    if (existing) {
      pendingTickets.delete(ticket);
      const auth = discordSession(existing, pending.discord);
      return sendJson(res, 200, { ok: true, data: auth });
    }
    // A Discord OAuth profile and a Microsoft profile are separate DewClient
    // identities. Linking Discord to a Microsoft profile is a community
    // verification action and must never make that Microsoft profile
    // accessible through Discord sign-in (or block a separate Discord profile).
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    if (!username) {
      const suggested = pending.discord.displayName.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
      return sendJson(res, 200, { ok: true, data: { requiresUsername: true, suggestedUsername: /^[A-Za-z0-9_]{3,16}$/.test(suggested) ? suggested : '' } });
    }
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      return sendJson(res, 400, { ok: false, error: { code: 'INVALID_USERNAME', message: 'Choose an in-game name with 3–16 letters, numbers, or underscores.' } });
    }
    try {
      const account = await storage.createDiscordAccount({
        discordUserId: pending.discord.id,
        uuid: offlinePlayerUuid(username),
        username,
        guildId: CONFIG.DISCORD_LINK_GUILD_ID,
        discordUsername: pending.discord.username,
        discordDisplayName: pending.discord.displayName
      });
      if (!account) return sendJson(res, 503, { ok: false, error: { code: 'DISCORD_ACCOUNT_CREATE_FAILED', message: 'DewClient could not save your profile right now. Please try again shortly.' } });
      pendingTickets.delete(ticket);
      return sendJson(res, 201, { ok: true, data: discordSession(account, pending.discord) });
    } catch (error) {
      console.error('[DISCORD] Account creation failed:', error?.message || 'storage error');
      if (error?.code === 'USERNAME_UNAVAILABLE') {
        return sendJson(res, 409, { ok: false, error: { code: 'USERNAME_UNAVAILABLE', message: 'That in-game name is already taken. Choose another one.' } });
      }
      if (error?.code === 'INVALID_DISCORD_PROFILE') return sendJson(res, 400, { ok: false, error: { code: 'INVALID_DISCORD_PROFILE', message: 'DewClient could not validate that profile name. Please try again.' } });
      if (error?.code === 'DISCORD_PROFILE_CONFLICT') return sendJson(res, 409, { ok: false, error: { code: 'DISCORD_PROFILE_CONFLICT', message: 'That name or profile is already registered. Choose another name or sign in to the Discord profile that owns it.' } });
      return sendJson(res, 503, { ok: false, error: { code: 'DISCORD_ACCOUNT_CREATE_FAILED', message: 'Your Discord account was verified, but the profile could not be saved. Try again.' } });
    }
  }

  static async handleRename(req, res, body, storage) {
    const authorization = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1] || '';
    const user = this.verifySessionToken(authorization);
    if (!user) return sendJson(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in with Discord again to change your in-game name.' } });
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return sendJson(res, 400, { ok: false, error: { code: 'INVALID_USERNAME', message: 'Choose an in-game name with 3–16 letters, numbers, or underscores.' } });
    try {
      const result = await storage.changeDiscordUsername(user.discordUserId, username);
      if (result?.status === 'cooldown') return sendJson(res, 409, { ok: false, error: { code: 'USERNAME_COOLDOWN', message: `You can change your in-game name again after ${result.availableAt}.` } });
      if (result?.status === 'unavailable') return sendJson(res, 409, { ok: false, error: { code: 'USERNAME_UNAVAILABLE', message: 'That in-game name is already used. Choose another one.' } });
      if (!result?.account) return sendJson(res, 404, { ok: false, error: { code: 'ACCOUNT_NOT_FOUND', message: 'The Discord profile could not be found.' } });
      const discord = { id: user.discordUserId, username: '', avatarUrl: null };
      return sendJson(res, 200, { ok: true, data: { ...discordSession(result.account, discord), usernameChangedAt: result.changedAt, nextNameChangeAt: result.nextChangeAt } });
    } catch {
      return sendJson(res, 503, { ok: false, error: { code: 'USERNAME_CHANGE_FAILED', message: 'The in-game name could not be changed right now. Try again.' } });
    }
  }
}

function offlinePlayerUuid(username) {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
