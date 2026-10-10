/**
 * DewClient Central Server - Client Routes
 * Handles Ed25519 client identity registration and signed heartbeats.
 */

import { CryptoService } from '../services/cryptoService.mjs';

export async function handleClientRegister(req, res, storage, body) {
  const { publicKey, clientVersion, os, osVersion, architecture, hostname, metadata } = body || {};
  const normalizedClientVersion = typeof clientVersion === 'string' ? clientVersion.trim() : '';

  if (!publicKey || typeof publicKey !== 'string') {
    return sendJson(res, 400, {
      ok: false,
      error: { code: 'INVALID_PUBLIC_KEY', message: 'Valid Ed25519 SPKI public key in hex format is required.' }
    });
  }

  if (!CryptoService.isValidEd25519PublicKey(publicKey)) {
    return sendJson(res, 400, {
      ok: false,
      error: { code: 'MALFORMED_PUBLIC_KEY', message: 'The provided public key is not a valid Ed25519 key.' }
    });
  }

  // Look for existing registered client with this public key
  let client = await storage.getClientByPublicKey(publicKey);
  if (!client && !normalizedClientVersion) {
    return sendJson(res, 400, {
      ok: false,
      error: { code: 'INVALID_CLIENT_VERSION', message: 'A real clientVersion is required when registering a device.' }
    });
  }
  const now = new Date().toISOString();

  if (!client) {
    const clientId = CryptoService.generateClientId();
    client = {
      id: clientId,
      publicKey,
      clientVersion: normalizedClientVersion,
      os: os || 'unknown',
      osVersion: osVersion || '',
      architecture: architecture || '',
      hostname: hostname || '',
      metadata: metadata || {},
      status: 'online',
      registeredAt: now,
      lastSeenAt: now
    };
  } else {
    // Update existing client metadata
    client = {
      ...client,
      clientVersion: normalizedClientVersion || client.clientVersion,
      os: os || client.os,
      osVersion: osVersion || client.osVersion,
      architecture: architecture || client.architecture,
      hostname: hostname || client.hostname,
      status: 'online',
      lastSeenAt: now
    };
  }

  await storage.saveClient(client);
  console.log(`[CLIENT] Registered client ${client.id} (${client.os || 'unknown'} - v${client.clientVersion})`);

  return sendJson(res, 200, {
    ok: true,
    data: {
      clientId: client.id,
      heartbeatIntervalSeconds: 30
    }
  });
}

export async function handleClientHeartbeat(req, res, storage, body, rawBody) {
  const clientId = req.headers['x-dewclient-id'];
  const timestamp = req.headers['x-dewclient-timestamp'];
  const requestId = req.headers['x-dewclient-request-id'];
  const signature = req.headers['x-dewclient-signature'];

  if (!clientId) {
    return sendJson(res, 400, {
      ok: false,
      error: { code: 'MISSING_CLIENT_ID', message: 'Header x-dewclient-id is required.' }
    });
  }

  let client = await storage.getClient(clientId);
  if (!client) {
    return sendJson(res, 404, {
      ok: false,
      error: { code: 'CLIENT_NOT_REGISTERED', message: 'Client identity is not registered. Register the device before sending heartbeats.' }
    });
  }

  if (!client.publicKey || !signature || !timestamp || !requestId) {
    return sendJson(res, 401, {
      ok: false,
      error: { code: 'SIGNATURE_REQUIRED', message: 'A registered client signature is required.' }
    });
  }

  if (!CryptoService.isFreshTimestamp(String(timestamp))) {
    return sendJson(res, 401, {
      ok: false,
      error: { code: 'STALE_TIMESTAMP', message: 'Heartbeat timestamp is expired or too far in the future.' }
    });
  }

  {
    const bodyHash = CryptoService.sha256(rawBody || '');
    const canonicalPayload = `${clientId}:${timestamp}:${requestId}:${bodyHash}`;
    const isValid = CryptoService.verifySignature(client.publicKey, canonicalPayload, signature);

    if (!isValid) {
      console.warn(`[HEARTBEAT] Invalid signature from client ${clientId}`);
      return sendJson(res, 401, {
        ok: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Ed25519 signature verification failed.' }
      });
    }
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId))) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_REQUEST_ID', message: 'A unique heartbeat request ID is required.' } });
  }
  if (body?.accounts !== undefined && (!Array.isArray(body.accounts) || body.accounts.length > 100
    || body.accounts.some((account) => !isValidTrackedAccount(account)))) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_ACCOUNTS', message: 'Shared account data is invalid.' } });
  }
  if (body?.activePlayer !== undefined && body.activePlayer !== null && !isValidActivePlayer(body.activePlayer)) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_PLAYER_PRESENCE', message: 'Active player presence is invalid.' } });
  }
  if (!await storage.claimPublishRequest(clientId, requestId)) {
    return sendJson(res, 409, { ok: false, error: { code: 'REPLAYED_REQUEST', message: 'This signed heartbeat request has already been used.' } });
  }

  // Update client presence
  const now = new Date().toISOString();
  client.status = 'online';
  client.lastSeenAt = now;
  if (body?.clientVersion) client.clientVersion = body.clientVersion;
  await storage.saveClient(client);

  let accountsTracked = 0;
  if (Array.isArray(body?.accounts)) {
    accountsTracked = await storage.syncClientAccounts?.(clientId, body.accounts) || 0;
  }
  if (body && Object.hasOwn(body, 'activePlayer')) {
    await storage.syncOnlinePresence?.(clientId, body.activePlayer, now);
  }

  const manifest = await storage.getManifest();

  return sendJson(res, 200, {
    ok: true,
    data: {
      heartbeatIntervalSeconds: 30,
      manifestUpdatedAt: manifest?.updatedAt || '',
      accountsTracked
    }
  });
}

function isValidTrackedAccount(account) {
  return Boolean(account && typeof account === 'object' && !Array.isArray(account)
    && typeof account.username === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(account.username)
    && typeof account.uuid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.uuid)
    && ['microsoft', 'offline'].includes(account.type)
    && (account.lastUsedAt === undefined || account.lastUsedAt === null
      || (typeof account.lastUsedAt === 'string' && Number.isFinite(Date.parse(account.lastUsedAt)))));
}

function isValidActivePlayer(player) {
  return Boolean(player && typeof player === 'object' && !Array.isArray(player)
    && typeof player.username === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(player.username)
    && typeof player.uuid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(player.uuid));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json'
  });
  res.end(JSON.stringify(data));
}
