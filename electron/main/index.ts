/**
 * DewClient - Electron Main Process Entry Point
 */

import { app, BrowserWindow, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from '../ipc/ipcHandlers.ts';
import { getHeartbeatService } from '../remote/heartbeatService.ts';
import { getCosmeticsSyncService } from '../remote/cosmeticsSyncService.ts';
import { getRichPresenceService } from '../remote/richPresenceService.ts';
import { getUpdateService } from '../updater/updateService.ts';
import { getLogger } from '../core/logger.ts';
import { getAuthService } from '../auth/authService.ts';
import { isTrustedRendererNavigation } from './navigationPolicy.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(globalThis as typeof globalThis & {
  __DewClientElectronShell?: typeof shell;
  __DewClientElectronBrowserWindow?: typeof BrowserWindow;
}).__DewClientElectronShell = shell;
(globalThis as typeof globalThis & {
  __DewClientElectronBrowserWindow?: typeof BrowserWindow;
}).__DewClientElectronBrowserWindow = BrowserWindow;

let mainWindow: BrowserWindow | null = null;
const appIconPath = resolveAppIconPath();

function resolveAppIconPath(): string | undefined {
  const candidates = [
    path.resolve(process.resourcesPath, 'icon/DewClient.ico'),
    path.resolve(app.getAppPath(), 'icon/DewClient.ico'),
    path.resolve(__dirname, '../icon/DewClient.ico'),
    path.resolve(__dirname, '../../icon/DewClient.ico'),
    path.resolve(process.cwd(), 'icon/DewClient.ico')
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.dewclient.launcher');
}

function createWindow(): BrowserWindow {
  // Resolve preload script (supporting both bundled dist-electron and source dev)
  let preloadPath = path.resolve(__dirname, 'preload.cjs');
  if (!fs.existsSync(preloadPath)) {
    preloadPath = path.resolve(__dirname, '../preload/index.js');
  }

  // Ensure standard Edit/View menu for Windows keyboard accelerator routing (Cut, Copy, Paste, Undo, Redo, typing)
  const menu = Menu.buildFromTemplate([
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    title: 'DewClient',
    backgroundColor: '#0a0d14',
    icon: resolveAppIconPath(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  if (appIconPath) {
    win.setIcon(appIconPath);
  }

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const bundledHtml = path.resolve(__dirname, '../dist/index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' || target.protocol === 'http:') {
        void shell.openExternal(target.toString()).catch((error) => {
          getLogger().warn('main', 'Could not open external link:', error);
        });
      }
    } catch (error) {
      getLogger().warn('main', 'Rejected invalid popup URL:', error);
    }
    return { action: 'deny' };
  });

  const restrictNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedRendererNavigation(url, bundledHtml, devServerUrl)) {
      event.preventDefault();
    }
  };
  win.webContents.on('will-navigate', restrictNavigation);
  win.webContents.on('will-redirect', restrictNavigation);

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    win.webContents.focus();
  });

  win.on('focus', () => {
    win.webContents.focus();
  });

  // Support F12 and Ctrl+Shift+I to toggle DevTools
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Register master IPC handlers
  registerIpcHandlers(win);

  // In dev mode load Vite server, else load static index.html
  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    if (fs.existsSync(bundledHtml)) {
      win.loadFile(bundledHtml);
    } else {
      getLogger().error('main', 'Packaged renderer bundle is missing; refusing to load an untrusted local web server.');
      app.quit();
    }
  }

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  // Register custom protocol client for returning from browser auth
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('dewclient', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('dewclient');
  }

  const handleProtocolUrl = (candidate: string) => {
    if (typeof candidate === 'string' && candidate.startsWith('dewclient://')) {
      getAuthService().acceptDiscordOAuthCallback(candidate);
    }
  };

  app.on('second-instance', (_event, commandLine) => {
    const protocolUrl = commandLine.find((argument) => argument.startsWith('dewclient://'));
    if (protocolUrl) handleProtocolUrl(protocolUrl);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
  });

  app.whenReady().then(() => {
    app.setName('DewClient');
    getLogger().info('main', 'DewClient Electron main process starting...');
    mainWindow = createWindow();
    for (const argument of process.argv) handleProtocolUrl(argument);

    getUpdateService().startBackgroundChecks();

    // Start background presence heartbeats
    getHeartbeatService().start();
    getCosmeticsSyncService().start();
    getRichPresenceService().start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        getHeartbeatService().start();
        getCosmeticsSyncService().start();
        getRichPresenceService().start();
      }
    });
  });

  app.on('window-all-closed', () => {
    getUpdateService().stopBackgroundChecks();
    getHeartbeatService().stop();
    getCosmeticsSyncService().stop();
    getRichPresenceService().stop();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
