/**
 * DewClient Central Server - Manifest Route
 * Delivers the live RemoteManifestSnapshot (news, announcements, featured servers, client releases).
 */

import { CryptoService } from '../services/cryptoService.mjs';

const DEWCOSMETICS_RELEASE_NEWS = Object.freeze({
  id: 'dewcosmetics-0-4-0-support-matrix',
  title: 'DewCosmetics 0.4.0: cosmetics across five Minecraft versions',
  summary: 'DewCosmetics 0.4.0 adds Fabric support for Minecraft 1.21.4, 1.21.8, 1.21.11, 26.2, and 26.3. Players running the supported mod can sync skins, capes, and wings across these versions. Free cape claims are for Microsoft and Discord accounts; offline sandbox profiles are not eligible.',
  tag: 'DEWCOSMETICS · 0.4.0',
  publishedAt: '2026-10-09T00:00:00.000Z',
  enabled: true
});

export const CANONICAL_LINKS = Object.freeze({
  website: 'https://dewclient.fun',
  support: 'https://dewclient.fun/#support',
  download: 'https://dewclient.fun/#download',
  discord: 'https://discord.gg/uXs2YD4D6H'
});

function canonicalWebsiteUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    if (url.hostname === 'dewclient.site' || url.hostname === 'www.dewclient.site') {
      url.hostname = 'dewclient.fun';
      return url.toString();
    }
  } catch { /* Keep the original value; clients do not open invalid URLs. */ }
  return value;
}

export function normalizeManifestLinks(source) {
  const manifest = source && typeof source === 'object' ? source : {};
  return {
    ...manifest,
    links: { ...(manifest.links || {}), ...CANONICAL_LINKS },
    client: {
      ...(manifest.client || {}),
      notesUrl: canonicalWebsiteUrl(manifest.client?.notesUrl) || CANONICAL_LINKS.download
    },
    announcements: (manifest.announcements || []).map((item) => ({
      ...item,
      url: typeof item.url === 'string' && /^https?:\/\/discord\.gg\/dewclient\/?$/i.test(item.url)
        ? CANONICAL_LINKS.discord
        : canonicalWebsiteUrl(item.url)
    }))
  };
}

export async function handleGetManifest(req, res, storage) {
  const manifest = normalizeManifestLinks(await storage.getManifest());
  manifest.featuredServers = (manifest.featuredServers || [])
    .filter((server) => server.enabled === true)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  manifest.news = (manifest.news || []).filter((item) => item.enabled === true);
  if (!manifest.news.some((item) => item.id === DEWCOSMETICS_RELEASE_NEWS.id)) {
    manifest.news.unshift(DEWCOSMETICS_RELEASE_NEWS);
  }
  manifest.announcements = (manifest.announcements || []).filter((item) => item.enabled === true);
  const snapshot = {
    ...manifest,
    serverTime: new Date().toISOString()
  };

  const serialized = JSON.stringify(snapshot);
  const etag = `"${CryptoService.sha256(serialized).slice(0, 16)}"`;

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === etag) {
    res.writeHead(304, {
      'ETag': etag
    });
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'ETag': etag,
    'Cache-Control': 'public, max-age=15'
  });
  res.end(serialized);
}
