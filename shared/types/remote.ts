/**
 * DewClient - Remote Management and Server State Types
 */

export interface RemoteNewsItem {
  id: string;
  title: string;
  summary: string;
  tag?: string;
  imageUrl?: string;
  url?: string;
  publishedAt: string;
  enabled: boolean;
}

export interface RemoteAnnouncement {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  url?: string;
  enabled: boolean;
  priority?: number;
}

export interface RemoteFeaturedServer {
  id: string;
  name: string;
  host: string;
  port: number;
  iconUrl?: string;
  tags: string[];
  enabled: boolean;
  priority?: number;
}

export interface RemoteMaintenanceConfig {
  enabled: boolean;
  mode: 'soft' | 'hard';
  title: string;
  message: string;
}

export interface RemoteClientReleaseConfig {
  latestVersion: string;
  minimumVersion: string;
  updateUrl: string;
  notesUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  releaseId?: string;
}

export interface RemotePremiumConfig {
  tier: string;
  enabled: boolean;
  label?: string;
}

export interface RemoteManifestSnapshot {
  serverTime: string;
  updatedAt: string;
  maintenance: RemoteMaintenanceConfig;
  news: RemoteNewsItem[];
  announcements: RemoteAnnouncement[];
  featuredServers: RemoteFeaturedServer[];
  client: RemoteClientReleaseConfig;
  flags: Record<string, boolean>;
  links: Record<string, string>;
  premium?: RemotePremiumConfig;
}

export type ClientPresenceStatus = 'online' | 'offline' | 'revoked';

export interface ClientInstanceRecord {
  id: string;
  client_public_key: string;
  client_version: string;
  os?: string | null;
  os_version?: string | null;
  architecture?: string | null;
  hostname?: string | null;
  display_name?: string | null;
  registered_at: string;
  last_seen_at: string;
  last_ip?: string | null;
  last_user_agent?: string | null;
  status: ClientPresenceStatus;
  revoked_at?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RemoteConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  service?: string;
  version?: string;
  status?: string;
  environment?: string;
  time?: string;
  error?: string;
}

export interface RemoteManagementStatus {
  state: 'disabled' | 'registering' | 'online' | 'offline' | 'revoked' | 'error';
  clientId?: string | null;
  lastHeartbeatAt?: string | null;
  heartbeatIntervalSeconds: number;
  serverUrl?: string;
  lastSyncAt?: string;
  error?: string;
}

export type RemoteManifest = RemoteManifestSnapshot;
export type NewsItem = RemoteNewsItem;
export type Announcement = RemoteAnnouncement;
export type FeaturedServer = RemoteFeaturedServer;
export type FeatureFlags = Record<string, boolean>;
export type ClientRelease = RemoteClientReleaseConfig;
export type ClientInstance = ClientInstanceRecord;

