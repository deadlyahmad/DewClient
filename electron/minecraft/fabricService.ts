import type { MinecraftVersionPackage } from '../../shared/types/minecraft.ts';

interface FabricProfile {
  id: string;
  inheritsFrom?: string;
  mainClass: string;
  libraries?: Array<{
    name: string;
    url?: string;
    sha1?: string;
    size?: number;
    downloads?: { artifact?: { path?: string; sha1?: string; size?: number; url?: string } };
  }>;
  arguments?: MinecraftVersionPackage['arguments'];
}

async function readJsonLimited(response: Response, maxBytes: number): Promise<any> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error('Fabric metadata response exceeds the size limit.');
  if (!response.body) throw new Error('Fabric metadata response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('Fabric metadata response exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'));
}

function validateFabricRepository(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'maven.fabricmc.net' || url.username || url.password) {
    throw new Error('Fabric metadata contains an untrusted artifact repository.');
  }
  return url.toString();
}

function fabricMavenPath(name: string): string {
  const [coordinate, extension = 'jar'] = name.split('@');
  const parts = coordinate.split(':');
  if (parts.length < 3 || parts.length > 4
    || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(parts[0])
    || !/^[A-Za-z0-9_.-]+$/.test(parts[1])
    || !/^[A-Za-z0-9_.+-]+$/.test(parts[2])
    || (parts[3] && !/^[A-Za-z0-9_.+-]+$/.test(parts[3]))
    || extension !== 'jar') {
    throw new Error('Fabric metadata contains an invalid Maven library coordinate.');
  }
  const [group, artifact, version, classifier] = parts;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.${extension}`;
}

function validSize(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 512 * 1024 * 1024;
}

async function resolveFabricArtifact(library: NonNullable<FabricProfile['libraries']>[number]) {
  const repository = validateFabricRepository(library.url || 'https://maven.fabricmc.net/');
  const artifactPath = fabricMavenPath(library.name);
  const artifactUrl = new URL(artifactPath, repository).toString();
  const supplied = library.downloads?.artifact;

  if (supplied?.path !== undefined && supplied.path !== artifactPath) {
    throw new Error('Fabric metadata contains an unexpected library artifact path.');
  }
  if (supplied?.url) {
    const suppliedUrl = new URL(validateFabricRepository(supplied.url));
    if (suppliedUrl.pathname.replace(/\/$/, '') !== new URL(artifactUrl).pathname.replace(/\/$/, '')) {
      throw new Error('Fabric metadata contains an unexpected library artifact URL.');
    }
  }
  if (library.sha1 !== undefined && !/^[a-f0-9]{40}$/i.test(library.sha1)) {
    throw new Error('Fabric metadata contains an invalid library checksum.');
  }
  if (supplied?.sha1 !== undefined && !/^[a-f0-9]{40}$/i.test(supplied.sha1)) {
    throw new Error('Fabric metadata contains an invalid library checksum.');
  }
  if (library.size !== undefined && !validSize(library.size)) {
    throw new Error('Fabric metadata contains an invalid library size.');
  }
  if (supplied?.size !== undefined && !validSize(supplied.size)) {
    throw new Error('Fabric metadata contains an invalid library size.');
  }
  if (library.sha1 && supplied?.sha1 && library.sha1.toLowerCase() !== supplied.sha1.toLowerCase()) {
    throw new Error('Fabric metadata contains conflicting library checksums.');
  }
  if (library.size !== undefined && supplied?.size !== undefined && library.size !== supplied.size) {
    throw new Error('Fabric metadata contains conflicting library sizes.');
  }

  let sha1 = library.sha1 || supplied?.sha1;
  let size = library.size ?? supplied?.size;
  const missing: Promise<void>[] = [];

  // Fabric intentionally omits checksums for a small number of generated
  // launcher-profile libraries. Obtain their official Maven checksum/length
  // instead of weakening validation or silently treating them as unverifiable.
  if (!sha1) {
    missing.push((async () => {
      const response = await fetch(`${artifactUrl}.sha1`, {
        headers: { Accept: 'text/plain' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new Error(`Fabric Maven checksum request failed (${response.status}).`);
      const text = await response.text();
      if (text.length > 256 || !/^[a-f0-9]{40}(?:\s+\S+)?\s*$/i.test(text)) {
        throw new Error('Fabric Maven returned an invalid library checksum.');
      }
      sha1 = text.trim().slice(0, 40);
    })());
  }
  if (size === undefined) {
    missing.push((async () => {
      const response = await fetch(artifactUrl, {
        method: 'HEAD',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      });
      const length = Number(response.headers.get('content-length'));
      if (!response.ok || !validSize(length)) {
        throw new Error('Fabric Maven did not provide a verified library size.');
      }
      size = length;
    })());
  }
  try {
    await Promise.all(missing);
  } catch (error) {
    throw new Error(`Fabric metadata contains an invalid or unverifiable library artifact: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!sha1 || !/^[a-f0-9]{40}$/i.test(sha1) || !validSize(size)) {
    throw new Error('Fabric metadata contains an invalid or unverifiable library artifact.');
  }
  return { path: artifactPath, sha1: sha1.toLowerCase(), size, url: supplied?.url || artifactUrl };
}

