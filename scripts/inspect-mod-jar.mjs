import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedPath = process.argv[2];
let jarPath = requestedPath ? path.resolve(requestedPath) : '';

if (!jarPath) {
  const manifestPath = path.join(root, 'DewCosmeticsLoader', 'versions.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const artifact = manifest.versions?.['26.3']?.artifact;
  if (typeof artifact !== 'string' || !artifact.trim()) {
    throw new Error('No Minecraft 26.3 mod artifact is registered in versions.json.');
  }
  jarPath = path.resolve(root, 'DewCosmeticsLoader', artifact);
}

if (!fs.existsSync(jarPath)) throw new Error(`Mod JAR does not exist: ${jarPath}`);
const bytes = fs.readFileSync(jarPath);
const archive = new AdmZip(jarPath);
const entries = archive.getEntries().map((entry) => entry.entryName);
const metadata = JSON.parse(archive.readAsText('fabric.mod.json'));
console.log(JSON.stringify({
  path: jarPath,
  sizeBytes: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  modId: metadata.id,
  modVersion: metadata.version,
  minecraft: metadata.depends?.minecraft || '',
  fabricLoader: metadata.depends?.fabricloader || '',
  clientEntrypoints: metadata.entrypoints?.client || [],
  hasFabricMetadata: entries.includes('fabric.mod.json')
}, null, 2));
