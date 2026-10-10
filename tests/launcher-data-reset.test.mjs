import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetLauncherData } from '../electron/storage/launcherDataReset.ts';

test('launcher data reset stops games, clears session and sensitive state, and schedules relaunch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-reset-test-'));
  const dataRoot = path.join(root, 'launcher-data');
  const appDataPath = path.join(root, 'roaming');
  const userDataPath = path.join(appDataPath, 'DewClient');
  const tempDirectory = path.join(root, 'temp');
  const updatePath = path.join(userDataPath, 'updates');
  const modpackPath = path.join(tempDirectory, 'dewclient-modpack-test');
  const preservedLogPath = path.join(userDataPath, 'logs', 'client.log');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(updatePath, { recursive: true });
  fs.mkdirSync(path.dirname(preservedLogPath), { recursive: true });
  fs.mkdirSync(modpackPath, { recursive: true });
  fs.mkdirSync(path.join(tempDirectory, 'other-app'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'config.json'), '{}');
  fs.writeFileSync(path.join(userDataPath, 'msal-token-cache.dat'), 'encrypted');
  fs.writeFileSync(path.join(updatePath, 'installer.exe'), 'update');
  fs.writeFileSync(preservedLogPath, 'active electron log');
  let gamesStopped = false;
  let sessionCleared = false;
  let relaunchScheduled = false;

  try {
    await resetLauncherData({
      dataRoot,
      appDataPath,
      homePath: path.join(root, 'home'),
      electronStatePaths: [path.join(userDataPath, 'msal-token-cache.dat'), updatePath],
      tempDirectory,
      stopRunningGames: async () => { gamesStopped = true; },
      clearElectronSession: async () => { sessionCleared = true; },
      scheduleRelaunch: () => { relaunchScheduled = true; }
    });

    assert.equal(gamesStopped, true);
    assert.equal(sessionCleared, true);
    assert.equal(relaunchScheduled, true);
    assert.equal(fs.existsSync(dataRoot), false);
    assert.equal(fs.existsSync(path.join(userDataPath, 'msal-token-cache.dat')), false);
    assert.equal(fs.existsSync(updatePath), false);
    assert.equal(fs.existsSync(modpackPath), false);
    assert.equal(fs.existsSync(preservedLogPath), true);
    assert.equal(fs.existsSync(path.join(tempDirectory, 'other-app')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('launcher data reset refuses a root that contains the app data directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dewclient-reset-unsafe-'));
  let stopped = false;
  try {
    await assert.rejects(resetLauncherData({
      dataRoot: root,
      appDataPath: path.join(root, 'roaming'),
      homePath: path.join(root, 'home'),
      electronStatePaths: [],
      stopRunningGames: async () => { stopped = true; },
      clearElectronSession: async () => {},
      scheduleRelaunch: () => {}
    }), /too broad to reset safely/);
    assert.equal(stopped, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});