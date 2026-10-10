/**
 * DewClient - Admin Data Transfer Objects
 */

import type {
  RemoteMaintenanceConfig,
  RemoteClientReleaseConfig,
  RemoteNewsItem,
  RemoteAnnouncement,
  RemoteFeaturedServer
} from '../types/remote.ts';

export interface AdminMaintenanceUpdateDto {
  enabled: boolean;
  mode?: 'soft' | 'hard';
  title?: string;
  message?: string;
}

export interface AdminClientReleaseUpdateDto {
  latestVersion: string;
  minimumVersion: string;
  updateUrl: string;
  notesUrl?: string;
}

export interface AdminFeatureFlagsUpdateDto {
  flags: Record<string, boolean>;
}

export interface AdminPremiumUpdateDto {
  tier: string;
  enabled: boolean;
  label?: string;
}

export interface AdminNewsUpsertDto {
  id?: string;
  title: string;
  summary: string;
  tag?: string;
  imageUrl?: string;
  url?: string;
  enabled?: boolean;
}

export interface AdminAnnouncementUpsertDto {
  id?: string;
  title: string;
  message: string;
  severity?: 'info' | 'success' | 'warning' | 'critical';
  url?: string;
  enabled?: boolean;
  priority?: number;
}

export interface AdminServerUpsertDto {
  id?: string;
  name: string;
  host: string;
  port?: number;
  iconUrl?: string;
  tags?: string[];
  enabled?: boolean;
  priority?: number;
}

export interface AdminStoreResponseDto {
  ok: boolean;
  data: {
    maintenance: RemoteMaintenanceConfig;
    client: RemoteClientReleaseConfig;
    flags: Record<string, boolean>;
    news: RemoteNewsItem[];
    announcements: RemoteAnnouncement[];
    featuredServers: RemoteFeaturedServer[];
    links: Record<string, string>;
  };
  requestId?: string;
}
