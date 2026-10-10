import React, { useState, useEffect } from 'react';
import {
  Compass,
  Search,
  Sparkles,
  Download,
  Calendar,
  CheckCircle2,
  RefreshCw,
  Filter
} from 'lucide-react';
import type { MinecraftVersion } from '../../shared/types/minecraft.ts';

interface VersionsViewProps {
  onInstallVersion: (versionId: string) => void;
}

export const VersionsView: React.FC<VersionsViewProps> = ({ onInstallVersion }) => {
  const [versions, setVersions] = useState<MinecraftVersion[]>([]);
  const [latestRelease, setLatestRelease] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'release'>('release');
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    loadManifest();
  }, []);

  const loadManifest = async () => {
    setLoading(true);
    setLoadError('');
    try {
      if (!window.dewclient?.minecraft) throw new Error('Minecraft services are unavailable.');
      const [list, fabricVersions] = await Promise.all([
        window.dewclient.minecraft.getManifest(),
        window.dewclient.minecraft.getFabricVersions()
      ]);
      const supportedVersions = new Set(fabricVersions);
      const compatibleList = list.filter((version) => supportedVersions.has(version.id));
      const releaseList = compatibleList.filter((version) => version.type === 'release');
      setVersions(compatibleList);
      setLatestRelease(releaseList[0]?.id || '');
      if (releaseList.length === 0) setLoadError('No Fabric-compatible Minecraft releases are currently available.');
    } catch (error: any) {
      setVersions([]);
      setLatestRelease('');
      setLoadError(error?.message || 'Could not load official Minecraft versions.');
    } finally {
      setLoading(false);
    }
  };

  const filteredVersions = versions.filter((v) => {
    const matchesSearch = v.id.toLowerCase().includes(search.toLowerCase());
    const matchesChannel = channelFilter === 'all' || v.type === 'release';
    return matchesSearch && matchesChannel;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Search and Channel Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: '320px' }}>
          <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '13px' }} />
          <input
            type="text"
            className="input-text"
            placeholder="Search official versions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '40px' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', padding: '4px', border: '1px solid var(--border-subtle)' }}>
            {(['all', 'release'] as const).map((ch) => (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: channelFilter === ch ? 'var(--accent-primary)' : 'transparent',
                  color: channelFilter === ch ? 'var(--accent-primary-fg)' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '12px',
                  textTransform: 'capitalize',
                  cursor: 'pointer'
                }}
              >
                {ch === 'all' ? 'All Versions' : 'Releases'}
              </button>
            ))}
          </div>

          <button onClick={loadManifest} className="btn btn-secondary btn-sm" title="Refresh official versions">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Latest Official Release Spotlight Card */}
      {latestRelease && <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-focus)',
        borderRadius: 'var(--radius-xl)',
        padding: '24px 28px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 0 20px var(--accent-primary-glow)',
        flexWrap: 'wrap',
        gap: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-emerald) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <Sparkles size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
                Minecraft Java Edition {latestRelease}
              </h3>
              <span className="badge badge-cyan">Featured Release</span>
              {versions.find((version) => version.id === latestRelease)?.isInstalled && <span className="badge badge-emerald">Installed Version</span>}
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              The latest official release featuring verified stability and performance enhancements.
            </p>
          </div>
        </div>

        <button
          onClick={() => onInstallVersion(latestRelease)}
          className="btn btn-primary"
          style={{ padding: '12px 24px', fontWeight: 700 }}
        >
          {versions.find((version) => version.id === latestRelease)?.isInstalled ? <><CheckCircle2 size={15} /> Installed</> : <><Download size={15} /> Install & Play {latestRelease}</>}
        </button>
      </div>}

      {/* Manifest Version List */}
      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{
          padding: '14px 24px',
          background: 'var(--bg-surface-elevated)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 140px',
          fontSize: '11px',
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          <div>Version</div>
          <div>Category</div>
          <div>Release Date</div>
          <div style={{ textAlign: 'right' }}>Action</div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px auto' }} />
            Loading Fabric-compatible Minecraft versions...
          </div>
        ) : filteredVersions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            {loadError || (versions.length > 0 ? 'No versions matched your search filter.' : 'No official Minecraft versions are available.')}
          </div>
        ) : (
          <div style={{ maxHeight: '520px', overflowY: 'auto' }}>
            {filteredVersions.slice(0, 100).map((v) => {
              const isLatest = v.id === latestRelease;
              return (
                <div
                  key={v.id}
                  style={{
                    padding: '14px 24px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 140px',
                    alignItems: 'center',
                    background: isLatest ? 'var(--accent-primary-glow)' : 'transparent',
                    transition: 'background var(--transition-fast)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>{v.id}</span>
                    {isLatest && <span className="badge badge-cyan" style={{ fontSize: '10px' }}>Latest</span>}
                    {v.isInstalled && <span className="badge badge-emerald" style={{ fontSize: '10px' }}>Installed Version</span>}
                  </div>
                  <div>
                    <span className={`badge ${v.type === 'release' ? 'badge-emerald' : 'badge-amber'}`}>
                      {v.type === 'release' ? 'Official' : v.type}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Calendar size={13} color="var(--text-dim)" />
                    {new Date(v.releaseTime).toLocaleDateString()}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <button
                      onClick={() => onInstallVersion(v.id)}
                      className={`btn ${v.isInstalled ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    >
                      {v.isInstalled ? <><CheckCircle2 size={13} /> Installed</> : <><Download size={13} /> Install</>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
