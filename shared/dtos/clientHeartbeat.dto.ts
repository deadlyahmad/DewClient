/**
 * DewClient - Client Heartbeat Data Transfer Objects
 */

export interface ClientHeartbeatHeadersDto {
  'x-dewclient-id': string;
  'x-dewclient-timestamp': string;
  'x-dewclient-signature': string;
  'x-dewclient-version'?: string;
}

export interface ClientTrackedAccountDto {
  username: string;
  uuid: string;
  type: string;
  avatarUrl?: string | null;
  skinUrl?: string | null;
  capeUrl?: string | null;
  lastUsedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ClientHeartbeatRequestBodyDto {
  clientVersion?: string;
  metadata?: Record<string, unknown>;
  accounts?: ClientTrackedAccountDto[];
  activePlayer?: {
    username: string;
    uuid: string;
  } | null;
}

export interface ClientHeartbeatResponseDto {
  ok: boolean;
  data?: {
    heartbeatIntervalSeconds: number;
    manifestUpdatedAt?: string | null;
    accountsTracked?: number;
  };
  error?: {
    code: string;
    message: string;
  };
  requestId?: string;
}
