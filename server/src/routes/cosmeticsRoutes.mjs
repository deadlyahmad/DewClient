/**
 * DewClient Central Server - Cosmetics Routes
 * Handles player cosmetics lookup, publishing, and binary asset streaming.
 */

import { CryptoService } from '../services/cryptoService.mjs';
import { DewUserAuthService } from '../services/dewUserAuthService.mjs';
import { CONFIG } from '../config.mjs';
import {
  decryptCosmeticAsset,
  decryptedCosmeticContentType,
  encryptCosmeticAsset,
  encryptedCosmeticContentType,
  isEncryptedCosmeticAsset
} from '../services/cosmeticAssetEncryptionService.mjs';

export async function handleGetPlayerCosmetics(req, res, storage, playerUuid) {
  if (typeof playerUuid !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(playerUuid)) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_UUID', message: 'Player UUID required.' } });
  }

  const cosmetics = await storage.getCosmetics(playerUuid);
  if (!cosmetics) {
    return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'No cosmetics registered for this player.' } });
  }

  const etag = `"${cosmetics.playerUuid}:${cosmetics.updatedAt}:${cosmetics.version}"`;
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === etag) {
    res.writeHead(304, { 'ETag': etag });
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'ETag': etag
  });
  res.end(JSON.stringify({ ok: true, data: {
    ...cosmetics,
    metadata: sanitizePublicCosmeticsMetadata(cosmetics.metadata)
  } }));
}

const MAX_BATCH_COSMETIC_PLAYERS = 128;

/**
 * Return only public, enabled cosmetics for a bounded set of visible Minecraft
 * players. Fabric clients call this as one request per nearby player batch.
 */
export async function handleGetPlayersCosmetics(req, res, storage, uuidsValue) {
  if (typeof uuidsValue !== 'string' || !uuidsValue.trim()) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_UUIDS', message: 'At least one Minecraft UUID is required.' } });
  }
  const uuids = [...new Set(uuidsValue.split(',').map((uuid) => uuid.trim().toLowerCase()))];
  if (uuids.length > MAX_BATCH_COSMETIC_PLAYERS
    || uuids.some((uuid) => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(uuid))) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_UUIDS', message: `Provide up to ${MAX_BATCH_COSMETIC_PLAYERS} valid Minecraft UUIDs.` } });
  }

  const manifests = typeof storage.getCosmeticsForPlayers === 'function'
    ? await storage.getCosmeticsForPlayers(uuids)
    : await Promise.all(uuids.map((uuid) => storage.getCosmetics(uuid)));
  const players = manifests.filter(Boolean).map((manifest) => {
    const metadata = manifest.metadata || {};
    const skins = normalizeCosmeticList(manifest.metadata?.skins, manifest.skin);
    const capes = normalizeCosmeticList(manifest.metadata?.capes, manifest.cape);
    const elytras = normalizeCosmeticList(manifest.metadata?.elytras, manifest.elytra);
    const adminKinds = Array.isArray(metadata.adminAssignedKinds) ? metadata.adminAssignedKinds : [];
    const activeAdmin = metadata.activeAdminCosmetics && typeof metadata.activeAdminCosmetics === 'object'
      ? metadata.activeAdminCosmetics : {};
    const select = (kind, collection, legacy) => {
      if (adminKinds.includes(kind)) {
        const adminId = String(activeAdmin[kind] || '').toLowerCase();
        return collection.find((item) => item.assetId.toLowerCase() === adminId)
          || (isEnabledCosmetic(legacy) ? legacy : null)
          || collection[0]
          || null;
      }
      const activeKey = kind === 'skin' ? 'activeSkinAssetId' : kind === 'cape' ? 'activeCapeAssetId' : 'activeElytraAssetId';
      if (Object.prototype.hasOwnProperty.call(metadata, activeKey)) {
        const activeId = metadata[activeKey];
        return typeof activeId === 'string'
          ? collection.find((item) => item.assetId.toLowerCase() === activeId.toLowerCase()) || null
          : null;
      }
      return (isEnabledCosmetic(legacy) ? legacy : collection[0]) || null;
    };
    return {
      playerUuid: manifest.playerUuid,
      skin: select('skin', skins, manifest.skin),
      cape: select('cape', capes, manifest.cape),
      elytra: select('elytra', elytras, manifest.elytra)
    };
  }).filter((entry) => entry.skin || entry.cape || entry.elytra);

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3, stale-while-revalidate=2'
  });
  res.end(JSON.stringify({ ok: true, data: players }));
}

