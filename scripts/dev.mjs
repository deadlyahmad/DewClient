import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronBinary from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const viteBin = path.resolve(projectRoot, 'node_modules/vite/bin/vite.js');
const electronPath = typeof electronBinary === 'string' ? electronBinary : (process.platform === 'win32' ? 'electron.cmd' : 'electron');

// 1. Ensure Electron Main and Preload bundles are built
try {
  console.log('[Dev] Pre-building Electron main and preload...');
  execFileSync(process.execPath, [path.join(__dirname, 'build-electron.mjs')], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
} catch (err) {
  console.error('[Dev] Failed to build Electron before starting dev server:', err);
  process.exit(1);
}

const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
  BROWSER: 'none'
};

// 2. Start Vite Dev Server directly via Node executable (avoids .cmd spawn EINVAL on Windows)
console.log('[Dev] Starting Vite dev server...');
const vite = spawn(process.execPath, [viteBin, '--host'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env
});

let electron = null;

const shutdown = (code = 0) => {
  try {
    vite.kill();
  } catch {}
  try {
    if (electron && !electron.killed) {
      electron.kill();
    }
  } catch {}
  process.exit(code);
};

// Helper: poll until Vite server is accepting connections
async function waitForDevServer(url, timeoutMs = 20000) {
  const parsed = new URL(url);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(
          {
            hostname: parsed.hostname,
            port: parsed.port,
            path: '/',
            timeout: 1000
          },
          (res) => {
            resolve(res);
          }
        );
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

// 3. Wait for Vite server and launch Electron
(async () => {
  console.log('[Dev] Waiting for Vite dev server at http://127.0.0.1:5173...');
  const ready = await waitForDevServer('http://127.0.0.1:5173');
  if (!ready) {
    console.warn('[Dev] Vite dev server wait timed out; attempting Electron launch anyway...');
  } else {
    console.log('[Dev] Vite dev server is ready. Launching Electron...');
  }

  const isCmd = typeof electronPath === 'string' && electronPath.endsWith('.cmd');
  electron = spawn(electronPath, ['.'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: isCmd,
    env
  });

  electron.on('exit', (code, signal) => {
    if (signal === 'SIGTERM') {
      shutdown(0);
      return;
    }
    shutdown(code ?? 0);
  });
})();

vite.on('exit', (code, signal) => {
  if (electron && !electron.killed && !electron.exitCode && signal !== 'SIGTERM') {
    electron.kill();
  }
  if (code !== 0) shutdown(code ?? 1);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
