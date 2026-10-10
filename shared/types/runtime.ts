/**
 * DewClient - Java Runtime Types
 */

import type { DownloadTelemetry } from './download.ts';

export interface JavaInstallation {
  path: string;
  versionString: string;
  majorVersion: number;
  is64Bit: boolean;
  vendor: string;
  isCompatibleWithLatest: boolean;
}

export interface JavaValidationResult {
  valid: boolean;
  majorVersion?: number;
  details?: JavaInstallation;
  error?: string;
}

export interface ManagedJavaRuntime {
  majorVersion: number;
  name: string;
  vendor: string;
  installed: boolean;
  path?: string;
  versionString?: string;
  isDownloading: boolean;
  telemetry?: DownloadTelemetry;
}

export interface JavaCompatibilityResult {
  compatible: boolean;
  requiredJava: number;
  message?: string;
}

export type ManagedRuntime = ManagedJavaRuntime;