/** Publish the active in-game texture for the identity bound to a short-lived mod session. */
export async function handlePublishModCosmetic(req, res, sessionService, storage, body) {
  res.setHeader('Cache-Control', 'no-store');
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1] || '';
  const session = sessionService.authenticate(bearer);
  if (!session) return sendJson(res, 401, { ok: false, error: { code: 'AUTH_EXPIRED', message: 'The DewCosmetics session has expired. Restart the game to reconnect.' } });
  if (!session.permissions.includes('cosmetics:publish')) {
    return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'This session cannot share equipped cosmetics.' } });
  }

  const kind = body?.kind === 'wings' ? 'elytra' : body?.kind;
  if (!['skin', 'cape', 'elytra'].includes(kind) || !(body?.asset === null || (body?.asset && typeof body.asset === 'object' && !Array.isArray(body.asset)))) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_COSMETIC', message: 'A valid skin, cape, or wings selection is required.' } });
  }

  const existing = await storage.getCosmetics(session.playerUuid);
  const metadata = { ...(existing?.metadata || {}) };
  const adminAssignedKinds = Array.isArray(metadata.adminAssignedKinds) ? metadata.adminAssignedKinds : [];
  if (adminAssignedKinds.includes(kind)) {
    return sendJson(res, 200, { ok: true, data: { published: false, protected: true } });
  }

  let asset;
  try {
    const collectionKey = kind === 'skin' ? 'skins' : kind === 'cape' ? 'capes' : 'elytras';
    const currentCollection = normalizeCosmeticList(metadata[collectionKey], existing?.[kind]);
    if (typeof body.asset?.data === 'string'
        && /^[A-Za-z0-9+/]+={0,2}$/.test(body.asset.data)
        && body.asset.data.length % 4 !== 1) {
      const incomingHash = CryptoService.sha256(Buffer.from(body.asset.data, 'base64'));
      const same = currentCollection.find((item) => item.sha256.toLowerCase() === incomingHash.toLowerCase());
      asset = same || await resolveCosmeticAsset(body.asset, existing?.[kind], storage, kind);
    } else {
      asset = await resolveCosmeticAsset(body.asset, existing?.[kind], storage, kind);
    }

    if (!existing && !asset) return sendJson(res, 200, { ok: true, data: { published: true, unchanged: true } });
    const activeKey = kind === 'skin' ? 'activeSkinAssetId' : kind === 'cape' ? 'activeCapeAssetId' : 'activeElytraAssetId';
    metadata[activeKey] = asset?.assetId || null;
    if (asset) {
      const collection = new Map(currentCollection.map((item) => [item.assetId.toLowerCase(), item]));
      collection.set(asset.assetId.toLowerCase(), asset);
      metadata[collectionKey] = [...collection.values()];
    }

    const previous = existing?.[kind] || null;
    const previousActive = existing?.metadata?.[activeKey];
    if (previous?.sha256 === asset?.sha256 && previousActive === metadata[activeKey]) {
      return sendJson(res, 200, { ok: true, data: { published: true, unchanged: true } });
    }
    const updated = await storage.saveCosmetics(session.playerUuid, {
      username: session.username,
      skin: kind === 'skin' ? asset : existing?.skin || null,
      cape: kind === 'cape' ? asset : existing?.cape || null,
      elytra: kind === 'elytra' ? asset : existing?.elytra || null,
      metadata
    }, Number(existing?.version || 0));
    if (!updated) return sendJson(res, 409, { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Cosmetics changed while syncing. The client will retry.' } });
    return sendJson(res, 200, { ok: true, data: { published: true, revision: updated.version } });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_COSMETIC_ASSET', message: error.message || 'This cosmetic texture could not be verified.' } });
  }
}

export async function handleGetAssignedCosmetics(req, res, storage) {
  const entries = await storage.getAllCosmetics();
  const players = entries
    .filter((entry) => /^[A-Za-z0-9_]{1,16}$/.test(String(entry.username || '')))
    .map((entry) => {
      const skins = normalizeCosmeticList(entry.metadata?.skins, entry.skin);
      const capes = normalizeCosmeticList(entry.metadata?.capes, entry.cape);
      const elytras = normalizeCosmeticList(entry.metadata?.elytras, entry.elytra);
      return {
        playerUuid: entry.playerUuid,
        username: entry.username,
        skin: isEnabledCosmetic(entry.skin) ? entry.skin : skins[0] || null,
        cape: isEnabledCosmetic(entry.cape) ? entry.cape : capes[0] || null,
        elytra: isEnabledCosmetic(entry.elytra) ? entry.elytra : elytras[0] || null,
        skins,
        capes,
        elytras
      };
    })
    .filter((entry) => entry.skins.length || entry.capes.length || entry.elytras.length);

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify({ ok: true, data: players }));
}

