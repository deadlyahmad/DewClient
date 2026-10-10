import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Activity,
  AlertTriangle,
  Play,
  Square,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Download,
  Cpu,
  Layers,
  ChevronDown,
  ChevronUp,
  RotateCcw
} from 'lucide-react';
import type { InstanceWithStats } from '../../shared/types/instance.ts';
import type { DownloadProgress } from '../../shared/types/download.ts';

interface PlayViewProps {
  activeInstance: InstanceWithStats | null;
  isRunning: boolean;
  isInstalled?: boolean;
  isDownloading?: boolean;
  launchStatus: {
    status: 'idle' | 'preparing' | 'downloading' | 'launching' | 'running' | 'crashed' | 'install-error' | 'finished';
    pid?: number;
    exitCode?: number;
    error?: string;
  };
  installProgress: any | null;
  logs: string[];
  crashReport: any | null;
  onLaunch: () => void;
  onDownload?: () => void;
  onStop: () => void;
  onClearLogs: () => void;
}

export const PlayView: React.FC<PlayViewProps> = ({
  activeInstance,
  isRunning,
  isInstalled = true,
  isDownloading = false,
  launchStatus,
  installProgress,
  logs,
  crashReport,
  onLaunch,
  onDownload,
  onStop,
  onClearLogs
}) => {
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);
  const [showConsole, setShowConsole] = useState<boolean>(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((line) => {
    if (filter === 'all') return true;
    if (filter === 'info') return line.includes('[INFO]') || line.includes('/INFO');
    if (filter === 'warn') return line.includes('[WARN]') || line.includes('/WARN');
    if (filter === 'error') return line.includes('[ERROR]') || line.includes('/ERROR') || line.includes('Exception');
    return true;
  });

  // Friendly user-facing status label
  const getFriendlyStatus = () => {
    const st = launchStatus.status || (launchStatus as any)?.state;
    switch (st) {
      case 'preparing':
        return 'Checking Game Files...';
      case 'downloading':
        return isDownloading ? 'Downloading Minecraft...' : 'Downloading Updates...';
      case 'launching':
        return 'Starting Minecraft...';
      case 'running':
        return 'Game Running';
      case 'crashed':
        return 'Game Stopped Unexpectedly';
      case 'install-error':
        return 'Game Install Failed';
      case 'finished':
      case 'idle':
      default:
        if (!isInstalled) return 'Download Required';
        return 'Ready to Play';
    }
  };

  const getStatusColor = () => {
    const st = launchStatus.status || (launchStatus as any)?.state;
    switch (st) {
      case 'running':
        return 'var(--accent-emerald)';
      case 'preparing':
      case 'downloading':
      case 'launching':
        return 'var(--accent-primary)';
      case 'crashed':
      case 'install-error':
        return 'var(--accent-crimson)';
      default:
        if (!isInstalled) return '#F59E0B';
        return 'var(--accent-emerald)';
    }
  };

  // Robust progress extraction
  const rawProgress = installProgress
    ? (typeof installProgress.progressPercent === 'number'
        ? installProgress.progressPercent
        : (typeof installProgress.progress === 'number'
            ? Math.round(installProgress.progress * 100)
            : 0))
    : 0;
  const progressPercent = isNaN(rawProgress) ? 0 : Math.min(100, Math.max(0, Math.round(rawProgress)));
  const isLaunching = launchStatus.status === 'launching';

  const downloadedBytes = (installProgress as any)?.downloadedBytes ?? (installProgress as any)?.transferredBytes ?? 0;
  const totalBytes = (installProgress as any)?.totalBytes ?? 0;
  const speedBytes = (installProgress as any)?.speedBytesPerSec ?? (installProgress as any)?.speed ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
      {/* Top Status Telemetry Bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '16px'
      }}>
        {/* Game Status Card */}
        <div className={`card play-status-card${isLaunching ? ' is-launching' : ''}`} style={{ padding: '16px 20px' }} aria-live="polite">
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.4px' }}>
            Game Status
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              className="play-status-dot"
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: getStatusColor(),
                boxShadow: isRunning ? '0 0 10px var(--accent-emerald)' : 'none'
              }}
            />
            <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {getFriendlyStatus()}
            </span>
          </div>
        </div>

        {/* Selected Instance Card */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.4px' }}>
            Active Game
          </div>
          <div style={{ fontSize: '15px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
            {activeInstance ? `${activeInstance.name} (${activeInstance.minecraftVersion})` : 'No Game Selected'}
          </div>
        </div>

        {/* Memory Allocation Card */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.4px' }}>
            JVM Memory
          </div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Global Settings allocation
          </div>
        </div>

        {/* Quick Action Button Card */}
        <div className="card" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          {isRunning ? (
            <button onClick={onStop} className="btn btn-danger btn-stop-game btn-sm" style={{ width: '100%', fontWeight: 700 }}>
              <Square size={14} fill="currentColor" /> Stop Game
            </button>
          ) : isDownloading || launchStatus.status === 'downloading' || launchStatus.status === 'preparing' ? (
            <button disabled className="btn btn-secondary btn-sm" style={{ width: '100%', fontWeight: 700, opacity: 0.85 }}>
              <RefreshCw size={14} className="spin" /> Downloading...
            </button>
          ) : !isInstalled ? (
            <button
              onClick={onDownload || onLaunch}
              disabled={!activeInstance}
              className="btn btn-primary btn-sm"
              style={{ width: '100%', fontWeight: 700 }}
            >
              <Download size={14} /> Download Game
            </button>
          ) : (
            <button
              onClick={onLaunch}
              disabled={!activeInstance}
              className="btn btn-primary btn-sm"
              style={{ width: '100%', fontWeight: 700 }}
            >
              <Play size={14} fill="currentColor" /> Launch Game
            </button>
          )}
        </div>
      </div>

      {isLaunching && (
        <div className="launching-card" role="status" aria-live="polite">
          <span className="launching-icon"><Activity size={18} /></span>
          <span><strong>Starting Minecraft</strong><small>Preparing the game window and connecting the selected instance…</small></span>
          <RefreshCw size={16} className="launching-indicator" aria-hidden="true" />
        </div>
      )}

      {/* Download / Installation Progress Bar */}
      {(isDownloading || launchStatus.status === 'downloading' || launchStatus.status === 'preparing' || (installProgress && progressPercent < 100)) && (
        <div className="card" style={{ padding: '20px 24px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-glow)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Download size={18} color="var(--accent-primary)" />
              <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                {installProgress?.currentFile
                  ? `Downloading ${installProgress.currentFile.split('/').pop() || 'game files'}...`
                  : (installProgress?.phase || 'Preparing game files...')}
              </span>
            </div>
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--accent-primary)' }}>
              {progressPercent}%
            </span>
          </div>

          <div style={{ width: '100%', height: '8px', background: 'var(--bg-input)', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                background: 'var(--accent-primary)',
                boxShadow: '0 0 12px var(--accent-primary-glow)',
                transition: 'width 200ms ease'
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
            <span>
              {installProgress?.step === 'verifying' && installProgress?.totalFiles > 0
                ? `${Number(installProgress.completedFiles || 0).toLocaleString()} of ${Number(installProgress.totalFiles).toLocaleString()} assets checked`
                : downloadedBytes > 0 && totalBytes > 0
                ? `${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB of ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
                : (installProgress?.phase || 'Initializing download...')}
            </span>
            <span>
              {installProgress?.step !== 'verifying' && speedBytes > 0
                ? `${(speedBytes / (1024 * 1024)).toFixed(1)} MB/s`
                : ''}
            </span>
          </div>
        </div>
      )}

      {/* Human-Friendly Error Banner */}
      {(launchStatus.status === 'crashed' || launchStatus.status === 'install-error') && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--accent-crimson)' }}>
              <AlertTriangle size={22} />
              <div>
                <h4 style={{ fontWeight: 700, fontSize: '16px' }}>{launchStatus.status === 'install-error' ? 'Minecraft could not be installed' : 'Minecraft couldn’t start or closed unexpectedly'}</h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {launchStatus.status === 'install-error'
                    ? 'DewClient could not verify the Fabric or Minecraft files. Check the technical details, then retry the download.'
                    : crashReport?.details || 'A game error occurred during startup. You can try launching again or check your graphics drivers and memory settings.'}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={launchStatus.status === 'install-error' ? (onDownload || onLaunch) : onLaunch} className="btn btn-primary btn-sm">
                <RotateCcw size={13} /> {launchStatus.status === 'install-error' ? 'Retry Download' : 'Try Again'}
              </button>
              <button
                onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                className="btn btn-secondary btn-sm"
              >
                {showTechnicalDetails ? 'Hide Details' : 'View Details'}
              </button>
            </div>
          </div>

          {showTechnicalDetails && (crashReport || launchStatus.error) && (
            <div style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              padding: '14px',
              borderRadius: 'var(--radius-md)',
              fontSize: '12px',
              color: 'var(--text-secondary)'
            }}>
              {crashReport?.probableCause && <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Technical Analysis: {crashReport.probableCause}
              </div>}
              {crashReport?.solution && <div>{crashReport.solution}</div>}
              {launchStatus.error && <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-muted)', fontFamily: 'inherit' }}>{launchStatus.error}</pre>}
              {launchStatus.exitCode !== undefined && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', fontFamily: 'monospace' }}>
                  Process Exit Code: {launchStatus.exitCode}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Game Output Console */}
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{
          padding: '12px 20px',
          background: 'var(--bg-surface-elevated)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Terminal size={16} color="var(--accent-primary)" />
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
              Game Output & Activity
            </span>
            <span className="badge badge-gray">{filteredLogs.length} Lines</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Filter Buttons */}
            <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', padding: '2px', border: '1px solid var(--border-subtle)' }}>
              {(['all', 'info', 'warn', 'error'] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setFilter(lvl)}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: filter === lvl ? 'var(--bg-surface-hover)' : 'transparent',
                    color: filter === lvl ? 'var(--accent-primary)' : 'var(--text-muted)'
                  }}
                >
                  {lvl}
                </button>
              ))}
            </div>

            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className="btn btn-secondary btn-sm"
              style={{
                fontSize: '11px',
                color: autoScroll ? 'var(--accent-primary)' : 'var(--text-muted)'
              }}
            >
              Auto-Scroll: {autoScroll ? 'ON' : 'OFF'}
            </button>

            <button onClick={onClearLogs} className="btn btn-secondary btn-sm" title="Clear Console">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Console Body */}
        <div
          ref={logContainerRef}
          style={{
            flex: 1,
            background: 'var(--bg-input)',
            padding: '16px 20px',
            overflowY: 'auto',
            fontFamily: 'Consolas, "Fira Code", monospace',
            fontSize: '12px',
            lineHeight: 1.6,
            color: 'var(--text-secondary)'
          }}
        >
          {filteredLogs.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '40px' }}>
              No game output yet. Launch Minecraft to view game activity in real time.
            </div>
          ) : (
            filteredLogs.map((line, idx) => {
              let color = 'var(--text-secondary)';
              if (line.includes('[WARN]') || line.includes('/WARN')) color = 'var(--accent-amber)';
              if (line.includes('[ERROR]') || line.includes('/ERROR') || line.includes('Exception')) color = 'var(--accent-crimson)';
              if (line.includes('[DEWCLIENT]')) color = 'var(--accent-primary)';
              return (
                <div key={idx} style={{ color, wordBreak: 'break-all' }}>
                  {line}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
