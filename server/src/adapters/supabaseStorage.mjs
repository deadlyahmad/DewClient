/**
 * DewClient Central Server - Supabase PostgreSQL Storage Adapter
 * Communicates directly with Supabase via its REST API (PostgREST) using native fetch.
 */

import { CONFIG } from '../config.mjs';
import { getEmptyManifest } from '../services/defaults.mjs';
import { fetchSupabase } from '../services/supabaseHttp.mjs';

export class SupabaseStorageAdapter {
  constructor() {
    this.supabaseUrl = (CONFIG.SUPABASE_URL || '').replace(/\/+$/, '');
    this.supabaseKey = CONFIG.SUPABASE_KEY || '';
    this.isReady = false;
  }

  async init() {
    if (!this.supabaseUrl || !this.supabaseKey) throw new Error('SUPABASE_URL and SUPABASE_KEY are required.');

    try {
      const [manifestRes, staffRes] = await Promise.all([
        fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_manifest?select=id&limit=1`, { headers: this.getHeaders() }),
        fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_admins?select=id,session_version&limit=1`, { headers: this.getHeaders() })
      ]);
      if (manifestRes.ok && staffRes.ok) {
        this.isReady = true;
        console.log(`[STORAGE] Connected to Supabase at ${this.supabaseUrl}`);
      } else {
        throw new Error(`Supabase readiness check failed (${manifestRes.status}/${staffRes.status}).`);
      }
    } catch (error) {
      this.isReady = false;
      throw new Error('Could not connect to Supabase storage.', { cause: error });
    }
  }

  getHeaders() {
    return {
      'apikey': this.supabaseKey,
      'Authorization': `Bearer ${this.supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  async checkHealth() {
    try {
      const [manifestRes, staffRes] = await Promise.all([
        fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_manifest?select=id&limit=1`, { headers: this.getHeaders() }),
        fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_admins?select=id,session_version&limit=1`, { headers: this.getHeaders() })
      ]);
      this.isReady = manifestRes.ok && staffRes.ok;
      return this.isReady;
    } catch {
      this.isReady = false;
      return false;
    }
  }

  // --- Clients ---

  async getClients() {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_clients?select=*&order=last_seen_at.desc`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`Supabase client lookup failed (${res.status}).`);
    const rows = await res.json();
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000;

    return rows.map((r) => ({
      id: r.id,
      publicKey: r.public_key,
      clientVersion: r.client_version,
      os: r.os,
      osVersion: r.os_version,
      architecture: r.architecture,
      hostname: r.hostname,
      status: r.status,
      lastSeenAt: r.last_seen_at,
      registeredAt: r.created_at,
      isOnline: Boolean(r.last_seen_at && new Date(r.last_seen_at).getTime() >= twoMinutesAgo)
    }));
  }

  async getClient(clientId) {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_clients?id=eq.${encodeURIComponent(clientId)}&select=*`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`Supabase client lookup failed (${res.status}).`);
    const rows = await res.json();
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      publicKey: r.public_key,
      clientVersion: r.client_version,
      os: r.os,
      osVersion: r.os_version,
      architecture: r.architecture,
      hostname: r.hostname,
      status: r.status,
      lastSeenAt: r.last_seen_at
    };
  }

  async getClientByPublicKey(publicKey) {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_clients?public_key=eq.${encodeURIComponent(publicKey)}&select=*`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`Supabase client lookup failed (${res.status}).`);
    const rows = await res.json();
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      publicKey: r.public_key,
      clientVersion: r.client_version,
      os: r.os,
      status: r.status,
      lastSeenAt: r.last_seen_at
    };
  }

  async saveClient(client) {
    const clientVersion = typeof client.clientVersion === 'string' ? client.clientVersion.trim() : '';
    if (!clientVersion) throw new TypeError('A real client version is required to save a client.');
    const now = new Date().toISOString();
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_clients`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        id: client.id,
        public_key: client.publicKey || '',
        client_version: clientVersion,
        os: client.os || null,
        os_version: client.osVersion || null,
        architecture: client.architecture || null,
        hostname: client.hostname || null,
        status: client.status || 'online',
        last_seen_at: client.lastSeenAt || now
      })
    });
    if (!res.ok) throw new Error(`Supabase client save failed (${res.status}).`);
    return client;
  }

  // --- Accounts ---

  async getAccounts(query = {}) {
    const page = await this.getAccountsPage(query);
    return page.accounts;
  }

  async getAccountsPage({ search = '', limit = 100, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 100));
    const safeOffset = Math.max(0, Math.min(10_000_000, Number.isInteger(offset) ? offset : 0));
    const params = new URLSearchParams({ select: '*', order: 'last_used_at.desc' });
    const normalizedSearch = String(search).replace(/[^A-Za-z0-9_ -]/g, '').trim().slice(0, 100);
    if (normalizedSearch) {
      params.set('or', `(username.ilike.*${normalizedSearch}*,uuid.ilike.*${normalizedSearch}*)`);
    }
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_accounts?${params}`, {
      headers: { ...this.getHeaders(), Prefer: 'count=exact', Range: `${safeOffset}-${safeOffset + safeLimit - 1}` }
    });
    if (!res.ok) throw new Error(`Supabase account lookup failed (${res.status}).`);
    const rows = await res.json();
    const countMatch = (res.headers.get('content-range') || '').match(/\/(\d+|\*)$/);
    const total = countMatch?.[1] && countMatch[1] !== '*' ? Number(countMatch[1]) : rows.length;
    return { accounts: rows.map((r) => ({
      uuid: r.uuid,
      username: r.username,
      type: r.type,
      avatarUrl: r.avatar_url,
      skinUrl: r.skin_url,
      capeUrl: r.cape_url,
      clientId: r.client_id,
      lastUsedAt: r.last_used_at,
      registeredAt: r.registered_at
    })), total };
  }

  async syncClientAccounts(clientId, accounts) {
    const uniqueAccounts = [...new Map(accounts.map((account) => [account.uuid.toLowerCase(), account])).values()];
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_sync_client_accounts`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ p_client_id: clientId, p_accounts: uniqueAccounts })
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      const errorCode = typeof errorBody?.code === 'string' ? `, ${errorBody.code}` : '';
      throw new Error(`Supabase account sync failed (${res.status}${errorCode}).`);
    }
    return Number(await res.json()) || 0;
  }

  async syncOnlinePresence(clientId, player, lastSeenAt = new Date().toISOString()) {
    if (!player) {
      const params = new URLSearchParams({ client_id: `eq.${clientId}` });
      const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_player_presence?${params}`, {
        method: 'DELETE', headers: { ...this.getHeaders(), Prefer: 'return=minimal' }
      });
      if (!res.ok) throw new Error(`Supabase player presence cleanup failed (${res.status}).`);
      return;
    }
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_player_presence?on_conflict=player_uuid`, {
      method: 'POST',
      headers: { ...this.getHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        player_uuid: player.uuid.toLowerCase(),
        username: player.username,
        client_id: clientId,
        last_seen_at: lastSeenAt
      })
    });
    if (!res.ok) throw new Error(`Supabase player presence update failed (${res.status}).`);
  }

  async getOnlinePlayers() {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      select: 'player_uuid,username,last_seen_at',
      last_seen_at: `gte.${cutoff}`,
      order: 'last_seen_at.desc',
      limit: '100'
    });
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_player_presence?${params}`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Supabase player presence lookup failed (${res.status}).`);
    return (await res.json()).map((row) => ({
      uuid: row.player_uuid,
      username: row.username,
      avatarUrl: `https://mc-heads.net/avatar/${encodeURIComponent(row.username)}/64`
    }));
  }

  async getAccount(uuid) {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_accounts?uuid=eq.${encodeURIComponent(uuid)}&select=*`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`Supabase account lookup failed (${res.status}).`);
    const rows = await res.json();
    return rows.length > 0 ? rows[0] : null;
  }

  async authorizeCosmeticsPublish(userId, playerUuid, username, clientId, publicKey) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_authorize_cosmetics_publish`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        p_dew_user_id: userId,
        p_player_uuid: playerUuid,
        p_minecraft_username: username,
        p_client_id: clientId,
        p_public_key: publicKey
      })
    });
    if (!response.ok) throw new Error(`Supabase identity authorization failed (${response.status}).`);
    const result = await response.json();
    return result === true || (Array.isArray(result) && result[0] === true);
  }

  async linkDewMinecraftIdentity(userId, playerUuid, username) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_link_minecraft_identity`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        p_dew_user_id: userId,
        p_player_uuid: playerUuid,
        p_minecraft_username: username
      })
    });
    if (!response.ok) throw new Error(`Supabase Minecraft identity link failed (${response.status}).`);
    const result = await response.json();
    return result === true || (Array.isArray(result) && result[0] === true);
  }

  async getDewMinecraftIdentity(userId) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_minecraft_identities?dew_user_id=eq.${encodeURIComponent(userId)}&select=player_uuid,minecraft_username&limit=1`, {
      headers: this.getHeaders()
    });
    if (!response.ok) throw new Error(`Supabase linked Minecraft identity lookup failed (${response.status}).`);
    const rows = await response.json();
    return rows[0] ? { playerUuid: rows[0].player_uuid, username: rows[0].minecraft_username } : null;
  }

  async claimPublishRequest(clientId, requestId) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_claim_cosmetics_publish_request`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ p_client_id: clientId, p_request_id: requestId })
    });
    if (!response.ok) throw new Error(`Supabase publish replay check failed (${response.status}).`);
    const result = await response.json();
    return result === true || (Array.isArray(result) && result[0] === true);
  }

  async getAccountByUsername(username) {
    const res = await fetchSupabase(
      `${this.supabaseUrl}/rest/v1/dew_accounts?username=ilike.${encodeURIComponent(username.replace(/_/g, '\\_'))}&select=*&order=last_used_at.desc&limit=1`,
      { headers: this.getHeaders() }
    );
    if (!res.ok) throw new Error(`Supabase account lookup failed (${res.status}): ${await res.text()}`);
    const rows = await res.json();
    return rows[0] || null;
  }

  async getDiscordAccount(discordUserId) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_discord_accounts?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=discord_user_id,player_uuid,username,created_at,last_username_change_at&limit=1`, {
      headers: this.getHeaders()
    });
    if (!response.ok) throw new Error(`Discord account lookup failed (${response.status}).`);
    const row = (await response.json())[0];
    return row || null;
  }

  async createDiscordAccount({ discordUserId, uuid, username, guildId, discordUsername = '', discordDisplayName = '' }) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_create_discord_account`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        p_discord_user_id: discordUserId,
        p_player_uuid: uuid,
        p_username: username,
        p_guild_id: guildId
      })
    });
    if (!response.ok) throw new Error(`Discord account creation failed (${response.status}).`);
    const result = await response.json();
    if (['username_taken', 'unavailable'].includes(result?.status)) {
      const error = new Error('That Minecraft username is already in use.');
      error.code = 'USERNAME_UNAVAILABLE';
      throw error;
    }
    if (result?.status === 'invalid_uuid' || result?.status === 'invalid') {
      const error = new Error('The Minecraft profile name could not be validated.');
      error.code = 'INVALID_DISCORD_PROFILE';
      throw error;
    }
    if (result?.status === 'conflict') {
      const error = new Error('This name or profile is already registered.');
      error.code = 'DISCORD_PROFILE_CONFLICT';
      throw error;
    }
    if (!['created', 'exists'].includes(result?.status) || !result?.account) {
      throw new Error('Discord profile creation returned an unexpected result.');
    }
    await this.updateDiscordAccountLinkProfile(discordUserId, discordUsername, discordDisplayName);
    return result.account;
  }

  async updateDiscordAccountLinkProfile(discordUserId, discordUsername, discordDisplayName) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_discord_account_links?discord_user_id=eq.${encodeURIComponent(discordUserId)}`, {
      method: 'PATCH',
      headers: { ...this.getHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        discord_username: String(discordUsername || '').slice(0, 64) || null,
        discord_display_name: String(discordDisplayName || discordUsername || '').slice(0, 80) || null
      })
    });
    if (!response.ok) console.error(`[DISCORD] Link is active, but profile name could not be saved (HTTP ${response.status}).`);
  }

  async changeDiscordUsername(discordUserId, username) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_change_discord_username`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ p_discord_user_id: discordUserId, p_username: username })
    });
    if (!response.ok) throw new Error(`Discord name change failed (${response.status}).`);
    const result = await response.json();
    if (result?.status === 'changed' || result?.status === 'unchanged') {
      return { account: result.account, changedAt: result.changedAt || null, nextChangeAt: result.nextChangeAt || null };
    }
    if (result?.status === 'cooldown') return { status: 'cooldown', availableAt: result.availableAt };
    if (result?.status === 'unavailable') return { status: 'unavailable' };
    return { status: 'missing' };
  }

  async saveAccount(account) {
    const rawUuid = typeof account.uuid === 'string' ? account.uuid.trim() : '';
    const username = typeof account.username === 'string' ? account.username.trim() : '';
    if (!rawUuid || !username || !['microsoft', 'offline'].includes(account.type)) {
      throw new TypeError('A real account UUID, username, and type are required to save an account.');
    }
    const now = new Date().toISOString();
    const avatarUrl = account.avatarUrl || `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`;

    const checkRes = await fetchSupabase(
      `${this.supabaseUrl}/rest/v1/dew_accounts?uuid=eq.${encodeURIComponent(rawUuid)}&select=skin_url,cape_url`,
      { headers: this.getHeaders() }
    );
    if (!checkRes.ok) throw new Error(`Supabase account lookup failed (${checkRes.status}).`);
    const existingRows = await checkRes.json();
    const existingSkinUrl = existingRows[0]?.skin_url || null;
    const existingCapeUrl = existingRows[0]?.cape_url || null;

    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_accounts`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        uuid: rawUuid,
        username,
        type: account.type,
        avatar_url: avatarUrl,
        skin_url: existingSkinUrl || account.skinUrl || null,
        cape_url: existingCapeUrl || account.capeUrl || null,
        client_id: account.clientId || null,
        last_used_at: account.lastUsedAt || now,
        updated_at: now
      })
    });
    if (!res.ok) throw new Error(`Supabase account save failed (${res.status}).`);

    return {
      uuid: rawUuid,
      username: account.username,
      type: account.type || 'microsoft',
      avatarUrl,
      lastUsedAt: account.lastUsedAt || now
    };
  }

  // --- Manifest ---

  async getManifest() {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_manifest?id=eq.primary&select=snapshot`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`Supabase manifest lookup failed (${res.status}).`);
    const rows = await res.json();
    return rows.length > 0 && rows[0].snapshot ? rows[0].snapshot : getEmptyManifest();
  }

  async saveManifest(manifest) {
    const now = new Date().toISOString();
    const updated = {
      ...manifest,
      serverTime: now,
      updatedAt: now
    };
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_manifest`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        id: 'primary',
        snapshot: updated,
        updated_at: now
      })
    });
    if (!res.ok) throw new Error(`Supabase manifest save failed (${res.status}).`);

    return updated;
  }

  // --- Cosmetics ---

  async getCosmetics(playerUuid) {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_cosmetics?player_uuid=eq.${encodeURIComponent(playerUuid)}&select=*`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`Supabase cosmetics lookup failed (${res.status}).`);
    const rows = await res.json();
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      playerUuid: r.player_uuid,
      username: r.username,
      version: r.version,
      skin: r.skin,
      cape: r.cape,
      elytra: r.elytra,
      metadata: r.metadata,
      updatedAt: r.updated_at
    };
  }

  async getCosmeticsForPlayers(playerUuids) {
    if (!Array.isArray(playerUuids) || playerUuids.length > 128
      || playerUuids.some((uuid) => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(uuid)))) {
      throw new TypeError('Cosmetics lookup requires up to 128 valid Minecraft UUIDs.');
    }
    if (playerUuids.length === 0) return [];
    const filter = `in.(${playerUuids.map((uuid) => uuid.toLowerCase()).join(',')})`;
    const res = await fetchSupabase(
      `${this.supabaseUrl}/rest/v1/dew_cosmetics?player_uuid=${encodeURIComponent(filter)}&select=player_uuid,username,version,skin,cape,elytra,metadata,updated_at&limit=128`,
      { headers: this.getHeaders() }
    );
    if (!res.ok) throw new Error(`Supabase batch cosmetics lookup failed (${res.status}).`);
    const rows = await res.json();
    return rows.map((row) => ({
      playerUuid: row.player_uuid,
      username: row.username,
      version: row.version,
      skin: row.skin,
      cape: row.cape,
      elytra: row.elytra,
      metadata: row.metadata || {},
      updatedAt: row.updated_at
    }));
  }

  async getAllCosmetics() {
    try {
      const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_cosmetics?select=player_uuid,username,version,skin,cape,elytra,metadata,updated_at&limit=500`, {
        headers: this.getHeaders()
      });
      if (!res.ok) throw new Error(`Supabase getAllCosmetics failed (${res.status}).`);
      const rows = await res.json();
      return rows.map((row) => ({
        playerUuid: row.player_uuid,
        username: row.username,
        version: row.version,
        skin: row.skin,
        cape: row.cape,
        elytra: row.elytra,
        metadata: row.metadata || {},
        updatedAt: row.updated_at
      }));
    } catch (error) {
      throw error;
    }
  }

  async getCosmeticLibrary() {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_cosmetic_library?select=*&order=created_at.desc&limit=500`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`Supabase cosmetic library lookup failed (${res.status}): ${await res.text()}`);
    return (await res.json()).map((row) => ({
      assetId: row.asset_id,
      sha256: row.sha256,
      name: row.name,
      kind: row.kind,
      contentType: row.content_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      isFree: row.is_free === true,
      createdAt: row.created_at
    }));
  }

  async getCosmeticLibraryItem(assetId) {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_cosmetic_library?asset_id=eq.${encodeURIComponent(assetId)}&select=*&limit=1`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`Supabase cosmetic lookup failed (${res.status}): ${await res.text()}`);
    const rows = await res.json();
    const row = rows[0];
    return row ? {
      assetId: row.asset_id,
      sha256: row.sha256,
      name: row.name,
      kind: row.kind,
      contentType: row.content_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      isFree: row.is_free === true,
      createdAt: row.created_at
    } : null;
  }

  async saveCosmeticLibraryItem(item) {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_cosmetic_library`, {
      method: 'POST',
      headers: { ...this.getHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        asset_id: item.assetId,
        sha256: item.sha256,
        name: item.name,
        kind: item.kind,
        content_type: item.contentType,
        byte_size: item.byteSize,
        width: item.width,
        height: item.height,
        is_free: item.isFree === true,
        created_at: item.createdAt
      })
    });
    if (!res.ok) throw new Error(`Supabase cosmetic library save failed (${res.status}): ${await res.text()}`);
    const rows = await res.json();
    const row = rows[0];
    if (!row) throw new Error('Supabase did not return the saved cosmetic library item.');
    return {
      assetId: row.asset_id,
      sha256: row.sha256,
      name: row.name,
      kind: row.kind,
      contentType: row.content_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      isFree: row.is_free === true,
      createdAt: row.created_at
    };
  }

  async deleteCosmeticLibraryItem(assetId) {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_delete_cosmetic_library_item`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ p_asset_id: String(assetId).toLowerCase() })
    });
    if (!res.ok) throw new Error(`Supabase cosmetic library delete failed (${res.status}): ${await res.text()}`);
    return await res.json();
  }

  async setCosmeticLibraryFree(assetId, isFree) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_cosmetic_library?asset_id=eq.${encodeURIComponent(assetId)}&select=asset_id,is_free,kind`, {
      method: 'PATCH',
      headers: { ...this.getHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({ is_free: isFree === true })
    });
    if (!response.ok) throw new Error(`Supabase free cosmetic update failed (${response.status}).`);
    const rows = await response.json();
    return rows[0] ? { assetId: rows[0].asset_id, isFree: rows[0].is_free === true, kind: rows[0].kind } : null;
  }

  async getFreeCosmetics() {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_cosmetic_library?is_free=eq.true&kind=eq.cape&select=asset_id,sha256,name,kind,content_type,byte_size,width,height,created_at&order=created_at.desc&limit=200`, {
      headers: this.getHeaders()
    });
    if (!response.ok) throw new Error(`Supabase free cosmetic list failed (${response.status}).`);
    return (await response.json()).map((row) => ({
      assetId: row.asset_id,
      sha256: row.sha256,
      name: row.name,
      kind: row.kind,
      contentType: row.content_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      createdAt: row.created_at
    }));
  }

  async createFreeCosmeticClaimCode({ codeHash, assetId, playerUuid, username, expiresAt }) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_free_cosmetic_claim_codes`, {
      method: 'POST',
      headers: { ...this.getHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        code_hash: codeHash,
        asset_id: assetId,
        player_uuid: playerUuid,
        minecraft_username: username,
        expires_at: expiresAt
      })
    });
    if (!response.ok) throw new Error(`Could not create the cape claim code (${response.status}).`);
  }

  async invalidateDiscordAccountLinkCodes(playerUuid) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_discord_account_link_codes?player_uuid=eq.${encodeURIComponent(playerUuid)}&used_at=is.null`, {
      method: 'DELETE',
      headers: { ...this.getHeaders(), Prefer: 'return=minimal' }
    });
    if (!response.ok) throw new Error(`Could not rotate the previous Discord link code (${response.status}).`);
  }

  async createDiscordAccountLinkCode({ codeHash, playerUuid, username, initialAssetId, expiresAt }) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_discord_account_link_codes`, {
      method: 'POST',
      headers: { ...this.getHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        code_hash: codeHash,
        player_uuid: playerUuid,
        minecraft_username: username,
        initial_asset_id: initialAssetId || null,
        expires_at: expiresAt
      })
    });
    if (!response.ok) throw new Error(`Could not create the Discord account link code (${response.status}).`);
  }

  async consumeDiscordAccountLinkCode(codeHash, discordUserId, guildId, discordUsername = '', discordDisplayName = '') {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_consume_discord_account_link_code`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ p_code_hash: codeHash, p_discord_user_id: discordUserId, p_guild_id: guildId })
    });
    if (!response.ok) throw new Error(`Could not complete the Discord account link (${response.status}).`);
    const result = await response.json();
    const normalized = Array.isArray(result) ? result[0] : result;
    if (['linked', 'linked_and_claimed'].includes(normalized?.status) && /^\d{17,20}$/.test(discordUserId)) {
      await this.updateDiscordAccountLinkProfile(discordUserId, discordUsername, discordDisplayName);
    }
    return normalized;
  }

  async getDiscordAccountLinkByPlayerUuid(playerUuid) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_discord_account_links?player_uuid=eq.${encodeURIComponent(playerUuid)}&select=discord_user_id,player_uuid,minecraft_username,linked_at,discord_username,discord_display_name&limit=1`, {
      headers: this.getHeaders()
    });
    if (!response.ok) throw new Error(`Could not check Discord link status (${response.status}).`);
    const rows = await response.json();
    const row = rows[0];
    return row ? { discordUserId: row.discord_user_id, playerUuid: row.player_uuid, username: row.minecraft_username, linkedAt: row.linked_at, discordUsername: row.discord_username || null, discordDisplayName: row.discord_display_name || null } : null;
  }

  async claimFreeCosmeticForLinkedPlayer(assetId, playerUuid) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_claim_free_cosmetic_for_linked_player`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ p_asset_id: assetId, p_player_uuid: playerUuid })
    });
    if (!response.ok) throw new Error(`Could not claim the free cape (${response.status}).`);
    const result = await response.json();
    return Array.isArray(result) ? result[0] : result;
  }

  async selectClaimedFreeCape(assetId, playerUuid) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_select_claimed_free_cape`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ p_asset_id: assetId, p_player_uuid: playerUuid })
    });
    if (!response.ok) throw new Error(`Could not equip the claimed cape (${response.status}).`);
    const result = await response.json();
    return Array.isArray(result) ? result[0] : result;
  }

  async clearSelectedCape(playerUuid) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_clear_selected_cape`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ p_player_uuid: playerUuid })
    });
    if (!response.ok) throw new Error(`Could not clear the selected cape (${response.status}).`);
    const result = await response.json();
    return Array.isArray(result) ? result[0] : result;
  }

  async invalidateFreeCosmeticClaimCodes(playerUuid, assetId) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_free_cosmetic_claim_codes?player_uuid=eq.${encodeURIComponent(playerUuid)}&asset_id=eq.${encodeURIComponent(assetId)}&used_at=is.null`, {
      method: 'DELETE',
      headers: { ...this.getHeaders(), Prefer: 'return=minimal' }
    });
    if (!response.ok) throw new Error(`Could not rotate the previous cape claim code (${response.status}).`);
  }

  async consumeFreeCosmeticClaimCode(codeHash, discordUserId, guildId) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_consume_free_cosmetic_code`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ p_code_hash: codeHash, p_discord_user_id: discordUserId, p_guild_id: guildId })
    });
    if (!response.ok) throw new Error(`Could not complete the Discord cape claim (${response.status}).`);
    const result = await response.json();
    return Array.isArray(result) ? result[0] : result;
  }

  async getFreeCosmeticClaims(playerUuid) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_free_cosmetic_claims?player_uuid=eq.${encodeURIComponent(playerUuid)}&select=asset_id,claimed_at&order=claimed_at.desc`, {
      headers: this.getHeaders()
    });
    if (!response.ok) throw new Error(`Could not read cape claim status (${response.status}).`);
    return (await response.json()).map((row) => ({ assetId: row.asset_id, claimedAt: row.claimed_at }));
  }

  async saveCosmetics(playerUuid, cosmeticsData, expectedVersion) {
    const username = typeof cosmeticsData.username === 'string' ? cosmeticsData.username.trim() : '';
    if (!username) throw new TypeError('A real username is required to save cosmetics.');
    const now = new Date().toISOString();
    const expected = Number.isSafeInteger(expectedVersion) && expectedVersion >= 0
      ? expectedVersion
      : Number((await this.getCosmetics(playerUuid))?.version || 0);
    const version = expected + 1;
    const payload = {
      player_uuid: playerUuid,
      username,
      version,
      skin: cosmeticsData.skin || null,
      cape: cosmeticsData.cape || null,
      elytra: cosmeticsData.elytra || null,
      metadata: cosmeticsData.metadata || {},
      updated_at: now
    };
    const isCreate = expected === 0;
    const endpoint = isCreate
      ? `${this.supabaseUrl}/rest/v1/dew_cosmetics`
      : `${this.supabaseUrl}/rest/v1/dew_cosmetics?player_uuid=eq.${encodeURIComponent(playerUuid)}&version=eq.${expected}`;
    const response = await fetchSupabase(endpoint, {
      method: isCreate ? 'POST' : 'PATCH',
      headers: { ...this.getHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });

    if (response.status === 409) return null;
    if (!response.ok) {
      throw new Error(`Supabase saveCosmetics failed (${response.status}): ${await response.text()}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const saved = rows[0];
    return {
      playerUuid: saved.player_uuid,
      username: saved.username,
      version: saved.version,
      skin: saved.skin,
      cape: saved.cape,
      elytra: saved.elytra,
      metadata: saved.metadata,
      updatedAt: saved.updated_at
    };
  }

  // --- Cosmetic Assets ---

  async saveAsset(sha256, buffer, contentType = 'image/png') {
    const base64 = buffer.toString('base64');
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_cosmetic_assets`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        sha256,
        content_type: contentType,
        byte_size: buffer.length,
        data_base64: base64
      })
    });
    if (!response.ok) {
      throw new Error(`Supabase saveAsset failed (${response.status}): ${await response.text()}`);
    }
    return { sha256, size: buffer.length };
  }

  async getAsset(sha256) {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_cosmetic_assets?sha256=eq.${encodeURIComponent(sha256)}&select=*`, {
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(`Supabase asset lookup failed (${res.status}).`);
    const rows = await res.json();
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      buffer: Buffer.from(r.data_base64, 'base64'),
      contentType: r.content_type || 'image/png'
    };
  }

  async isAssetAssigned(sha256) {
    const res = await fetchSupabase(`${this.supabaseUrl}/rest/v1/rpc/dew_is_cosmetic_asset_assigned`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ p_sha256: sha256 })
    });
    if (!res.ok) throw new Error(`Supabase asset assignment lookup failed (${res.status}).`);
    return (await res.json()) === true;
  }

  // --- Statistics ---

  async getCount(url) {
    const response = await fetchSupabase(url, {
      headers: {
        ...this.getHeaders(),
        'Prefer': 'count=exact',
        'Range-Unit': 'items',
        'Range': '0-0'
      }
    });
    if (!response.ok) throw new Error(`Supabase statistics lookup failed (${response.status}).`);
    const contentRange = response.headers.get('content-range') || '';
    const match = contentRange.match(/\/(\d+)$/);
    if (!match) throw new Error('Supabase statistics lookup returned an invalid count.');
    return Number(match[1]);
  }

  // --- Privacy-scoped bug reports (no uploaded logs or client identity) ---

  async createBugReport(report) {
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_bug_reports`, {
      method: 'POST',
      headers: { ...this.getHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: report.id,
        category: report.category,
        title: report.title,
        description: report.description,
        client_version: report.clientVersion,
        minecraft_version: report.minecraftVersion,
        status: 'pending'
      })
    });
    if (!response.ok) throw new Error(`Supabase bug report insert failed (${response.status}).`);
  }

  async getBugReports({ status = null, limit = 100, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 100));
    const safeOffset = Math.max(0, Math.min(1_000_000, Number.isInteger(offset) ? offset : 0));
    const params = new URLSearchParams({ select: '*', order: 'created_at.desc', limit: String(safeLimit), offset: String(safeOffset) });
    if (status) params.set('status', `eq.${status}`);
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_bug_reports?${params}`, {
      headers: { ...this.getHeaders(), Prefer: 'count=exact' }
    });
    if (!response.ok) throw new Error(`Supabase bug report lookup failed (${response.status}).`);
    const rows = await response.json();
    const countMatch = (response.headers.get('content-range') || '').match(/\/(\d+|\*)$/);
    const total = countMatch?.[1] && countMatch[1] !== '*' ? Number(countMatch[1]) : rows.length;
    return {
      reports: rows.map((row) => ({
        id: row.id,
        category: row.category,
        title: row.title,
        description: row.description,
        clientVersion: row.client_version,
        minecraftVersion: row.minecraft_version,
        status: row.status,
        resolutionNote: row.resolution_note,
        resolvedBy: row.resolved_by,
        resolvedAt: row.resolved_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      total
    };
  }

  async updateBugReport(id, changes) {
    const resolved = changes.status === 'resolved';
    const response = await fetchSupabase(`${this.supabaseUrl}/rest/v1/dew_bug_reports?id=eq.${encodeURIComponent(id)}&select=*`, {
      method: 'PATCH',
      headers: { ...this.getHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({
        status: changes.status,
        resolution_note: changes.resolutionNote,
        resolved_by: resolved ? changes.resolvedBy : null,
        resolved_at: resolved ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
    });
    if (!response.ok) throw new Error(`Supabase bug report update failed (${response.status}).`);
    const [row] = await response.json();
    return row ? {
      id: row.id,
      category: row.category,
      title: row.title,
      description: row.description,
      clientVersion: row.client_version,
      minecraftVersion: row.minecraft_version,
      status: row.status,
      resolutionNote: row.resolution_note,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    } : null;
  }

  async getStats() {
    const onlineSince = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const cosmeticsQuery = new URLSearchParams({
      select: 'player_uuid',
      or: '(skin->>enabled.eq.true,cape->>enabled.eq.true,elytra->>enabled.eq.true)'
    });
    const [totalClients, onlineClients, totalAccounts, cosmeticsCount] = await Promise.all([
      this.getCount(`${this.supabaseUrl}/rest/v1/dew_clients?select=id`),
      this.getCount(`${this.supabaseUrl}/rest/v1/dew_clients?select=id&last_seen_at=gte.${encodeURIComponent(onlineSince)}`),
      this.getCount(`${this.supabaseUrl}/rest/v1/dew_accounts?select=uuid`),
      this.getCount(`${this.supabaseUrl}/rest/v1/dew_cosmetics?${cosmeticsQuery}`)
    ]);
    const manifest = await this.getManifest();

    return {
      totalAccounts,
      totalClients,
      onlineClients,
      featuredServersCount: (manifest.featuredServers || []).filter((server) => server.enabled).length,
      newsCount: (manifest.news || []).filter((item) => item.enabled).length,
      cosmeticsCount,
      storageType: 'supabase',
      serverTime: new Date().toISOString()
    };
  }
}