export async function handleGetAdminCosmetics(req, res, storage, playerUuid) {
  res.setHeader('Cache-Control', 'no-store');
  const account = await findAccount(storage, playerUuid);
  if (!account) return sendJson(res, 404, { ok: false, error: { code: 'ACCOUNT_NOT_FOUND', message: 'Player account was not found.' } });
  const cosmetics = await storage.getCosmetics(account.uuid || account.player_uuid || playerUuid);
  return sendJson(res, 200, { ok: true, data: { account, cosmetics } });
}

export async function handleAdminAssignCosmetics(req, res, storage, playerUuid, body) {
  res.setHeader('Cache-Control', 'no-store');
  const account = await findAccount(storage, playerUuid);
  if (!account) return sendJson(res, 404, { ok: false, error: { code: 'ACCOUNT_NOT_FOUND', message: 'Player account was not found.' } });
  const uuid = account.uuid || account.player_uuid || playerUuid;

  const existing = await storage.getCosmetics(uuid);
  if (body?.expectedVersion !== undefined && Number(body.expectedVersion) !== Number(existing?.version || 0)) {
    return sendJson(res, 409, { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Player cosmetics changed. Reload and try again.' } });
  }

  let assignments;
  const collectionAssignments = {};
  const adminAssignedKinds = new Set(
    Array.isArray(existing?.metadata?.adminAssignedKinds) ? existing.metadata.adminAssignedKinds : []
  );
  try {
    assignments = {};
    for (const kind of ['skin', 'cape', 'elytra']) {
      if (body?.[kind] !== undefined) {
        if (body[kind] == null || body[kind].enabled === false) adminAssignedKinds.delete(kind);
        else adminAssignedKinds.add(kind);
      }
      if (body?.[kind]?.data && body[kind].contentType !== 'image/png') {
        throw new Error('Assigned in-game textures must be PNG files.');
      }
      assignments[kind] = body?.[kind] === undefined
        ? existing?.[kind] || null
        : await resolveAdminAssignment(body[kind], kind, existing?.[kind], storage);
    }
    for (const [kind, collectionKey] of [['skin', 'skins'], ['cape', 'capes'], ['elytra', 'elytras']]) {
      if (Array.isArray(body?.[collectionKey])) {
        if (body[collectionKey].length > 100) throw new Error(`At most 100 ${collectionKey} can be assigned to one player.`);
        const uniqueAssets = new Map();
        for (const asset of body[collectionKey]) {
          const resolved = await resolveAdminAssignment(asset, kind, null, storage);
          if (resolved?.enabled) uniqueAssets.set(resolved.assetId, resolved);
        }
        collectionAssignments[collectionKey] = [...uniqueAssets.values()];
        assignments[kind] = collectionAssignments[collectionKey][0] || null;
        if (collectionAssignments[collectionKey].length) adminAssignedKinds.add(kind);
        else adminAssignedKinds.delete(kind);
      } else if (body?.[kind] !== undefined) {
        collectionAssignments[collectionKey] = assignments[kind]?.enabled ? [assignments[kind]] : [];
      } else {
        collectionAssignments[collectionKey] = normalizeCosmeticList(existing?.metadata?.[collectionKey], existing?.[kind]);
      }
    }
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_COSMETIC_ASSET', message: error.message } });
  }

  const activeAdminCosmetics = sanitizeActiveAdminCosmetics(existing?.metadata?.activeAdminCosmetics);
  for (const [kind, collectionKey] of [['skin', 'skins'], ['cape', 'capes'], ['elytra', 'elytras']]) {
    const collection = collectionAssignments[collectionKey] || normalizeCosmeticList(existing?.metadata?.[collectionKey], existing?.[kind]);
    const selected = collection.find((item) => item.assetId === activeAdminCosmetics[kind]) || collection[0] || null;
    assignments[kind] = selected;
    if (selected) activeAdminCosmetics[kind] = selected.assetId;
    else delete activeAdminCosmetics[kind];
  }
  collectionAssignments.activeAdminCosmetics = activeAdminCosmetics;

  const updated = await storage.saveCosmetics(uuid, {
    username: account.username,
    ...assignments,
    metadata: { ...(existing?.metadata || {}), ...collectionAssignments, adminAssignedKinds: [...adminAssignedKinds] }
  }, Number(existing?.version || 0));
  if (!updated) return sendJson(res, 409, { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Player cosmetics changed. Reload and try again.' } });
  return sendJson(res, 200, { ok: true, data: updated });
}

export async function handleGetAdminCosmeticLibrary(req, res, storage) {
  res.setHeader('Cache-Control', 'no-store');
  const cosmetics = await storage.getCosmeticLibrary();
  return sendJson(res, 200, { ok: true, data: cosmetics });
}

export async function handleAdminSetCosmeticFree(req, res, storage, assetId, body) {
  res.setHeader('Cache-Control', 'no-store');
  if (!/^[a-f0-9]{64}$/i.test(String(assetId || '')) || typeof body?.isFree !== 'boolean') {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_FREE_COSMETIC', message: 'Choose whether this uploaded cape is claimable.' } });
  }
  const current = await storage.getCosmeticLibraryItem(assetId.toLowerCase());
  if (!current) return sendJson(res, 404, { ok: false, error: { code: 'COSMETIC_NOT_FOUND', message: 'Cosmetic was not found.' } });
  if (body.isFree && current.kind !== 'cape') {
    return sendJson(res, 400, { ok: false, error: { code: 'ONLY_CAPES_CAN_BE_FREE', message: 'Only cape cosmetics can be listed as free claims.' } });
  }
  const updated = await storage.setCosmeticLibraryFree(assetId.toLowerCase(), body.isFree);
  if (!updated) return sendJson(res, 404, { ok: false, error: { code: 'COSMETIC_NOT_FOUND', message: 'Cosmetic was not found.' } });
  return sendJson(res, 200, { ok: true, data: { ...current, isFree: updated.isFree } });
}

export async function handleGetAdminCosmeticPreview(req, res, storage, assetId) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!/^[a-f0-9]{64}$/i.test(String(assetId || ''))) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_ASSET', message: 'Cosmetic asset reference is invalid.' } });
  }
  const item = await storage.getCosmeticLibraryItem(assetId.toLowerCase());
  if (!item) return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Cosmetic preview was not found.' } });
  const asset = await storage.getAsset(item.sha256);
  if (!asset) return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Cosmetic preview was not found.' } });

  let plaintext;
  try {
    plaintext = isEncryptedCosmeticAsset(asset.buffer) ? decryptCosmeticAsset(asset.buffer) : asset.buffer;
  } catch {
    return sendJson(res, 500, { ok: false, error: { code: 'ASSET_DECRYPT_FAILED', message: 'Cosmetic preview could not be verified.' } });
  }
  if (CryptoService.sha256(plaintext) !== String(item.sha256).toLowerCase()) {
    return sendJson(res, 500, { ok: false, error: { code: 'ASSET_CORRUPT', message: 'Cosmetic preview failed its integrity check.' } });
  }
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': plaintext.length,
    'X-Content-Type-Options': 'nosniff'
  });
  return res.end(plaintext);
}

