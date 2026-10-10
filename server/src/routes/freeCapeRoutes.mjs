import crypto from 'node:crypto';
import { CONFIG } from '../config.mjs';
import { DewUserAuthService } from '../services/dewUserAuthService.mjs';
import { CryptoService } from '../services/cryptoService.mjs';
import { decryptCosmeticAsset, isEncryptedCosmeticAsset } from '../services/cosmeticAssetEncryptionService.mjs';

const CLAIM_TTL_MS = 10 * 60 * 1000;
const UUID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ASSET_PATTERN = /^[a-f0-9]{64}$/i;
// Human-readable list; sampling without replacement guarantees 16 distinct words.
const CODE_WORDS = `amber anchor apple autumn bamboo beacon berry birch blossom breeze brook canyon cedar cherry cobalt comet coral cosmos cricket crystal dawn delta desert diamond dolphin dragon dream dune eagle ember emerald falcon fern field finch flame forest fossil fox galaxy garden garlic glacier gold granite harbor hazel honey horizon island ivory jade jasmine juniper kettle kiwi lagoon lantern lemon lilac linen lotus maple marble meadow melon mercury meteor mint mirror mist moon mountain music navy nectar nickel olive opal orange orbit orchid otter pebble pepper pine planet plum pollen poppy quartz rabbit radar raven reef river robin rocket saffron sage sail sapphire satin scarlet shadow silver sky slate solar sparrow spirit spruce star stone storm summit sunset swift thyme tiger timber toast topaz tulip velvet violet walnut wave willow winter wolf wonder yarrow yellow zephyr`.split(/\s+/);

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

function digestWords(words) {
  return crypto.createHash('sha256').update(words.join(' '), 'utf8').digest('hex');
}

function generateWords() {
  const pool = [...CODE_WORDS];
  const words = [];
  while (words.length < 16) {
    const index = crypto.randomInt(pool.length);
    words.push(pool.splice(index, 1)[0]);
  }
  return words;
}

function parseWords(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  const words = value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length !== 16 || new Set(words).size !== 16 || words.some((word) => !CODE_WORDS.includes(word))) return null;
  return words;
}

function getBearer(req) {
  return /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1] || '';
}

async function verifyPlayerIdentity(req, storage) {
  const minecraftToken = String(req.headers['x-minecraft-access-token'] || '');
  const dewToken = getBearer(req);
  let minecraftProfile = null;
  let dewUser = null;

  if (minecraftToken) {
    const verified = await DewUserAuthService.verifyMinecraftAccessToken(minecraftToken);
    if (verified.status === 'unavailable') return { error: { status: 503, code: 'MINECRAFT_AUTH_UNAVAILABLE', message: 'Minecraft profile verification is temporarily unavailable.' } };
    if (verified.status !== 'authenticated') return { error: { status: 401, code: 'MINECRAFT_AUTH_REQUIRED', message: 'Sign in to a valid Microsoft Minecraft account to continue.' } };
    minecraftProfile = verified.profile;
  }

  if (dewToken) {
    const verified = await DewUserAuthService.verifyAccessToken(dewToken);
    if (verified.status === 'unavailable') return { error: { status: 503, code: 'DEW_AUTH_UNAVAILABLE', message: 'Dew account verification is temporarily unavailable.' } };
    if (verified.status !== 'authenticated') return { error: { status: 401, code: 'DEW_AUTH_REQUIRED', message: 'Sign in to your Dew account again to continue.' } };
    dewUser = verified.user;
  }

  if (!minecraftProfile && !dewUser) {
    return { error: { status: 401, code: 'ACCOUNT_AUTH_REQUIRED', message: 'Sign in with a Microsoft or linked Dew account to claim a cape.' } };
  }

  let linkedIdentity = null;
  if (dewUser) {
    linkedIdentity = dewUser.provider === 'discord'
      ? { playerUuid: dewUser.minecraftUuid, username: dewUser.username }
      : await storage.getDewMinecraftIdentity?.(dewUser.id) || null;
    if (!linkedIdentity) {
      return { error: { status: 409, code: 'MINECRAFT_IDENTITY_NOT_LINKED', message: 'Link this Dew account to your verified Microsoft Minecraft profile first.' } };
    }
    if (minecraftProfile && linkedIdentity.playerUuid.toLowerCase() !== minecraftProfile.uuid.toLowerCase()) {
      return { error: { status: 403, code: 'ACCOUNT_IDENTITY_MISMATCH', message: 'The selected Dew and Microsoft accounts belong to different Minecraft profiles.' } };
    }
  }

  const profile = minecraftProfile || { uuid: linkedIdentity.playerUuid, username: linkedIdentity.username };
  return { profile, dewUser };
}

