import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Search,
  FolderOpen,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Package,
  Plus,
  RefreshCw
} from 'lucide-react';
import type { InstanceWithStats } from '../../shared/types/instance.ts';
import type { ModItem } from '../../shared/types/content.ts';

interface ModsViewProps {
  activeInstance: InstanceWithStats | null;
  onNavigateToModrinth: () => void;
  onOpenFolder: (id: string) => void;
  onRefreshInstances: () => Promise<void>;
}

export const ModsView: React.FC<ModsViewProps> = ({
  activeInstance,
  onNavigateToModrinth,
  onOpenFolder,
  onRefreshInstances
}) => {
  const [mods, setMods] = useState<ModItem[]>([]);
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (activeInstance) {
      loadMods();
    }
  }, [activeInstance?.id]);

  const loadMods = async () => {
    if (!activeInstance) return;
    setLoading(true);
    try {
      if (window.dewclient?.content) {
        const list = await window.dewclient.content.getInstalledMods(activeInstance.id);
        setMods(list || []);
      }
    } catch {
      setMods([]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (mod: ModItem) => {
    if (!activeInstance) return;
    try {
      await window.dewclient.content.toggleMod(activeInstance.id, mod.fileName, !mod.enabled);
      await loadMods();
      await onRefreshInstances();
    } catch (err: any) {
      alert(`Failed to toggle mod: ${err.message}`);
    }
  };

  const handleDelete = async (mod: ModItem) => {
    if (!activeInstance) return;
    if (!confirm(`Are you sure you want to delete ${mod.fileName}?`)) return;
    try {
      await window.dewclient.content.deleteMod(activeInstance.id, mod.fileName);
      await loadMods();
      await onRefreshInstances();
    } catch (err: any) {
      alert(`Failed to delete mod: ${err.message}`);
    }
  };

  if (!activeInstance) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <Boxes size={48} color="var(--text-dim)" style={{ margin: '0 auto 16px auto' }} />
        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>No Instance Selected</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Select or create an instance from the Instances tab to manage its installed mods.
        </p>
      </div>
    );
  }

  const filteredMods = mods.filter((m) =>
    (m.name || m.fileName).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Controls Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ position: 'relative', width: '320px' }}>
          <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '13px' }} />
          <input
            type="text"
            className="input-text"
            placeholder="Filter installed mods..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '40px' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => onOpenFolder(activeInstance.id)} className="btn btn-secondary btn-sm">
            <FolderOpen size={14} /> Open Mods Folder
          </button>
          <button onClick={loadMods} className="btn btn-secondary btn-sm" title="Refresh Mods List">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={onNavigateToModrinth} className="btn btn-primary btn-sm">
              <Plus size={14} /> Browse Content
          </button>
        </div>
      </div>

      {/* Instance Context Subheader */}
      <div style={{
        padding: '12px 18px',
        background: 'var(--bg-surface-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '13px'
      }}>
        <div>
          Active Instance: <strong>{activeInstance.name}</strong>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span className="badge badge-cyan">{mods.filter((m) => m.enabled).length} Enabled</span>
          <span className="badge badge-gray">{mods.filter((m) => !m.enabled).length} Disabled</span>
        </div>
      </div>

      {/* Mods List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
          <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px auto' }} />
          Reading mods directory...
        </div>
      ) : filteredMods.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Boxes size={48} color="var(--text-dim)" style={{ margin: '0 auto 16px auto' }} />
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>No Mods Installed</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '420px', margin: '0 auto 20px auto' }}>
            {search ? 'No mods match your search query.' : 'Browse the content catalog to find compatible mods, shaders, and resource packs.'}
          </p>
          <button onClick={onNavigateToModrinth} className="btn btn-primary">
            <Package size={16} /> Open Content Browser
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredMods.map((mod) => {
            const rawBytes = (mod as any).sizeBytes || (mod as any).fileSize || 0;
            const sizeStr = rawBytes > 0 ? `${(rawBytes / (1024 * 1024)).toFixed(2)} MB` : '';

            return (
              <div
                key={mod.fileName}
                style={{
                  padding: '14px 20px',
                  borderRadius: 'var(--radius-md)',
                  background: mod.enabled ? 'var(--bg-surface)' : 'rgba(14, 19, 31, 0.4)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  opacity: mod.enabled ? 1 : 0.65
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: mod.enabled ? 'var(--bg-surface-elevated)' : 'var(--bg-input)',
                    border: '1px solid var(--border-medium)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0
                  }}>
                    {mod.iconUrl ? (
                      <img
                        src={mod.iconUrl}
                        alt={mod.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Boxes size={20} color={mod.enabled ? 'var(--accent-primary)' : 'var(--text-muted)'} />
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{mod.name || mod.fileName}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {mod.fileName} {sizeStr ? `• ${sizeStr}` : ''}
                    </div>
                  </div>
                </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  onClick={() => handleToggle(mod)}
                  className={`btn ${mod.enabled ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  style={{
                    color: mod.enabled ? 'var(--accent-primary-fg)' : 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {mod.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  {mod.enabled ? 'Enabled' : 'Disabled'}
                </button>

                <button
                  onClick={() => handleDelete(mod)}
                  className="btn btn-danger btn-sm"
                  title="Delete Mod"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
};
