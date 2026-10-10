function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  return match?.[1] || '';
}

function equippedSnapshot(manifest) {
  const equipped = new Map();
  const add = (kind, item) => {
    if (item?.enabled !== true || !/^[a-f0-9]{64}$/i.test(String(item.assetId || ''))) return;
    equipped.set(`${kind}:${item.assetId}`, {
      cosmeticId: `${kind}:${item.assetId}`,
      assetVersion: Math.max(1, Number(manifest.version) || 1),
      enabled: true
    });
  };

  add('skin', manifest.skin);
  add('cape', manifest.cape);
  add('wings', manifest.elytra);
  return { revision: Math.max(0, Number(manifest.version) || 0), items: [...equipped.values()] };
}

export async function handleCreateDewCosmeticsSession(req, res, sessionService, body) {
  const minecraftAccessToken = String(req.headers['x-minecraft-access-token'] || '');
  const result = await sessionService.createSession(bearerToken(req), body, minecraftAccessToken);
  if (!result.data) {
    return sendJson(res, result.status, {
      ok: false,
      error: { code: result.code, message: result.message }
    });
  }
  return sendJson(res, result.status, { ok: true, data: result.data });
}

export async function handleGetOwnDewCosmetics(req, res, sessionService, storage) {
  const session = sessionService.authenticate(bearerToken(req));
  if (!session) {
    return sendJson(res, 401, { ok: false, error: { code: 'AUTH_EXPIRED', message: 'DewCosmetics session is invalid or expired.' } });
  }
  if (!session.permissions.includes('cosmetics:read')) {
    return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'This session cannot read cosmetics.' } });
  }

  const manifest = await storage.getCosmetics(session.playerUuid);
  const assigned = normalizeCosmeticList(manifest?.metadata?.capes, manifest?.cape);
  const claims = typeof storage.getFreeCosmeticClaims === 'function'
    ? await storage.getFreeCosmeticClaims(session.playerUuid)
    : [];
  const claimedIds = new Set(claims.map((claim) => String(claim.assetId || '').toLowerCase()));
  const capes = new Map();
  for (const item of assigned) {
    capes.set(item.assetId.toLowerCase(), ownCapeItem(item, claimedIds.has(item.assetId.toLowerCase()) ? 'claimed' : 'assigned'));
  }
  for (const claim of claims) {
    const assetId = String(claim.assetId || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(assetId) || capes.has(assetId)) continue;
    const libraryItem = await storage.getCosmeticLibraryItem(assetId);
    if (!libraryItem || libraryItem.isFree !== true || libraryItem.kind !== 'cape') continue;
    capes.set(assetId, ownCapeItem({
      assetId,
      sha256: libraryItem.sha256,
      name: libraryItem.name,
      contentType: libraryItem.contentType,
      byteSize: libraryItem.byteSize,
      width: libraryItem.width,
      height: libraryItem.height,
      enabled: true
    }, 'claimed'));
  }
  const explicitlySelected = Object.prototype.hasOwnProperty.call(manifest?.metadata || {}, 'activeCapeAssetId');
  const selectedCapeAssetId = explicitlySelected
    ? (typeof manifest.metadata.activeCapeAssetId === 'string' ? manifest.metadata.activeCapeAssetId.toLowerCase() : null)
    : (manifest?.cape?.assetId || null);
  const snapshot = equippedSnapshot(manifest || { version: 0, metadata: {} });
  return sendJson(res, 200, {
    ok: true,
    data: {
      player: { dewUserId: session.userId, minecraftUuid: session.playerUuid, displayName: session.username },
      equipped: snapshot,
      selectedCapeAssetId,
      capes: [...capes.values()]
    }
  });
}

export async function handleEquipOwnCape(req, res, sessionService, storage, body) {
  const session = sessionService.authenticate(bearerToken(req));
  if (!session) {
    return sendJson(res, 401, { ok: false, error: { code: 'AUTH_EXPIRED', message: 'DewCosmetics session is invalid or expired.' } });
  }
  if (!session.permissions.includes('cosmetics:equip')) {
    return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'This session cannot equip cosmetics.' } });
  }

  const requested = body?.assetId;
  const assetId = requested === null || requested === '' ? null
    : typeof requested === 'string' && /^[a-f0-9]{64}$/i.test(requested) ? requested.toLowerCase() : undefined;
  if (assetId === undefined) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_COSMETIC', message: 'Choose a valid cape from your collection.' } });
  }

  const existing = await storage.getCosmetics(session.playerUuid);
  const assigned = normalizeCosmeticList(existing?.metadata?.capes, existing?.cape);
  let selected = assetId ? assigned.find((item) => item.assetId.toLowerCase() === assetId) || null : null;
  if (assetId && !selected) {
    const claims = typeof storage.getFreeCosmeticClaims === 'function'
      ? await storage.getFreeCosmeticClaims(session.playerUuid)
      : [];
    if (!claims.some((claim) => String(claim.assetId || '').toLowerCase() === assetId)) {
      return sendJson(res, 403, { ok: false, error: { code: 'COSMETIC_NOT_OWNED', message: 'That cape is not assigned or claimed on this Minecraft profile.' } });
    }
    const libraryItem = await storage.getCosmeticLibraryItem(assetId);
    if (!libraryItem || libraryItem.isFree !== true || libraryItem.kind !== 'cape') {
      return sendJson(res, 404, { ok: false, error: { code: 'COSMETIC_UNAVAILABLE', message: 'That claimed cape is no longer available.' } });
    }
    selected = {
      assetId,
      sha256: libraryItem.sha256,
      name: libraryItem.name,
      contentType: libraryItem.contentType,
      byteSize: libraryItem.byteSize,
      width: libraryItem.width,
      height: libraryItem.height,
      enabled: true
    };
  }

  const metadata = { ...(existing?.metadata || {}), activeCapeAssetId: assetId };
  if (assetId && selected && !assigned.some((item) => item.assetId.toLowerCase() === assetId)) {
    metadata.capes = [...assigned, selected];
  }
  const updated = await storage.saveCosmetics(session.playerUuid, {
    username: session.username,
    skin: existing?.skin || null,
    cape: selected,
    elytra: existing?.elytra || null,
    metadata
  }, Number(existing?.version || 0));
  if (!updated) {
    return sendJson(res, 409, { ok: false, error: { code: 'COSMETICS_CHANGED', message: 'Your cape collection changed. Refresh it and try again.' } });
  }
  return sendJson(res, 200, { ok: true, data: { selectedCapeAssetId: assetId, revision: updated.version } });
}

function ownCapeItem(item, source) {
  return {
    assetId: String(item.assetId || '').toLowerCase(),
    sha256: String(item.sha256 || '').toLowerCase(),
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : 'DewClient Cape',
    contentType: item.contentType || item.mime || 'image/png',
    byteSize: Number(item.byteSize) || 0,
    width: Number(item.width) || null,
    height: Number(item.height) || null,
    source
  };
}

function normalizeCosmeticList(value, legacyValue) {
  const candidates = Array.isArray(value) ? value : [legacyValue];
  const unique = new Map();
  for (const cosmetic of candidates) {
    if (cosmetic && typeof cosmetic === 'object' && cosmetic.enabled === true
      && /^[a-f0-9]{64}$/i.test(String(cosmetic.assetId || ''))
      && /^[a-f0-9]{64}$/i.test(String(cosmetic.sha256 || ''))
      && cosmetic.assetId.toLowerCase() === cosmetic.sha256.toLowerCase()) {
      unique.set(cosmetic.assetId.toLowerCase(), cosmetic);
    }
  }
  return [...unique.values()];
}