export async function handleListFreeCapes(req, res, storage) {
  const hasIdentityCredentials = Boolean(req.headers['x-minecraft-access-token'] || getBearer(req));
  const [cosmetics, identity] = await Promise.all([
    storage.getFreeCosmetics(),
    hasIdentityCredentials ? verifyPlayerIdentity(req, storage) : Promise.resolve({})
  ]);
  let claimedAssetIds = [];
  let discordLink = null;
  let selectedCapeAssetId = null;
  if (identity.profile) {
    const [claims, link, profileCosmetics] = await Promise.all([
      storage.getFreeCosmeticClaims(identity.profile.uuid),
      storage.getDiscordAccountLinkByPlayerUuid(identity.profile.uuid),
      storage.getCosmetics(identity.profile.uuid)
    ]);
    claimedAssetIds = claims.map((claim) => claim.assetId);
    discordLink = link;
    const metadata = profileCosmetics?.metadata || {};
    const adminCapeId = metadata.activeAdminCosmetics?.cape;
    const hasAdminCape = Array.isArray(metadata.adminAssignedKinds) && metadata.adminAssignedKinds.includes('cape');
    selectedCapeAssetId = hasAdminCape
      ? (typeof adminCapeId === 'string' ? adminCapeId.toLowerCase() : profileCosmetics?.cape?.assetId || null)
      : Object.prototype.hasOwnProperty.call(metadata, 'activeCapeAssetId')
        ? (typeof metadata.activeCapeAssetId === 'string' ? metadata.activeCapeAssetId.toLowerCase() : null)
        : (profileCosmetics?.cape?.assetId || null);
  }
  return sendJson(res, 200, {
    ok: true,
    data: cosmetics.map(({ assetId, sha256, name, kind, width, height, byteSize, createdAt }) => ({
      assetId, sha256, name, kind, width, height, byteSize, createdAt,
      claimed: claimedAssetIds.includes(assetId)
    })),
    identityRequired: identity.error?.message || null,
    selectedCapeAssetId,
    discordLinked: Boolean(discordLink),
    discordLinkedAt: discordLink?.linkedAt || null
  });
}

export async function handleCreateFreeCapeClaimCode(req, res, storage, body) {
  const identity = await verifyPlayerIdentity(req, storage);
  if (identity.error) return sendJson(res, identity.error.status, { ok: false, error: { code: identity.error.code, message: identity.error.message } });
  const assetId = typeof body?.assetId === 'string' && body.assetId ? body.assetId.toLowerCase() : null;
  if (assetId && !ASSET_PATTERN.test(assetId)) return sendJson(res, 400, { ok: false, error: { code: 'INVALID_ASSET', message: 'Select a valid free cape.' } });

  if (assetId) {
    const cosmetic = await storage.getCosmeticLibraryItem(assetId);
    if (!cosmetic || cosmetic.kind !== 'cape' || cosmetic.isFree !== true) {
      return sendJson(res, 404, { ok: false, error: { code: 'CAPE_NOT_AVAILABLE', message: 'This cape is not currently available to claim.' } });
    }
    const existingClaims = await storage.getFreeCosmeticClaims(identity.profile.uuid);
    if (existingClaims.some((claim) => claim.assetId === assetId)) {
      return sendJson(res, 409, { ok: false, error: { code: 'CAPE_ALREADY_CLAIMED', message: 'This cape is already in your cosmetics.' } });
    }
  }

  const currentLink = await storage.getDiscordAccountLinkByPlayerUuid(identity.profile.uuid);
  if (currentLink) {
    if (!assetId) return sendJson(res, 200, { ok: true, data: { alreadyLinked: true, discordInviteUrl: CONFIG.DISCORD_INVITE_URL || 'https://discord.gg/uXs2YD4D6H' } });
    const claim = await storage.claimFreeCosmeticForLinkedPlayer(assetId, identity.profile.uuid.toLowerCase());
    if (claim?.status === 'claimed' || claim?.status === 'already_claimed') {
      return sendJson(res, 200, { ok: true, data: { alreadyLinked: true, claimed: true, assetId } });
    }
    return sendJson(res, claim?.status === 'not_available' ? 404 : 409, { ok: false, error: { code: claim?.status === 'link_required' ? 'DISCORD_LINK_REQUIRED' : 'CAPE_NOT_AVAILABLE', message: 'The Discord link or cape claim could not be completed.' } });
  }

  const words = generateWords();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString();
  await storage.invalidateDiscordAccountLinkCodes(identity.profile.uuid.toLowerCase());
  await storage.createDiscordAccountLinkCode({
    codeHash: digestWords(words),
    playerUuid: identity.profile.uuid.toLowerCase(),
    username: identity.profile.username,
    initialAssetId: assetId,
    expiresAt
  });
  return sendJson(res, 201, {
    ok: true,
    data: {
      words,
      expiresAt,
      discordInviteUrl: CONFIG.DISCORD_INVITE_URL || 'https://discord.gg/uXs2YD4D6H',
      instruction: assetId
        ? 'Link your Discord account once; this first cape will be claimed automatically.'
        : 'Submit these words once in the DewClient Discord account-link form. Future free capes use the saved link.'
    }
  });
}

