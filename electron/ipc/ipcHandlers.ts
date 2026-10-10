/**
 * DewClient - Master IPC Handlers Registration
 * Enforces typed dispatch, input validation, and secure process delegation
 */

import { app, ipcMain, BrowserWindow, dialog, nativeImage, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IPC_CHANNELS } from '../../shared/constants/ipcChannels.ts';
import { PRODUCT_VERSION, PRODUCT_NAME, CURRENT_MINECRAFT_PRIMARY_TARGET } from '../../shared/constants/versions.ts';
import { OFFICIAL_DEWCLIENT_API_URL } from '../../shared/constants/defaults.ts';
import { getAuthService } from '../auth/authService.ts';
import { ManifestService } from '../minecraft/manifestService.ts';
import { InstallService } from '../minecraft/installService.ts';
import { LibraryResolver } from '../minecraft/libraryResolver.ts';
import { ArgumentBuilder } from '../minecraft/argumentBuilder.ts';
import { LaunchService } from '../minecraft/launchService.ts';
import { RepairService } from '../minecraft/repairService.ts';
import { CrashDiagnostics } from '../minecraft/crashDiagnostics.ts';
import { getInstanceManager } from '../instances/instanceManager.ts';
import { RuntimeService, getRequiredJavaForPackage } from '../runtime/runtimeService.ts';
import { getModrinthService } from '../content/modrinthService.ts';
import { getContentManager } from '../content/contentManager.ts';
import { getRemoteConfigService } from '../remote/remoteConfigService.ts';
import { getSettingsStorage } from '../storage/settingsStorage.ts';
import { getPathManager } from '../storage/paths.ts';
import { resetLauncherData } from '../storage/launcherDataReset.ts';
import { getCosmeticStorage, type CosmeticKind, validateCosmeticImage } from '../storage/cosmeticStorage.ts';
import { getCosmeticsSyncService } from '../remote/cosmeticsSyncService.ts';
import { DewCosmeticsSessionClient } from '../remote/dewCosmeticsSessionClient.ts';
import { DewCosmeticsBridgeService } from '../remote/dewCosmeticsBridgeService.ts';
import { getRichPresenceService } from '../remote/richPresenceService.ts';
import { getUpdateService } from '../updater/updateService.ts';
import { getLogger } from '../core/logger.ts';
import { isTrustedIpcSender } from './ipcSecurity.ts';

