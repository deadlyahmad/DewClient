import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import electronBinary from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const mainBundle = path.join(projectRoot, 'dist-electron/main.mjs');
const htmlBundle = path.join(projectRoot, 'dist/index.html');

if (!fs.existsSync(mainBundle) || !fs.existsSync(htmlBundle)) {
  console.error('[Start] Production build not found!');
  console.error('[Start] Please run "npm run build" first to generate the production bundles.');
  process.exit(1);
}

const electronPath = typeof electronBinary === 'string' ? electronBinary : (process.platform === 'win32' ? 'electron.cmd' : 'electron');
const isCmd = typeof electronPath === 'string' && electronPath.endsWith('.cmd');

console.log('[Start] Launching DewClient production build from dist/index.html...');

const env = { ...process.env, NODE_ENV: 'production' };
delete env.VITE_DEV_SERVER_URL;

const electron = spawn(electronPath, ['.'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: isCmd,
  env
});

electron.on('exit', (code) => {
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  try { electron.kill(); } catch {}
  process.exit(0);
});

process.on('SIGTERM', () => {
  try { electron.kill(); } catch {}
  process.exit(0);
});