export async function handleClaimFreeCape(req, res, storage, body) {
  const identity = await verifyPlayerIdentity(req, storage);
  if (identity.error) return sendJson(res, identity.error.status, { ok: false, error: { code: identity.error.code, message: identity.error.message } });
  const assetId = typeof body?.assetId === 'string' ? body.assetId.toLowerCase() : '';
  if (!ASSET_PATTERN.test(assetId)) return sendJson(res, 400, { ok: false, error: { code: 'INVALID_ASSET', message: 'Select a valid free cape.' } });
  const result = await storage.claimFreeCosmeticForLinkedPlayer(assetId, identity.profile.uuid.toLowerCase());
  if (result?.status === 'claimed' || result?.status === 'already_claimed') {
    return sendJson(res, 200, { ok: true, data: {
      claimed: true,
      alreadyClaimed: result.status === 'already_claimed',
      equipped: result.equipped === true,
      selectedCapeAssetId: result.selectedCapeAssetId || null,
      assetId
    } });
  }
  if (result?.status === 'link_required') {
    return sendJson(res, 409, { ok: false, error: { code: 'DISCORD_LINK_REQUIRED', message: 'Link your Discord account once before claiming free capes.' } });
  }
  if (result?.status === 'not_available') {
    return sendJson(res, 404, { ok: false, error: { code: 'CAPE_NOT_AVAILABLE', message: 'This cape is no longer available to claim.' } });
  }
  return sendJson(res, 400, { ok: false, error: { code: 'CLAIM_FAILED', message: 'The free cape claim could not be completed.' } });
}

export async function handleEquipFreeCape(req, res, storage, body) {
  const identity = await verifyPlayerIdentity(req, storage);
  if (identity.error) return sendJson(res, identity.error.status, { ok: false, error: { code: identity.error.code, message: identity.error.message } });
  const requestedAssetId = body?.assetId;
  if (requestedAssetId === null || requestedAssetId === '') {
    const result = await storage.clearSelectedCape(identity.profile.uuid.toLowerCase());
    if (result?.status === 'cleared') {
      return sendJson(res, 200, { ok: true, data: { equipped: false, cleared: true, selectedCapeAssetId: null } });
    }
    if (result?.status === 'admin_override') {
      return sendJson(res, 409, { ok: false, error: { code: 'ADMIN_CAPE_ACTIVE', message: 'A cape assigned by DewClient is active on this profile.' } });
    }
    return sendJson(res, 400, { ok: false, error: { code: 'CAPE_CLEAR_FAILED', message: 'The active cape could not be cleared. Refresh your collection and try again.' } });
  }
  const assetId = typeof requestedAssetId === 'string' ? requestedAssetId.toLowerCase() : '';
  if (!ASSET_PATTERN.test(assetId)) return sendJson(res, 400, { ok: false, error: { code: 'INVALID_ASSET', message: 'Choose a valid cape from your collection.' } });

  const result = await storage.selectClaimedFreeCape(assetId, identity.profile.uuid.toLowerCase());
  if (result?.status === 'equipped') {
    return sendJson(res, 200, { ok: true, data: { equipped: true, selectedCapeAssetId: result.assetId } });
  }
  if (result?.status === 'not_owned') {
    return sendJson(res, 403, { ok: false, error: { code: 'CAPE_NOT_OWNED', message: 'Claim this cape before equipping it.' } });
  }
  if (result?.status === 'not_available') {
    return sendJson(res, 404, { ok: false, error: { code: 'CAPE_NOT_AVAILABLE', message: 'This cape is no longer available.' } });
  }
  if (result?.status === 'admin_override') {
    return sendJson(res, 409, { ok: false, error: { code: 'ADMIN_CAPE_ACTIVE', message: 'A cape assigned by DewClient is active on this profile.' } });
  }
  if (result?.status === 'profile_missing') {
    return sendJson(res, 409, { ok: false, error: { code: 'PROFILE_NOT_READY', message: 'Refresh your profile and try again.' } });
  }
  return sendJson(res, 400, { ok: false, error: { code: 'CAPE_EQUIP_FAILED', message: 'The cape could not be equipped. Refresh your collection and try again.' } });
}

