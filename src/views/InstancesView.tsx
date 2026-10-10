import React, { useEffect, useRef, useState } from 'react';
import {
  Layers,
  Plus,
  Play,
  Copy,
  Trash2,
  FolderOpen,
  Wrench,
  Download,
  Sparkles,
  Check,
  Clock,
  Boxes
  ,Archive
} from 'lucide-react';
import type { InstanceWithStats } from '../../shared/types/instance.ts';
import { CURRENT_MINECRAFT_PRIMARY_TARGET } from '../../shared/constants/versions.ts';

function formatPlayTime(minutes = 0): string {
  const totalSeconds = Math.floor(Math.max(0, minutes) * 60);
  if (totalSeconds < 60) return `${totalSeconds} sec`;
  if (minutes < 60) return `${Math.floor(minutes)} min`;
  return `${(minutes / 60).toFixed(1)} hours`;
}

interface InstancesViewProps {
  instances: InstanceWithStats[];
  activeInstance: InstanceWithStats | null;
  isInstalled?: boolean;
  onSelectInstance: (id: string) => void;
  onLaunchInstance: (id: string) => void;
  onDownloadInstance?: (id: string) => void;
  onCreateInstance: (data: { name: string; minecraftVersion: string; loader: 'fabric' }) => Promise<void>;
  onDuplicateInstance: (id: string) => Promise<void>;
  onDeleteInstance: (id: string) => Promise<void>;
  onRepairInstance: (id: string) => Promise<void>;
  onExportInstance: (id: string) => Promise<void>;
  onImportInstance: () => Promise<void>;
  onOpenFolder: (id: string) => void;
}