export class FabricService {
  public async mergeLoaderProfile(pkg: MinecraftVersionPackage, preferredLoaderVersion?: string): Promise<MinecraftVersionPackage> {
    const metadataHost = 'https://meta.fabricmc.net';
    const versionsResponse = await fetch(`${metadataHost}/v2/versions/loader/${encodeURIComponent(pkg.id)}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    if (!versionsResponse.ok) {
      throw new Error(`Fabric loader metadata unavailable for Minecraft ${pkg.id} (${versionsResponse.status}).`);
    }
    const loaderVersions = await readJsonLimited(versionsResponse, 1024 * 1024) as Array<{ loader?: { version?: string; stable?: boolean } }>;
    const selected = preferredLoaderVersion
      ? loaderVersions.find((item) => item.loader?.version === preferredLoaderVersion)
      : loaderVersions.find((item) => item.loader?.stable) || loaderVersions[0];
    const loaderVersion = selected?.loader?.version;
    if (!loaderVersion) {
      throw new Error(preferredLoaderVersion
        ? `Fabric loader ${preferredLoaderVersion} is unavailable for Minecraft ${pkg.id}.`
        : `No Fabric loader is available for Minecraft ${pkg.id}.`);
    }

    const profileResponse = await fetch(`${metadataHost}/v2/versions/loader/${encodeURIComponent(pkg.id)}/${encodeURIComponent(loaderVersion)}/profile/json`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    if (!profileResponse.ok) {
      throw new Error(`Fabric loader profile unavailable for Minecraft ${pkg.id} (${profileResponse.status}).`);
    }
    const profile = await readJsonLimited(profileResponse, 5 * 1024 * 1024) as FabricProfile;
    if (profile.mainClass !== 'net.fabricmc.loader.impl.launch.knot.KnotClient'
      || !Array.isArray(profile.libraries) || profile.libraries.length > 500) {
      throw new Error('Fabric loader profile is invalid or unsupported.');
    }
    const fabricLibraries = await Promise.all(profile.libraries.map(async (library) => {
      if (!library || typeof library.name !== 'string') {
        throw new Error('Fabric loader profile contains an invalid library entry.');
      }
      const artifact = await resolveFabricArtifact(library);
      return {
        name: library.name,
        url: validateFabricRepository(library.url || 'https://maven.fabricmc.net/'),
        sha1: artifact.sha1,
        size: artifact.size,
        downloads: {
          ...(library.downloads || {}),
          artifact
        }
      };
    }));

    return {
      ...pkg,
      mainClass: profile.mainClass || pkg.mainClass,
      libraries: [...pkg.libraries, ...fabricLibraries],
      arguments: {
        jvm: [...(profile.arguments?.jvm || []), ...(pkg.arguments?.jvm || [])],
        game: pkg.arguments?.game || profile.arguments?.game || []
      }
    };
  }
}