export async function handleGetFreeCapePreview(res, storage, assetId) {
  if (!ASSET_PATTERN.test(String(assetId || ''))) return sendJson(res, 400, { ok: false, error: { code: 'INVALID_ASSET', message: 'Cape preview reference is invalid.' } });
  const item = await storage.getCosmeticLibraryItem(assetId.toLowerCase());
  if (!item || item.kind !== 'cape' || item.isFree !== true) return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Free cape preview was not found.' } });
  const asset = await storage.getAsset(item.sha256);
  if (!asset) return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Free cape preview was not found.' } });
  let plaintext;
  try {
    plaintext = isEncryptedCosmeticAsset(asset.buffer) ? decryptCosmeticAsset(asset.buffer) : asset.buffer;
  } catch {
    return sendJson(res, 500, { ok: false, error: { code: 'ASSET_DECRYPT_FAILED', message: 'Cape preview could not be verified.' } });
  }
  if (plaintext.length > 50 * 1024 * 1024 || CryptoService.sha256(plaintext) !== String(item.sha256).toLowerCase()) {
    return sendJson(res, 500, { ok: false, error: { code: 'ASSET_CORRUPT', message: 'Cape preview failed its integrity check.' } });
  }
  res.writeHead(200, {
    'Content-Type': item.contentType || 'image/png',
    'Content-Length': plaintext.length,
    'Cache-Control': 'public, max-age=300',
    'ETag': `"${String(item.sha256).toLowerCase()}"`,
    'X-Content-Type-Options': 'nosniff'
  });
  return res.end(plaintext);
}

export async function handleFreeCapeClaimStatus(req, res, storage) {
  const identity = await verifyPlayerIdentity(req, storage);
  if (identity.error) return sendJson(res, identity.error.status, { ok: false, error: { code: identity.error.code, message: identity.error.message } });
  const claims = await storage.getFreeCosmeticClaims(identity.profile.uuid);
  const link = await storage.getDiscordAccountLinkByPlayerUuid(identity.profile.uuid);
  return sendJson(res, 200, { ok: true, data: { playerUuid: identity.profile.uuid, claimedAssetIds: claims.map((claim) => claim.assetId), discordLinked: Boolean(link), discordLinkedAt: link?.linkedAt || null, discordUsername: link?.discordUsername || null, discordDisplayName: link?.discordDisplayName || null } });
}

