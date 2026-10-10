import React from 'react';
import {
  Home,
  Play,
  Layers,
  Compass,
  Boxes,
  Package,
  User,
  Sparkles,
  Settings,
  Bug,
  ChevronRight,
  CircleDot
} from 'lucide-react';
import type { InstanceWithStats } from '../../shared/types/instance.ts';
import type { UserAccount } from '../../shared/types/account.ts';
import { DewLogo } from './DewLogo.tsx';

export type ViewType = 'home' | 'play' | 'instances' | 'versions' | 'mods' | 'modrinth' | 'cosmetics' | 'accounts' | 'settings' | 'support' | 'error';

interface SidebarProps {
  currentView: ViewType;
  onSelectView: (view: ViewType) => void;
  activeInstance: InstanceWithStats | null;
  activeAccount: UserAccount | null;
  isRunning: boolean;
}

const navGroups = [
  {
    label: 'PLAY',
    items: [
      { id: 'home' as ViewType, label: 'Overview', icon: Home },
      { id: 'play' as ViewType, label: 'Game Console', icon: Play }
    ]
  },
  {
    label: 'LIBRARY',
    items: [
      { id: 'instances' as ViewType, label: 'Instances', icon: Layers },
      { id: 'versions' as ViewType, label: 'Minecraft Versions', icon: Compass },
      { id: 'mods' as ViewType, label: 'Mod Manager', icon: Boxes },
      { id: 'modrinth' as ViewType, label: 'Content Hub', icon: Package },
      { id: 'cosmetics' as ViewType, label: 'Cosmetics', icon: Sparkles }
    ]
  },
  {
    label: 'PROFILE',
    items: [
      { id: 'accounts' as ViewType, label: 'Accounts', icon: User },
      { id: 'settings' as ViewType, label: 'Settings', icon: Settings },
      { id: 'support' as ViewType, label: 'Report a problem', icon: Bug }
    ]
  }
];

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onSelectView, activeInstance, activeAccount, isRunning }) => (
  <aside className="app-sidebar">
    <div className="app-sidebar-top">
      <button className="sidebar-brand" type="button" onClick={() => onSelectView('home')} aria-label="DewClient overview">
        <DewLogo size="small" />
        <span className="sidebar-brand-copy">
          <strong>DewClient</strong>
          <small><span className="sidebar-ready-dot" />Minecraft launcher</small>
        </span>
      </button>

      <nav className="sidebar-navigation" aria-label="Main navigation">
        {navGroups.map((group) => (
          <div className="sidebar-nav-group" key={group.label}>
            <div className="sidebar-nav-label">{group.label}</div>
            <div className="sidebar-nav-items">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                const isLive = item.id === 'play' && isRunning;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectView(item.id)}
                    title={item.label}
                    className={`sidebar-nav-item${isActive ? ' is-active' : ''}${isLive ? ' is-live' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon size={17} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                    <span>{item.label}</span>
                    {isLive && <span className="sidebar-live-indicator" aria-label="Game running" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>

    <div className="sidebar-bottom">
      <button className="sidebar-instance-card" type="button" onClick={() => onSelectView('instances')}>
        <span className="sidebar-instance-icon"><Layers size={16} /></span>
        <span className="sidebar-instance-copy">
          <small>ACTIVE INSTANCE</small>
          <strong>{activeInstance?.name || 'Choose an instance'}</strong>
          <span>{activeInstance ? `Minecraft ${activeInstance.minecraftVersion}` : 'Set up your game profile'}</span>
        </span>
        <ChevronRight className="sidebar-instance-arrow" size={15} />
      </button>
      <button className="sidebar-account-line" type="button" onClick={() => onSelectView('accounts')}>
        <span className="sidebar-account-avatar">
          {activeAccount?.avatarUrl ? <img src={activeAccount.avatarUrl} alt="" /> : <User size={15} />}
        </span>
        <span className="sidebar-account-copy">
          <small>PLAYER PROFILE</small>
          <strong>{activeAccount?.username || 'No profile selected'}</strong>
        </span>
        <CircleDot size={13} className={activeAccount ? 'sidebar-account-status is-ready' : 'sidebar-account-status'} />
      </button>
    </div>
  </aside>
);
