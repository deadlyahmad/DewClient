import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Square,
  User,
  ShieldCheck,
  Settings,
  Users,
  LogOut,
  Moon,
  Sun,
  ChevronDown,
  Download,
  RefreshCw,
  Layers
} from 'lucide-react';
import type { UserAccount } from '../../shared/types/account.ts';
import type { InstanceWithStats } from '../../shared/types/instance.ts';
import type { ViewType } from './Sidebar.tsx';
import { DiscordLogo } from './DiscordLogo.tsx';
import { ProfileSettingsModal } from './ProfileSettingsModal.tsx';

interface HeaderProps {
  currentView: ViewType;
  activeInstance: InstanceWithStats | null;
  activeAccount: UserAccount | null;
  isRunning: boolean;
  isInstalled?: boolean;
  isDownloading?: boolean;
  currentTheme: 'black' | 'white';
  onToggleTheme: () => void;
  onLaunch: () => void;
  onDownload?: () => void;
  onStop: () => void;
  onNavigateToAccounts: () => void;
  onNavigateToInstances: () => void;
  onLogout: () => void;
  onUpdateAccount: (id: string, partial: any) => Promise<void>;
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  activeInstance,
  activeAccount,
  isRunning,
  isInstalled = true,
  isDownloading = false,
  currentTheme,
  onToggleTheme,
  onLaunch,
  onDownload,
  onStop,
  onNavigateToAccounts,
  onNavigateToInstances,
  onLogout,
  onUpdateAccount
}) => {
  const discordServerUrl = 'https://discord.gg/uXs2YD4D6H';
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  const titles: Record<ViewType, { title: string; subtitle: string }> = {
    home: { title: 'Overview', subtitle: 'Your game, your setup, your next session' },
    play: { title: 'Game Console', subtitle: 'Live status, game activity, and downloads' },
    instances: { title: 'Instances', subtitle: 'Manage your Minecraft installations, worlds, and mods' },
    versions: { title: 'Minecraft Versions', subtitle: 'Browse and install official Minecraft releases' },
    mods: { title: 'Mod Manager', subtitle: 'Organize and toggle installed mods for your selected game' },
    modrinth: { title: 'Content Hub', subtitle: 'Discover mods, shaders, and packs with one-click installation' },
    cosmetics: { title: 'Cosmetics', subtitle: 'Customize your Minecraft player appearance' },
    accounts: { title: 'Account Manager', subtitle: 'Manage your online and offline player profiles' },
    settings: { title: 'Launcher Settings', subtitle: 'Customize appearance, memory allocation, and Java preferences' },
    support: { title: 'Report a problem', subtitle: 'Send a privacy-safe issue report to the DewClient team' },
    error: { title: 'DewClient recovery', subtitle: 'Review a safe summary and choose what to do next' }
  };

  const current = titles[currentView] || { title: 'DewClient', subtitle: '' };

  return (
    <>
      <header className="app-header">
        <div className="app-header-brand">
          <div>
            <h1>{current.title}</h1>
            <p>{current.subtitle}</p>
          </div>
        </div>

        <div className="app-header-actions" style={{ display: 'flex', alignItems: 'center' }}>
          {/* Quick Launch / Stop / Download Action Button */}
          {isRunning ? (
            <button
              onClick={onStop}
              className="btn btn-danger btn-stop-game btn-sm"
              style={{ padding: '8px 16px', fontWeight: 700 }}
            >
              <Square size={14} fill="currentColor" />
              Stop Game
            </button>
          ) : isDownloading ? (
            <button
              disabled
              className="btn btn-secondary btn-sm"
              style={{ padding: '8px 18px', fontWeight: 700, opacity: 0.85 }}
            >
              <RefreshCw size={14} className="spin" />
              Downloading...
            </button>
          ) : !activeInstance ? (
            <button
              onClick={onNavigateToInstances}
              className="btn btn-primary btn-sm"
              style={{ padding: '8px 16px', fontWeight: 700 }}
            >
              <Layers size={14} />
              Choose instance
            </button>
          ) : !isInstalled ? (
            <button
              onClick={onDownload || onLaunch}
              disabled={!activeInstance}
              className="btn btn-primary btn-sm"
              style={{ padding: '8px 20px', fontWeight: 700 }}
            >
              <Download size={14} />
              Download
            </button>
          ) : (
            <button
              onClick={onLaunch}
              disabled={!activeInstance}
              className="btn btn-primary btn-sm"
              style={{ padding: '8px 20px', fontWeight: 700 }}
            >
              <Play size={14} fill="currentColor" />
              Play
            </button>
          )}

          {/* Theme Quick Toggle Button */}
          <button
            onClick={onToggleTheme}
            className="btn btn-secondary btn-sm"
            style={{ padding: '8px', borderRadius: '50%' }}
            title={`Switch to ${currentTheme === 'black' ? 'DewClient White' : 'DewClient Black'}`}
            aria-label="Toggle visual theme"
          >
            {currentTheme === 'black' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {/* User Account Capsule with Interactive Dropdown */}
          <div ref={dropdownRef} className="header-account-wrap">
            {activeAccount ? (
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className={`header-account-trigger${dropdownOpen ? ' is-open' : ''}`}
                aria-haspopup="true"
                aria-expanded={dropdownOpen}
                aria-label={`Profile: ${activeAccount.username}`}
              >
                {activeAccount.avatarUrl ? (
                  <img
                    src={activeAccount.avatarUrl}
                    alt=""
                    className="header-account-avatar"
                  />
                ) : (
                  <span className="header-account-avatar header-account-avatar-fallback">
                    <User size={15} color="var(--text-secondary)" />
                  </span>
                )}
                <span className="header-account-name-wrap">
                  <strong className="header-account-name">
                    {activeAccount.username}
                  </strong>
                  <small>{activeAccount.type === 'microsoft' ? 'Microsoft profile' : activeAccount.type === 'discord' ? 'Discord profile' : 'Offline profile'}</small>
                </span>
                {activeAccount.type === 'microsoft' && (
                  <ShieldCheck size={14} color="var(--accent-primary)" aria-label="Verified account" />
                )}
                <ChevronDown size={14} className={`header-account-chevron${dropdownOpen ? ' is-open' : ''}`} />
              </button>
            ) : (
              <button
                onClick={onNavigateToAccounts}
                className="btn btn-secondary btn-sm"
                style={{ gap: '8px' }}
              >
                <User size={15} /> Sign In
              </button>
            )}

            {/* Profile Dropdown Menu */}
            {dropdownOpen && activeAccount && (
              <div className="dropdown-menu">
                {/* Account Summary Header */}
                <div style={{ padding: '10px 14px 12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {activeAccount.username}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {activeAccount.type === 'microsoft' ? (
                      <>
                        <ShieldCheck size={12} color="var(--accent-primary)" /> Verified Account
                      </>
                    ) : (
                      'Offline Profile'
                    )}
                  </div>
                </div>

                <div style={{ padding: '4px 0' }}>
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      setShowProfileModal(true);
                    }}
                    className="dropdown-item"
                  >
                    <Settings size={15} /> Profile Settings
                  </button>

                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      void window.dewclient?.system.openExternal(discordServerUrl);
                    }}
                    className="dropdown-item"
                  >
                    <DiscordLogo size={15} /> Join DewClient Discord
                  </button>

                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onNavigateToAccounts();
                    }}
                    className="dropdown-item"
                  >
                    <Users size={15} /> Switch Account
                  </button>

                  <button
                    onClick={() => {
                      onToggleTheme();
                    }}
                    className="dropdown-item"
                  >
                    {currentTheme === 'black' ? <Sun size={15} /> : <Moon size={15} />}
                    Theme: {currentTheme === 'black' ? 'DewClient White' : 'DewClient Black'}
                  </button>
                </div>

                <div className="dropdown-divider" />

                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    onLogout();
                  }}
                  className="dropdown-item dropdown-item-danger"
                >
                  <LogOut size={15} /> Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Profile Settings Modal */}
      {showProfileModal && (
        <ProfileSettingsModal
          account={activeAccount}
          onClose={() => setShowProfileModal(false)}
          onUpdateAccount={onUpdateAccount}
        />
      )}
    </>
  );
};
