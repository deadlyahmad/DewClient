/**
 * DewClient - Client Registration Data Transfer Objects
 */

export interface ClientRegisterRequestDto {
  publicKey: string;
  clientVersion: string;
  os?: string;
  osVersion?: string;
  architecture?: string;
  hostname?: string;
  metadata?: Record<string, unknown>;
}

export interface ClientRegisterResponseDto {
  ok: boolean;
  data?: {
    clientId: string;
    heartbeatIntervalSeconds: number;
  };
  error?: {
    code: string;
    message: string;
  };
  requestId?: string;
}
