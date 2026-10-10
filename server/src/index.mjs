/**
 * DewClient Central Management & Cosmetics Backend Server
 * Supabase database, signed client APIs, and email/password admin authentication
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, validateServerConfig } from './config.mjs';
import { getStorage } from './adapters/index.mjs';
import { AuthService } from './services/authService.mjs';
import { DewUserAuthService } from './services/dewUserAuthService.mjs';
import { DiscordOAuthService } from './services/discordOAuthService.mjs';
import { DewCosmeticsSessionService } from './services/dewCosmeticsSessionService.mjs';
import { handleCreateDewCosmeticsSession, handleEquipOwnCape, handleGetOwnDewCosmetics } from './routes/dewCosmeticsRoutes.mjs';
import { handleClientRegister, handleClientHeartbeat } from './routes/clientRoutes.mjs';
import { CANONICAL_LINKS, handleGetManifest, normalizeManifestLinks } from './routes/manifestRoutes.mjs';
import {
  handleGetPlayerCosmetics,
  handleGetPlayersCosmetics,
  handlePublishModCosmetic,
  handleGetAssignedCosmetics,
  handleGetAdminCosmetics,
  handleAdminAssignCosmetics,
  handleGetAdminCosmeticLibrary,
  handleGetAdminCosmeticPreview,
  handleAdminUploadCosmetic,
  handleAdminDeleteCosmetic,
  handleAdminSetCosmeticFree,
  handlePublishCosmetics,
  handleGetAsset
} from './routes/cosmeticsRoutes.mjs';
import {
  handleListFreeCapes,
  handleCreateFreeCapeClaimCode,
  handleClaimFreeCape,
  handleEquipFreeCape,
  handleGetFreeCapePreview,
  handleFreeCapeClaimStatus,
  handleDiscordInteraction
} from './routes/freeCapeRoutes.mjs';
import {
  handleGetStats,
  handleGetAccounts,
  handleGetClients,
  handleUpdateServer,
  handleDeleteServer,
  handleUpdateNews,
  handleDeleteNews,
  handleUpdateAnnouncement,
  handleDeleteAnnouncement,
  handleToggleMaintenance,
  handleGetClientRelease,
  handleUpdateClientRelease,
  handleUploadClientRelease,
  handleGetStaff,
  handleCreateStaff,
  handleUpdateStaff
} from './routes/adminRoutes.mjs';
import { handleGetBugReports, handleSubmitBugReport, handleUpdateBugReport } from './routes/bugReportRoutes.mjs';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const RATE_LIMIT_MAX_LOGIN_REQUESTS = 10;
const RATE_LIMIT_MAX_COSMETIC_ASSET_REQUESTS = 600;
const RATE_LIMIT_MAX_COSMETIC_BATCH_REQUESTS = 60;
const RATE_LIMIT_MAX_BUG_REPORTS = 3;
const RATE_LIMIT_BUG_REPORT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_CAPE_CODES = 5;
const RATE_LIMIT_CAPE_CODE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_CLIENTS = 10_000;
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
// Admin texture payloads use base64 JSON, which adds roughly 33% over the 50 MiB PNG limit.
const MAX_COSMETIC_UPLOAD_BODY_BYTES = 70 * 1024 * 1024;

export function getClientId(req) {
  const remoteAddress = req.socket?.remoteAddress || req.headers['x-real-ip'] || 'unknown';
  const forwardedFor = req.headers['x-forwarded-for'];
  const isLoopbackProxy = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress.startsWith('::ffff:127.');
  if (CONFIG.TRUST_PROXY && isLoopbackProxy && typeof forwardedFor === 'string' && forwardedFor.trim()) {
    const forwardedIps = forwardedFor.split(',').map((address) => address.trim()).filter(Boolean);
    if (forwardedIps.length === 1) return forwardedIps[0];
  }

  return remoteAddress;
}

function applyRateLimit(req, res, clientBuckets) {
  if (!req.url || !req.url.startsWith('/api/v1')) {
    return false;
  }

  const requestPath = new URL(req.url, 'http://localhost').pathname;
  const isLoginAttempt = req.method === 'POST' && [
    '/api/v1/admin/login',
    '/api/v1/auth/discord/exchange',
    '/api/v1/auth/discord/change-username',
    '/api/v1/client/mod-sessions'
  ].includes(requestPath);
  const isCosmeticAsset = req.method === 'GET' && (/^\/api\/v1\/cosmetics\/assets?\/[a-f0-9]{64}$/i.test(requestPath) || /^\/api\/v1\/cosmetics\/free\/[a-f0-9]{64}\/preview$/i.test(requestPath));
  const isCosmeticBatch = req.method === 'GET' && requestPath === '/api/v1/cosmetics/players';
  const isBugReport = req.method === 'POST' && requestPath === '/api/v1/bug-reports';
  const isCapeClaimOperation = req.method === 'POST' && ['/api/v1/cosmetics/free-claims/link-code', '/api/v1/cosmetics/free-claims/claim', '/api/v1/cosmetics/free-claims/equip'].includes(requestPath);
  const lane = isLoginAttempt ? 'login'
      : isCosmeticAsset ? 'cosmetic-assets'
        : isCosmeticBatch ? 'cosmetic-batch'
          : isBugReport ? 'bug-report'
            : isCapeClaimOperation ? 'cape-claim' : 'api';
  const key = `${getClientId(req)}|${lane}`;
  const requestLimit = isLoginAttempt ? RATE_LIMIT_MAX_LOGIN_REQUESTS
      : isCosmeticAsset ? RATE_LIMIT_MAX_COSMETIC_ASSET_REQUESTS
        : isCosmeticBatch ? RATE_LIMIT_MAX_COSMETIC_BATCH_REQUESTS
      : isBugReport ? RATE_LIMIT_MAX_BUG_REPORTS
        : isCapeClaimOperation ? RATE_LIMIT_MAX_CAPE_CODES : RATE_LIMIT_MAX_REQUESTS;
  const windowMs = isBugReport ? RATE_LIMIT_BUG_REPORT_WINDOW_MS
    : isCapeClaimOperation ? RATE_LIMIT_CAPE_CODE_WINDOW_MS : RATE_LIMIT_WINDOW_MS;
  const now = Date.now();
  const entry = clientBuckets.get(key) || { count: 0, resetAt: now + windowMs };

  if (now >= entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }

  entry.count += 1;
  if (!clientBuckets.has(key) && clientBuckets.size >= RATE_LIMIT_MAX_CLIENTS) {
    const oldestKey = clientBuckets.keys().next().value;
    if (oldestKey !== undefined) clientBuckets.delete(oldestKey);
  }
  clientBuckets.set(key, entry);

  if (entry.count > requestLimit) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfter),
      'X-Robots-Tag': 'noindex, nofollow'
    });
    res.end(JSON.stringify({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please slow down and retry later.'
      }
    }));
    return true;
  }

  return false;
}

export function createApp(storage, options = {}) {
  if (!storage) throw new TypeError('A storage adapter is required.');
  const startTime = Date.now();
  const clientBuckets = new Map();
  const dewCosmeticsSessions = options.dewCosmeticsSessions || new DewCosmeticsSessionService({
    ...options.dewCosmeticsSessionOptions,
    linkMinecraftIdentity: options.dewCosmeticsSessionOptions?.linkMinecraftIdentity
      || (async (userId, playerUuid, username) => storage.linkDewMinecraftIdentity?.(userId, playerUuid, username) || false),
    getLinkedIdentity: options.dewCosmeticsSessionOptions?.getLinkedIdentity
      || (async (userId) => storage.getDewMinecraftIdentity?.(userId) || null)
  });

  const server = http.createServer(async (req, res) => {
    applyCors(req, res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (applyRateLimit(req, res, clientBuckets)) {
      return;
    }

    const host = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = parsedUrl.pathname;
    const query = Object.fromEntries(parsedUrl.searchParams.entries());

    if (pathname === '/api/v1/admin/release/upload' && req.method === 'POST') {
      try {
        const adminUser = await AuthService.verifySession(req);
        if (!adminUser) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Valid administrator credentials are required.' } }));
        }
        return await handleUploadClientRelease(req, res, query);
      } catch (err) {
        console.error('[SERVER] Installer upload failed:', err);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: { code: 'UPLOAD_FAILED', message: 'Installer upload failed.' } }));
      }
    }

    // 2. Read Request Body if POST/PUT/DELETE
    let rawBody = '';
    let parsedBody = null;

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      try {
        const bodyLimit = req.method === 'POST' && (pathname === '/api/v1/admin/cosmetics/library' || pathname === '/api/v1/cosmetics/publish' || pathname === '/api/v1/client/cosmetics/presence')
          ? MAX_COSMETIC_UPLOAD_BODY_BYTES
          : req.method === 'POST' && pathname === '/api/v1/discord/interactions' ? 64 * 1024
            : req.method === 'POST' && (pathname === '/api/v1/cosmetics/free-claims/link-code' || pathname === '/api/v1/cosmetics/free-claims/claim' || pathname === '/api/v1/cosmetics/free-claims/equip') ? 16 * 1024
          : req.method === 'POST' && pathname === '/api/v1/bug-reports' ? 16 * 1024 : MAX_REQUEST_BODY_BYTES;
        rawBody = await readBody(req, bodyLimit);
        if (rawBody && req.headers['content-type']?.includes('application/json')) {
          parsedBody = JSON.parse(rawBody);
        }
      } catch (err) {
        const tooLarge = err?.statusCode === 413;
        res.writeHead(tooLarge ? 413 : 400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: false,
          error: {
            code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
            message: tooLarge ? 'Request payload exceeds the allowed size limit.' : 'Malformed JSON payload.'
          }
        }));
      }
    }

    try {
      if (pathname === '/api/v1/discord/interactions' && req.method === 'POST') {
        return await handleDiscordInteraction(req, res, storage, rawBody, parsedBody);
      }

      // 3. Health & Public Info
      if (pathname === '/api/v1/ping' || pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          service: 'DewClient Central Server',
          version: '1.0.1',
          database: 'Supabase',
          time: new Date().toISOString()
        }));
      }

      if (pathname === '/api/v1/health' || pathname === '/health') {
        const databaseReady = typeof storage.checkHealth === 'function' && await storage.checkHealth();
        res.writeHead(databaseReady ? 200 : 503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: databaseReady,
          status: databaseReady ? 'healthy' : 'degraded',
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
          database: 'Supabase'
        }));
      }

      // Public Auth configuration for dashboard email/password login
      if (pathname === '/api/v1/auth/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          data: {
            authMode: 'admin_email_password',
            configured: Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY && CONFIG.ADMIN_SESSION_SECRET)
          }
        }));
      }

      if (pathname === '/api/v1/auth/discord/start' && req.method === 'GET') {
        return DiscordOAuthService.handleStart(res);
      }

      if (pathname === '/api/v1/auth/discord/callback' && req.method === 'GET') {
        return await DiscordOAuthService.handleCallback(req, res, query);
      }

      if (pathname === '/api/v1/auth/discord/exchange' && req.method === 'POST') {
        return await DiscordOAuthService.handleExchange(res, parsedBody, storage);
      }

      if (pathname === '/api/v1/auth/discord/change-username' && req.method === 'POST') {
        return await DiscordOAuthService.handleRename(req, res, parsedBody, storage);
      }

      if (pathname === '/api/v1/bug-reports' && req.method === 'POST') {
        return await handleSubmitBugReport(res, storage, parsedBody);
      }

      if (pathname === '/api/v1/client/mod-sessions' && req.method === 'POST') {
        return await handleCreateDewCosmeticsSession(req, res, dewCosmeticsSessions, parsedBody);
      }

      if (pathname === '/api/v1/client/cosmetics/me' && req.method === 'GET') {
        return await handleGetOwnDewCosmetics(req, res, dewCosmeticsSessions, storage);
      }

      if (pathname === '/api/v1/client/cosmetics/presence' && req.method === 'POST') {
        return await handlePublishModCosmetic(req, res, dewCosmeticsSessions, storage, parsedBody);
      }

      if (pathname === '/api/v1/client/cosmetics/equip-cape' && req.method === 'POST') {
        return await handleEquipOwnCape(req, res, dewCosmeticsSessions, storage, parsedBody);
      }

      if (pathname === '/api/v1/cosmetics/free' && req.method === 'GET') {
        return await handleListFreeCapes(req, res, storage);
      }
      if (pathname === '/api/v1/cosmetics/free-claims/link-code' && req.method === 'POST') {
        return await handleCreateFreeCapeClaimCode(req, res, storage, parsedBody);
      }
      if (pathname === '/api/v1/cosmetics/free-claims/claim' && req.method === 'POST') {
        return await handleClaimFreeCape(req, res, storage, parsedBody);
      }
      if (pathname === '/api/v1/cosmetics/free-claims/equip' && req.method === 'POST') {
        return await handleEquipFreeCape(req, res, storage, parsedBody);
      }
      if (pathname === '/api/v1/cosmetics/free-claims/status' && req.method === 'GET') {
        return await handleFreeCapeClaimStatus(req, res, storage);
      }
      const freeCapePreviewMatch = pathname.match(/^\/api\/v1\/cosmetics\/free\/([a-f0-9]{64})\/preview$/i);
      if (freeCapePreviewMatch && req.method === 'GET') {
        return await handleGetFreeCapePreview(res, storage, freeCapePreviewMatch[1].toLowerCase());
      }

      if (pathname === '/api/v1/admin/login' && req.method === 'POST') {
        const { email, password } = parsedBody || {};
        const isValid = await AuthService.verifyCredentials(email, password);
        if (!isValid) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            ok: false,
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid administrator email or password.'
            }
          }));
        }

        const userEmail = (email || '').trim().toLowerCase();
        const staffRecord = await AuthService.getDatabaseAdmin(userEmail);
        if (!staffRecord || staffRecord.is_active !== true) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid administrator email or password.' } }));
        }
        const token = AuthService.createSessionToken(userEmail, staffRecord.session_version || 1);
        const staff = await AuthService.verifySession({ headers: { authorization: `Bearer ${token}` } });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          data: {
            token,
            user: {
              id: staff.id,
              email: staff.email,
              name: staff.displayName
            }
          }
        }));
      }

      // Explicit Admin Session Verifier (strictly ensures user is an authorized admin)
      if (pathname === '/api/v1/auth/verify-admin' && req.method === 'GET') {
        const adminUser = await AuthService.verifySession(req);
        if (!adminUser) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            ok: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Restricted access: valid admin credentials are required.'
            }
          }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          data: {
            authorized: true,
            user: {
              id: adminUser.id,
              email: adminUser.email,
              name: adminUser.displayName
            }
          }
        }));
      }

      // 4. Client Telemetry & Heartbeat (Public Launcher Endpoints)
      if (pathname === '/api/v1/client/register' && req.method === 'POST') {
        return await handleClientRegister(req, res, storage, parsedBody);
      }

      if (pathname === '/api/v1/client/heartbeat' && req.method === 'POST') {
        return await handleClientHeartbeat(req, res, storage, parsedBody, rawBody);
      }

      // 5. Remote Manifest (Public Launcher Endpoint)
      if (pathname === '/api/v1/manifest' && req.method === 'GET') {
        return await handleGetManifest(req, res, storage);
      }

      const releaseFileMatch = pathname.match(/^\/downloads\/(DewClient-[A-Za-z0-9._-]+\.exe)$/i);
      if (releaseFileMatch && req.method === 'GET') {
        const filePath = path.join(CONFIG.RELEASE_DIR, releaseFileMatch[1]);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.writeHead(200, {
            'Content-Type': 'application/vnd.microsoft.portable-executable',
            'Content-Length': fs.statSync(filePath).size,
            'Content-Disposition': `attachment; filename="${releaseFileMatch[1]}"`,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff'
          });
          return fs.createReadStream(filePath).pipe(res);
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Installer not found.' } }));
      }

      // 6. Cosmetics Routes (Public Launcher Endpoints)
      if (pathname === '/api/v1/cosmetics/assigned' && req.method === 'GET') {
        return await handleGetAssignedCosmetics(req, res, storage);
      }

      const cosmeticsPlayerMatch = pathname.match(/^\/api\/v1\/cosmetics\/player\/([a-zA-Z0-9_-]+)$/);
      if (cosmeticsPlayerMatch && req.method === 'GET') {
        return await handleGetPlayerCosmetics(req, res, storage, cosmeticsPlayerMatch[1]);
      }

      if (pathname === '/api/v1/cosmetics/players' && req.method === 'GET') {
        return await handleGetPlayersCosmetics(req, res, storage, query.uuids);
      }

      if (pathname === '/api/v1/cosmetics/publish' && req.method === 'POST') {
        return await handlePublishCosmetics(req, res, storage, parsedBody, rawBody);
      }

      const cosmeticsAssetMatch = pathname.match(/^\/api\/v1\/cosmetics\/assets?\/([a-fA-F0-9]+)$/);
      if (cosmeticsAssetMatch && req.method === 'GET') {
        return await handleGetAsset(req, res, storage, cosmeticsAssetMatch[1]);
      }

      // Public Online Players endpoint for launcher client
      if (pathname === '/api/v1/players/online' && req.method === 'GET') {
        const players = await storage.getOnlinePlayers?.() || [];
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ ok: true, data: players }));
      }

      // 7. Protected Admin & Dashboard Routes
      // Require a valid local admin session token
      const isAdminRoute =
        pathname === '/api/v1/stats' ||
        pathname === '/api/v1/accounts' ||
        pathname === '/api/v1/clients' ||
        pathname.startsWith('/api/v1/admin/');

      if (isAdminRoute) {
        const adminUser = await AuthService.verifySession(req);
        if (!adminUser) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            ok: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Restricted access: valid admin credentials are required.'
            }
          }));
        }

        if (pathname === '/api/v1/stats' && req.method === 'GET') {
          return await handleGetStats(req, res, storage);
        }

        if (pathname === '/api/v1/accounts' && req.method === 'GET') {
          return await handleGetAccounts(req, res, storage, query);
        }

        if (pathname === '/api/v1/clients' && req.method === 'GET') {
          return await handleGetClients(req, res, storage);
        }

        if (pathname === '/api/v1/admin/manifest' && req.method === 'GET') {
          const manifest = normalizeManifestLinks(await storage.getManifest());
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({ ok: true, data: { ...manifest, links: { ...(manifest.links || {}), ...CANONICAL_LINKS } } }));
        }

        if (pathname === '/api/v1/admin/bug-reports' && req.method === 'GET') {
          return await handleGetBugReports(res, storage, query);
        }
        const adminBugReportMatch = pathname.match(/^\/api\/v1\/admin\/bug-reports\/([A-Fa-f0-9-]{36})$/);
        if (adminBugReportMatch && req.method === 'PATCH') {
          return await handleUpdateBugReport(res, storage, adminBugReportMatch[1], parsedBody, adminUser);
        }

        if (pathname === '/api/v1/admin/staff' && req.method === 'GET') {
          return await handleGetStaff(req, res);
        }
        if (pathname === '/api/v1/admin/staff' && req.method === 'POST') {
          return await handleCreateStaff(req, res, parsedBody);
        }
        const adminStaffMatch = pathname.match(/^\/api\/v1\/admin\/staff\/([A-Fa-f0-9-]{36})$/);
        if (adminStaffMatch && req.method === 'PATCH') {
          return await handleUpdateStaff(req, res, adminStaffMatch[1], adminUser, parsedBody);
        }

        if (pathname === '/api/v1/admin/cosmetics/library' && req.method === 'GET') {
          return await handleGetAdminCosmeticLibrary(req, res, storage);
        }
        if (pathname === '/api/v1/admin/cosmetics/library' && req.method === 'POST') {
          return await handleAdminUploadCosmetic(req, res, storage, parsedBody);
        }
        const adminLibraryFreeMatch = pathname.match(/^\/api\/v1\/admin\/cosmetics\/library\/([a-fA-F0-9]{64})\/free$/);
        if (adminLibraryFreeMatch && req.method === 'PATCH') {
          return await handleAdminSetCosmeticFree(req, res, storage, adminLibraryFreeMatch[1].toLowerCase(), parsedBody);
        }
        const adminLibraryPreviewMatch = pathname.match(/^\/api\/v1\/admin\/cosmetics\/library\/([a-fA-F0-9]{64})\/preview$/);
        if (adminLibraryPreviewMatch && req.method === 'GET') {
          return await handleGetAdminCosmeticPreview(req, res, storage, adminLibraryPreviewMatch[1].toLowerCase());
        }
        const adminLibraryDeleteMatch = pathname.match(/^\/api\/v1\/admin\/cosmetics\/library\/([a-fA-F0-9]{64})$/);
        if (adminLibraryDeleteMatch && req.method === 'DELETE') {
          return await handleAdminDeleteCosmetic(req, res, storage, adminLibraryDeleteMatch[1].toLowerCase());
        }

        const adminCosmeticsMatch = pathname.match(/^\/api\/v1\/admin\/cosmetics\/([A-Za-z0-9_-]{1,36})$/);
        if (adminCosmeticsMatch && req.method === 'GET') {
          return await handleGetAdminCosmetics(req, res, storage, adminCosmeticsMatch[1]);
        }
        if (adminCosmeticsMatch && req.method === 'POST') {
          return await handleAdminAssignCosmetics(req, res, storage, adminCosmeticsMatch[1], parsedBody);
        }

        if (pathname === '/api/v1/admin/servers') {
          if (req.method === 'POST') return await handleUpdateServer(req, res, storage, parsedBody);
        }

        const adminServerDeleteMatch = pathname.match(/^\/api\/v1\/admin\/servers\/([a-zA-Z0-9_-]+)$/);
        if (adminServerDeleteMatch && req.method === 'DELETE') {
          return await handleDeleteServer(req, res, storage, adminServerDeleteMatch[1]);
        }

        if (pathname === '/api/v1/admin/news') {
          if (req.method === 'POST') return await handleUpdateNews(req, res, storage, parsedBody);
        }

        const adminNewsDeleteMatch = pathname.match(/^\/api\/v1\/admin\/news\/([a-zA-Z0-9_-]+)$/);
        if (adminNewsDeleteMatch && req.method === 'DELETE') {
          return await handleDeleteNews(req, res, storage, adminNewsDeleteMatch[1]);
        }

        if (pathname === '/api/v1/admin/announcements') {
          if (req.method === 'POST') return await handleUpdateAnnouncement(req, res, storage, parsedBody);
        }

        const adminAnnDeleteMatch = pathname.match(/^\/api\/v1\/admin\/announcements\/([a-zA-Z0-9_-]+)$/);
        if (adminAnnDeleteMatch && req.method === 'DELETE') {
          return await handleDeleteAnnouncement(req, res, storage, adminAnnDeleteMatch[1]);
        }

        if (pathname === '/api/v1/admin/maintenance' && req.method === 'POST') {
          return await handleToggleMaintenance(req, res, storage, parsedBody);
        }

        if (pathname === '/api/v1/admin/release' && req.method === 'GET') {
          return await handleGetClientRelease(req, res, storage);
        }

        if (pathname === '/api/v1/admin/release' && req.method === 'POST') {
          return await handleUpdateClientRelease(req, res, storage, parsedBody);
        }
      }

      if (pathname === '/robots.txt') {
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Robots-Tag': 'noindex, nofollow, noarchive'
        });
        return res.end('User-agent: *\nDisallow: /\n');
      }

      // 8. Serve Admin Dashboard and Static Public Assets
      const publicRoot = path.resolve(CONFIG.PUBLIC_DIR);
      const requestedAssetPath = pathname === '/' || pathname === '/admin' || pathname === '/admin/'
        ? 'index.html'
        : pathname.replace(/^\/+/, '');
      const candidateFilePath = path.resolve(publicRoot, requestedAssetPath);
      const relativeToPublicRoot = path.relative(publicRoot, candidateFilePath);
      const isWithinPublicRoot = relativeToPublicRoot === '' || (!relativeToPublicRoot.startsWith('..') && !path.isAbsolute(relativeToPublicRoot));

      if (isWithinPublicRoot && fs.existsSync(candidateFilePath) && fs.statSync(candidateFilePath).isFile()) {
        const ext = path.extname(candidateFilePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
          'X-Robots-Tag': 'noindex, nofollow, noarchive'
        });
        return fs.createReadStream(candidateFilePath).pipe(res);
      }

      // Route 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${pathname} not found.` } }));

    } catch (err) {
      console.error(`[SERVER] Error handling ${req.method} ${pathname}:`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'An internal server error occurred.' } }));
    }
  });

  return server;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && CONFIG.CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-dewclient-id, x-dewclient-timestamp, x-dewclient-signature, x-dewclient-version, x-dewclient-player-uuid, If-None-Match');
    res.setHeader('Access-Control-Expose-Headers', 'ETag, x-dewclient-version');
    res.setHeader('Vary', 'Origin');
  }
}

async function main() {
  validateServerConfig();
  const storage = await getStorage();
  const server = createApp(storage);
  server.listen(CONFIG.PORT, CONFIG.HOST, () => {
    console.log(`\n=============================================================`);
    console.log(`🚀 DewClient Central Server running on http://${CONFIG.HOST}:${CONFIG.PORT}`);
    console.log(`🌐 Public API Base: http://127.0.0.1:${CONFIG.PORT}/api/v1`);
    console.log(`🔒 Restricted Admin Portal: http://localhost:${CONFIG.PORT}/admin`);
    console.log(`⚡ Database: SUPABASE (PostgreSQL)`);
    console.log(`🔑 Auth: Email/password administrator sessions`);
    console.log(`=============================================================\n`);
  });

  const shutdown = () => {
    console.log('\n[SERVER] Shutting down gracefully...');
    server.close(() => {
      console.log('[SERVER] Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function readBody(req, maxBytes = MAX_REQUEST_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bodyBytes = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      bodyBytes += chunk.length;
      if (bodyBytes > maxBytes) {
        tooLarge = true;
        const error = new Error('Request payload too large');
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks, bodyBytes).toString('utf8'));
    });
    req.on('error', reject);
  });
}

export function isServerEntrypoint(entryPath) {
  if (!entryPath || typeof entryPath !== 'string') return false;

  const expectedPath = fs.realpathSync.native(fileURLToPath(import.meta.url));
  const candidatePath = (() => {
    try {
      return fs.realpathSync.native(path.resolve(entryPath));
    } catch {
      return path.resolve(entryPath);
    }
  })();

  return candidatePath === expectedPath || path.resolve(entryPath) === fileURLToPath(import.meta.url);
}

const entryPath = process.env.pm_exec_path || process.argv[1];
if (isServerEntrypoint(entryPath)) {
  main().catch((err) => {
    console.error('[FATAL] Failed to start DewClient Central Server:', err);
    process.exit(1);
  });
}
