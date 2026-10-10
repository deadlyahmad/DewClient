/**
 * DewClient - Content Types (Mods, Resourcepacks, Shaders, Modrinth)
 */

export interface ModItem {
  id: string;
  fileName: string;
  filePath: string;
  name: string;
  version?: string;
  description?: string;
  icon?: string;
  iconUrl?: string;
  enabled: boolean;
  sizeBytes: number;
}

export interface PackItem {
  id: string;
  fileName: string;
  filePath: string;
  name: string;
  description?: string;
  packFormat?: number;
  icon?: string;
  sizeBytes: number;
}

export interface ModrinthSearchHit {
  project_id: string;
  project_type: 'mod' | 'modpack' | 'resourcepack' | 'shader';
  slug: string;
  author: string;
  title: string;
  description: string;
  categories: string[];
  display_categories: string[];
  versions: string[];
  downloads: number;
  follows: number;
  icon_url?: string;
  date_created: string;
  date_modified: string;
  latest_version: string;
  client_side: 'required' | 'optional' | 'unsupported';
  server_side: 'required' | 'optional' | 'unsupported';
}

export interface ModrinthSearchResult {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

export interface ModrinthProjectDetails {
  id: string;
  slug: string;
  project_type: 'mod' | 'modpack' | 'resourcepack' | 'shader';
  title: string;
  description: string;
  body: string;
  icon_url?: string;
  client_side: 'required' | 'optional' | 'unsupported';
  server_side: 'required' | 'optional' | 'unsupported';
  categories: string[];
  downloads: number;
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  version_type: 'release' | 'beta' | 'alpha';
  files: Array<{
    hashes: {
      sha1: string;
      sha512: string;
    };
    url: string;
    filename: string;
    primary: boolean;
    size: number;
  }>;
  dependencies: Array<{
    version_id?: string;
    project_id?: string;
    dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
  }>;
}

export interface MrpackIndex {
  formatVersion: number;
  game: 'minecraft';
  versionId: string;
  name: string;
  summary?: string;
  files: Array<{
    path: string;
    hashes: {
      sha1: string;
      sha512?: string;
    };
    env?: {
      client: 'required' | 'optional' | 'unsupported';
      server: 'required' | 'optional' | 'unsupported';
    };
    downloads: string[];
    fileSize?: number;
  }>;
  dependencies: Record<string, string>;
}