export async function handleAdminUploadCosmetic(req, res, storage, body) {
  res.setHeader('Cache-Control', 'no-store');
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const kind = body?.kind;
  if (name.length < 1 || name.length > 64 || !['skin', 'cape', 'elytra'].includes(kind)) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_COSMETIC', message: 'A name (1-64 characters) and valid cosmetic type are required.' } });
  }

  let asset;
  try {
    if (body?.contentType !== 'image/png') throw new Error('Admin cosmetics must be PNG files.');
    asset = await resolveCosmeticAsset(body, null, storage, kind);
    if (!asset?.enabled) throw new Error('A valid PNG cosmetic image is required.');
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_COSMETIC_ASSET', message: error.message } });
  }

  const saved = await storage.saveCosmeticLibraryItem({
    ...asset,
    name,
    kind,
    createdAt: new Date().toISOString()
  });
  return sendJson(res, 201, { ok: true, data: saved });
}

export async function handleAdminDeleteCosmetic(req, res, storage, assetId) {
  const result = await storage.deleteCosmeticLibraryItem(assetId);
  if (result?.status === 'invalid') return sendJson(res, 400, { ok: false, error: { code: 'INVALID_COSMETIC_ID', message: 'Cosmetic ID is invalid.' } });
  if (result?.status !== 'deleted') return sendJson(res, 404, { ok: false, error: { code: 'COSMETIC_NOT_FOUND', message: 'Cosmetic was not found.' } });
  return sendJson(res, 200, {
    ok: true,
    data: {
      assetId,
      assetDeleted: result.assetDeleted === true,
      profilesUpdated: Number(result.profilesUpdated || 0),
      assignmentsDeleted: Number(result.assignmentsDeleted || 0)
    }
  });
}

