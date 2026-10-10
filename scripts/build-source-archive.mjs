import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const archivePath = path.join(rootDirectory, 'DewClient-Source.zip');
const excludedDirectories = new Set([
  '.git',
  '.idea',
  '.vscode',
  '.gradle',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'dist-server',
  'node_modules',
  'out',
  'release'
]);
const runtimeJars = new Set();
const modVersionIndex = path.join(rootDirectory, 'DewCosmeticsLoader', 'versions.json');
if (fs.existsSync(modVersionIndex)) {
  try {
    const versionIndex = JSON.parse(fs.readFileSync(modVersionIndex, 'utf8'));
    for (const version of Object.values(versionIndex.versions || {})) {
      if (typeof version?.artifact === 'string') {
        runtimeJars.add(path.resolve(path.dirname(modVersionIndex), version.artifact));
      }
      for (const dependency of Array.isArray(version?.dependencies) ? version.dependencies : []) {
        if (typeof dependency?.artifact === 'string') {
          runtimeJars.add(path.resolve(path.dirname(modVersionIndex), dependency.artifact));
        }
      }
    }
  } catch {
    // Keep the source archive buildable even if a local runtime index needs repair.
  }
}
const zip = new AdmZip();
let fileCount = 0;

function addSourceDirectory(directoryPath) {
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        addSourceDirectory(path.join(directoryPath, entry.name));
      }
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith('.zip') || entry.name.endsWith('.class')) continue;
    if (entry.name === '.env' || (entry.name.startsWith('.env.') && entry.name !== '.env.example')) continue;
    if (entry.name.startsWith('tmp-debug')) continue;

    const absolutePath = path.join(directoryPath, entry.name);
    // Package only mod JARs explicitly referenced by versions.json; stale
    // build artifacts and bundled libraries are not runtime deliverables.
    if (entry.name.endsWith('.jar') && !runtimeJars.has(absolutePath)) continue;
    const archiveEntryPath = path.relative(rootDirectory, absolutePath).split(path.sep).join('/');
    zip.addFile(archiveEntryPath, fs.readFileSync(absolutePath));
    fileCount += 1;
  }
}

addSourceDirectory(rootDirectory);
fs.rmSync(archivePath, { force: true });
zip.writeZip(archivePath);

const archiveSize = fs.statSync(archivePath).size;
console.log(`[Build Source] Wrote ${fileCount} source files to DewClient-Source.zip (${Math.round(archiveSize / 1024)} KB).`);
