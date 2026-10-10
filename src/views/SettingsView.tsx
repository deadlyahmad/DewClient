import React, { useState, useEffect } from 'react';
import {
  Palette,
  Cpu,
  FolderOpen,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Layers,
  Sparkles,
  Sun,
  Moon,
  Check,
  Monitor,
  Sliders,
  Save,
  RotateCcw,
  LoaderCircle,
  Download,
  Database,
  Trash2,
  ShieldCheck,
  UserRound,
  Copy,
  ExternalLink,
  Link2
} from 'lucide-react';
import type { JavaInstallation } from '../../shared/types/runtime.ts';
import type { UserAccount } from '../../shared/types/account.ts';
import { DEFAULT_JVM_ARGS } from '../../shared/constants/defaults.ts';
import { PRODUCT_VERSION } from '../../shared/constants/versions.ts';
import { getUserFacingErrorMessage } from '../utils/userFacingError.ts';

function formatUpdateSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

interface SettingsViewProps {
  activeAccount: UserAccount | null;
  pendingCapeClaimAssetId: string | null;
  onCapeClaimComplete: () => void;
  currentTheme: 'black' | 'white';
  onSelectTheme: (theme: 'black' | 'white') => void;
  onDirtyChange: (isDirty: boolean) => void;
  onSaved: () => void;
  onOpenDataDir: () => void;
}