function discordPublicKey() {
  const hex = CONFIG.DISCORD_APPLICATION_PUBLIC_KEY;
  if (!/^[a-f0-9]{64}$/i.test(hex)) return null;
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return crypto.createPublicKey({ key: Buffer.concat([prefix, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
}

function validDiscordSignature(req, rawBody) {
  const signatureHex = String(req.headers['x-signature-ed25519'] || '');
  const timestamp = String(req.headers['x-signature-timestamp'] || '');
  if (!/^[a-f0-9]{128}$/i.test(signatureHex) || !/^\d{10,16}$/.test(timestamp)) return false;
  const timestampMs = Number(timestamp) * (timestamp.length <= 10 ? 1000 : 1);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false;
  try {
    const key = discordPublicKey();
    return Boolean(key && crypto.verify(null, Buffer.from(`${timestamp}${rawBody}`, 'utf8'), key, Buffer.from(signatureHex, 'hex')));
  } catch {
    return false;
  }
}

function findModalText(data) {
  for (const row of data?.components || []) {
    for (const component of row.components || []) {
      if (component.custom_id === 'claim_words' && typeof component.value === 'string') return component.value;
    }
  }
  return '';
}

function discordReply(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  return res.end(JSON.stringify(body));
}

async function editDeferredDiscordReply(interaction, content) {
  const applicationId = encodeURIComponent(CONFIG.DISCORD_APPLICATION_ID);
  const token = encodeURIComponent(String(interaction?.token || ''));
  if (!token) return;
  try {
    const response = await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) console.error(`[DISCORD] Could not update deferred interaction (HTTP ${response.status}).`);
  } catch (error) {
    console.error('[DISCORD] Could not update deferred interaction:', error?.name || 'network error');
  }
}

async function completeDiscordAccountLink(interaction, storage, words, discordUserId, guildId) {
  let result;
  try {
    const discordUser = interaction?.member?.user || interaction?.user || {};
    const discordUsername = String(discordUser.username || '').slice(0, 64);
    const discordDisplayName = String(discordUser.global_name || discordUsername).slice(0, 80);
    result = await storage.consumeDiscordAccountLinkCode(digestWords(words), discordUserId, guildId, discordUsername, discordDisplayName);
    if (result?.status === 'expired_or_invalid' || result?.status === 'invalid') {
      // Accept valid, still-pending codes created by the original 1.0.4 flow.
      result = await storage.consumeFreeCosmeticClaimCode(digestWords(words), discordUserId, guildId);
    }
  } catch (error) {
    console.error('[DISCORD] Account-link interaction failed:', error?.message || 'storage error');
    await editDeferredDiscordReply(interaction, 'The account-link service is temporarily unavailable. Please try again shortly.');
    return;
  }

  const messages = {
    linked_and_claimed: 'Your Discord and Minecraft accounts are linked. The selected cape has been added to DewClient; future free capes can be claimed with one click.',
    linked: result?.claimStatus === 'not_available'
      ? 'Your Discord and Minecraft accounts are now linked. That cape is no longer available, but future free capes can be claimed with one click.'
      : 'Your Discord and Minecraft accounts are now linked. Future free capes can be claimed with one click in DewClient.',
    claimed: 'Your account is linked and the cape is claimed. Reopen Cosmetics in DewClient to see it in your cape slots.',
    expired_or_invalid: 'That code is expired or invalid. Generate a fresh link code in DewClient Settings → Account.',
    not_available: 'That cape is no longer available to claim.',
    discord_already_linked: 'This Discord account is already linked to a different Minecraft profile.',
    player_already_linked: 'This Minecraft profile is already linked to a different Discord account.',
    link_conflict: 'The account could not be linked because it is already connected elsewhere.'
  };
  const status = result?.status || 'expired_or_invalid';
  await editDeferredDiscordReply(interaction, messages[status] || 'The account link could not be completed. Generate a fresh code and try again.');
}

export async function handleDiscordInteraction(req, res, storage, rawBody, parsedBody) {
  if (!CONFIG.DISCORD_APPLICATION_PUBLIC_KEY) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Discord interactions are not configured.' }));
  }
  if (!validDiscordSignature(req, rawBody)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid Discord request signature.' }));
  }

  const interaction = parsedBody;
  if (interaction?.type === 1) return discordReply(res, { type: 1 });
  if (interaction?.application_id !== CONFIG.DISCORD_APPLICATION_ID) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'This Discord application is not configured for DewClient linking.' }));
  }
  if (interaction?.guild_id !== CONFIG.DISCORD_LINK_GUILD_ID || interaction?.channel_id !== CONFIG.DISCORD_LINK_CHANNEL_ID) {
    return discordReply(res, { type: 4, data: { content: 'Use the official DewClient Discord server to link your account.', flags: 64 } });
  }

  if (interaction?.type === 3 && interaction?.data?.custom_id === 'dewclient:link-account') {
    return discordReply(res, {
      type: 9,
      data: {
        custom_id: 'dewclient:submit-account-link',
        title: 'Link your DewClient account',
        components: [{ type: 1, components: [{
          type: 4,
          custom_id: 'claim_words',
          style: 2,
          label: 'Your 16-word link code',
          placeholder: 'Paste the words from DewClient Settings → Account',
          min_length: 40,
          max_length: 255,
          required: true
        }] }]
      }
    });
  }

  if (interaction?.type === 5 && interaction?.data?.custom_id === 'dewclient:submit-account-link') {
    const discordUserId = String(interaction?.member?.user?.id || interaction?.user?.id || '');
    const guildId = String(interaction.guild_id || '');
    if (!/^[0-9]{17,20}$/.test(discordUserId)) {
      return discordReply(res, { type: 4, data: { content: 'Discord could not verify your user. Please try again.', flags: 64 } });
    }
    const words = parseWords(findModalText(interaction.data));
    if (!words) {
      return discordReply(res, { type: 4, data: { content: 'That code is invalid. Paste the 16 unique words exactly as DewClient showed them.', flags: 64 } });
    }
    // Acknowledge with visible feedback immediately; Discord can otherwise
    // show its generic "didn't respond" toast while the database RPC runs.
    const response = discordReply(res, { type: 4, data: { content: 'Checking your link code…', flags: 64 } });
    setImmediate(() => { void completeDiscordAccountLink(interaction, storage, words, discordUserId, guildId); });
    return response;
  }

  return discordReply(res, { type: 4, data: { content: 'This DewClient interaction is no longer available.', flags: 64 } });
}