export const InstancesView: React.FC<InstancesViewProps> = ({
  instances,
  activeInstance,
  isInstalled = true,
  onSelectInstance,
  onLaunchInstance,
  onDownloadInstance,
  onCreateInstance,
  onDuplicateInstance,
  onDeleteInstance,
  onRepairInstance,
  onExportInstance,
  onImportInstance,
  onOpenFolder
}) => {
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const instanceNameInputRef = useRef<HTMLInputElement>(null);
  const [newInstanceName, setNewInstanceName] = useState<string>('');
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const [officialVersions, setOfficialVersions] = useState<string[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [versionsError, setVersionsError] = useState('');

  useEffect(() => {
    loadAvailableVersions();
  }, []);

  useEffect(() => {
    if (!showCreateModal) return;
    const focusTimer = window.setTimeout(() => {
      instanceNameInputRef.current?.focus();
      instanceNameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [showCreateModal]);

  const loadAvailableVersions = async () => {
    setVersionsLoading(true);
    setVersionsError('');
    try {
      if (!window.dewclient?.minecraft) throw new Error('Minecraft services are unavailable.');
      const [raw, fabricVersions] = await Promise.all([
        window.dewclient.minecraft.getVersions('release'),
        window.dewclient.minecraft.getFabricVersions()
      ]);
      const list = Array.isArray(raw) ? raw : (raw as any)?.versions || [];
      const supportedVersions = new Set(fabricVersions);
      const releases = list.filter((version: any) => version.type === 'release' && supportedVersions.has(version.id)).map((version: any) => version.id);
      if (!releases.length) throw new Error('No official Minecraft releases are currently available.');
      setOfficialVersions(releases);
      setSelectedVersion((current) => releases.includes(current)
        ? current
        : releases.includes(CURRENT_MINECRAFT_PRIMARY_TARGET) ? CURRENT_MINECRAFT_PRIMARY_TARGET : releases[0]);
    } catch (error: any) {
      setOfficialVersions([]);
      setSelectedVersion('');
      setVersionsError(error?.message || 'Could not load official Minecraft releases.');
    } finally {
      setVersionsLoading(false);
    }
  };

  const currentAvailableVersions = officialVersions;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInstanceName.trim() || !selectedVersion) return;
    setIsSubmitting(true);
    try {
      await onCreateInstance({
        name: newInstanceName.trim(),
        minecraftVersion: selectedVersion,
        loader: 'fabric'
      });
      setShowCreateModal(false);
      setNewInstanceName('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAction = async (action: () => Promise<void>, instanceId: string, actionName: string) => {
    setActionInProgress(`${instanceId}-${actionName}`);
    try {
      await action();
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Action Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Installed Games: <strong style={{ color: 'var(--text-primary)' }}>{instances.length}</strong> instances
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, color: 'var(--text-secondary)', fontSize: '12px' }}>
            Active instance
            <select
              className="input-select"
              value={activeInstance?.id || ''}
              disabled={instances.length < 2}
              onChange={(event) => onSelectInstance(event.target.value)}
              aria-label="Select active Minecraft instance"
              style={{ width: 'min(260px, 62vw)', padding: '7px 10px' }}
            >
              {instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.name}</option>)}
            </select>
          </label>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary btn-sm">
            <Plus size={14} /> Create Instance
          </button>
          <button onClick={() => void onImportInstance()} className="btn btn-secondary btn-sm">
            <Archive size={14} /> Import Instance
          </button>
        </div>
      </div>

      {/* Instances Grid */}
      {instances.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Layers size={48} color="var(--text-dim)" style={{ margin: '0 auto 16px auto' }} />
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>No Instances Created</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '420px', margin: '0 auto 20px auto', lineHeight: 1.5 }}>
            Create your first isolated Minecraft instance to download official assets, manage mods, and play.
          </p>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
            <Plus size={16} /> Create New Instance
          </button>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: '20px'
        }}>
          {instances.map((inst) => {
            const isActive = activeInstance?.id === inst.id;

            return (
              <div
                key={inst.id}
                className={`card ${isActive ? 'card-active' : ''}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '16px',
                  background: isActive ? 'var(--bg-surface-elevated)' : 'var(--bg-card)'
                }}
              >
                <div>
                  {/* Top Badges */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <span className="badge badge-cyan">
                        Minecraft {inst.minecraftVersion}
                      </span>
                    </div>
                    {isActive && (
                      <span className="badge badge-emerald">
                        <Check size={11} /> Selected
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
                    {inst.name}
                  </h3>

                  {/* Stats list */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Boxes size={13} color="var(--accent-violet)" /> {inst.stats?.modCount || 0} Mods
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Clock size={13} color="var(--accent-emerald)" /> {formatPlayTime(inst.totalPlayTimeMinutes)}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', alignSelf: 'center' }}>
                      {(inst as any).lastPlayedAt || (inst as any).stats?.lastPlayed ? new Date((inst as any).lastPlayedAt || (inst as any).stats?.lastPlayed).toLocaleDateString() : 'Never Played'}
                    </div>
                  </div>
                </div>

                {/* Instance Actions */}
                <div style={{
                  borderTop: '1px solid var(--border-subtle)',
                  paddingTop: '14px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => onOpenFolder(inst.id)}
                      className="btn btn-secondary btn-sm"
                      title="Open Game Folder"
                      aria-label="Open Game Folder"
                    >
                      <FolderOpen size={13} />
                    </button>
                    <button
                      onClick={() => handleAction(() => onDuplicateInstance(inst.id), inst.id, 'dup')}
                      disabled={actionInProgress === `${inst.id}-dup`}
                      className="btn btn-secondary btn-sm"
                      title="Duplicate Instance"
                      aria-label="Duplicate Instance"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={() => handleAction(() => onRepairInstance(inst.id), inst.id, 'rep')}
                      disabled={actionInProgress === `${inst.id}-rep`}
                      className="btn btn-secondary btn-sm"
                      title="Verify & Repair Files"
                      aria-label="Verify & Repair Files"
                    >
                      <Wrench size={13} />
                    </button>
                    <button
                      onClick={() => handleAction(() => onExportInstance(inst.id), inst.id, 'export')}
                      disabled={actionInProgress === `${inst.id}-export`}
                      className="btn btn-secondary btn-sm"
                      title="Export Instance"
                      aria-label="Export Instance"
                    >
                      <Archive size={13} />
                    </button>
                    <button
                      onClick={() => handleAction(() => onDeleteInstance(inst.id), inst.id, 'del')}
                      disabled={actionInProgress === `${inst.id}-del`}
                      className="btn btn-danger btn-sm"
                      title="Delete Instance"
                      aria-label="Delete Instance"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <div>
                    {isActive ? (
                      <button
                        onClick={() => (!isInstalled && onDownloadInstance ? onDownloadInstance(inst.id) : onLaunchInstance(inst.id))}
                        className="btn btn-primary btn-sm"
                        style={{
                          background: undefined
                        }}
                      >
                        {!isInstalled ? (
                          <>
                            <Download size={13} /> Download
                          </>
                        ) : (
                          <>
                            <Play size={13} fill="currentColor" /> Play
                          </>
                        )}
                      </button>
                    ) : (
                      <button onClick={() => onSelectInstance(inst.id)} className="btn btn-secondary btn-sm">
                        Select
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Instance Modal */}
      {showCreateModal && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowCreateModal(false);
          }}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">Create New Instance</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="btn btn-secondary btn-sm"
                style={{ padding: '4px 8px' }}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Instance Name</label>
                <input
                  ref={instanceNameInputRef}
                  type="text"
                  className="input-text"
                  value={newInstanceName}
                  onChange={(e) => setNewInstanceName(e.target.value)}
                  placeholder="e.g. My Survival World"
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Minecraft Version</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {versionsLoading ? 'Loading official releases...' : `${currentAvailableVersions.length} official releases`}
                  </span>
                </label>
                <select
                  className="input-select"
                  value={selectedVersion}
                  disabled={versionsLoading || !currentAvailableVersions.length}
                  required
                  onChange={(e) => setSelectedVersion(e.target.value)}
                >
                  {!currentAvailableVersions.length && <option value="">{versionsLoading ? 'Loading official releases...' : 'No releases available'}</option>}
                  {currentAvailableVersions.map((v) => (
                    <option key={v} value={v}>
                      Minecraft {v}
                    </option>
                  ))}
                </select>
                {versionsError && <span role="alert" className="form-error">{versionsError}</span>}
              </div>

              <div className="form-group">
                <label className="form-label">Mod loader</label>
                <div className="input-select" aria-readonly="true">Fabric</div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting || !selectedVersion}>
                  {isSubmitting ? 'Creating...' : 'Create Instance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
