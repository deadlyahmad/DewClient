import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function buildElectron() {
  console.log('[Build] Bundling Electron Main and Preload...');

  // 1. Build Main Process
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'electron/main/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: path.join(rootDir, 'dist-electron/main.mjs'),
    external: [
      'electron',
      'adm-zip',
      '@azure/msal-node'
    ],
    sourcemap: true
  });

  // 2. Build Preload Script (CommonJS for Electron preload compatibility)
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'electron/preload/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: path.join(rootDir, 'dist-electron/preload.cjs'),
    external: [
      'electron'
    ],
    sourcemap: true
  });

  console.log('[Build] Electron build complete.');
}

buildElectron().catch((err) => {
  console.error('[Build] Failed:', err);
  process.exit(1);
});
