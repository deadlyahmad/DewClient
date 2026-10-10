import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isTrustedRendererNavigation(targetUrl: string, appHtmlPath: string, devServerUrl?: string): boolean {
  try {
    const target = new URL(targetUrl);
    if (devServerUrl) {
      return target.origin === new URL(devServerUrl).origin;
    }

    if (target.protocol !== 'file:') return false;

    const targetPath = path.resolve(fileURLToPath(target));
    const trustedPath = path.resolve(appHtmlPath);
    return process.platform === 'win32'
      ? targetPath.toLowerCase() === trustedPath.toLowerCase()
      : targetPath === trustedPath;
  } catch {
    return false;
  }
}