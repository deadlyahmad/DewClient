import React, { useState, useEffect } from 'react';
import {
  Package,
  Search,
  Download,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Layers,
  Sparkles,
  RefreshCw,
  Eye
} from 'lucide-react';
import type { InstanceWithStats } from '../../shared/types/instance.ts';
import type { ModrinthSearchHit, ModrinthSearchResult } from '../../shared/types/content.ts';

interface ModrinthViewProps {
  activeInstance: InstanceWithStats | null;
  onRefreshInstances: () => Promise<void>;
}

export const ModrinthView: React.FC<ModrinthViewProps> = ({ activeInstance, onRefreshInstances }) => {
  const [projectType, setProjectType] = useState<'mod' | 'modpack' | 'resourcepack' | 'shader'>('mod');
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<ModrinthSearchHit[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installSuccessId, setInstallSuccessId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<{ id: string; error: string } | null>(null);
  const [installedProjectIds, setInstalledProjectIds] = useState<Set<string>>(() => new Set());
  const [checkingInstalled, setCheckingInstalled] = useState<boolean>(false);

  useEffect(() => {
    void searchProjects();
  }, [projectType, activeInstance?.id, activeInstance?.minecraftVersion, activeInstance?.loaderType]);

  useEffect(() => {
    let cancelled = false;
    setInstalledProjectIds(new Set());
    setCheckingInstalled(false);
    if (!activeInstance || projectType === 'modpack') return () => { cancelled = true; };

    setCheckingInstalled(results.length > 0);
    window.dewclient.content.getInstalledProjectIds(activeInstance.id, projectType, results.map((hit) => hit.project_id))
      .then((ids) => {
        if (!cancelled) setInstalledProjectIds(new Set(ids));
      })
      .catch(() => {
        if (!cancelled) setInstalledProjectIds(new Set());
      })
      .finally(() => {
        if (!cancelled) setCheckingInstalled(false);
      });
    return () => { cancelled = true; };
  }, [activeInstance?.id, activeInstance?.minecraftVersion, activeInstance?.loaderType, projectType, results]);

  const searchProjects = async () => {
    setLoading(true);
    setInstallError(null);
    try {
      if (window.dewclient?.content) {
        const res = await window.dewclient.content.searchModrinth({
          query,
          projectType,
          gameVersion: projectType === 'mod' ? activeInstance?.minecraftVersion : undefined,
          loader: projectType === 'mod' ? ((activeInstance as any)?.loaderType || (activeInstance as any)?.loader) : undefined,
          limit: 24
        });
        setResults(res?.hits || []);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (hit: ModrinthSearchHit) => {
    setInstallingId(hit.project_id);
    setInstallError(null);
    try {
      if (projectType === 'modpack') {
        await window.dewclient.content.installModpack(hit.project_id, {
          instanceName: hit.title
        });
        await onRefreshInstances();
      } else {
        if (!activeInstance) {
          throw new Error('Please select an active instance first before installing components.');
        }
        if (window.dewclient.content.installContent) {
          await window.dewclient.content.installContent(activeInstance.id, hit.project_id, projectType);
        } else {
          await window.dewclient.content.installMod(activeInstance.id, hit.project_id);
        }
        setInstalledProjectIds((current) => new Set(current).add(hit.project_id));
        await onRefreshInstances();
      }
      setInstallSuccessId(hit.project_id);
      setTimeout(() => setInstallSuccessId(null), 4000);
    } catch (err: any) {
      setInstallError({ id: hit.project_id, error: err.message || 'Installation could not be completed.' });
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Category Tabs & Search Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        {/* Project Type Nav */}
        <div style={{ display: 'flex', background: 'var(--bg-surface)', padding: '4px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          {[
            { id: 'mod', label: 'Mods' },
            { id: 'resourcepack', label: 'Resource Packs' },
            { id: 'shader', label: 'Shader Packs' },
            { id: 'modpack', label: 'Modpacks' }
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setProjectType(id as any)}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: projectType === id ? 'var(--accent-primary)' : 'transparent',
                color: projectType === id ? 'var(--accent-primary-fg)' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <form
          onSubmit={(e) => { e.preventDefault(); searchProjects(); }}
          style={{ display: 'flex', gap: '8px' }}
        >
          <div style={{ position: 'relative', width: '300px' }}>
            <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '13px' }} />
            <input
              type="text"
              className="input-text"
              placeholder={`Search ${projectType === 'mod' ? 'mods' : projectType === 'modpack' ? 'modpacks' : projectType === 'shader' ? 'shaders' : 'resource packs'}...`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: '40px' }}
            />
          </div>
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
        </form>
      </div>

      {/* Target Instance Context Notice */}
      {projectType === 'mod' && (
        <div style={{
          fontSize: '12px',
          color: 'var(--text-secondary)',
          background: 'var(--bg-surface-elevated)',
          padding: '12px 18px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            Installing to: <strong style={{ color: 'var(--text-primary)' }}>{activeInstance?.name || 'No Instance Selected'}</strong>
            {activeInstance ? ` (${activeInstance.minecraftVersion})` : ''}
          </div>
          <span style={{ color: 'var(--text-muted)' }}>Compatible versions shown</span>
        </div>
      )}

      {/* Results Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
          <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px auto' }} />
          Discovering catalog packages...
        </div>
      ) : results.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Package size={48} color="var(--text-dim)" style={{ margin: '0 auto 16px auto' }} />
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>No Items Found</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            Try searching with broader keywords or browse another category.
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: '20px'
        }}>
          {results.map((hit) => {
            const isInstalling = installingId === hit.project_id;
            const isSuccess = installSuccessId === hit.project_id;
            const isInstalled = installedProjectIds.has(hit.project_id);
            const hasError = installError?.id === hit.project_id;

            return (
              <div
                key={hit.project_id}
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '16px'
                }}
              >
                <div>
                  {/* Top metadata */}
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                    {hit.icon_url ? (
                      <img
                        src={hit.icon_url}
                        alt={hit.title}
                        style={{ width: '48px', height: '48px', borderRadius: '10px', background: 'var(--bg-input)' }}
                      />
                    ) : (
                      <div style={{ width: '48px', height: '48px', borderRadius: '10px', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Package size={24} color="var(--accent-primary)" />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {hit.title}
                      </h4>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        by <span style={{ color: 'var(--text-secondary)' }}>{hit.author}</span> • {(hit.downloads / 1000).toFixed(0)}k downloads
                      </div>
                    </div>
                  </div>

                  <p style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginTop: '12px',
                    lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    {hit.description}
                  </p>

                  {/* Categories Tags */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '12px' }}>
                    {hit.categories?.slice(0, 3).map((cat) => (
                      <span key={cat} className="badge badge-gray" style={{ fontSize: '10px' }}>
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div style={{
                  borderTop: '1px solid var(--border-subtle)',
                  paddingTop: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  {isInstalled ? (
                    <div style={{ fontSize: '12px', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                      <CheckCircle2 size={14} /> Installed in this instance
                    </div>
                    ) : hasError ? (
                    <div style={{ fontSize: '11px', color: 'var(--accent-crimson)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertCircle size={13} /> {installError.error}
                    </div>
                  ) : isSuccess ? (
                    <div style={{ fontSize: '12px', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                      <CheckCircle2 size={14} /> Installed!
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Verified Package
                    </div>
                  )}

                    <button
                    onClick={() => handleInstall(hit)}
                    className="btn btn-primary btn-sm"
                    disabled={isInstalling || isInstalled || (checkingInstalled && projectType !== 'modpack') || (!activeInstance && projectType === 'mod')}
                  >
                    {isInstalling ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" /> Installing...
                      </>
                    ) : isInstalled || isSuccess ? (
                      'Installed'
                    ) : checkingInstalled && projectType !== 'modpack' ? (
                      'Checking...'
                    ) : (
                      <>
                        <Download size={13} /> {
                          projectType === 'modpack' ? 'Create Instance' :
                          projectType === 'shader' ? 'Install Shader' :
                          projectType === 'resourcepack' ? 'Install Pack' : 'Install Mod'
                        }
                      </>
                    )}
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