async function findAccount(storage, identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    return storage.getAccount(value.toLowerCase());
  }
  if (!/^[A-Za-z0-9_]{1,16}$/.test(value) || typeof storage.getAccountByUsername !== 'function') return null;
  return storage.getAccountByUsername(value);
}

async function resolveAdminAssignment(value, kind, existing, storage) {
  if (value && typeof value === 'object' && typeof value.assetId === 'string' && typeof value.sha256 === 'string') {
    const item = await storage.getCosmeticLibraryItem(value.assetId);
    if (!item || item.kind !== kind || item.sha256 !== value.sha256) {
      throw new Error(`Select an uploaded ${kind} from the admin cosmetic library.`);
    }
    await encryptStoredCosmeticAsset(item, storage);
    return {
      enabled: true,
      assetId: item.assetId,
      sha256: item.sha256,
      contentType: item.contentType,
      byteSize: item.byteSize,
      width: item.width,
      height: item.height,
      updatedAt: new Date().toISOString()
    };
  }
  return resolveCosmeticAsset(value, existing, storage, kind);
}

async function encryptStoredCosmeticAsset(item, storage) {
  const stored = await storage.getAsset(item.sha256);
  if (!stored) throw new Error('The selected cosmetic file is missing from secure storage. Re-upload it before assigning.');
  if (isEncryptedCosmeticAsset(stored.buffer)) return;
  if (CryptoService.sha256(stored.buffer) !== item.sha256.toLowerCase()) {
    throw new Error('The selected cosmetic file failed its integrity check. Re-upload it before assigning.');
  }
  await storage.saveAsset(
    item.sha256.toLowerCase(),
    encryptCosmeticAsset(stored.buffer),
    encryptedCosmeticContentType(item.contentType)
  );
}

