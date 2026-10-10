/**
 * DewClient - Minecraft Instance Types
 */

export type LoaderType = 'fabric';

export interface InstanceConfig {
  id: string;
  name: string;
  minecraftVersion: string;
  loaderType: LoaderType;
  loaderVersion?: string;
  gameDirectory?: string;
  javaPath?: string;
  jvmArgs?: string;
  gameArgs?: string;
  icon?: string;
  createdAt: string;
  lastPlayedAt?: string;
  totalPlayTimeMinutes?: number;
}

export interface InstanceStats {
  modCount: number;
  resourcePackCount: number;
  shaderPackCount: number;
}

export interface InstanceWithStats extends InstanceConfig {
  stats: InstanceStats;
}

export type Instance = InstanceWithStats;

