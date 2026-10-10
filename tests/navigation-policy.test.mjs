import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isTrustedRendererNavigation } from '../electron/main/navigationPolicy.ts';
import { isTrustedIpcSender } from '../electron/ipc/ipcSecurity.ts';

test('renderer navigation is limited to the bundled app or configured dev origin', () => {
  const appHtmlPath = path.resolve('dist/index.html');
  const appUrl = pathToFileURL(appHtmlPath).toString();

  assert.equal(isTrustedRendererNavigation(appUrl, appHtmlPath), true);
  assert.equal(isTrustedRendererNavigation(`${appUrl}#settings`, appHtmlPath), true);
  assert.equal(isTrustedRendererNavigation('https://example.com/', appHtmlPath), false);
  assert.equal(isTrustedRendererNavigation('file:///outside/index.html', appHtmlPath), false);
  assert.equal(isTrustedRendererNavigation('javascript:alert(1)', appHtmlPath), false);
  assert.equal(isTrustedRendererNavigation('http://localhost:5173/settings', appHtmlPath, 'http://localhost:5173'), true);
  assert.equal(isTrustedRendererNavigation('http://localhost:5174/', appHtmlPath, 'http://localhost:5173'), false);
});

test('IPC accepts only the active BrowserWindow main frame', () => {
  const mainFrame = { url: 'file:///app/dist/index.html' };
  const webContents = { mainFrame, getURL: () => mainFrame.url };
  const mainWindow = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: mainFrame };

  assert.equal(isTrustedIpcSender(event, mainWindow), true);
  assert.equal(isTrustedIpcSender({ sender: {}, senderFrame: mainFrame }, mainWindow), false);
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: { url: mainFrame.url } }, mainWindow), false);
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: { ...mainFrame, url: 'https://attacker.example' } }, mainWindow), false);
  assert.equal(isTrustedIpcSender(event, { ...mainWindow, isDestroyed: () => true }), false);
});