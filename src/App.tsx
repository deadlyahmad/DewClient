import React, { useState, useEffect } from 'react';
import { Sidebar, type ViewType } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { HomeView } from './views/HomeView.tsx';
import { PlayView } from './views/PlayView.tsx';
import { InstancesView } from './views/InstancesView.tsx';
import { VersionsView } from './views/VersionsView.tsx';
import { ModsView } from './views/ModsView.tsx';
import { ModrinthView } from './views/ModrinthView.tsx';
import { AccountsView } from './views/AccountsView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { SupportView } from './views/SupportView.tsx';
import { ErrorView, type UserFacingError } from './views/ErrorView.tsx';
import { StartupLoadingView } from './views/StartupLoadingView.tsx';
import { LoginView } from './views/StartupAuthView.tsx';
import { IntroView } from './views/IntroView.tsx';
import { CURRENT_JAVA_RUNTIME_MAJOR } from '../shared/constants/versions.ts';
import type { InstanceWithStats } from '../shared/types/instance.ts';
import type { UserAccount } from '../shared/types/account.ts';
import type { DownloadProgress } from '../shared/types/download.ts';
import type { RemoteMaintenanceConfig } from '../shared/types/remote.ts';
import { getUserFacingErrorMessage } from './utils/userFacingError.ts';