export async function handlePublishCosmetics(req, res, storage, body, rawBody) {
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1] || '';
  const authResult = await DewUserAuthService.verifyAccessToken(bearer);
  if (authResult?.status === 'unavailable') {
    return sendJson(res, 503, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'Dew account authorization is temporarily unavailable.' } });
  }
  if (authResult?.status !== 'authenticated') {
    return sendJson(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'A verified Dew account session is required to publish cosmetics.' } });
  }

  const clientId = req.headers['x-dewclient-id'];
  const playerUuid = req.headers['x-dewclient-player-uuid'];
  const timestamp = req.headers['x-dewclient-timestamp'];
  const requestId = req.headers['x-dewclient-request-id'];
  const signature = req.headers['x-dewclient-signature'];
  const minecraftAccessToken = req.headers['x-minecraft-access-token'];

  if (!playerUuid || !body?.playerUuid) {
    return sendJson(res, 400, { ok: false, error: { code: 'MISSING_PLAYER_UUID', message: 'Player UUID is required.' } });
  }
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_REQUEST_ID', message: 'A unique publish request ID is required.' } });
  }

  if (!clientId || !signature || !timestamp) {
    return sendJson(res, 401, { ok: false, error: { code: 'SIGNATURE_REQUIRED', message: 'A registered client signature is required.' } });
  }

  if (!CryptoService.isFreshTimestamp(String(timestamp))) {
    return sendJson(res, 401, { ok: false, error: { code: 'STALE_TIMESTAMP', message: 'Cosmetics timestamp is expired or too far in the future.' } });
  }

  const client = await storage.getClient(clientId);
  if (!client?.publicKey) {
    return sendJson(res, 401, { ok: false, error: { code: 'CLIENT_NOT_REGISTERED', message: 'A registered client identity is required.' } });
  }

  if (body.playerUuid.toLowerCase() !== String(playerUuid).toLowerCase()) {
    return sendJson(res, 400, { ok: false, error: { code: 'PLAYER_UUID_MISMATCH', message: 'Player UUID header and payload must match.' } });
  }

  const bodyHash = CryptoService.sha256(rawBody || '');
  const canonicalPayload = `${clientId}:${timestamp}:${requestId}:${bodyHash}`;
  const valid = CryptoService.verifySignature(client.publicKey, canonicalPayload, signature);
  if (!valid) {
    return sendJson(res, 401, { ok: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } });
  }

  const minecraftResult = await DewUserAuthService.verifyMinecraftAccessToken(minecraftAccessToken);
  if (minecraftResult?.status === 'unavailable') {
    return sendJson(res, 503, { ok: false, error: { code: 'MINECRAFT_AUTH_UNAVAILABLE', message: 'Minecraft profile verification is temporarily unavailable.' } });
  }
  if (minecraftResult?.status !== 'authenticated') {
    return sendJson(res, 401, { ok: false, error: { code: 'MINECRAFT_AUTH_REQUIRED', message: 'A valid Minecraft Services session is required to publish cosmetics.' } });
  }

  const canonicalUuid = minecraftResult.profile.uuid;
  const canonicalUsername = minecraftResult.profile.username;
  if (String(playerUuid).toLowerCase() !== canonicalUuid.toLowerCase()) {
    return sendJson(res, 403, { ok: false, error: { code: 'PLAYER_UUID_UNAUTHORIZED', message: 'The Minecraft session does not own the requested player UUID.' } });
  }

  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  if (!username) {
    return sendJson(res, 400, { ok: false, error: { code: 'MISSING_USERNAME', message: 'Player username is required to publish cosmetics.' } });
  }
  if (username.toLowerCase() !== canonicalUsername.toLowerCase()) {
    return sendJson(res, 403, { ok: false, error: { code: 'PLAYER_USERNAME_MISMATCH', message: 'The username does not match the authorized Minecraft identity.' } });
  }

  const deviceAuthorized = await storage.authorizeCosmeticsPublish(
    authResult.user.id,
    canonicalUuid,
    canonicalUsername,
    clientId,
    client.publicKey
  );
  if (!deviceAuthorized) {
    return sendJson(res, 403, { ok: false, error: { code: 'CLIENT_NOT_AUTHORIZED', message: 'This device is not authorized for the verified Minecraft identity.' } });
  }

  const firstUse = await storage.claimPublishRequest(clientId, requestId);
  if (!firstUse) {
    return sendJson(res, 409, { ok: false, error: { code: 'REPLAYED_REQUEST', message: 'This signed publish request has already been used.' } });
  }

  const existing = await storage.getCosmetics(playerUuid);
  const currentVersion = Number(existing?.version || 0);
  if (body?.expectedVersion !== undefined && Number(body.expectedVersion) !== currentVersion) {
    return sendJson(res, 409, {
      ok: false,
      error: { code: 'VERSION_CONFLICT', message: 'Cosmetics changed on another client.' },
      data: { manifest: existing }
    });
  }

  const adminAssignedKinds = new Set(
    Array.isArray(existing?.metadata?.adminAssignedKinds) ? existing.metadata.adminAssignedKinds : []
  );
  let skin;
  let cape;
  let elytra;
  const requestedMetadata = sanitizeWritableCosmeticsMetadata(body?.metadata);
  const activeAdminCosmetics = {
    ...sanitizeActiveAdminCosmetics(existing?.metadata?.activeAdminCosmetics),
    ...sanitizeActiveAdminCosmetics(requestedMetadata.activeAdminCosmetics)
  };
  try {
    skin = adminAssignedKinds.has('skin')
      ? selectAdminAssignedCosmetic('skin', activeAdminCosmetics, existing)
      : await resolveCosmeticAsset(body?.skin, existing?.skin, storage, 'skin');
    cape = adminAssignedKinds.has('cape')
      ? selectAdminAssignedCosmetic('cape', activeAdminCosmetics, existing)
      : await resolveCosmeticAsset(body?.cape, existing?.cape, storage, 'cape');
    elytra = adminAssignedKinds.has('elytra')
      ? selectAdminAssignedCosmetic('elytra', activeAdminCosmetics, existing)
      : body?.elytra === undefined
        ? existing?.elytra || null
        : await resolveCosmeticAsset(body.elytra, existing?.elytra, storage, 'elytra');
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_COSMETIC_ASSET', message: err.message } });
  }

  for (const [kind, item] of [['skin', skin], ['cape', cape], ['elytra', elytra]]) {
    if (adminAssignedKinds.has(kind) && item?.enabled) activeAdminCosmetics[kind] = item.assetId;
    else if (!adminAssignedKinds.has(kind)) delete activeAdminCosmetics[kind];
  }

  const updated = await storage.saveCosmetics(playerUuid, {
    username,
    skin,
    cape,
    elytra,
    metadata: { ...(existing?.metadata || {}), ...requestedMetadata, activeAdminCosmetics, adminAssignedKinds: [...adminAssignedKinds] }
  }, currentVersion);

  if (!updated) {
    return sendJson(res, 409, {
      ok: false,
      error: { code: 'VERSION_CONFLICT', message: 'Cosmetics changed on another client.' },
      data: { manifest: await storage.getCosmetics(playerUuid) }
    });
  }

  return sendJson(res, 200, {
    ok: true,
    data: {
      manifest: updated
    }
  });
}

