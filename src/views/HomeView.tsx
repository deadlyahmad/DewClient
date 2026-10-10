import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Boxes,
  Check,
  Clock3,
  Download,
  ExternalLink,
  Layers,
  Package,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users
} from 'lucide-react';
import type { InstanceWithStats } from '../../shared/types/instance.ts';
import type { UserAccount } from '../../shared/types/account.ts';
import type { NewsItem, Announcement, FeaturedServer, RemoteMaintenanceConfig } from '../../shared/types/remote.ts';
import { PRODUCT_NAME } from '../../shared/constants/versions.ts';
import dewClientIcon from '../../icon/DewClient.ico';
import homeWorldArt from '../assets/auth-world.svg';

function formatPlayTime(minutes = 0): string {
  if (minutes < 1) return 'New session';
  if (minutes < 60) return `${Math.floor(minutes)} min played`;
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1) : Math.floor(hours)} hr${hours >= 2 ? 's' : ''} played`;
}

function getFeaturedServerIcon(server: FeaturedServer): string {
  if (server.iconUrl) return server.iconUrl;
  return `https://api.mcstatus.io/v2/icon/${encodeURIComponent(`${server.host}:${server.port}`)}`;
}

interface HomeViewProps {
  activeInstance: InstanceWithStats | null;
  activeAccount: UserAccount | null;
  isRunning: boolean;
  isInstalled?: boolean;
  isDownloading?: boolean;
  maintenance?: RemoteMaintenanceConfig | null;
  onLaunch: () => void;
  onDownload?: () => void;
  onNavigate: (view: any) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  activeInstance,
  activeAccount,
  isRunning,
  isInstalled = true,
  isDownloading = false,
  maintenance = null,
  onLaunch,
  onDownload,
  onNavigate
}) => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [featuredServers, setFeaturedServers] = useState<FeaturedServer[]>([]);
  const [onlineProfiles, setOnlineProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedDashboardRef = useRef(false);

  useEffect(() => {
    void loadDashboardContent();
    const refreshTimer = window.setInterval(() => void loadDashboardContent(), 5 * 60 * 1000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  const loadDashboardContent = async () => {
    if (!hasLoadedDashboardRef.current) setLoading(true);
    try {
      if (window.dewclient?.remote) {
        const [newsData, annData, serversData] = await Promise.all([
          window.dewclient.remote.getNews().catch(() => []),
          window.dewclient.remote.getAnnouncements().catch(() => []),
          window.dewclient.remote.getFeaturedServers().catch(() => [])
        ]);
        const versionedBrand = new RegExp(`\\b${PRODUCT_NAME}\\s+\\d+(?:\\.\\d+){0,2}\\b`, 'i');
        setNews((newsData || []).filter((item) => !versionedBrand.test(`${item.title} ${item.summary}`)));
        setAnnouncements(annData || []);
        setFeaturedServers((serversData || [])
          .filter((server) => server.enabled !== false)
          .sort((a, b) => (b.priority || 0) - (a.priority || 0)));
        void window.dewclient.remote.getOnlineProfiles()
          .then((profilesData) => setOnlineProfiles(profilesData || []))
          .catch(() => setOnlineProfiles([]));
      }
    } catch {
      // Keep the local launcher useful when connected services are unavailable.
    } finally {
      hasLoadedDashboardRef.current = true;
      setLoading(false);
    }
  };

  const accountType = activeAccount?.type === 'microsoft'
    ? 'Microsoft account'
    : activeAccount?.type === 'discord'
      ? 'Discord account'
      : activeAccount
        ? 'Offline profile'
        : 'No profile selected';
  const primaryAction = !activeInstance
    ? () => onNavigate('instances')
    : isInstalled
      ? onLaunch
      : (onDownload || onLaunch);
  const primaryLabel = isDownloading
    ? 'Preparing game…'
    : isRunning
      ? 'Minecraft is running'
      : !activeInstance
        ? 'Create an instance'
        : isInstalled
          ? 'Play Minecraft'
          : 'Install this version';

  return (
    <div className="home-dashboard">
      {maintenance?.enabled && (
        <div className={`home-maintenance-banner${maintenance.mode === 'hard' ? ' is-blocking' : ''}`} role="status">
          <span className="home-maintenance-icon"><Bell size={17} /></span>
          <div>
            <strong>{maintenance.title || 'Scheduled maintenance'}</strong>
            <p>{maintenance.message}{maintenance.mode === 'hard' ? ' Game launches are paused for now.' : ''}</p>
          </div>
        </div>
      )}

      {announcements.length > 0 && (
        <div className="home-announcement" role="status">
          <span className="home-announcement-icon"><Bell size={16} /></span>
          <p><strong>{announcements[0].title}</strong><span>{announcements[0].message}</span></p>
          {announcements[0].url && (
            <button type="button" className="home-announcement-link" onClick={() => void window.dewclient?.system.openExternal(announcements[0].url!)}>
              Details <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      )}

      <section className="home-launch-card" aria-labelledby="home-title">
        <img className="home-launch-art" src={homeWorldArt} alt="" draggable={false} />
        <div className="home-launch-shade" />
        <div className="home-launch-copy">
          <div className="home-kicker"><span className="home-kicker-dot" />YOUR DEWCLIENT SPACE</div>
          <div className="home-status-row">
            <span className="home-version-pill"><Sparkles size={13} /> Minecraft {activeInstance?.minecraftVersion || 'Java Edition'}</span>
            <span className={`home-game-status${isRunning ? ' is-live' : ''}`}>
              <span />{isRunning ? 'Game running' : isInstalled ? 'Ready to play' : activeInstance ? 'Install needed' : 'Setup needed'}
            </span>
          </div>
          <h2 id="home-title">
            {isRunning ? 'Your game is in motion.' : activeInstance ? 'Ready when you are.' : 'Let’s get your game set up.'}
          </h2>
          <p className="home-launch-description">
            {activeInstance
              ? `${activeInstance.name} · Minecraft ${activeInstance.minecraftVersion}. Your worlds, mods and cosmetics start here.`
              : 'Create an instance to choose your Minecraft version and get your first session ready.'}
          </p>
          <div className="home-launch-profile">
            <span className="home-profile-avatar">
              {activeAccount?.avatarUrl ? <img src={activeAccount.avatarUrl} alt="" /> : <UserRound size={17} />}
            </span>
            <span><small>PLAYING AS</small><strong>{activeAccount?.username || 'Choose a profile'}</strong></span>
            <span className="home-profile-divider" />
            <span className="home-profile-type">{activeAccount?.type === 'microsoft' && <ShieldCheck size={13} />}{accountType}</span>
          </div>
          <div className="home-launch-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg home-play-button"
              onClick={primaryAction}
              disabled={isRunning || isDownloading || Boolean(maintenance?.enabled && maintenance.mode === 'hard')}
            >
              {isDownloading ? <RefreshCw size={17} className="spin" /> : isInstalled && activeInstance ? <Play size={17} fill="currentColor" /> : !activeInstance ? <Layers size={17} /> : <Download size={17} />}
              {primaryLabel}
              {!isRunning && !isDownloading && <ArrowRight size={16} />}
            </button>
            <button type="button" className="btn btn-quiet home-instance-button" onClick={() => onNavigate('instances')}>
              {activeInstance ? 'Manage instance' : 'Browse instances'}
            </button>
          </div>
        </div>
        <div className="home-launch-visual" aria-hidden="true">
          <div className="home-world-orbit orbit-one" />
          <div className="home-world-orbit orbit-two" />
          <div className="home-world-glow" />
          <div className="home-world-card">
            <div className="home-world-window"><i /><i /><i /><span>DEWCLIENT SESSION</span></div>
            <div className="home-world-landscape">
              <div className="home-world-sun" />
              <div className="home-world-hill hill-back" />
              <div className="home-world-hill hill-front" />
              <div className="home-world-cube"><b /><b /><b /></div>
            </div>
            <div className="home-world-caption"><span><strong>{activeInstance?.name || 'Your next world'}</strong><small>{activeInstance ? `Minecraft ${activeInstance.minecraftVersion}` : 'A world of your own'}</small></span><span className="home-world-caption-dot" /></div>
          </div>
          <div className="home-floating-tag"><span className="home-floating-tag-icon"><Boxes size={15} /></span><span><strong>{activeInstance?.stats?.modCount || 0} mods</strong><small>in this instance</small></span></div>
        </div>
      </section>

      <section className="home-quick-grid" aria-label="Quick access">
        <button className="home-quick-card" type="button" onClick={() => onNavigate('instances')}>
          <span className="home-quick-icon icon-green"><Layers size={18} /></span>
          <span className="home-quick-copy"><small>YOUR SETUPS</small><strong>Instances</strong><span>{activeInstance ? `${activeInstance.name} selected` : 'Create a game setup'}</span></span>
          <ArrowUpRight size={16} className="home-quick-arrow" />
        </button>
        <button className="home-quick-card" type="button" onClick={() => onNavigate('cosmetics')}>
          <span className="home-quick-icon icon-violet"><Sparkles size={18} /></span>
          <span className="home-quick-copy"><small>MAKE IT YOURS</small><strong>Cosmetics</strong><span>Skins, capes and wings</span></span>
          <ArrowUpRight size={16} className="home-quick-arrow" />
        </button>
        <button className="home-quick-card" type="button" onClick={() => onNavigate('modrinth')}>
          <span className="home-quick-icon icon-amber"><Package size={18} /></span>
          <span className="home-quick-copy"><small>ADD SOMETHING NEW</small><strong>Content Hub</strong><span>Find mods and packs</span></span>
          <ArrowUpRight size={16} className="home-quick-arrow" />
        </button>
      </section>

      {onlineProfiles.length > 0 && (
        <section className="card online-players-panel">
          <div className="home-section-heading"><div><span className="home-section-icon icon-green"><Users size={16} /></span><span><h3>Playing on DewClient</h3><p>Active Microsoft profiles connected right now.</p></span></div><span className="badge badge-emerald">{onlineProfiles.length} online</span></div>
          <div className="online-players-grid">
            {onlineProfiles.slice(0, 8).map((profile) => {
              const cosmetics = profile.cosmetics || {};
              return (
                <div className="online-player" key={profile.uuid} style={{ borderColor: cosmetics.accentColor || 'var(--border-subtle)' }}>
                  <div className="online-player-avatar" style={{ borderColor: cosmetics.accentColor || 'var(--border-medium)' }}>
                    <img src={cosmetics.skinUrl || profile.skinUrl || profile.avatarUrl} alt="" />
                    {cosmetics.capeUrl && <img className="online-player-cape" src={cosmetics.capeUrl} alt="" />}
                  </div>
                  <div className="online-player-name">{profile.username}</div>
                  {cosmetics.badge && <div className="online-player-badge">{cosmetics.badge}</div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="home-info-grid">
        <section className="card home-info-card">
          <div className="home-section-heading">
            <div><span className="home-section-icon icon-blue"><Server size={16} /></span><span><h3>Featured servers</h3><p>Quick places to jump into a game.</p></span></div>
            <span className="home-count-pill">{featuredServers.length}</span>
          </div>
          {loading ? (
            <div className="home-loading-state"><span className="home-loader"><RefreshCw size={16} /></span>Loading featured servers</div>
          ) : featuredServers.length === 0 ? (
            <div className="home-empty-state"><span className="home-empty-icon"><Server size={18} /></span><strong>No featured servers yet</strong><p>Your saved server list is ready in Instances.</p><button type="button" onClick={() => onNavigate('instances')}>Open instances <ArrowRight size={14} /></button></div>
          ) : (
            <div className="home-server-list">
              {featuredServers.slice(0, 4).map((server) => (
                <div key={server.id} className="home-server-row">
                  <img src={getFeaturedServerIcon(server)} alt="" onError={(event) => { event.currentTarget.src = dewClientIcon; }} />
                  <span><strong>{server.name}</strong><small>{server.host}:{server.port}</small></span>
                  <span className="home-server-tag">{server.tags?.[0] || 'Featured'}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card home-info-card">
          <div className="home-section-heading">
            <div><span className="home-section-icon icon-violet"><Sparkles size={16} /></span><span><h3>Latest news</h3><p>Updates from the DewClient team.</p></span></div>
            <span className="home-count-pill">{news.length}</span>
          </div>
          {loading ? (
            <div className="home-loading-state"><span className="home-loader"><RefreshCw size={16} /></span>Checking for news</div>
          ) : news.length === 0 ? (
            <div className="home-empty-state"><span className="home-empty-icon"><Check size={18} /></span><strong>You’re all caught up</strong><p>New client notes will show up here when available.</p><button type="button" onClick={() => void loadDashboardContent()}>Refresh updates <RefreshCw size={13} /></button></div>
          ) : (
            <div className="home-news-list">
              {news.slice(0, 3).map((item) => (
                <article key={item.id} className="home-news-item">
                  <span className="home-news-date">{new Date(item.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  <div><h4>{item.title}</h4><p>{item.summary}</p></div>
                  {item.url && <button type="button" aria-label={`Read ${item.title}`} onClick={() => void window.dewclient?.system.openExternal(item.url!)}><ExternalLink size={14} /></button>}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="home-footer-note"><Clock3 size={13} />{formatPlayTime(activeInstance?.totalPlayTimeMinutes)}<span />Everything you need for your next Minecraft session, in one place.</footer>
    </div>
  );
};