const CosmeticsView = React.lazy(() => import('./views/CosmeticsView.tsx').then((module) => ({ default: module.CosmeticsView })));

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [instances, setInstances] = useState<InstanceWithStats[]>([]);
  const [activeInstance, setActiveInstance] = useState<InstanceWithStats | null>(null);
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [activeAccount, setActiveAccount] = useState<UserAccount | null>(null);
  const [currentTheme, setCurrentTheme] = useState<'black' | 'white'>('black');
  const [savedTheme, setSavedTheme] = useState<'black' | 'white'>('black');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [bootPhase, setBootPhase] = useState<'loading' | 'login' | 'intro' | 'ready'>('loading');
  const [hasCompletedIntro, setHasCompletedIntro] = useState(false);
  const [javaStatus, setJavaStatus] = useState<'preparing' | 'ready' | 'failed'>('preparing');
  const [remoteMaintenance, setRemoteMaintenance] = useState<RemoteMaintenanceConfig | null>(null);
  const [activeError, setActiveError] = useState<UserFacingError | null>(null);
  const [pendingCapeClaimAssetId, setPendingCapeClaimAssetId] = useState<string | null>(null);

  const showErrorPage = (title: string, message: string) => {
    const reference = globalThis.crypto?.randomUUID?.().slice(0, 8).toUpperCase()
      || Math.random().toString(36).slice(2, 10).toUpperCase();
    setActiveError({ reference, title, message });
    setCurrentView('error');
  };

  useEffect(() => {
    const onWindowError = () => showErrorPage('DewClient hit a problem', 'The interface could not finish that action. Your private account and game data were not attached to an error report.');
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      showErrorPage('DewClient hit a problem', 'An operation did not finish. Try again, or send a report without attaching logs or account data.');
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    const refreshMaintenance = async () => {
      const remote = window.dewclient?.remote;
      if (!remote?.getManifest) return;
      const manifest = await remote.getManifest().catch(() => null);
      if (manifest?.maintenance) setRemoteMaintenance(manifest.maintenance);
    };

    void refreshMaintenance();
    const timer = window.setInterval(refreshMaintenance, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Launch & Process State
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [launchStatus, setLaunchStatus] = useState<{
    status: 'idle' | 'preparing' | 'downloading' | 'launching' | 'running' | 'crashed' | 'install-error' | 'finished';
    pid?: number;
    exitCode?: number;
    error?: string;
    message?: string;
  }>({ status: 'idle' });
  const [installProgress, setInstallProgress] = useState<any | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [crashReport, setCrashReport] = useState<any | null>(null);

  // Sync theme attribute to document element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
  }, [currentTheme]);

  useEffect(() => {
    checkIfInstalled(activeInstance);
  }, [activeInstance]);

  const checkIfInstalled = async (inst: InstanceWithStats | null) => {
    if (!inst || !window.dewclient?.minecraft?.isInstalled) {
      setIsInstalled(false);
      return;
    }
    try {
      const res = await window.dewclient.minecraft.isInstalled(inst.minecraftVersion || inst.id);
      setIsInstalled(Boolean(res));
    } catch {
      setIsInstalled(false);
    }
  };

  useEffect(() => {
    initApp();
    const cleanupListeners = setupListeners();
    return cleanupListeners;
  }, []);

  const initApp = async () => {
    if (!window.dewclient) {
      setBootPhase('ready');
      return;
    }

    try {
      // 0. Load launcher settings and theme
      const settings = await window.dewclient.settings.get().catch(() => null);
      if (settings?.general?.theme === 'white' || settings?.general?.theme === 'black') {
        setCurrentTheme(settings.general.theme);
        setSavedTheme(settings.general.theme);
      }
      const introComplete = Boolean(settings?.general?.hasCompletedIntro);
      setHasCompletedIntro(introComplete);

      // Provision the managed runtime in the background while the user signs in.
      window.dewclient.runtime?.downloadRuntime(CURRENT_JAVA_RUNTIME_MAJOR)
        .then(() => setJavaStatus('ready'))
        .catch(() => setJavaStatus('failed'));

      // 1. Load accounts
      const accList = await window.dewclient.auth.getAccounts().catch(() => []);
      setAccounts(accList || []);
      const activeAcc = await window.dewclient.auth.getActiveAccount().catch(() => null);
      setActiveAccount(activeAcc);

      // 2. Load instances
      await reloadInstances();
      setBootPhase(activeAcc ? (introComplete ? 'ready' : 'intro') : 'login');
    } catch (err) {
      console.error('[App] Init failed:', err);
      setBootPhase('login');
    }
  };

  const handleToggleTheme = async (themeOverride?: 'black' | 'white') => {
    const nextTheme = themeOverride || (currentTheme === 'black' ? 'white' : 'black');
    setCurrentTheme(nextTheme);
    if (window.dewclient?.settings) {
      const updated = await window.dewclient.settings.update({
        general: { theme: nextTheme }
      }).catch(() => null);
      if (updated) setSavedTheme(nextTheme);
    }
  };

  const navigateToView = (view: ViewType): boolean => {
    if (currentView === 'settings' && view !== 'settings' && settingsDirty) {
      const shouldDiscard = window.confirm('You have unsaved settings. Leave Settings and discard these changes?');
      if (!shouldDiscard) return false;
      setCurrentTheme(savedTheme);
      setSettingsDirty(false);
    }
    setCurrentView(view);
    return true;
  };

  const reloadInstances = async () => {
    if (!window.dewclient) return;
    try {
      const [instList, persistedActive] = await Promise.all([
        window.dewclient.instances.list().catch(() => []),
        window.dewclient.instances.getActive().catch(() => null)
      ]);
      setInstances(instList || []);

      if (instList && instList.length > 0) {
        setActiveInstance((prev) => {
          const selectedId = persistedActive?.id || prev?.id;
          return instList.find((instance) => instance.id === selectedId) || instList[0];
        });
      } else {
        setActiveInstance(null);
      }
    } catch (err) {
      console.error('[App] Failed to reload instances:', err);
    }
  };

  const setupListeners = () => {
    if (!window.dewclient?.events) return () => {};

    const cleanup: Array<() => void> = [];

    // Launch status listener
    cleanup.push(window.dewclient.events.onLaunchStatus((data: any) => {
      const statusVal = data.status || data.state;
      const mappedStatus = statusVal === 'error' ? 'crashed' : statusVal;
      setLaunchStatus({
        status: mappedStatus,
        pid: data.pid,
        exitCode: data.exitCode,
        error: data.message
      });

      if (mappedStatus === 'running') {
        setIsRunning(true);
        setIsDownloading(false);
      } else if (mappedStatus === 'downloading') {
        setIsDownloading(true);
      } else if (mappedStatus === 'finished' || mappedStatus === 'idle') {
        setIsRunning(false);
        setIsDownloading(false);
      } else if (mappedStatus === 'crashed') {
        setIsRunning(false);
        setIsDownloading(false);
        const diagnostic = data.crashReport || data.diagnosticError;
        setCrashReport(diagnostic || null);
        const allowedTitle = typeof diagnostic?.title === 'string' ? diagnostic.title.slice(0, 80) : 'Minecraft could not start';
        const allowedMessage = typeof diagnostic?.message === 'string' ? diagnostic.message.slice(0, 360) : 'Minecraft exited before it was ready. Check the selected Java runtime and instance files.';
        showErrorPage(allowedTitle, allowedMessage);
      }
    }));

    // Download/Install progress listener
    cleanup.push(window.dewclient.events.onInstallProgress((progress: any) => {
      setInstallProgress(progress);
    }));

    // Real-time game log listener
    cleanup.push(window.dewclient.events.onGameLog((logLine: any) => {
      const message = typeof logLine === 'string'
        ? logLine
        : typeof logLine?.message === 'string'
          ? logLine.message
          : String(logLine ?? '');
      const batch = message.split(/\r?\n/).filter(Boolean).slice(-400);
      setLogs((prev) => [...prev, ...batch].slice(-400));
    }));

    return () => cleanup.forEach((removeListener) => removeListener());
  };

  // Download & Installation Handler
  const handleDownloadGame = async (targetId?: string) => {
    const instId = targetId || activeInstance?.id;
    if (!instId) {
      alert('Please select or create an instance first.');
      return;
    }
    const inst = instances.find((i) => i.id === instId) || activeInstance;
    if (!inst) return;

    if (!navigateToView('play')) return;
    setIsDownloading(true);
    setInstallProgress(null);
    setCrashReport(null);
    setLaunchStatus({
      status: 'downloading',
      message: `Downloading Minecraft ${inst.minecraftVersion}...`
    });
    setActiveError(null);
    setLogs((prev) => [
      ...prev,
      `[DEWCLIENT] Checking required files for Minecraft ${inst.minecraftVersion} (Instance: ${inst.name})...`,
      `[DEWCLIENT] Connecting to official Mojang CDN for client jar, libraries, and assets...`
    ]);

    try {
      await window.dewclient.minecraft.installVersion(inst.minecraftVersion, inst.id);
      setIsInstalled(true);
      setIsDownloading(false);
      setLaunchStatus({ status: 'idle' });
      setLogs((prev) => [
        ...prev,
        `[DEWCLIENT] Minecraft ${inst.minecraftVersion} downloaded and verified successfully!`,
        `[DEWCLIENT] Ready to play. Click 'Launch Game' to start playing.`
      ]);
    } catch (err: any) {
      setIsDownloading(false);
      setInstallProgress(null);
      setLaunchStatus({ status: 'install-error', error: 'Minecraft files could not be downloaded.' });
      setLogs((prev) => [...prev, '[ERROR] Minecraft files could not be downloaded.'].slice(-400));
      showErrorPage('Minecraft download failed', 'The required game files could not be verified or downloaded. Check your connection and try again.');
    }
  };

  // Launch & Stop Handlers
  const handleLaunch = async (targetId?: string) => {
    if (remoteMaintenance?.enabled && remoteMaintenance.mode === 'hard') {
      alert(`${remoteMaintenance.title || 'DewClient is under maintenance'}\n\n${remoteMaintenance.message || 'Game launches are temporarily unavailable.'}`);
      return;
    }

    const instId = targetId || activeInstance?.id;
    if (!instId) {
      alert('Please select or create an instance first.');
      return;
    }

    // If game version is not installed yet, start download sequence first!
    if (!isInstalled) {
      await handleDownloadGame(instId);
      return;
    }

    if (!activeAccount) {
      navigateToView('accounts');
      alert('Please select or create a player profile before launching.');
      return;
    }

    // Switch to game console view
    if (!navigateToView('play')) return;
    setLogs((prev) => [...prev, `[DEWCLIENT] Preparing to launch instance: ${instId}...`]);
    setActiveError(null);
    setCrashReport(null);
    setLaunchStatus({ status: 'preparing' });

    try {
      await window.dewclient.minecraft.launch({
        instanceId: instId
      });
    } catch (err: any) {
      setLogs((prev) => [...prev, '[DEWCLIENT] Minecraft could not be started.'].slice(-400));
      setLaunchStatus({ status: 'crashed', error: 'Minecraft could not be started.' });
      setIsRunning(false);
      showErrorPage('Minecraft could not start', 'DewClient could not start the game process. Check the selected Java runtime and instance files, then try again.');
    } finally {
      await reloadInstances();
    }
  };

  const handleStop = async () => {
    if (!activeInstance?.id) {
      alert('No active Minecraft instance is selected.');
      return;
    }

    try {
      const stopped = await window.dewclient.minecraft.stop(activeInstance.id);
      if (!stopped) {
        throw new Error('Minecraft is not running for the selected instance.');
      }
      setIsRunning(false);
      setLaunchStatus({ status: 'idle' });
      setLogs((prev) => [...prev, `[DEWCLIENT] Minecraft process closed by user.`]);
    } catch (err: any) {
      alert(getUserFacingErrorMessage(err, 'Could not stop the game.'));
    }
  };

  // Instance Actions
  const handleSelectInstance = async (id: string) => {
    const target = instances.find((i) => i.id === id);
    if (!target || !window.dewclient) return;
    try {
      const selected = await window.dewclient.instances.select(id);
      setActiveInstance(selected || target);
    } catch (error: any) {
      alert(getUserFacingErrorMessage(error, 'Could not select this instance.'));
    }
  };

  const handleCreateInstance = async (data: { name: string; minecraftVersion: string; loader: 'fabric'; loaderVersion?: string }) => {
    if (!window.dewclient) return;
    const created = await window.dewclient.instances.create({
      name: data.name,
      minecraftVersion: data.minecraftVersion,
      loaderType: 'fabric',
      loaderVersion: data.loaderVersion
    });
    await window.dewclient.instances.select(created.id);
    await reloadInstances();
  };

  const handleDuplicateInstance = async (id: string) => {
    if (!window.dewclient) return;
    await window.dewclient.instances.duplicate(id, `${activeInstance?.name || 'Instance'} (Copy)`);
    await reloadInstances();
  };

  const handleExportInstance = async (id: string) => {
    const archivePath = await window.dewclient?.instances.export(id);
    if (archivePath) alert(`Instance exported to ${archivePath}`);
  };

  const handleImportInstance = async () => {
    const imported = await window.dewclient?.instances.import();
    if (imported) await reloadInstances();
  };

  const handleDeleteInstance = async (id: string) => {
    if (!window.dewclient) return;
    if (!confirm('Are you sure you want to delete this game instance? Local world saves in this instance folder will be removed.')) return;
    await window.dewclient.instances.delete(id);
    await reloadInstances();
  };

  const handleRepairInstance = async (id: string) => {
    if (!window.dewclient) return;
    if (!navigateToView('play')) return;
    setLogs((prev) => [...prev, `[DEWCLIENT] Verifying game assets and libraries for ${id}...`]);
    try {
      await window.dewclient.minecraft.repair(id);
      setLogs((prev) => [...prev, `[DEWCLIENT] Verification complete. All files validated.`]);
    } catch (err: any) {
      setLogs((prev) => [...prev, '[DEWCLIENT] Instance verification could not finish.'].slice(-400));
      showErrorPage('Instance verification failed', 'DewClient could not verify every game file. Try repairing this instance again.');
    }
  };

  const handleOpenFolder = (id: string) => {
    window.dewclient?.instances.openFolder(id);
  };

  // Account Handlers
  const handleSelectAccount = async (uuid: string) => {
    const acc = accounts.find((a) => a.uuid === uuid);
    if (acc && window.dewclient) {
      await window.dewclient.auth.setActiveAccount(uuid);
      setActiveAccount(acc);
    }
  };

  const handleRemoveAccount = async (uuid: string) => {
    if (!confirm('Are you sure you want to remove this profile from DewClient?')) return;
    if (window.dewclient) {
      await window.dewclient.auth.removeAccount(uuid);
      const updated = await window.dewclient.auth.getAccounts();
      setAccounts(updated || []);
      if (activeAccount?.uuid === uuid) {
        setActiveAccount(updated && updated[0] ? updated[0] : null);
      }
    }
  };

  const handleLogout = async () => {
    if (window.dewclient) {
      await window.dewclient.auth.setActiveAccount('');
      setActiveAccount(null);
      setBootPhase('login');
    }
  };

  const handleAddOfflineProfile = async (username: string) => {
    if (!window.dewclient) return;
    const created = await window.dewclient.auth.createOfflineProfile(username.trim());
    const updated = await window.dewclient.auth.getAccounts();
    setAccounts(updated || []);
    if (created) {
      await window.dewclient.auth.setActiveAccount(created.uuid || created.id);
      setActiveAccount(created);
      setBootPhase(hasCompletedIntro ? 'ready' : 'intro');
    }
  };

  const handleMicrosoftLogin = async () => {
    if (window.dewclient) {
      const authFn = (window.dewclient.auth as any).loginMicrosoft || window.dewclient.auth.startMicrosoft;
      if (typeof authFn !== 'function') {
        throw new Error('Authentication method not available on client interface.');
      }
      const account = await authFn();
      const updated = await window.dewclient.auth.getAccounts();
      setAccounts(updated || []);
      setActiveAccount(account);
      setBootPhase(hasCompletedIntro ? 'ready' : 'intro');
    }
  };

  const activateAuthenticatedProfile = async (account: UserAccount) => {
    if (!window.dewclient) return;
    const updated = await window.dewclient.auth.getAccounts();
    setAccounts(updated || []);
    setActiveAccount(account);
    setBootPhase(hasCompletedIntro ? 'ready' : 'intro');
  };

  const handleDiscordStart = () => {
    if (!window.dewclient) throw new Error('DewClient is not ready.');
    return window.dewclient.auth.startDiscordLogin();
  };

  const handleDiscordComplete = async (input: { ticket: string; username?: string }) => {
    if (!window.dewclient) throw new Error('DewClient is not ready.');
    const result = await window.dewclient.auth.completeDiscordLogin(input);
    if (result.account) await activateAuthenticatedProfile(result.account);
    return result;
  };

  const handleUpdateAccount = async (id: string, partial: any) => {
    if (!window.dewclient) return;
    const updated = await window.dewclient.auth.updateAccount(id, partial);
    if (!updated) return;
    setAccounts((current) => current.map((account) => account.id === updated.id ? updated : account));
    setActiveAccount((current) => current?.id === updated.id ? updated : current);
  };

  const handleChangeUsername = async (accountId: string, username: string) => {
    if (!window.dewclient) throw new Error('DewClient is not ready.');
    const updated = await window.dewclient.auth.changeUsername({ accountId, username });
    setAccounts((current) => current.map((account) => account.id === updated.id ? updated : account));
    setActiveAccount((current) => current?.id === updated.id ? updated : current);
  };

  const handleCompleteIntro = async () => {
    setHasCompletedIntro(true);
    setBootPhase('ready');
    await window.dewclient?.settings.update({ general: { hasCompletedIntro: true } }).catch(() => {});
  };

  const handleInstallVersion = async (versionId: string) => {
    await handleCreateInstance({
      name: `Minecraft ${versionId}`,
      minecraftVersion: versionId,
      loader: 'fabric'
    });
    navigateToView('instances');
  };

  if (bootPhase === 'loading') {
    return <StartupLoadingView message="Loading accounts, instances, and runtime" />;
  }

  if (bootPhase === 'login') {
    return (
      <LoginView
        currentTheme={currentTheme}
        onSelectTheme={handleToggleTheme}
        onMicrosoftLogin={handleMicrosoftLogin}
        onDiscordStart={handleDiscordStart}
        onDiscordComplete={handleDiscordComplete}
        onAddOfflineProfile={handleAddOfflineProfile}
      />
    );
  }

  if (bootPhase === 'intro' && activeAccount) {
    return <IntroView username={activeAccount.username} javaReady={javaStatus === 'ready'} onContinue={handleCompleteIntro} />;
  }

  return (
    <div className="app-container">
      {/* Atmospheric Ambient Visual Backdrop */}
      <div className="app-backdrop" />

      {/* Primary Sidebar Navigation */}
      <Sidebar
        currentView={currentView}
        onSelectView={navigateToView}
        activeInstance={activeInstance}
        activeAccount={activeAccount}
        isRunning={isRunning}
      />

      {/* Main Content Area */}
      <div className="main-content">
        {/* Top Header */}
        <Header
          currentView={currentView}
          activeInstance={activeInstance}
          activeAccount={activeAccount}
          isRunning={isRunning}
          isInstalled={isInstalled}
          isDownloading={isDownloading}
          currentTheme={currentTheme}
          onToggleTheme={() => handleToggleTheme()}
          onLaunch={() => handleLaunch()}
          onDownload={() => handleDownloadGame()}
          onStop={handleStop}
          onNavigateToAccounts={() => navigateToView('accounts')}
          onNavigateToInstances={() => navigateToView('instances')}
          onLogout={handleLogout}
          onUpdateAccount={handleUpdateAccount}
        />

        {/* View Viewport */}
        <main className="view-viewport">
          {currentView === 'home' && (
            <HomeView
              activeInstance={activeInstance}
              activeAccount={activeAccount}
              isRunning={isRunning}
              isInstalled={isInstalled}
              isDownloading={isDownloading}
              maintenance={remoteMaintenance}
              onLaunch={() => handleLaunch()}
              onDownload={() => handleDownloadGame()}
              onNavigate={navigateToView}
            />
          )}

          {currentView === 'play' && (
            <PlayView
              activeInstance={activeInstance}
              isRunning={isRunning}
              isInstalled={isInstalled}
              isDownloading={isDownloading}
              launchStatus={launchStatus}
              installProgress={installProgress}
              logs={logs}
              crashReport={crashReport}
              onLaunch={() => handleLaunch()}
              onDownload={() => handleDownloadGame()}
              onStop={handleStop}
              onClearLogs={() => setLogs([])}
            />
          )}

          {currentView === 'instances' && (
            <InstancesView
              instances={instances}
              activeInstance={activeInstance}
              isInstalled={isInstalled}
              onSelectInstance={handleSelectInstance}
              onLaunchInstance={(id) => handleLaunch(id)}
              onDownloadInstance={(id) => handleDownloadGame(id)}
              onCreateInstance={handleCreateInstance}
              onDuplicateInstance={handleDuplicateInstance}
              onDeleteInstance={handleDeleteInstance}
              onRepairInstance={handleRepairInstance}
              onExportInstance={handleExportInstance}
              onImportInstance={handleImportInstance}
              onOpenFolder={handleOpenFolder}
            />
          )}

          {currentView === 'versions' && (
            <VersionsView onInstallVersion={handleInstallVersion} />
          )}

          {currentView === 'mods' && (
            <ModsView
              activeInstance={activeInstance}
              onNavigateToModrinth={() => navigateToView('modrinth')}
              onOpenFolder={handleOpenFolder}
              onRefreshInstances={reloadInstances}
            />
          )}

          {currentView === 'modrinth' && (
            <ModrinthView
              activeInstance={activeInstance}
              onRefreshInstances={reloadInstances}
            />
          )}

          {currentView === 'accounts' && (
            <AccountsView
              accounts={accounts}
              activeAccount={activeAccount}
              onSelectAccount={handleSelectAccount}
              onRemoveAccount={handleRemoveAccount}
              onAddOfflineProfile={handleAddOfflineProfile}
              onMicrosoftLogin={handleMicrosoftLogin}
              onDiscordStart={handleDiscordStart}
              onDiscordComplete={handleDiscordComplete}
              onChangeUsername={handleChangeUsername}
            />
          )}

          {currentView === 'cosmetics' && (
            <React.Suspense fallback={<div className="cosmetics-studio-empty">Loading 3D cosmetics preview…</div>}>
              <CosmeticsView activeAccount={activeAccount} onUpdateAccount={handleUpdateAccount} onClaimCape={(assetId) => {
                if (navigateToView('settings')) setPendingCapeClaimAssetId(assetId);
              }} />
            </React.Suspense>
          )}

          {currentView === 'settings' && (
            <SettingsView
              activeAccount={activeAccount}
              pendingCapeClaimAssetId={pendingCapeClaimAssetId}
              onCapeClaimComplete={() => {
                setPendingCapeClaimAssetId(null);
                setCurrentView('cosmetics');
              }}
              currentTheme={currentTheme}
              onSelectTheme={(theme) => setCurrentTheme(theme)}
              onDirtyChange={setSettingsDirty}
              onSaved={() => setSavedTheme(currentTheme)}
              onOpenDataDir={() => {
                if (window.dewclient?.system?.openDataDir) {
                  window.dewclient.system.openDataDir();
                } else {
                  window.dewclient?.instances.openFolder('');
                }
              }}
            />
          )}

          {currentView === 'support' && (
            <SupportView minecraftVersion={activeInstance?.minecraftVersion || null} />
          )}

          {currentView === 'error' && activeError && (
            <ErrorView
              error={activeError}
              onRetry={() => { setActiveError(null); setCurrentView('play'); void handleLaunch(); }}
              onReport={() => setCurrentView('support')}
              onDismiss={() => setCurrentView('home')}
            />
          )}
        </main>
      </div>
    </div>
  );
};