interface SystemInfo {
  productName: string;
  version: string;
  platform: string;
  arch: string;
  osVersion: string;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  totalMemoryMb: number;
  freeMemoryMb: number;
  recommendedMemoryMb: number;
  cpuModel?: string;
  cpuCores?: number;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  activeAccount,
  pendingCapeClaimAssetId,
  onCapeClaimComplete,
  currentTheme,
  onSelectTheme,
  onDirtyChange,
  onSaved,
  onOpenDataDir
}) => {
  const [activeTab, setActiveTab] = useState<'appearance' | 'memory' | 'java' | 'privacy' | 'data' | 'account'>('memory');
  const [capeClaimCode, setCapeClaimCode] = useState<{ words: string[]; expiresAt: string; discordInviteUrl: string; instruction: string } | null>(null);
  const [capeClaimName, setCapeClaimName] = useState('Free cape');
  const [capeClaimError, setCapeClaimError] = useState('');
  const [capeClaimMessage, setCapeClaimMessage] = useState('');
  const [discordLinked, setDiscordLinked] = useState(false);
  const [discordDisplayName, setDiscordDisplayName] = useState<string | null>(null);
  const [discordLinkLoading, setDiscordLinkLoading] = useState(false);
  const [isCreatingCapeClaimCode, setIsCreatingCapeClaimCode] = useState(false);
  const [copySucceeded, setCopySucceeded] = useState(false);
  const [claimClock, setClaimClock] = useState(Date.now());
  const [memoryMb, setMemoryMb] = useState<number>(4096);
  const [jvmArgs, setJvmArgs] = useState<string>(DEFAULT_JVM_ARGS.join(' '));
  const [resolutionWidth, setResolutionWidth] = useState<number>(1280);
  const [resolutionHeight, setResolutionHeight] = useState<number>(720);
  const [fullscreen, setFullscreen] = useState<boolean>(false);
  const [closeOnLaunch, setCloseOnLaunch] = useState<boolean>(false);
  const [richPresenceEnabled, setRichPresenceEnabled] = useState<boolean>(true);
  const [shareAccountUsage, setShareAccountUsage] = useState<boolean>(true);
  const [shareOnlinePresence, setShareOnlinePresence] = useState<boolean>(true);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<'checking' | 'up-to-date' | 'update-available' | 'downloading' | 'verifying' | 'downloaded' | 'installing' | 'error'>('checking');
  const [updateProgress, setUpdateProgress] = useState({ progressPercent: 0, downloadedBytes: 0, totalBytes: 0, message: '' });
  const [updateError, setUpdateError] = useState('');
  const [currentVersion, setCurrentVersion] = useState<string>(PRODUCT_VERSION);
  const [latestVersion, setLatestVersion] = useState<string>(PRODUCT_VERSION);
  const [updateUrl, setUpdateUrl] = useState<string>('');
  const [downloadedUpdatePath, setDownloadedUpdatePath] = useState<string>('');
  const [isResettingData, setIsResettingData] = useState(false);
  const [resetDataError, setResetDataError] = useState('');

  const [runtimes, setRuntimes] = useState<JavaInstallation[]>([]);
  const [loadingRuntimes, setLoadingRuntimes] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');

  const createSnapshot = (values = {
    memoryMb,
    jvmArgs,
    resolutionWidth,
    resolutionHeight,
    fullscreen,
    closeOnLaunch,
    richPresenceEnabled,
    shareAccountUsage,
    shareOnlinePresence,
    theme: currentTheme
  }) => JSON.stringify(values);

  const isDirty = savedSnapshot !== '' && savedSnapshot !== createSnapshot();

  useEffect(() => {
    if (!pendingCapeClaimAssetId) return;
    setActiveTab('account');
    setCapeClaimCode(null);
    setCapeClaimError('');
    setCapeClaimMessage('');
    void window.dewclient.auth.getFreeCapes(activeAccount?.id).then((result) => {
      const item = result.items.find((cape) => cape.assetId === pendingCapeClaimAssetId);
      if (item) setCapeClaimName(item.name);
    }).catch(() => {});
  }, [pendingCapeClaimAssetId, activeAccount?.id]);

  useEffect(() => {
    if (!activeAccount) {
      setDiscordLinked(false);
      setDiscordDisplayName(null);
      return;
    }
    let cancelled = false;
    setDiscordLinkLoading(true);
    void window.dewclient.auth.getDiscordCapeClaimStatus(activeAccount.id).then((status) => {
      if (!cancelled) {
        setDiscordLinked(status.discordLinked === true);
        setDiscordDisplayName(status.discordDisplayName || status.discordUsername || null);
      }
    }).catch(() => {
      if (!cancelled) setDiscordLinked(false);
    }).finally(() => {
      if (!cancelled) setDiscordLinkLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeAccount?.id]);

  const createCapeClaimCode = async () => {
    if (!activeAccount || isCreatingCapeClaimCode || discordLinked) return;
    setIsCreatingCapeClaimCode(true);
    setCapeClaimError('');
    setCapeClaimMessage('');
    setCopySucceeded(false);
    try {
      const code = await window.dewclient.auth.createDiscordCapeClaimCode(activeAccount.id, pendingCapeClaimAssetId || undefined);
      if (code.alreadyLinked) {
        setDiscordLinked(true);
        setCapeClaimMessage('Discord is already linked. Free capes can now be claimed instantly from Cosmetics.');
        return;
      }
      setCapeClaimCode(code);
      setCapeClaimMessage('Link code ready. It is shown only here and expires in 10 minutes. You only link this Discord account once.');
    } catch (error: any) {
      setCapeClaimError(getUserFacingErrorMessage(error, 'Could not create a Discord link code.'));
    } finally {
      setIsCreatingCapeClaimCode(false);
    }
  };

  const copyCapeClaimCode = async () => {
    if (!capeClaimCode) return;
    const value = capeClaimCode.words.join(' ');
    try {
      await navigator.clipboard.writeText(value);
      setCopySucceeded(true);
      setCapeClaimMessage('16-word code copied. Paste it into the Discord Link Account form.');
    } catch {
      setCapeClaimError('Clipboard access is unavailable. Select and copy the 16 words manually.');
    }
  };

  useEffect(() => {
    if (!capeClaimCode || !activeAccount) return;
    let stopped = false;
    let completed = false;
    const poll = async () => {
      if (stopped || completed || Date.parse(capeClaimCode.expiresAt) <= Date.now()) return;
      try {
        const status = await window.dewclient.auth.getDiscordCapeClaimStatus(activeAccount.id);
        if (!stopped && status.discordLinked) {
          setDiscordLinked(true);
          setDiscordDisplayName(status.discordDisplayName || status.discordUsername || null);
          if (pendingCapeClaimAssetId && status.claimedAssetIds.includes(pendingCapeClaimAssetId)) {
            completed = true;
            setCapeClaimMessage(`${capeClaimName} is claimed and added to your cape slots. Future free capes can be claimed with one click.`);
            window.setTimeout(() => { if (!stopped) onCapeClaimComplete(); }, 1800);
          } else if (!pendingCapeClaimAssetId) {
            completed = true;
            setCapeClaimMessage('Discord is linked. Future free capes can be claimed instantly from Cosmetics.');
          }
        }
      } catch {
        // A transient network issue is retried on the next poll; no credentials or codes are logged.
      }
    };
    void poll();
    const interval = window.setInterval(poll, 7000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [capeClaimCode, pendingCapeClaimAssetId, activeAccount?.id, capeClaimName, onCapeClaimComplete]);

  useEffect(() => {
    if (!capeClaimCode) return;
    const interval = window.setInterval(() => setClaimClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [capeClaimCode]);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    loadSettings();
    loadRuntimes();
    loadSystemInfo();
    void loadUpdateStatus();
  }, []);

  useEffect(() => {
    const unsubscribe = window.dewclient?.updater?.onDownloadProgress((progress) => {
      setUpdateProgress(progress);
      if (progress.status === 'preparing' || progress.status === 'downloading') setUpdateStatus('downloading');
      else if (progress.status === 'verifying') setUpdateStatus('verifying');
      else if (progress.status === 'complete') {
        setDownloadedUpdatePath(progress.filePath || '');
        setUpdateStatus('downloaded');
      } else if (progress.status === 'failed') {
        setUpdateError(progress.message || 'Update download failed.');
        setUpdateStatus('error');
      }
    });
    return () => unsubscribe?.();
  }, []);

  const loadSystemInfo = async () => {
    try {
      if (window.dewclient?.system) {
        const info = await window.dewclient.system.getInfo();
        if (info) {
          setSystemInfo(info);
        }
      }
    } catch (err) {
      console.warn('Failed to load system info:', err);
    }
  };

  const loadSettings = async () => {
    try {
      if (window.dewclient?.settings) {
        const s = await window.dewclient.settings.get();
        if (s) {
          const loadedMemoryMb = s.minecraft?.memoryMb ?? 4096;
          const args = s.minecraft?.defaultJvmArgs;
          const loadedJvmArgs = Array.isArray(args) ? args.join(' ') : (typeof args === 'string' ? args : DEFAULT_JVM_ARGS.join(' '));
          const loadedWidth = s.minecraft?.resolutionWidth || 1280;
          const loadedHeight = s.minecraft?.resolutionHeight || 720;
          const loadedFullscreen = s.minecraft?.fullscreen || false;
          const loadedCloseOnLaunch = s.launcher?.closeOnLaunch || false;
          const loadedRichPresenceEnabled = s.launcher?.richPresenceEnabled !== false;
          const loadedShareAccountUsage = true;
          const loadedShareOnlinePresence = true;
          setMemoryMb(loadedMemoryMb);
          setJvmArgs(loadedJvmArgs);
          setResolutionWidth(loadedWidth);
          setResolutionHeight(loadedHeight);
          setFullscreen(loadedFullscreen);
          setCloseOnLaunch(loadedCloseOnLaunch);
          setRichPresenceEnabled(loadedRichPresenceEnabled);
          setShareAccountUsage(loadedShareAccountUsage);
          setShareOnlinePresence(loadedShareOnlinePresence);
          setSavedSnapshot(createSnapshot({ memoryMb: loadedMemoryMb, jvmArgs: loadedJvmArgs, resolutionWidth: loadedWidth, resolutionHeight: loadedHeight, fullscreen: loadedFullscreen, closeOnLaunch: loadedCloseOnLaunch, richPresenceEnabled: loadedRichPresenceEnabled, shareAccountUsage: loadedShareAccountUsage, shareOnlinePresence: loadedShareOnlinePresence, theme: currentTheme }));
        } else {
          setSavedSnapshot(createSnapshot());
        }
      }
    } catch {
      setSavedSnapshot(createSnapshot());
    }
  };

  const loadRuntimes = async () => {
    setLoadingRuntimes(true);
    try {
      if (window.dewclient?.runtime) {
        const list = await window.dewclient.runtime.getInstalledRuntimes();
        setRuntimes(list || []);
      }
    } catch {
      setRuntimes([]);
    } finally {
      setLoadingRuntimes(false);
    }
  };

  const loadUpdateStatus = async () => {
    if (!window.dewclient?.updater) return;
    setUpdateStatus((current) => ['downloading', 'verifying', 'installing'].includes(current) ? current : 'checking');

    try {
      const result = await window.dewclient.updater.checkForUpdates();
      setCurrentVersion(result.currentVersion || PRODUCT_VERSION);
      setLatestVersion(result.latestVersion || PRODUCT_VERSION);
      setUpdateUrl(result.updateUrl || '');
      setUpdateError('');
      setUpdateStatus((current) => ['downloading', 'verifying', 'downloaded', 'installing'].includes(current)
        ? current
        : result.updateAvailable ? 'update-available' : 'up-to-date');
    } catch (error: any) {
      setUpdateError(getUserFacingErrorMessage(error, 'Unable to check the release manifest.'));
      setUpdateStatus('error');
    }
  };

  const handleDownloadUpdate = async () => {
    if (!window.dewclient?.updater) return;
    setUpdateError('');
    setUpdateProgress({ progressPercent: 0, downloadedBytes: 0, totalBytes: 0, message: 'Preparing secure update download…' });
    setUpdateStatus('downloading');
    try {
      const result = await window.dewclient.updater.downloadUpdate(false);
      if (result.filePath) {
        setDownloadedUpdatePath(result.filePath);
      }

      if (result.status === 'downloaded' && result.filePath) {
        setUpdateStatus('downloaded');
        setUpdateProgress((current) => ({ ...current, progressPercent: 100, message: 'Update verified and ready to install.' }));
      } else if (result.status === 'up-to-date') {
        setUpdateStatus('up-to-date');
      } else {
        setUpdateError(result.message || 'Update download failed.');
        setUpdateStatus('error');
      }
    } catch (error: any) {
      setUpdateError(getUserFacingErrorMessage(error, 'Update download failed.'));
      setUpdateStatus('error');
    }
  };

  const handleInstallDownloadedUpdate = async () => {
    setUpdateError('');
    setUpdateStatus('installing');
    try {
      const installed = await window.dewclient?.updater?.installDownloadedUpdate();
      if (!installed) throw new Error('The downloaded installer could not be started. Download and verify the update again.');
    } catch (error: any) {
      setUpdateError(getUserFacingErrorMessage(error, 'The installer could not be started.'));
      setUpdateStatus('error');
    }
  };

  const handleResetLauncherData = async () => {
    if (isResettingData || !window.confirm('Reset Launcher Data will close running Minecraft games, then permanently delete local DewClient profiles and sessions, instances, downloaded game files, mods, settings, and caches from this device. Your registered DewClient account will not be deleted, and the launcher application will stay installed. Continue?')) return;
    setResetDataError('');
    setIsResettingData(true);
    try {
      const reset = await window.dewclient?.system.resetLauncherData();
      if (!reset) throw new Error('The launcher data reset could not be started.');
    } catch (error: any) {
      setResetDataError(getUserFacingErrorMessage(error, 'Launcher data could not be reset.'));
      setIsResettingData(false);
    }
  };

  const handleSaveSettings = async () => {
    if (isSaving || !window.dewclient?.settings) return;
    const submittedSnapshot = createSnapshot();
    const saveStartedAt = Date.now();
    setIsSaving(true);
    try {
      await window.dewclient.settings.update({
        minecraft: {
          memoryMb,
          defaultJvmArgs: jvmArgs.split(' ').filter(Boolean),
          resolutionWidth,
          resolutionHeight,
          fullscreen
        },
        general: {
          theme: currentTheme
        },
        launcher: {
          closeOnLaunch,
          richPresenceEnabled
        },
        remote: {
          shareAccountUsage,
          shareOnlinePresence
        }
      });
      const remainingAnimationMs = Math.max(0, 1000 - (Date.now() - saveStartedAt));
      if (remainingAnimationMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingAnimationMs));
      }
      setSavedSnapshot(submittedSnapshot);
      setSaveSuccess(true);
      onSaved();
      window.setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(getUserFacingErrorMessage(err, 'Settings could not be saved.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscardSettings = () => {
    if (!savedSnapshot) return;
    const snapshot = JSON.parse(savedSnapshot);
    setMemoryMb(snapshot.memoryMb);
    setJvmArgs(snapshot.jvmArgs);
    setResolutionWidth(snapshot.resolutionWidth);
    setResolutionHeight(snapshot.resolutionHeight);
    setFullscreen(snapshot.fullscreen);
    setCloseOnLaunch(snapshot.closeOnLaunch);
    setRichPresenceEnabled(snapshot.richPresenceEnabled);
    setShareAccountUsage(snapshot.shareAccountUsage);
    setShareOnlinePresence(snapshot.shareOnlinePresence);
    onSelectTheme(snapshot.theme);
  };

  const systemTotalMb = systemInfo?.totalMemoryMb ?? 0;
  const recommendedMb = systemInfo?.recommendedMemoryMb ?? 0;

  const tabs = [
    { id: 'memory', label: 'Memory & Game', icon: Cpu },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'java', label: 'Java Runtimes', icon: Layers },
    { id: 'account', label: 'Account & Claims', icon: Link2 },
    { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
    { id: 'data', label: "Launcher's Data", icon: Database }
  ] as const;

  return (
    <div className="settings-view" style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '880px', margin: '0 auto' }}>
      {/* Top Header */}
      <div>
        <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
          Launcher Settings
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
          Configure hardware memory calculation, game performance, appearance, and core system parameters.
        </p>
      </div>

      {/* Settings Navigation Tabs */}
      <div className="settings-tabs" style={{
        display: 'flex',
        gap: '6px',
        background: 'var(--bg-surface)',
        padding: '6px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)'
      }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={`settings-tab${isActive ? ' is-active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 18px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: isActive ? 'var(--accent-primary)' : 'transparent',
                color: isActive ? 'var(--accent-primary-fg)' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Save Success Banner */}
      {saveSuccess && (
        <div style={{
          padding: '12px 18px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(16, 185, 129, 0.12)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          color: 'var(--accent-emerald)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          fontWeight: 600
        }}>
          <CheckCircle2 size={16} /> All settings saved and updated successfully.
        </div>
      )}

      {activeTab === 'account' && (
        <section className="card settings-discord-link-card">
          <div className="settings-discord-link-heading">
            <span className="settings-discord-link-icon"><Link2 size={20} /></span>
            <div>
              <h3>Link Discord once</h3>
              <p>Connect this verified Minecraft profile to one Discord account. After that, free capes are claimed instantly with one click.</p>
            </div>
          </div>
          {activeAccount ? (
            <div className="settings-discord-account">
              <span>Selected player</span>
              <strong>{activeAccount.username}</strong>
              <small>{activeAccount.type === 'microsoft' ? 'Microsoft account' : activeAccount.type === 'discord' ? 'Discord account' : activeAccount.accountType === 'dew' ? 'Dew account' : 'Offline profile'}</small>
            </div>
          ) : (
            <div className="settings-discord-notice">Sign in to Microsoft or Discord to use cape claims.</div>
          )}

          {pendingCapeClaimAssetId ? (
            <div className="settings-discord-claim-target">
              <span>Claiming</span><strong>{capeClaimName}</strong>
            </div>
          ) : (
            <div className="settings-discord-notice">Use this to link once now, or claim a free cape in Cosmetics and link as part of your first claim.</div>
          )}

          {discordLinked ? (
            <div className="settings-discord-status" role="status"><Check size={15} /><span><strong>{discordDisplayName ? `Linked Discord: ${discordDisplayName}` : 'Discord account linked'}</strong><br />This Discord account is linked to the selected Minecraft profile. New free capes can be claimed from Cosmetics with one click.</span></div>
          ) : discordLinkLoading ? (
            <div className="settings-discord-notice"><LoaderCircle size={14} className="animate-spin" /> Checking Discord link…</div>
          ) : !capeClaimCode || Date.parse(capeClaimCode.expiresAt) <= claimClock ? (
            <button type="button" className="btn btn-primary" onClick={() => void createCapeClaimCode()} disabled={!activeAccount || isCreatingCapeClaimCode}>
              {isCreatingCapeClaimCode ? <LoaderCircle size={15} className="animate-spin" /> : <Link2 size={15} />}
              {isCreatingCapeClaimCode ? 'Preparing secure code…' : capeClaimCode ? 'Generate a fresh link code' : 'Link Discord once'}
            </button>
          ) : (
            <>
              <div className="settings-discord-steps">
                <div><span>1</span><p>Copy these words and keep them private. This code expires at {new Date(capeClaimCode.expiresAt).toLocaleTimeString()} and is used only to link once.</p></div>
                <div><span>2</span><p>Open the DewClient Discord invite, press <strong>Link Account</strong> in the account-link channel, then paste the words into the private form.</p></div>
                <div><span>3</span><p>{pendingCapeClaimAssetId ? `Your first cape, ${capeClaimName}, will be claimed as soon as linking succeeds.` : 'After linking, all future free capes are claimed with one click in Cosmetics.'}</p></div>
              </div>
              <ol className="settings-discord-code" aria-label="One-time 16-word Discord link code">
                {capeClaimCode.words.map((word, index) => <li key={`${word}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><strong>{word}</strong></li>)}
              </ol>
              <div className="settings-discord-actions">
                <button type="button" className="btn btn-secondary" onClick={() => void copyCapeClaimCode()}><Copy size={15} />{copySucceeded ? 'Copied' : 'Copy all 16 words'}</button>
                <a className="btn btn-secondary" href={capeClaimCode.discordInviteUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open Discord</a>
                <button type="button" className="btn btn-secondary" onClick={() => void createCapeClaimCode()} disabled={isCreatingCapeClaimCode}>Replace code</button>
              </div>
            </>
          )}
          {capeClaimMessage && <div className="settings-discord-status" role="status" aria-live="polite"><Check size={15} />{capeClaimMessage}</div>}
          {capeClaimError && <div className="settings-discord-error" role="alert">{capeClaimError}</div>}
          <div className="settings-discord-privacy">DewClient stores only a one-way hash of the temporary link code. It does not store your Microsoft password or share your session token with Discord.</div>
        </section>
      )}

      {/* TAB 1: MEMORY & GAME */}
      {activeTab === 'memory' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Memory Allocation Card */}
          <div className="card">
            <div style={{ marginBottom: '18px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Global Memory Allocation (RAM)
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                This value is applied to the Minecraft JVM as -Xmx. There is no artificial product minimum or ceiling.
              </p>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>Quick Memory Presets</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setMemoryMb(4096)}
                  className={`btn ${memoryMb === 4096 ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  style={{ justifyContent: 'center' }}
                >
                  Balanced (4 GB)
                </button>
                <button
                  type="button"
                  onClick={() => setMemoryMb(recommendedMb || 4096)}
                  className={`btn ${memoryMb === (recommendedMb || 4096) ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  style={{ justifyContent: 'center' }}
                >
                  <Sparkles size={13} /> Recommended ({Math.round((recommendedMb || 4096) / 1024)} GB)
                </button>
                <button
                  type="button"
                  onClick={() => setMemoryMb(8192)}
                  className={`btn ${memoryMb === 8192 ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  style={{ justifyContent: 'center' }}
                >
                  High Performance (8 GB)
                </button>
                <button
                  type="button"
                  onClick={() => setMemoryMb(12288)}
                  className={`btn ${memoryMb === 12288 ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  style={{ justifyContent: 'center' }}
                >
                  Heavy Modpacks (12 GB)
                </button>
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label className="form-label" style={{ margin: 0 }}>
                  Java Heap Size: <strong style={{ color: 'var(--accent-primary)', fontSize: '15px' }}>{Math.round(memoryMb / 1024)} GB</strong> ({memoryMb} MB)
                </label>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  JVM flag: -Xmx{Math.round(memoryMb / 1024)}G
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={Math.max(1, systemTotalMb)}
                step={512}
                value={Math.min(memoryMb, Math.max(1, systemTotalMb))}
                disabled={!systemTotalMb}
                onChange={(e) => setMemoryMb(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: systemTotalMb ? 'pointer' : 'not-allowed' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                <span>Selected: {Math.round(memoryMb / 1024 * 10) / 10} GB</span>
                <span>System memory: {systemTotalMb ? `${Math.round(systemTotalMb / 1024 * 10) / 10} GB` : 'Unavailable'}</span>
              </div>
            </div>
          </div>

          {/* Game Window & Resolution Settings Card */}
          <div className="card">
            <div style={{ marginBottom: '18px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Game Display & Startup
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Default Minecraft window size, fullscreen state, and launch lifecycle.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '18px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Window Width (Pixels)</label>
                <input
                  type="number"
                  className="input-text"
                  value={resolutionWidth}
                  onChange={(e) => setResolutionWidth(Number(e.target.value))}
                  min={640}
                  max={7680}
                  step={40}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Window Height (Pixels)</label>
                <input
                  type="number"
                  className="input-text"
                  value={resolutionHeight}
                  onChange={(e) => setResolutionHeight(Number(e.target.value))}
                  min={480}
                  max={4320}
                  step={30}
                />
              </div>
            </div>

            {/* Quick Resolution Buttons */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <button
                type="button"
                onClick={() => { setResolutionWidth(1280); setResolutionHeight(720); }}
                className="btn btn-secondary btn-sm"
              >
                720p (1280x720)
              </button>
              <button
                type="button"
                onClick={() => { setResolutionWidth(1920); setResolutionHeight(1080); }}
                className="btn btn-secondary btn-sm"
              >
                1080p (1920x1080)
              </button>
              <button
                type="button"
                onClick={() => { setResolutionWidth(2560); setResolutionHeight(1440); }}
                className="btn btn-secondary btn-sm"
              >
                1440p (2560x1440)
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="checkbox"
                  id="fullscreenToggle"
                  checked={fullscreen}
                  onChange={(e) => setFullscreen(e.target.checked)}
                  style={{ accentColor: 'var(--accent-primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="fullscreenToggle" style={{ fontSize: '13px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                  Launch Minecraft in Fullscreen mode by default
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="checkbox"
                  id="closeOnLaunchToggle"
                  checked={closeOnLaunch}
                  onChange={(e) => setCloseOnLaunch(e.target.checked)}
                  style={{ accentColor: 'var(--accent-primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="closeOnLaunchToggle" style={{ fontSize: '13px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                  Hide launcher window automatically when Minecraft starts
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="checkbox"
                  id="richPresenceToggle"
                  checked={richPresenceEnabled}
                  onChange={(e) => setRichPresenceEnabled(e.target.checked)}
                  style={{ accentColor: 'var(--accent-primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="richPresenceToggle" style={{ fontSize: '13px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                  Show DewClient activity in Discord Rich Presence
                </label>
              </div>

            </div>
          </div>

          {/* Advanced Performance & JVM Arguments */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  JVM Optimization Flags
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Optimized G1GC garbage collection parameters tailored for smooth framerates and zero lag spikes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setJvmArgs(DEFAULT_JVM_ARGS.join(' '))}
                className="btn btn-secondary btn-sm"
              >
                Reset to Defaults
              </button>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <input
                type="text"
                className="input-text"
                value={jvmArgs}
                onChange={(e) => setJvmArgs(e.target.value)}
                placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
              />
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                Advanced flags injected directly into Java virtual machine execution string.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: APPEARANCE */}
      {activeTab === 'appearance' && (
        <div className="card">
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Launcher Appearance
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Choose your preferred visual theme for DewClient.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Visual Theme</label>
            <div className="settings-theme-grid">
              <button
                type="button"
                aria-pressed={currentTheme === 'black'}
                className={`settings-theme-option theme-black${currentTheme === 'black' ? ' is-selected' : ''}`}
                onClick={() => onSelectTheme('black')}
              >
                <span className="settings-theme-swatch" aria-hidden="true"><i /><i /><i /></span>
                <span className="settings-theme-copy"><strong><Moon size={15} /> Black</strong><small>Deep charcoal surfaces, bright text, and quiet borders.</small></span>
                {currentTheme === 'black' && <span className="settings-theme-check"><Check size={13} strokeWidth={3} /></span>}
              </button>
              <button
                type="button"
                aria-pressed={currentTheme === 'white'}
                className={`settings-theme-option theme-white${currentTheme === 'white' ? ' is-selected' : ''}`}
                onClick={() => onSelectTheme('white')}
              >
                <span className="settings-theme-swatch" aria-hidden="true"><i /><i /><i /></span>
                <span className="settings-theme-copy"><strong><Sun size={15} /> White</strong><small>Paper-light surfaces, dark text, and crisp dividers.</small></span>
                {currentTheme === 'white' && <span className="settings-theme-check"><Check size={13} strokeWidth={3} /></span>}
              </button>
            </div>
          </div>

          <div style={{ marginTop: '22px', padding: '18px 20px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  App Version & Updates
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                  Downloaded release information is fetched from the remote manifest and compared against your local launcher build.
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={loadUpdateStatus} disabled={['checking', 'downloading', 'verifying', 'installing'].includes(updateStatus)}>
                <RefreshCw size={14} className={['checking', 'downloading', 'verifying', 'installing'].includes(updateStatus) ? 'animate-spin' : ''} /> {updateStatus === 'checking' ? 'Checking...' : 'Check for updates'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '14px' }}>
              <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current</div>
                <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '6px' }}>{currentVersion}</div>
              </div>
              <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Latest</div>
                <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '6px' }}>{latestVersion}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <span className={`badge ${updateStatus === 'update-available' ? 'badge-amber' : updateStatus === 'up-to-date' ? 'badge-cyan' : updateStatus === 'downloaded' ? 'badge-emerald' : 'badge-amber'}`}>
                {updateStatus === 'checking' ? 'Checking...' : updateStatus === 'update-available' ? 'Update available' : updateStatus === 'downloading' ? 'Downloading' : updateStatus === 'verifying' ? 'Verifying' : updateStatus === 'downloaded' ? 'Ready to install' : updateStatus === 'installing' ? 'Installing' : updateStatus === 'up-to-date' ? 'Up to date' : updateStatus === 'error' ? 'Update failed' : 'Unknown'}
              </span>
              {updateUrl && (
                <a href={updateUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 600 }}>Release download</a>
              )}
            </div>

            {['update-available', 'downloading', 'verifying'].includes(updateStatus) && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  {updateStatus === 'update-available' ? `DewClient ${latestVersion} is available. Download it securely, then install and restart.` : updateProgress.message || 'Preparing update…'}
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleDownloadUpdate} disabled={['downloading', 'verifying'].includes(updateStatus)}>
                  <Download size={14} /> {updateStatus === 'downloading' ? 'Downloading…' : updateStatus === 'verifying' ? 'Verifying…' : 'Download update'}
                </button>
              </div>
            )}

            {['downloading', 'verifying'].includes(updateStatus) && (
              <div style={{ marginTop: '14px', padding: '13px 14px', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700 }}>{updateStatus === 'verifying' ? 'Verifying installer' : 'Downloading installer'}</span>
                  <span style={{ color: 'var(--text-primary)', fontSize: '12px', fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>{updateStatus === 'verifying' ? '100%' : `${updateProgress.progressPercent}%`}</span>
                </div>
                <div role="progressbar" aria-label="Update download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={updateStatus === 'verifying' ? 100 : updateProgress.progressPercent} style={{ height: '8px', overflow: 'hidden', borderRadius: '999px', background: 'var(--bg-surface-elevated)' }}>
                  <div style={{ width: `${updateStatus === 'verifying' ? 100 : updateProgress.progressPercent}%`, height: '100%', borderRadius: 'inherit', background: 'var(--accent-primary)', transition: 'width 160ms ease' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '7px', color: 'var(--text-muted)', fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
                  <span>{updateStatus === 'verifying' ? 'Checking file size and SHA-256…' : `${formatUpdateSize(updateProgress.downloadedBytes)} of ${formatUpdateSize(updateProgress.totalBytes)}`}</span>
                  <span>{updateStatus === 'verifying' ? 'Please wait' : 'Secure download'}</span>
                </div>
              </div>
            )}

            {updateStatus === 'downloaded' && downloadedUpdatePath && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  DewClient {latestVersion} downloaded and verified. Install it to restart into the updated launcher.
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleInstallDownloadedUpdate()}>
                  <Download size={14} /> Install & restart
                </button>
              </div>
            )}

            {updateStatus === 'installing' && (
              <div role="status" style={{ paddingTop: '10px', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '13px' }}>
                Starting the verified installer. DewClient will close and restart during installation…
              </div>
            )}

            {updateStatus === 'error' && (
              <div style={{ paddingTop: '10px', borderTop: '1px solid var(--border-subtle)', color: 'var(--accent-red)', fontSize: '13px' }}>
                {updateError || 'The update could not be completed. Check your connection and retry.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: JAVA RUNTIMES */}
      {activeTab === 'java' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Java Runtimes
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                DewClient isolates Java environments and automatically provisions compatible Adoptium OpenJDK runtimes.
              </p>
            </div>
            <button onClick={loadRuntimes} className="btn btn-secondary btn-sm" disabled={loadingRuntimes}>
              <RefreshCw size={14} className={loadingRuntimes ? 'animate-spin' : ''} /> Rescan for Java
            </button>
          </div>

          {loadingRuntimes ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px auto' }} />
              Scanning system and isolated runtimes directory...
            </div>
          ) : runtimes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              <AlertCircle size={28} style={{ margin: '0 auto 10px auto', color: 'var(--accent-amber)' }} />
              <div>No system-wide Java installations detected.</div>
              <p style={{ fontSize: '12px', marginTop: '6px' }}>
                DewClient will automatically download and isolate the required Eclipse Temurin Java runtime when launching Minecraft.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {runtimes.map((rt, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 18px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Java {rt.majorVersion} ({(rt as any).versionString || (rt as any).version || `v${rt.majorVersion}`})
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '4px' }}>
                      {rt.path}
                    </div>
                  </div>
                  <span className="badge badge-cyan">Ready</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'data' && (
        <div className="card">
          <div style={{ marginBottom: '18px' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Launcher Data
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Remove local DewClient profiles and sessions, instances, downloaded game files, mods, settings, runtimes, and cached data. Your registered DewClient account will not be deleted; the launcher application is not removed.
            </p>
          </div>
          {resetDataError && (
            <div role="alert" style={{ color: 'var(--accent-crimson)', fontSize: '13px', marginBottom: '12px' }}>
              {resetDataError}
            </div>
          )}
          <button type="button" className="btn btn-danger" onClick={handleResetLauncherData} disabled={isResettingData}>
            <Trash2 size={15} /> {isResettingData ? 'Resetting...' : 'Reset Launcher Data'}
          </button>
        </div>
      )}

      {activeTab === 'privacy' && (
        <div className="card">
          <div style={{ marginBottom: '18px' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>Connected account information</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Using DewClient’s connected services includes the account and online-player sharing described here. This is always enabled while the launcher is connected; see the Privacy Policy and Terms of Service for details.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }} role="status">
              <span style={{ color: 'var(--accent-emerald)', fontSize: '14px', lineHeight: '16px' }}>●</span>
              <div>
                <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>Saved Minecraft profiles are shared with the DewClient admin dashboard</strong>
                <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>Up to 100 profiles’ usernames, UUIDs, account types, and last-used times. Email addresses, Microsoft tokens, passwords, and local cosmetic files are not included.</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }} role="status">
              <span style={{ color: 'var(--accent-emerald)', fontSize: '14px', lineHeight: '16px' }}>●</span>
              <div>
                <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>The active Microsoft profile appears in the online-player list</strong>
                <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>Only its username and Minecraft UUID are sent while DewClient is running. Online presence expires after two minutes without a heartbeat.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Action Buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap', gap: '12px' }}>
        <button onClick={onOpenDataDir} className="btn btn-secondary">
          <FolderOpen size={15} /> Open Application Data Folder
        </button>
      </div>

      {isDirty && (
        <div className={`settings-save-bar animate-fade-in${isSaving ? ' is-saving' : ''}`} role="status" aria-live="polite">
          <div className="settings-save-message"><span className="settings-save-dot" /> {isSaving ? 'Saving your changes...' : 'You have unsaved changes'}</div>
          <div className="settings-save-actions">
            <button onClick={handleDiscardSettings} disabled={isSaving} className="btn btn-secondary btn-sm"><RotateCcw size={14} /> Discard</button>
            <button onClick={handleSaveSettings} disabled={isSaving} aria-busy={isSaving} className="btn btn-success btn-sm">
              {isSaving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
