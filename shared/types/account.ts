/**
 * DewClient - Account and Authentication Types
 */

export interface BaseAccount {
  id: string;
  dewAccountId?: string;
  authUserId?: string;
  email?: string;
  username: string;
  uuid: string;
  minecraftUuid?: string;
  accountType?: 'online' | 'offline' | 'dew' | 'discord';
  avatarUrl?: string;
  createdAt: string;
  lastUsedAt: string;
  active?: boolean;
  skinUrl?: string;
  capeUrl?: string;
  passwordHash?: string;
  passwordSalt?: string;
  usernameChangeCooldownUntil?: string | null;
  lastUsernameChangeAt?: string | null;
  cosmetics?: PlayerCosmetics;
  skinAssetPath?: string;
  capeAssetPath?: string;
  elytraAssetPath?: string;
}

export interface PlayerCosmetics {
  manifestVersion?: number;
  skinAssetId?: string;
  skinSha256?: string;
  capeAssetId?: string;
  capeSha256?: string;
  skinAssetPath?: string;
  capeAssetPath?: string;
  elytraAssetPath?: string;
  activeSkinSlot?: number;
  skinSlots?: LocalCosmeticTexture[];
  officialCapes?: LocalCosmeticTexture[];
  activeOfficialCapeId?: string;
  activeCapeSource?: 'microsoft' | 'dew' | 'admin';
  activeCapeAssetId?: string | null;
  skinSource?: 'official' | 'custom';
  capeSource?: 'official' | 'custom';
  elytraSource?: 'custom';
  activeAdminCosmetics?: Partial<Record<'skin' | 'cape' | 'elytra', string>>;
  badge?: string;
  accentColor?: string;
}

export interface LocalCosmeticTexture {
  id: string;
  name: string;
  assetPath: string;
  previewUrl: string;
  active?: boolean;
}

export interface MicrosoftAccount extends BaseAccount {
  type: 'microsoft';
  hasActiveSession: boolean;
  expiresAt: number;
}

export interface OfflineProfile extends BaseAccount {
  type: 'offline';
}

export interface DiscordAccount extends BaseAccount {
  type: 'discord';
  accountType: 'discord';
  discordUserId: string;
  nextUsernameChangeAt?: string | null;
}

export type UserAccount = MicrosoftAccount | OfflineProfile | DiscordAccount;

export interface EncryptedAccountTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  msalAccountId?: string;
}

export interface AuthProgressStatus {
  step: 'opening_browser' | 'waiting_user' | 'exchanging_token' | 'xbox_live' | 'xsts' | 'session' | 'profile' | 'complete' | 'error';
  message: string;
  error?: string;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}
