/**
 * DewClient - Semver Utility
 */

export function parseSemver(versionStr: string): [number, number, number] {
  const clean = String(versionStr || '').trim().replace(/^v/i, '');
  const parts = clean.split('-')[0].split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function compareSemver(v1: string, v2: string): number {
  const [maj1, min1, pat1] = parseSemver(v1);
  const [maj2, min2, pat2] = parseSemver(v2);

  if (maj1 !== maj2) return maj1 - maj2;
  if (min1 !== min2) return min1 - min2;
  return pat1 - pat2;
}

export function isVersionOutdated(currentVersion: string, latestVersion: string): boolean {
  return compareSemver(currentVersion, latestVersion) < 0;
}
