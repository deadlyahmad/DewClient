/**
 * DewClient - Modrinth API v2 Integration Service
 */

import { ENDPOINTS } from '../../shared/constants/endpoints.ts';
import type {
  ModrinthSearchResult,
  ModrinthProjectDetails,
  ModrinthVersion
} from '../../shared/types/content.ts';
import { getLogger } from '../core/logger.ts';

export class ModrinthService {
  private userAgent = 'DewClient/1.0.1 (contact@dewclient.fun)';

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Modrinth API request failed (${res.status}): ${res.statusText}`);
    }

    return (await res.json()) as T;
  }

  public async search(
    query = '',
    projectType: 'mod' | 'modpack' | 'resourcepack' | 'shader' = 'mod',
    gameVersion?: string,
    loader?: string,
    limit = 20,
    offset = 0
  ): Promise<ModrinthSearchResult> {
    const facets: string[][] = [
      [`project_type:${projectType}`]
    ];

    if (gameVersion) {
      facets.push([`versions:${gameVersion}`]);
    }
    if (loader && loader !== 'vanilla') {
      facets.push([`categories:${loader}`]);
    }

    const params = new URLSearchParams({
      limit: String(Math.min(limit, 50)),
      offset: String(offset),
      facets: JSON.stringify(facets)
    });

    if (query) {
      params.set('query', query);
    }

    const url = `${ENDPOINTS.MODRINTH_API}/search?${params.toString()}`;
    return this.fetchJson<ModrinthSearchResult>(url);
  }

  public async getProject(slugOrId: string): Promise<ModrinthProjectDetails> {
    const url = `${ENDPOINTS.MODRINTH_API}/project/${encodeURIComponent(slugOrId)}`;
    return this.fetchJson<ModrinthProjectDetails>(url);
  }

  public async getProjectVersions(
    slugOrId: string,
    gameVersion?: string,
    loaders?: string[]
  ): Promise<ModrinthVersion[]> {
    const params = new URLSearchParams();
    if (gameVersion) {
      params.set('game_versions', JSON.stringify([gameVersion]));
    }
    if (loaders && loaders.length > 0) {
      params.set('loaders', JSON.stringify(loaders));
    }

    const url = `${ENDPOINTS.MODRINTH_API}/project/${encodeURIComponent(slugOrId)}/version?${params.toString()}`;
    return this.fetchJson<ModrinthVersion[]>(url);
  }

  public async getVersion(versionId: string): Promise<ModrinthVersion> {
    const url = `${ENDPOINTS.MODRINTH_API}/version/${encodeURIComponent(versionId)}`;
    return this.fetchJson<ModrinthVersion>(url);
  }
}

let modrinthService: ModrinthService | null = null;

export function getModrinthService(): ModrinthService {
  if (!modrinthService) {
    modrinthService = new ModrinthService();
  }
  return modrinthService;
}