async function resolveCosmeticAsset(value, existing, storage, kind) {
  if (value == null) return null;
  if (value.enabled === false) return { enabled: false, updatedAt: new Date().toISOString() };

  const encodedData = value.data || value.base64;
  if (typeof encodedData === 'string' && encodedData.length > 0) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedData) || encodedData.length % 4 === 1) {
      throw new Error('Asset data must be valid base64.');
    }
    const buffer = Buffer.from(encodedData, 'base64');
    if (buffer.length === 0 || buffer.length > 50 * 1024 * 1024) {
      throw new Error('Asset must be between 1 byte and 50 MiB.');
    }

    const contentType = String(value.contentType || 'image/png').toLowerCase();
    const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    let width = 0;
    let height = 0;
    if (contentType === 'image/png' && isPng && buffer.length >= 33 && buffer.toString('ascii', 12, 16) === 'IHDR') {
      width = buffer.readUInt32BE(16);
      height = buffer.readUInt32BE(20);
    } else if (contentType === 'image/jpeg' && isJpeg) {
      ({ width, height } = readJpegDimensions(buffer));
    } else {
      throw new Error('Textures must be PNG or JPEG images with matching content types. Reselect WebP files in DewClient to convert them to PNG.');
    }
    if (!validCosmeticDimensions(kind, width, height)) {
      throw new Error(kind === 'skin'
        ? 'Skin textures must be 64x32 minimum to 2048x1024 maximum and use a square or 2:1 Minecraft skin layout.'
        : `${kind === 'cape' ? 'Cape' : 'Wing'} textures must be 64x32 minimum to 2048x1024 maximum in a 2:1 UV layout.`);
    }

    const sha256 = CryptoService.sha256(buffer);
    if (value.sha256 && value.sha256 !== sha256) throw new Error('Asset SHA-256 does not match its data.');
    await storage.saveAsset(sha256, encryptCosmeticAsset(buffer), encryptedCosmeticContentType(contentType));
    return {
      enabled: true,
      assetId: sha256,
      sha256,
      contentType,
      byteSize: buffer.length,
      width,
      height,
      updatedAt: new Date().toISOString()
    };
  }

  if (value.assetId && value.sha256 && existing?.enabled === true && value.assetId === existing.assetId && value.sha256 === existing.sha256) {
    return existing;
  }

  throw new Error('Asset reference is not available in the current manifest.');
}

function validCosmeticDimensions(kind, width, height) {
  if (![64, 128, 256, 512, 1024, 2048].includes(width) || !Number.isInteger(height) || height < 32 || height > 1024) return false;
  if (kind === 'skin') return height === width || height === width / 2;
  if (kind === 'cape' || kind === 'elytra') return height === width / 2;
  return false;
}

function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) break;
    offset += 2 + segmentLength;
  }
  return { width: 0, height: 0 };
}

