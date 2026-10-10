/**
 * DewCosmetics - Version-independent launcher, API, and mod protocol contracts
 */

export type DewCosmeticType = 'skin' | 'cape' | 'wings' | 'accessory' | 'effect' | 'other';

export type DewCosmeticsLoaderFamily = 'fabric';

export interface DewCosmeticAssetReference {
  url: string;
  sha256: string;
  mime: string;
  byteSize?: number;
}

export interface DewCosmeticDefinition {
  id: string;
  type: DewCosmeticType;
  version: number;
  assets: Record<string, DewCosmeticAssetReference>;
  render?: Record<string, unknown>;
}

export interface EquippedCosmetic {
  cosmeticId: string;
  assetVersion: number;
  enabled: boolean;
}

export interface EquippedCosmeticsSnapshot {
  revision: number;
  items: EquippedCosmetic[];
}

export interface DewCosmeticsModSessionRequest {
  instanceId: string;
  minecraftVersion: string;
  modVersion: string;
  protocolVersion: number;
  loaderFamily: DewCosmeticsLoaderFamily;
  capabilities: DewCosmeticType[];
}

export interface DewCosmeticsModSession {
  sessionId: string;
  accessToken: string;
  expiresAt: string;
  apiBaseUrl: string;
  wsUrl: string;
  protocolVersion: number;
  heartbeatSeconds: number;
}

export interface DewCosmeticsLaunchSnapshot {
  instanceId: string;
  minecraftVersion: string;
  modVersion: string;
  protocolVersion: number;
  equipped: EquippedCosmeticsSnapshot;
}

export interface DewCosmeticsPlayerIdentity {
  dewUserId: string;
  minecraftUuid?: string;
  displayName: string;
}

export interface DewCosmeticsPresenceContext {
  kind: 'singleplayer' | 'multiplayer';
  serverFingerprint: string;
}

export interface DewCosmeticsPresenceUpdate {
  op: 'presence';
  revision: number;
  player: DewCosmeticsPlayerIdentity;
  equipped: string[];
  timestamp: number;
}

export interface DewCosmeticsPlayerUpdate {
  op: 'player_update';
  player: DewCosmeticsPlayerIdentity;
  revision: number;
  equipped: string[];
}