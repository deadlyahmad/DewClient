/**
 * DewClient - Download and Telemetry Types
 */

export interface DownloadTask {
  id: string;
  name: string;
  url: string;
  destination: string;
  expectedSha1?: string;
  expectedSha512?: string;
  expectedSize?: number;
  downloadedBytes: number;
  totalBytes: number;
  progressPercent: number;
  progress?: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  status: 'pending' | 'downloading' | 'verifying' | 'completed' | 'failed' | 'paused' | 'cancelled';
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface DownloadTelemetry {
  downloadedBytes: number;
  totalBytes: number;
  remainingBytes: number;
  progressPercent: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  phase?: string;
}

export interface GameInstallProgress {
  instanceId: string;
  versionId: string;
  step: 'metadata' | 'java' | 'client' | 'libraries' | 'natives' | 'assets' | 'verifying' | 'complete';
  phase: string;
  downloadedBytes: number;
  totalBytes: number;
  remainingBytes: number;
  progressPercent: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  currentFile?: string;
  completedFiles?: number;
  totalFiles?: number;
}

export type DownloadProgress = DownloadTelemetry;
export type InstallationProgress = GameInstallProgress;
