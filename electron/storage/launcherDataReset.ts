import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LauncherDataResetOptions {
  dataRoot: string;
  appDataPath: string;
  homePath: string;
  electronStatePaths: string[];
  stopRunningGames: () => Promise<void>;
  clearElectronSession: () => Promise<void>;
  scheduleRelaunch: () => void;
  tempDirectory?: string;
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function resetLauncherData(options: LauncherDataResetOptions): Promise<void> {
  const dataRoot = path.resolve(options.dataRoot);
  const appDataPath = path.resolve(options.appDataPath);
  const homePath = path.resolve(options.homePath);
  const electronStatePaths = [...new Set(options.electronStatePaths.map((target) => path.resolve(target)))];
  const userDataPath = path.join(appDataPath, 'DewClient');
  const filesystemRoot = path.parse(dataRoot).root;

  if (dataRoot === filesystemRoot || dataRoot === homePath || dataRoot === appDataPath || isWithin(dataRoot, appDataPath)) {
    throw new Error('The configured launcher data location is too broad to reset safely.');
  }
  if (electronStatePaths.some((target) => !isWithin(userDataPath, target))) {
    throw new Error('An Electron reset path is outside DewClient user data.');
  }

  await options.stopRunningGames();
  await options.clearElectronSession();
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 3 });
  for (const target of electronStatePaths) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  }

  const tempDirectory = options.tempDirectory || os.tmpdir();
  for (const entry of fs.readdirSync(tempDirectory, { withFileTypes: true })) {
    if (entry.name.startsWith('dewclient-modpack-')) {
      fs.rmSync(path.join(tempDirectory, entry.name), { recursive: true, force: true, maxRetries: 3 });
    }
  }

  options.scheduleRelaunch();
}