let activeMainWindow: BrowserWindow | null = null;
let handlersRegistered = false;
const rawIpcHandle = ipcMain.handle.bind(ipcMain);
(ipcMain as any).handle = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => {
  rawIpcHandle(channel as any, ((event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    if (!isTrustedIpcSender(event, activeMainWindow)) {
      throw new Error('Rejected IPC from an untrusted renderer frame.');
    }
    return listener(event, ...args);
  }) as any);
};

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  activeMainWindow = mainWindow;
  if (handlersRegistered) return;
  handlersRegistered = true;

  const logger = getLogger();
  const authService = getAuthService();
  const manifestService = new ManifestService();
  const installService = new InstallService();
  const libraryResolver = new LibraryResolver();
  const argumentBuilder = new ArgumentBuilder();
  const launchService = new LaunchService();
  const repairService = new RepairService();
  const instanceManager = getInstanceManager();
  const runtimeService = new RuntimeService();
  const modrinthService = getModrinthService();
  const contentManager = getContentManager();
  const remoteConfigService = getRemoteConfigService();
  const settingsStorage = getSettingsStorage();
  const pathManager = getPathManager();
  const cosmeticStorage = getCosmeticStorage();
  const cosmeticsSyncService = getCosmeticsSyncService();
  const updateService = getUpdateService();
  const discordCapeClaimBaselines = new Map<string, Set<string>>();
  let launcherHiddenForGame = false;

  const ensureJavaForVersion = async (versionId: string, instanceId: string) => {
    const reportJava = (progressPercent: number, phase: string) => sendEvent(IPC_CHANNELS.EVENT_INSTALL_PROGRESS, {
      instanceId,
      versionId,
      step: 'java',
      phase,
      downloadedBytes: 0,
      totalBytes: 0,
      remainingBytes: 0,
      progressPercent,
      speedBytesPerSec: 0,
      etaSeconds: 0
    });
    reportJava(0, 'Checking required Java runtime...');
    const pkg = await manifestService.getVersionPackage(versionId);
    const requiredJavaMajor = getRequiredJavaForPackage(versionId, pkg);
    reportJava(5, `Preparing Java ${requiredJavaMajor}...`);
    const javaPath = await runtimeService.resolveRuntimeForRequirement(requiredJavaMajor, undefined, (progressPercent, phase) => {
      reportJava(progressPercent, phase);
    });
    reportJava(100, `Java ${requiredJavaMajor} ready.`);
    return javaPath;
  };

  // Helper to send events to renderer
  const sendEvent = (channel: string, payload: any) => {
    if (activeMainWindow && !activeMainWindow.isDestroyed()) {
      activeMainWindow.webContents.send(channel, payload);
    }
  };

  const ensureDewCosmeticsForInstance = async (instance: { id: string; minecraftVersion: string; loaderType: string }) => {
    if (instance.loaderType !== 'fabric') return;
    const requiredForThisRelease = instance.minecraftVersion === CURRENT_MINECRAFT_PRIMARY_TARGET;
    if (!requiredForThisRelease && !contentManager.hasManagedCosmeticsForVersion(instance.minecraftVersion)) return;
    try {
      const installed = await contentManager.installManagedCosmeticsMod(instance.id, (message) => {
        sendEvent(IPC_CHANNELS.EVENT_GAME_LOG, `[DEWCLIENT] ${message}`);
      });
      if (requiredForThisRelease && !installed) {
        throw new Error(`The bundled DewCosmetics mod is not available for Minecraft ${instance.minecraftVersion}.`);
      }
    } catch (err: any) {
      logger.warn('content', `DewCosmetics was not installed for ${instance.id}:`, err.message);
      sendEvent(IPC_CHANNELS.EVENT_GAME_LOG, `[DEWCLIENT] DewCosmetics is unavailable for Minecraft ${instance.minecraftVersion}: ${err.message}`);
      if (requiredForThisRelease) {
        throw new Error(`Could not prepare the required DewClient mods for Minecraft ${instance.minecraftVersion}: ${err.message}`);
      }
    }
  };

  cosmeticsSyncService.onSyncComplete((result) => {
    sendEvent(IPC_CHANNELS.EVENT_COSMETICS_SYNC, result);
  });

  // ============================ AUTH ============================

  ipcMain.handle(IPC_CHANNELS.AUTH_START_MICROSOFT, async () => {
    return authService.startMicrosoftLogin(activeMainWindow, (status) => {
      sendEvent(IPC_CHANNELS.EVENT_AUTH_STATUS, status);
    });
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_DISCORD_START, async () => authService.startDiscordLogin());
  ipcMain.handle(IPC_CHANNELS.AUTH_DISCORD_EXCHANGE, async (_event, payload: { ticket: string; username?: string }) =>
    authService.completeDiscordLogin(payload?.ticket, payload?.username || '')
  );

  ipcMain.handle(IPC_CHANNELS.AUTH_CANCEL_MICROSOFT, async () => {
    authService.cancelMicrosoftLogin();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_ACCOUNTS, async () => {
    return authService.getAccounts();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_ACTIVE, async () => {
    return authService.getActiveAccount();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_COSMETICS, async () => {
    return cosmeticsSyncService.getActiveCosmetics();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_FREE_CAPES, async (_event, accountId?: string) => authService.getFreeCapeCatalog(typeof accountId === 'string' ? accountId : undefined));
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_FREE_CAPE_PREVIEW, async (_event, input: { accountId: string; assetId: string; sha256: string }) => {
    if (!input || typeof input.accountId !== 'string' || typeof input.assetId !== 'string' || typeof input.sha256 !== 'string') throw new Error('Select a valid free cape preview.');
    return authService.getFreeCapePreview(input.accountId, input.assetId, input.sha256);
  });
  ipcMain.handle(IPC_CHANNELS.AUTH_CREATE_DISCORD_CAPE_CLAIM_CODE, async (_event, input: { accountId: string; assetId?: string }) => {
    if (!input || typeof input.accountId !== 'string' || (input.assetId !== undefined && typeof input.assetId !== 'string')) throw new Error('Select a signed-in player first.');
    const code = await authService.createDiscordCapeClaimCode(input.accountId, input.assetId);
    const current = await authService.getDiscordCapeClaimStatus(input.accountId).catch(() => null);
    if (current) discordCapeClaimBaselines.set(input.accountId, new Set(current.claimedAssetIds));
    return code;
  });
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_DISCORD_CAPE_CLAIM_STATUS, async (_event, accountId: string) => {
    if (typeof accountId !== 'string' || !accountId) throw new Error('Select a signed-in player first.');
    const status = await authService.getDiscordCapeClaimStatus(accountId);
    const previous = discordCapeClaimBaselines.get(accountId);
    const hasNewClaims = previous && status.claimedAssetIds.some((assetId) => !previous.has(assetId));
    discordCapeClaimBaselines.set(accountId, new Set(status.claimedAssetIds));
    if (hasNewClaims) cosmeticsSyncService.scheduleSync();
    return status;
  });
  ipcMain.handle(IPC_CHANNELS.AUTH_CLAIM_FREE_CAPE, async (_event, input: { accountId: string; assetId: string }) => {
    if (!input || typeof input.accountId !== 'string' || typeof input.assetId !== 'string') throw new Error('Select a player and a free cape first.');
    const result = await authService.claimFreeCape(input.accountId, input.assetId);
    if (result.claimed) {
      const current = await authService.getDiscordCapeClaimStatus(input.accountId).catch(() => null);
      if (current) discordCapeClaimBaselines.set(input.accountId, new Set(current.claimedAssetIds));
      cosmeticsSyncService.scheduleSync();
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_EQUIP_FREE_CAPE, async (_event, input: { accountId: string; assetId: string | null }) => {
    if (!input || typeof input.accountId !== 'string' || (input.assetId !== null && typeof input.assetId !== 'string')) throw new Error('Choose a player and a cape from your collection.');
    const result = await authService.equipFreeCape(input.accountId, input.assetId);
    cosmeticsSyncService.scheduleSync();
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_REFRESH_OFFICIAL_CAPES, async (_event, accountId: string) => {
    return authService.refreshOfficialCapes(accountId);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_ASSIGNED_COSMETIC_PREVIEW, async (_event, input: { accountId: string; kind: 'skin' | 'cape' | 'elytra'; assetId: string }) => {
    if (!input || typeof input.accountId !== 'string' || typeof input.assetId !== 'string') throw new Error('Select a valid assigned cosmetic.');
    return cosmeticsSyncService.getAssignedCosmeticPreview(input.accountId, input.kind, input.assetId);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SELECT_ACCOUNT, async (_event, id: string) => {
    const selected = authService.selectAccount(id);
    if (selected) {
      getCosmeticsSyncService().scheduleSync();
      const { getHeartbeatService } = await import('../remote/heartbeatService.ts');
      getHeartbeatService().sendHeartbeat().catch(() => {});
    }
    return selected;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_REMOVE_ACCOUNT, async (_event, id: string) => {
    const removed = authService.getAccounts().find((account) => account.id === id || account.uuid === id);
    const wasActive = Boolean(removed && authService.getActiveAccount()?.id === removed.id);
    authService.removeAccount(id);
    const { getHeartbeatService } = await import('../remote/heartbeatService.ts');
    getHeartbeatService().sendHeartbeat().catch(() => {});
    // Preserve local legacy/cache files; removing an account must not delete the last cosmetic copy.
    if (wasActive) getCosmeticsSyncService().scheduleSync();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_UPDATE_ACCOUNT, async (_event, { id, partial }) => {
    const account = authService.getAccounts().find((candidate) => candidate.id === id || candidate.uuid === id);
    const updated = authService.updateAccount(id, partial);
    if (updated) {
      const { getHeartbeatService } = await import('../remote/heartbeatService.ts');
      getHeartbeatService().sendHeartbeat(false).catch(() => {});
      if (account) {
        if (partial?.cosmetics && ('badge' in partial.cosmetics || 'accentColor' in partial.cosmetics || 'activeAdminCosmetics' in partial.cosmetics)) {
          cosmeticsSyncService.markPendingChange(account.id, 'metadata', 'set');
        }
      }
    }
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_PICK_COSMETIC, async (_event, { accountId, kind, slot }: { accountId: string; kind: CosmeticKind; slot?: number }) => {
    if (kind !== 'skin') throw new Error('Players can upload custom skins only. Capes and elytra are assigned by administrators.');
    if (slot !== undefined && (!Number.isInteger(slot) || slot < 0 || slot > 3)) throw new Error('Choose one of the four skin slots.');
    if (!authService.getAccounts().some((account) => account.id === accountId)) throw new Error('Account was not found.');
    const dialogOptions: OpenDialogOptions = {
      title: `Choose an ${kind} image`,
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    };
    const dialogParent = activeMainWindow && !activeMainWindow.isDestroyed() ? activeMainWindow : undefined;
    const result = dialogParent
      ? await dialog.showOpenDialog(dialogParent, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) return null;
    const sourcePath = result.filePaths[0];
    const sourceStat = fs.statSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size > 50 * 1024 * 1024) {
      throw new Error('Cosmetic images must be 50 MiB or smaller.');
    }
    const extension = path.extname(sourcePath).toLowerCase();
    const sourceBytes = fs.readFileSync(sourcePath);
    const contentType = extension === '.png' ? 'image/png'
      : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
        : extension === '.webp' ? 'image/webp' : '';
    if (!contentType) throw new Error('Cosmetics must be PNG, JPG, JPEG, or WebP files.');
    validateCosmeticImage(kind, sourceBytes, contentType);

    // The in-game renderer and cross-player sync use PNG. Normalize accepted uploads once here.
    const decodedImage = nativeImage.createFromPath(sourcePath);
    if (decodedImage.isEmpty()) throw new Error('The selected image could not be decoded.');
    const normalizedPng = decodedImage.toPNG();
    return slot === undefined
      ? cosmeticStorage.saveBuffer(accountId, kind, normalizedPng, '.png')
      : cosmeticStorage.saveSkinSlotBuffer(accountId, slot, normalizedPng, '.png');
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_COSMETIC_PREVIEW, async (_event, { accountId, assetPath, kind }: { accountId: string; assetPath: string; kind: CosmeticKind }) => {
    if (!authService.getAccounts().some((account) => account.id === accountId)) throw new Error('Account was not found.');
    return cosmeticStorage.getPreviewDataUrl(accountId, assetPath, kind);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_REMOVE_COSMETIC, async (_event, { accountId, kind }: { accountId: string; kind: CosmeticKind }) => {
    if (kind !== 'skin') throw new Error('Capes and wings are assigned by administrators.');
    const account = authService.getAccounts().find((candidate) => candidate.id === accountId || candidate.uuid === accountId);
    if (!account) throw new Error('Account was not found.');
    cosmeticStorage.remove(account.id, 'skin');
    const cosmetics = { ...(account.cosmetics || {}) };
    delete cosmetics.skinAssetPath;
    delete cosmetics.skinSource;
    delete cosmetics.skinSlots;
    delete cosmetics.activeSkinSlot;
    authService.updateAccount(account.id, { skinAssetPath: undefined, cosmetics });
    return true;
  });

  // Offline Profiles
  ipcMain.handle(IPC_CHANNELS.PROFILES_CREATE, async (_event, username: string) => {
    const profile = authService.createOfflineProfile(username);
    const { getHeartbeatService } = await import('../remote/heartbeatService.ts');
    getHeartbeatService().sendHeartbeat().catch(() => {});
    return profile;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_CHANGE_USERNAME, async (_event, payload: { accountId: string; username: string }) => {
    return await authService.changeUsername(payload.accountId, payload.username);
  });

  ipcMain.handle(IPC_CHANNELS.SUPPORT_SUBMIT_BUG_REPORT, async (_event, input: any) => {
    const categories = new Set(['launcher', 'game-launch', 'account', 'cosmetics', 'other']);
    const category = typeof input?.category === 'string' ? input.category : '';
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    const description = typeof input?.description === 'string' ? input.description.trim() : '';
    const minecraftVersion = typeof input?.minecraftVersion === 'string' ? input.minecraftVersion.trim().slice(0, 32) : '';
    if (!categories.has(category) || title.length < 8 || title.length > 120 || description.length < 20 || description.length > 5000) {
      throw new Error('Enter a title of 8–120 characters and a description of 20–5000 characters.');
    }

    const response = await fetch(`${OFFICIAL_DEWCLIENT_API_URL.replace(/\/+$/, '')}/bug-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        category,
        title,
        description,
        clientVersion: PRODUCT_VERSION,
        minecraftVersion: /^[0-9A-Za-z._+-]+$/.test(minecraftVersion) ? minecraftVersion : null
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok !== true) {
      const safeMessage = typeof result?.error?.message === 'string' && result.error.message.length < 240
        ? result.error.message
        : 'The report could not be sent. Check your connection and try again.';
      throw new Error(safeMessage);
    }
    return { id: String(result?.data?.id || '') };
  });

  // ============================ MINECRAFT ENGINE ============================

  ipcMain.handle(IPC_CHANNELS.MINECRAFT_GET_VERSIONS, async (_event, channel?: 'release' | 'all') => {
    return manifestService.listVersions(channel || 'release');
  });

  ipcMain.handle('minecraft.getFabricVersions', async () => {
    return manifestService.listFabricVersions();
  });

  ipcMain.handle(IPC_CHANNELS.MINECRAFT_INSTALL_VERSION, async (_event, { versionId, instanceId }) => {
    try {
      await ensureJavaForVersion(versionId, instanceId);
      sendEvent(IPC_CHANNELS.EVENT_LAUNCH_STATUS, {
        instanceId,
        status: 'downloading',
        state: 'downloading',
        message: `Downloading Minecraft ${versionId}...`
      });
      const result = await installService.installVersion(versionId, instanceId, (progress) => {
        sendEvent(IPC_CHANNELS.EVENT_INSTALL_PROGRESS, progress);
      });
      sendEvent(IPC_CHANNELS.EVENT_LAUNCH_STATUS, {
        instanceId,
        status: 'idle',
        state: 'idle',
        message: `Minecraft ${versionId} downloaded successfully.`
      });
      return result;
    } catch (err: any) {
      sendEvent(IPC_CHANNELS.EVENT_LAUNCH_STATUS, {
        instanceId,
        status: 'crashed',
        state: 'error',
        message: `Download failed: ${err?.message || err}`
      });
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MINECRAFT_IS_INSTALLED, async (_event, versionOrInstanceId: string) => {
    if (!versionOrInstanceId) return false;
    let targetVersion = versionOrInstanceId;
    const inst = instanceManager.getInstance(versionOrInstanceId);
    if (inst) {
      targetVersion = inst.minecraftVersion;
    }
    return manifestService.listInstalledVersionIds().has(targetVersion);
  });

  ipcMain.handle(IPC_CHANNELS.MINECRAFT_LAUNCH, async (_event, payload: string | { instanceId: string; accountUuid?: string }) => {
    const instanceId = typeof payload === 'string' ? payload : payload?.instanceId;
    const inst = instanceManager.getInstance(instanceId);
    if (!inst) throw new Error(`Instance '${instanceId}' not found.`);

    const account = authService.getActiveAccount();
    if (!account) {
      throw new Error('No Minecraft account selected. Please select or add an account before playing.');
    }

    let cosmeticsBridge: DewCosmeticsBridgeService | null = null;
    let cosmeticsBridgeRefreshTimer: NodeJS.Timeout | null = null;
    let cosmeticsBridgeRefreshInFlight = false;
    try {
      sendEvent(IPC_CHANNELS.EVENT_LAUNCH_STATUS, {
        instanceId,
        status: 'preparing',
        state: 'preparing',
        message: 'Preparing game files and runtime...'
      });

      // Hard gate: no game metadata, assets, or libraries are downloaded until Java is available.
      await ensureJavaForVersion(inst.minecraftVersion, inst.id);

      // 1. Install or verify version
      const { pkg, javaPath } = await installService.installVersion(
        inst.minecraftVersion,
        inst.id,
        (prog) => sendEvent(IPC_CHANNELS.EVENT_INSTALL_PROGRESS, prog)
      );

      if (inst.loaderType === 'fabric') {
        const requiredForThisRelease = inst.minecraftVersion === CURRENT_MINECRAFT_PRIMARY_TARGET;
        const hasBundledCosmeticsMod = contentManager.hasManagedCosmeticsForVersion(inst.minecraftVersion);
        const cosmeticsModInstalled = requiredForThisRelease || hasBundledCosmeticsMod
          ? await contentManager.installManagedCosmeticsMod(inst.id)
          : false;
        if (requiredForThisRelease && !cosmeticsModInstalled) {
          throw new Error(`The required DewClient mods are unavailable for Minecraft ${inst.minecraftVersion}. Reinstall DewClient or repair its files.`);
        }
        if (cosmeticsModInstalled) {
          try {
            const gameDirectory = inst.gameDirectory || pathManager.getInstancePath(inst.id);
            const syncResult = await cosmeticsSyncService.syncAssignedCosmetics(gameDirectory);
            logger.info('remote', `Synchronized assigned cosmetics for ${syncResult.playersSynced} players.`);
          } catch (error: any) {
            logger.warn('remote', `Assigned cosmetics could not be synchronized before launch: ${error?.message || error}`);
          }
        }
      }

      // 2. Verify the Microsoft profile and refresh its official capes. If the
      // network is unavailable, use an explicitly unverified offline identity.
      const launchAuth = await authService.getLaunchAuth(account);
      if (account.type === 'microsoft' && !launchAuth.verified) {
        sendEvent(IPC_CHANNELS.EVENT_LAUNCH_STATUS, {
          instanceId,
          status: 'preparing',
          state: 'preparing',
          message: 'Internet unavailable. Launching an unverified offline session; online-mode servers will require a verified relaunch.'
        });
      }

      let bridgeEnvironment: NodeJS.ProcessEnv | undefined;
      const managedModVersion = contentManager.getManagedCosmeticsModVersion(inst.minecraftVersion);
      if (inst.loaderType === 'fabric' && managedModVersion) {
        try {
          const remoteCosmeticsApiBaseUrl = settingsStorage.getSettings().remote?.enabled
            ? OFFICIAL_DEWCLIENT_API_URL
            : null;
          const protocolVersion = 1;
          const loaderFamily = 'fabric';
          const sessionClient = new DewCosmeticsSessionClient();
          let modSession = null;
          try {
            modSession = await sessionClient.createSession(account, {
              instanceId: inst.id,
              minecraftVersion: pkg.id,
              modVersion: managedModVersion,
              protocolVersion,
              loaderFamily,
              capabilities: ['skin', 'cape', 'wings']
            }, launchAuth.verified ? launchAuth.accessToken : null);
          } catch (sessionError: any) {
            logger.warn('remote', `DewCosmetics session unavailable; continuing without remote presence: ${sessionError?.message || sessionError}`);
          }

          const cosmetics = await cosmeticsSyncService.getActiveCosmetics();
          const profileAccount = authService.getAccounts().find((candidate) => candidate.id === account.id) || account;
          const microsoftCapes = [] as Array<{ name: string; dataUrl: string; active: boolean }>;
          if (profileAccount.type === 'microsoft') {
            const selectedMicrosoftCapeId = profileAccount.cosmetics?.activeOfficialCapeId;
            for (const cape of profileAccount.cosmetics?.officialCapes || []) {
              try {
                microsoftCapes.push({
                  name: cape.name || 'Minecraft Cape',
                  dataUrl: getCosmeticStorage().getPreviewDataUrl(profileAccount.id, cape.assetPath, 'cape'),
                  active: selectedMicrosoftCapeId ? cape.id === selectedMicrosoftCapeId : cape.active === true
                });
              } catch {
                // A missing cached official cape must not prevent the game from starting.
              }
            }
          }
          cosmeticsBridge = new DewCosmeticsBridgeService();
          const connection = await cosmeticsBridge.start({
            instanceId: inst.id,
            minecraftVersion: pkg.id,
            modVersion: managedModVersion,
            apiBaseUrl: remoteCosmeticsApiBaseUrl,
            session: modSession,
            cosmetics,
            microsoftCapes
          });
          bridgeEnvironment = {
            DEWCLIENT_BRIDGE_URL: connection.url,
            DEWCLIENT_BRIDGE_TOKEN: connection.token,
            DEWCLIENT_INSTANCE_ID: inst.id
          };
          cosmeticsBridgeRefreshTimer = setInterval(() => {
            if (!cosmeticsBridge || cosmeticsBridgeRefreshInFlight || authService.getActiveAccount()?.id !== account.id) return;
            cosmeticsBridgeRefreshInFlight = true;
            void (async () => {
              try {
                const latestCosmetics = await cosmeticsSyncService.getActiveCosmetics();
                const latestAccount = authService.getAccounts().find((candidate) => candidate.id === account.id);
                if (!latestAccount || authService.getActiveAccount()?.id !== account.id) return;
                const latestMicrosoftCapes: Array<{ name: string; dataUrl: string; active: boolean }> = [];
                if (latestAccount.type === 'microsoft') {
                  const selectedCapeId = latestAccount.cosmetics?.activeOfficialCapeId;
                  for (const cape of latestAccount.cosmetics?.officialCapes || []) {
                    try {
                      latestMicrosoftCapes.push({
                        name: cape.name || 'Minecraft Cape',
                        dataUrl: getCosmeticStorage().getPreviewDataUrl(latestAccount.id, cape.assetPath, 'cape'),
                        active: selectedCapeId ? cape.id === selectedCapeId : cape.active === true
                      });
                    } catch {
                      // A missing cached official cape must not interrupt an active game.
                    }
                  }
                }
                cosmeticsBridge?.update({
                  instanceId: inst.id,
                  minecraftVersion: pkg.id,
                  modVersion: managedModVersion,
                  apiBaseUrl: remoteCosmeticsApiBaseUrl,
                  session: modSession,
                  cosmetics: latestCosmetics,
                  microsoftCapes: latestMicrosoftCapes
                });
              } catch {
                // Keep the last working snapshot; the next refresh will retry.
              } finally {
                cosmeticsBridgeRefreshInFlight = false;
              }
            })();
          }, 10_000);
          cosmeticsBridgeRefreshTimer.unref?.();
        } catch (bridgeError: any) {
          await cosmeticsBridge?.stop();
          cosmeticsBridge = null;
          logger.warn('remote', `DewCosmetics bridge unavailable; continuing without the bridge: ${bridgeError?.message || bridgeError}`);
        }
      }

      // 3. Resolve libraries & classpath
      const resolvedLibs = libraryResolver.resolveLibraries(pkg);
      const clientJarPath = pathManager.getVersionJarPath(pkg.id);
      const classpathEntries = resolvedLibs.map((l) => l.path);

      // 4. Build Launch Configuration
      const minecraftSettings = settingsStorage.getSettings().minecraft;
      const launchConfig = {
        versionId: pkg.id,
        instanceId: inst.id,
        gameDirectory: inst.gameDirectory || pathManager.getInstancePath(inst.id),
        assetsDirectory: pathManager.getAssetsPath(),
        nativesDirectory: pathManager.getNativesPath(inst.id),
        javaPath: inst.javaPath || javaPath,
        mainClass: pkg.mainClass,
        jvmArgs: inst.jvmArgs ? argumentBuilder.parseCommandLineArgs(inst.jvmArgs) : [],
        gameArgs: inst.gameArgs ? argumentBuilder.parseCommandLineArgs(inst.gameArgs) : [],
        classpath: classpathEntries,
        memoryMb: minecraftSettings.memoryMb,
        resolutionWidth: minecraftSettings.resolutionWidth,
        resolutionHeight: minecraftSettings.resolutionHeight,
        fullscreen: minecraftSettings.fullscreen,
        auth: {
          username: account.username,
          uuid: launchAuth.uuid,
          accessToken: launchAuth.accessToken,
          userType: launchAuth.userType
        }
      };

      // 5. Build command & arguments
      const { command, args, safeArgsForLogs } = argumentBuilder.buildLaunchCommand(
        pkg,
        launchConfig,
        clientJarPath
      );

      // JVM/game arguments can contain account tokens and local file paths.
      // Keep those details out of both logs and the renderer event stream.
      logger.info('launch', 'Preparing the Minecraft process.');

      sendEvent(IPC_CHANNELS.EVENT_LAUNCH_STATUS, {
        instanceId,
        status: 'launching',
        state: 'launching',
        message: 'Starting Minecraft Java Edition...'
      });

      // 6. Spawn process supervisor
      const gameStartedAt = Date.now();
      const exitCode = await launchService.launchProcess(
        inst.id,
        command,
        args,
        launchConfig.gameDirectory,
        (status) => {
          const mappedStatus = status.state === 'error' ? 'crashed' : status.state;
          if (status.state === 'running') {
            getRichPresenceService().setMinecraftState(launchConfig.versionId);
          } else if (status.state === 'idle' || status.state === 'error') {
            getRichPresenceService().setLauncherState();
          }
          if (status.state === 'running' && settingsStorage.getSettings().launcher.closeOnLaunch && activeMainWindow && !activeMainWindow.isDestroyed()) {
            activeMainWindow.hide();
            launcherHiddenForGame = true;
          } else if (
            (status.state === 'idle' || status.state === 'error') &&
            launcherHiddenForGame &&
            Object.keys(launchService.getRunningPids()).length === 0 &&
            activeMainWindow &&
            !activeMainWindow.isDestroyed()
          ) {
            launcherHiddenForGame = false;
            activeMainWindow.show();
            activeMainWindow.focus();
          }
          const statusPayload: any = {
            ...status,
            status: mappedStatus
          };
          // If crashed, attach diagnostic analysis
          if (status.state === 'error' && status.exitCode && status.exitCode !== 0) {
            statusPayload.diagnosticError = CrashDiagnostics.analyzeCrash(launchConfig.gameDirectory, status.exitCode);
            statusPayload.crashReport = statusPayload.diagnosticError;
          }
          sendEvent(IPC_CHANNELS.EVENT_LAUNCH_STATUS, statusPayload);
        },
        (log) => {
          sendEvent(IPC_CHANNELS.EVENT_GAME_LOG, log);
        },
        { env: bridgeEnvironment }
      );

      instanceManager.recordPlayTime(inst.id, Date.now() - gameStartedAt);
      return exitCode;
    } catch (err: any) {
      logger.error('minecraft', `Launch error for instance ${instanceId}:`, err);
      sendEvent(IPC_CHANNELS.EVENT_LAUNCH_STATUS, {
        instanceId,
        status: 'crashed',
        state: 'error',
        message: err?.message || 'Failed to start Minecraft.'
      });
      sendEvent(IPC_CHANNELS.EVENT_GAME_LOG, {
        instanceId,
        timestamp: new Date().toISOString(),
        level: 'STDERR',
        message: `[ERROR] Game startup aborted: ${err?.message || err}`
      });
      throw err;
    } finally {
      if (cosmeticsBridgeRefreshTimer) clearInterval(cosmeticsBridgeRefreshTimer);
      await cosmeticsBridge?.stop();
    }
  });

  ipcMain.handle(IPC_CHANNELS.MINECRAFT_STOP, async (_event, instanceId: string) => {
    return launchService.stopInstance(instanceId);
  });

  ipcMain.handle(IPC_CHANNELS.MINECRAFT_GET_RUNNING, async () => {
    return launchService.getRunningPids();
  });

  ipcMain.handle(IPC_CHANNELS.MINECRAFT_REPAIR, async (_event, { versionId, instanceId }) => {
    const instance = instanceManager.getInstance(instanceId);
    const resolvedVersionId = versionId || instance?.minecraftVersion;
    if (!instance || !resolvedVersionId) {
      throw new Error(`Instance '${instanceId}' not found.`);
    }
    return repairService.repairVersion(resolvedVersionId, instanceId, (prog) => {
      sendEvent(IPC_CHANNELS.EVENT_INSTALL_PROGRESS, prog);
    });
  });

  // ============================ INSTANCES ============================

  ipcMain.handle(IPC_CHANNELS.INSTANCES_LIST, async () => {
    return instanceManager.listInstances();
  });

  ipcMain.handle(IPC_CHANNELS.INSTANCES_GET, async (_event, id: string) => {
    return instanceManager.getInstance(id);
  });

  ipcMain.handle(IPC_CHANNELS.INSTANCES_GET_ACTIVE, async () => {
    return instanceManager.getActiveInstance();
  });

  ipcMain.handle(IPC_CHANNELS.INSTANCES_SELECT, async (_event, id: string) => {
    instanceManager.setActiveInstance(id);
    return instanceManager.getActiveInstance();
  });

  ipcMain.handle(IPC_CHANNELS.INSTANCES_CREATE, async (_event, data: any) => {
    const instance = instanceManager.createInstance(data);
    if (instance.loaderType === 'fabric') {
      try {
        await ensureDewCosmeticsForInstance(instance);
        await contentManager.installManagedFabricMods(instance.id, instance.minecraftVersion, (message) => {
          sendEvent(IPC_CHANNELS.EVENT_GAME_LOG, `[DEWCLIENT] ${message}`);
        });
      } catch (err: any) {
        if (instance.minecraftVersion === CURRENT_MINECRAFT_PRIMARY_TARGET) {
          try { instanceManager.deleteInstance(instance.id); } catch {}
          throw err;
        }
        logger.warn('content', `Managed Fabric mods were not installed for ${instance.id}:`, err.message);
      }
    }
    return instance;
  });

  ipcMain.handle(IPC_CHANNELS.INSTANCES_UPDATE, async (_event, { id, partial }) => {
    return instanceManager.updateInstance(id, partial);
  });

  ipcMain.handle(IPC_CHANNELS.INSTANCES_DELETE, async (_event, id: string) => {
    return instanceManager.deleteInstance(id);
  });

  ipcMain.handle(IPC_CHANNELS.INSTANCES_DUPLICATE, async (_event, { id, newName }) => {
    const instance = instanceManager.duplicateInstance(id, newName);
    await ensureDewCosmeticsForInstance(instance);
    return instance;
  });

  ipcMain.handle(IPC_CHANNELS.INSTANCES_EXPORT, async (_event, { id }) => {
    const instance = instanceManager.getInstance(id);
    if (!instance) throw new Error(`Instance '${id}' not found.`);
    const safeName = instance.name.replace(/[^a-zA-Z0-9_.-]+/g, '-') || id;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(pathManager.getDownloadsPath(), `${safeName}.dewinstance.zip`),
      filters: [{ name: 'DewClient Instance', extensions: ['zip'] }]
    });
    return result.canceled ? null : instanceManager.exportInstance(id, result.filePath);
  });

  ipcMain.handle(IPC_CHANNELS.INSTANCES_IMPORT, async (_event, { name }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'DewClient Instance', extensions: ['zip'] }]
    });
    const selectedPath = result.canceled ? '' : result.filePaths[0];
    if (!selectedPath) return null;
    const instance = instanceManager.importInstance(selectedPath, name);
    await ensureDewCosmeticsForInstance(instance);
    return instance;
  });

  ipcMain.handle(IPC_CHANNELS.INSTANCES_OPEN_FOLDER, async (_event, id: string) => {
    if (!id || id === 'default' || id === 'root') {
      const root = pathManager.getRootPath();
      if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
      await shell.openPath(root);
      return true;
    }
    const inst = instanceManager.getInstance(id);
    if (inst && inst.gameDirectory && fs.existsSync(inst.gameDirectory)) {
      await shell.openPath(inst.gameDirectory);
      return true;
    }
    const root = pathManager.getRootPath();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    await shell.openPath(root);
    return true;
  });

  ipcMain.handle('system.openDataDir', async () => {
    const root = pathManager.getRootPath();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    await shell.openPath(root);
    return true;
  });

  ipcMain.handle('system.resetLauncherData', async () => {
    updateService.stopBackgroundChecks();
    const currentRemoteSettings = settingsStorage.getSettings().remote;
    if (currentRemoteSettings?.shareAccountUsage || currentRemoteSettings?.shareOnlinePresence) {
      const { getHeartbeatService } = await import('../remote/heartbeatService.ts');
      const cleared = await getHeartbeatService().clearSharedData().catch(() => false);
      if (!cleared) throw new Error('Connect to the DewClient server and retry so the launcher can remove your shared account and presence data before resetting local data.');
    }
    const runningInstanceIds = Object.keys(launchService.getRunningPids());
    await resetLauncherData({
      dataRoot: pathManager.getRootPath(),
      appDataPath: app.getPath('appData'),
      homePath: os.homedir(),
      electronStatePaths: [
        path.join(app.getPath('userData'), 'msal-token-cache.dat'),
        path.join(app.getPath('userData'), 'updates')
      ],
      stopRunningGames: async () => {
        for (const instanceId of runningInstanceIds) launchService.stopInstance(instanceId);
        const stopDeadline = Date.now() + 7000;
        while (runningInstanceIds.some((instanceId) => launchService.isInstanceRunning(instanceId)) && Date.now() < stopDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (runningInstanceIds.some((instanceId) => launchService.isInstanceRunning(instanceId))) {
          throw new Error('Minecraft did not close. Close the running game and try resetting again.');
        }
      },
      clearElectronSession: async () => {
        if (!activeMainWindow || activeMainWindow.isDestroyed()) return;
        const electronSession = activeMainWindow.webContents.session;
        await electronSession.clearStorageData();
        await electronSession.clearCache();
      },
      scheduleRelaunch: () => setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 300)
    });
    return true;
  });

  // ============================ JAVA RUNTIMES ============================

  ipcMain.handle(IPC_CHANNELS.JAVA_DETECT, async () => {
    return runtimeService.detectInstalledRuntimes();
  });

  ipcMain.handle(IPC_CHANNELS.JAVA_VALIDATE, async (_event, javaPath: string) => {
    return runtimeService.validateJavaPath(javaPath);
  });

  ipcMain.handle(IPC_CHANNELS.JAVA_DOWNLOAD_RUNTIME, async (_event, majorVersion: number) => {
    return runtimeService.provisionManagedRuntime(majorVersion);
  });

  // ============================ CONTENT & MODRINTH ============================

  ipcMain.handle(IPC_CHANNELS.MODRINTH_SEARCH, async (_event, params: any) => {
    const query = typeof params === 'string' ? params : (params?.query || '');
    const projectType = params?.projectType || params?.type || 'mod';
    const gameVersion = params?.gameVersion;
    const loader = params?.loader;
    const limit = params?.limit || 24;
    const offset = params?.offset || 0;
    return modrinthService.search(
      query,
      projectType,
      projectType === 'mod' ? gameVersion : undefined,
      projectType === 'mod' ? loader : undefined,
      limit,
      offset
    );
  });

  ipcMain.handle('content.install', async (_event, { instanceId, projectId, projectType }) => {
    return contentManager.installProjectContent(instanceId, projectId, projectType || 'mod');
  });

  ipcMain.handle(IPC_CHANNELS.MODRINTH_INSTALL, async (_event, { projectId, instanceName }) => {
    return contentManager.installModrinthModpack(projectId, instanceName);
  });

  ipcMain.handle(IPC_CHANNELS.MODRINTH_GET_PROJECT, async (_event, slugOrId: string) => {
    return modrinthService.getProject(slugOrId);
  });

  ipcMain.handle(IPC_CHANNELS.MODRINTH_GET_VERSIONS, async (_event, { slug, gameVersion, loaders }) => {
    return modrinthService.getProjectVersions(slug, gameVersion, loaders);
  });

  ipcMain.handle(IPC_CHANNELS.MODS_LIST, async (_event, instanceId: string) => {
    return contentManager.listMods(instanceId);
  });

  ipcMain.handle(IPC_CHANNELS.CONTENT_LIST_INSTALLED_PROJECTS, async (_event, { instanceId, projectType, candidateProjectIds }) => {
    return contentManager.listInstalledProjectIds(instanceId, projectType, candidateProjectIds);
  });

  ipcMain.handle(IPC_CHANNELS.MODS_TOGGLE, async (_event, { instanceId, fileName }) => {
    return contentManager.toggleMod(instanceId, fileName);
  });

  ipcMain.handle(IPC_CHANNELS.MODS_REMOVE, async (_event, { instanceId, fileName }) => {
    return contentManager.removeMod(instanceId, fileName);
  });

  ipcMain.handle(IPC_CHANNELS.RESOURCEPACKS_LIST, async (_event, instanceId: string) => {
    return contentManager.listResourcePacks(instanceId);
  });

  ipcMain.handle(IPC_CHANNELS.RESOURCEPACKS_REMOVE, async (_event, { instanceId, fileName }) => {
    return contentManager.removeResourcePack(instanceId, fileName);
  });

  ipcMain.handle(IPC_CHANNELS.SHADERS_LIST, async (_event, instanceId: string) => {
    return contentManager.listShaderPacks(instanceId);
  });

  ipcMain.handle(IPC_CHANNELS.SHADERS_REMOVE, async (_event, { instanceId, fileName }) => {
    return contentManager.removeShaderPack(instanceId, fileName);
  });

  ipcMain.handle(IPC_CHANNELS.MODPACKS_INSTALL, async (_event, { mrpackPath, instanceId }) => {
    return contentManager.installMrpack(mrpackPath, instanceId);
  });

  // ============================ REMOTE MANAGEMENT ============================

  ipcMain.handle(IPC_CHANNELS.REMOTE_GET_MANIFEST, async () => {
    return remoteConfigService.fetchManifest();
  });

  ipcMain.handle(IPC_CHANNELS.REMOTE_GET_CLIENT_ID, async () => {
    const { getClientIdentityService } = await import('../remote/clientIdentityService.ts');
    return getClientIdentityService().getClientId();
  });

  ipcMain.handle(IPC_CHANNELS.REMOTE_TEST_CONNECTION, async (_event, url?: string) => {
    return remoteConfigService.testConnection(url);
  });

  ipcMain.handle(IPC_CHANNELS.REMOTE_FORCE_SYNC, async () => {
    return remoteConfigService.fetchManifest(true);
  });

  ipcMain.handle(IPC_CHANNELS.REMOTE_GET_ONLINE_PROFILES, async () => {
    return remoteConfigService.getOnlineProfiles();
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK_FOR_UPDATES, async () => {
    return updateService.checkForUpdates();
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_DOWNLOAD_UPDATE, async (_event, force = false) => {
    return updateService.downloadUpdateIfNeeded(Boolean(force));
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_OPEN_DOWNLOADED, async () => {
    return updateService.openDownloadedUpdate();
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_INSTALL_DOWNLOADED, async () => {
    return updateService.installLatestDownloadedUpdate();
  });

  // ============================ SETTINGS ============================

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    return settingsStorage.getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, partial: any) => {
    const launcher = partial?.launcher && typeof partial.launcher === 'object'
      ? (({ discordClientId: _ignored, ...safeLauncher }) => ({ ...safeLauncher, autoInstallUpdates: false }))(partial.launcher)
      : undefined;
    const safePartial = {
      ...partial,
      ...(launcher ? { launcher } : {}),
      ...(partial?.remote && typeof partial.remote === 'object' ? { remote: {
        ...partial.remote,
        shareAccountUsage: true,
        shareOnlinePresence: true,
        privacyDefaultsVersion: 2
      } } : {})
    };
    const updated = settingsStorage.updateSettings(safePartial);
    if (partial?.remote) {
      getCosmeticsSyncService().scheduleSync();
      const { getHeartbeatService } = await import('../remote/heartbeatService.ts');
      getHeartbeatService().sendHeartbeat().catch(() => {});
    }
    if (partial?.launcher?.richPresenceEnabled !== undefined) {
      getRichPresenceService().refreshConfiguration();
    }
    return updated;
  });

  // ============================ SYSTEM ============================

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, async (_event, targetUrl: string) => {
    const parsed = new URL(String(targetUrl || '').trim());
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP and HTTPS links can be opened externally.');
    }
    await shell.openExternal(parsed.toString());
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_INFO, async () => {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const totalMb = Math.round(totalBytes / (1024 * 1024));
    const freeMb = Math.round(freeBytes / (1024 * 1024));
    const recommendedMb = Math.min(Math.max(Math.round(totalMb / 2), 2048), 8192);
    return {
      productName: PRODUCT_NAME,
      version: PRODUCT_VERSION,
      platform: process.platform,
      arch: process.arch,
      osVersion: os.release(),
      totalMemoryBytes: totalBytes,
      freeMemoryBytes: freeBytes,
      totalMemoryMb: totalMb,
      freeMemoryMb: freeMb,
      recommendedMemoryMb: recommendedMb,
      cpuModel: os.cpus()[0]?.model || 'Processor',
      cpuCores: os.cpus().length
    };
  });
}
