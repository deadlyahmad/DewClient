/**
 * DewClient - Production Server Packager & Bundler
 * Compiles server code into a standalone dist-server/ bundle and generates dist-server.zip for VPS upload.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const serverDir = path.join(rootDir, 'server');
const outDir = path.join(rootDir, 'dist-server');
const zipFile = path.join(rootDir, 'dist-server.zip');

async function buildServer() {
  console.log('[Build Server] Preparing production server build...');

  // 1. Clean output directory and existing zip
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  if (fs.existsSync(zipFile)) {
    fs.unlinkSync(zipFile);
  }

  // 2. Copy the server source so runtime-relative paths and security middleware
  // remain identical on the VPS.
  console.log('[Build Server] Copying production server source...');
  fs.cpSync(path.join(serverDir, 'src'), path.join(outDir, 'src'), { recursive: true });
  if (fs.existsSync(path.join(serverDir, 'scripts'))) {
    fs.cpSync(path.join(serverDir, 'scripts'), path.join(outDir, 'scripts'), { recursive: true });
  }

  // 3. Copy public dashboard assets (HTML, CSS, JS)
  console.log('[Build Server] Copying admin web dashboard assets...');
  const publicSrc = path.join(serverDir, 'public');
  const publicDest = path.join(outDir, 'public');
  fs.cpSync(publicSrc, publicDest, { recursive: true });
  fs.copyFileSync(path.join(rootDir, 'icon', 'DewClient.ico'), path.join(publicDest, 'favicon.ico'));

  // 4. Copy database schema. Never copy the live .env file.
  const supabaseDir = path.join(serverDir, 'supabase');
  const schemaFile = path.join(serverDir, 'schema.sql');
  const migrationsDir = path.join(serverDir, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    fs.cpSync(migrationsDir, path.join(outDir, 'migrations'), { recursive: true });
  }
  if (fs.existsSync(supabaseDir)) {
    fs.cpSync(supabaseDir, path.join(outDir, 'supabase'), { recursive: true });
  } else if (fs.existsSync(schemaFile)) {
    fs.mkdirSync(path.join(outDir, 'supabase'), { recursive: true });
    fs.copyFileSync(schemaFile, path.join(outDir, 'supabase', 'schema.sql'));
  }
  if (fs.existsSync(schemaFile)) fs.copyFileSync(schemaFile, path.join(outDir, 'schema.sql'));
  for (const filename of ['README.md', 'DISCORD-LINKING.md', 'RESEND-SUPABASE-SMTP.md', '.env.example', 'nginx.conf.example', 'dewclient.service.example']) {
    const sourcePath = path.join(serverDir, filename);
    if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, path.join(outDir, filename));
  }

  // 5. Generate production package.json
  const sourcePkg = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'));
  const prodPkg = {
    name: sourcePkg.name,
    version: sourcePkg.version,
    private: true,
    type: 'module',
    main: 'src/index.mjs',
    scripts: {
      start: 'node src/index.mjs',
      'bootstrap-admin': 'node src/bootstrapAdmin.mjs',
      'discord:publish-link-button': 'node scripts/publishDiscordLinkMessage.mjs',
      'discord:set-endpoint': 'node scripts/setDiscordInteractionsEndpoint.mjs'
    },
    dependencies: sourcePkg.dependencies
  };
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(prodPkg, null, 2), 'utf-8');
  const packageLock = path.join(serverDir, 'package-lock.json');
  if (fs.existsSync(packageLock)) {
    fs.copyFileSync(packageLock, path.join(outDir, 'package-lock.json'));
  }

  // 6. Generate dist-server.zip using AdmZip
  console.log('[Build Server] Generating production dist-server.zip for VPS...');
  const zip = new AdmZip();
  // Put the package files at the archive root so `unzip dist-server.zip -d /var/www/dewclient-server`
  // creates package.json and src/ directly in the target folder.
  zip.addLocalFolder(outDir);
  zip.writeZip(zipFile);

  const stat = fs.statSync(zipFile);
  console.log(`\n=============================================================`);
  console.log(`✅ Server build complete!`);
  console.log(`📦 Output Folder: dist-server/`);
  console.log(`📦 Production Archive: dist-server.zip (${Math.round(stat.size / 1024)} KB)`);
  console.log(`📋 Configure Supabase, server environment, and HTTPS proxy before deployment.`);
  console.log(`=============================================================\n`);
}

buildServer().catch((err) => {
  console.error('[Build Server] Failed:', err);
  process.exit(1);
});