export async function handleGetAsset(req, res, storage, sha256) {
  if (!/^[a-f0-9]{64}$/i.test(String(sha256 || ''))) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_SHA', message: 'Asset SHA-256 hash required.' } });
  }

  if (!await storage.isAssetAssigned(sha256.toLowerCase())) {
    return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Asset not found.' } });
  }

  const asset = await storage.getAsset(sha256);
  if (!asset) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Asset not found');
  }

  let plaintext;
  try {
    if (isEncryptedCosmeticAsset(asset.buffer)) {
      plaintext = decryptCosmeticAsset(asset.buffer);
    } else {
      plaintext = asset.buffer;
      if (CryptoService.sha256(plaintext) !== sha256.toLowerCase()) {
        return sendJson(res, 500, { ok: false, error: { code: 'ASSET_CORRUPT', message: 'Cosmetic asset integrity check failed.' } });
      }
      // Upgrade legacy plaintext rows the first time an assigned asset is requested.
      if (CONFIG.COSMETIC_ASSET_ENCRYPTION_KEY) {
        await storage.saveAsset(sha256.toLowerCase(), encryptCosmeticAsset(plaintext), encryptedCosmeticContentType(asset.contentType));
      }
    }
  } catch {
    return sendJson(res, 500, { ok: false, error: { code: 'ASSET_DECRYPT_FAILED', message: 'Cosmetic asset could not be verified.' } });
  }

  if (CryptoService.sha256(plaintext) !== sha256.toLowerCase()) {
    return sendJson(res, 500, { ok: false, error: { code: 'ASSET_CORRUPT', message: 'Cosmetic asset integrity check failed.' } });
  }
  res.writeHead(200, {
    'Content-Type': decryptedCosmeticContentType(asset.contentType),
    'Content-Length': plaintext.length,
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(plaintext);
}

function isEnabledCosmetic(value) {
  return value && typeof value === 'object'
    && value.enabled === true
    && /^[a-f0-9]{64}$/i.test(String(value.assetId || ''))
    && /^[a-f0-9]{64}$/i.test(String(value.sha256 || ''));
}

function sanitizeWritableCosmeticsMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metadata = {};
  if (typeof value.badge === 'string') metadata.badge = value.badge.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64);
  if (typeof value.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.accentColor.trim())) {
    metadata.accentColor = value.accentColor.trim();
  }
  const activeAdminCosmetics = sanitizeActiveAdminCosmetics(value.activeAdminCosmetics);
  if (Object.keys(activeAdminCosmetics).length) metadata.activeAdminCosmetics = activeAdminCosmetics;
  for (const kind of ['skin', 'cape', 'elytra']) {
    const key = kind === 'skin' ? 'activeSkinAssetId' : kind === 'cape' ? 'activeCapeAssetId' : 'activeElytraAssetId';
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      metadata[key] = typeof value[key] === 'string' && /^[a-f0-9]{64}$/i.test(value[key])
        ? value[key].toLowerCase() : null;
    }
  }
  return metadata;
}

function sanitizeActiveAdminCosmetics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const selected = {};
  for (const kind of ['skin', 'cape', 'elytra']) {
    if (/^[a-f0-9]{64}$/i.test(String(value[kind] || ''))) selected[kind] = String(value[kind]).toLowerCase();
  }
  return selected;
}

function selectAdminAssignedCosmetic(kind, activeAdminCosmetics, existing) {
  const collectionKey = kind === 'skin' ? 'skins' : kind === 'cape' ? 'capes' : 'elytras';
  const assigned = normalizeCosmeticList(existing?.metadata?.[collectionKey], existing?.[kind]);
  const selectedId = String(activeAdminCosmetics[kind] || '').toLowerCase();
  const currentId = String(existing?.[kind]?.assetId || '').toLowerCase();
  return assigned.find((item) => String(item.assetId).toLowerCase() === selectedId)
    || assigned.find((item) => String(item.assetId).toLowerCase() === currentId)
    || assigned[0]
    || null;
}

function sanitizePublicCosmeticsMetadata(value) {
  const metadata = sanitizeWritableCosmeticsMetadata(value);
  const adminAssignedKinds = Array.isArray(value?.adminAssignedKinds)
    ? value.adminAssignedKinds.filter((kind) => ['skin', 'cape', 'elytra'].includes(kind))
    : [];
  const skins = normalizeCosmeticList(value?.skins, null);
  const capes = normalizeCosmeticList(value?.capes, null);
  const elytras = normalizeCosmeticList(value?.elytras, null);
  return {
    ...metadata,
    ...(skins.length ? { skins } : {}),
    ...(capes.length ? { capes } : {}),
    ...(elytras.length ? { elytras } : {}),
    ...(adminAssignedKinds.length ? { adminAssignedKinds } : {})
  };
}

function normalizeCosmeticList(value, legacyValue) {
  const candidates = Array.isArray(value) ? value : [legacyValue];
  const unique = new Map();
  for (const cosmetic of candidates) {
    if (isEnabledCosmetic(cosmetic)) unique.set(cosmetic.assetId, cosmetic);
  }
  return [...unique.values()];
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json'
  });
  res.end(JSON.stringify(data));
}
