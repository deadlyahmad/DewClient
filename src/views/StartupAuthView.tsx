import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle, ShieldCheck, UserRound } from 'lucide-react';
import type { UserAccount } from '../../shared/types/account.ts';
import { DewLogo } from '../components/DewLogo.tsx';
import { MicrosoftLogo } from '../components/MicrosoftLogo.tsx';
import { DiscordLogo } from '../components/DiscordLogo.tsx';
import authWorld from '../assets/auth-world.svg';
import { getUserFacingErrorMessage } from '../utils/userFacingError.ts';

interface LoginViewProps {
  currentTheme: 'black' | 'white';
  onSelectTheme: (theme: 'black' | 'white') => Promise<void> | void;
  onMicrosoftLogin: () => Promise<void>;
  onDiscordStart: () => Promise<{ ticket: string }>;
  onDiscordComplete: (input: { ticket: string; username?: string }) => Promise<{ account?: UserAccount; requiresUsername?: boolean; suggestedUsername?: string; ticket?: string }>;
  onAddOfflineProfile: (username: string) => Promise<void>;
}

export const LoginView: React.FC<LoginViewProps> = ({ currentTheme, onSelectTheme, onMicrosoftLogin, onDiscordStart, onDiscordComplete, onAddOfflineProfile }) => {
  const [screen, setScreen] = useState<'choose' | 'offline' | 'discord-username'>('choose');
  const [username, setUsername] = useState('');
  const [discordTicket, setDiscordTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInMicrosoft = async () => {
    setBusy(true); setError(null);
    try { await onMicrosoftLogin(); }
    catch (err: any) { setError(getUserFacingErrorMessage(err, 'Microsoft sign-in could not be completed.')); }
    finally { setBusy(false); }
  };

  const signInDiscord = async () => {
    setBusy(true); setError(null);
    try {
      const { ticket } = await onDiscordStart();
      const result = await onDiscordComplete({ ticket });
      if (result.requiresUsername) {
        setDiscordTicket(result.ticket || ticket);
        setUsername(result.suggestedUsername || '');
        setScreen('discord-username');
      }
    } catch (err: any) { setError(getUserFacingErrorMessage(err, 'Discord sign-in could not be completed.')); }
    finally { setBusy(false); }
  };

  const createDiscordProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username.trim())) {
      setError('Use 3–16 letters, numbers, or underscores for your in-game name.');
      return;
    }
    setBusy(true); setError(null);
    try { await onDiscordComplete({ ticket: discordTicket, username: username.trim() }); }
    catch (err: any) { setError(getUserFacingErrorMessage(err, 'The Discord profile could not be created.')); }
    finally { setBusy(false); }
  };

  const createOfflineProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username.trim())) {
      setError('Use 3–16 letters, numbers, or underscores for your username.');
      return;
    }
    setBusy(true); setError(null);
    try { await onAddOfflineProfile(username.trim()); }
    catch (err: any) { setError(getUserFacingErrorMessage(err, 'Could not create an offline profile.')); }
    finally { setBusy(false); }
  };

  return (
    <div className="startup-screen auth-screen">
      <aside className="auth-art-panel" aria-label="DewClient welcome artwork">
        <img className="auth-art-image" src={authWorld} alt="" />
        <div className="auth-art-shade" />
        <div className="auth-art-brand"><div className="auth-brand-mark"><DewLogo size="small" /></div><span>DEWCLIENT</span></div>
        <div className="auth-art-caption"><span className="auth-art-kicker">YOUR NEXT WORLD</span><h2>Starts here.</h2></div>
      </aside>

      <main className="auth-main">
        <section className="auth-panel animate-fade-in">
          <header className="auth-heading">
            <div className="auth-eyebrow">Welcome to DewClient</div>
            <h1 className="auth-title">{screen === 'discord-username' ? 'Choose your in-game name' : screen === 'offline' ? 'Choose a username' : 'Choose how to continue'}</h1>
            <p className="auth-copy">{screen === 'discord-username'
              ? 'This name identifies your Discord profile in Minecraft. You can change it once each month.'
              : screen === 'offline'
                ? 'This profile stays on this device and cannot claim online cosmetics.'
                : 'Sign in with Microsoft or Discord, or start with an offline profile.'}</p>
          </header>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <div className="auth-theme-switcher" aria-label="Theme selection">
            {(['black', 'white'] as const).map((theme) => <button key={theme} type="button" className="auth-theme-pill" aria-pressed={currentTheme === theme} onClick={() => onSelectTheme(theme)}>{theme === 'black' ? 'DewClient Black' : 'DewClient White'}</button>)}
          </div>

          {screen === 'choose' ? (
            <div className="auth-choice-stack">
              <button type="button" className="auth-choice-button microsoft" onClick={signInMicrosoft} disabled={busy}>
                <span className="auth-choice-icon">{busy ? <LoaderCircle size={18} className="animate-spin" /> : <MicrosoftLogo size={18} />}</span>
                <span className="auth-choice-label">Continue with Microsoft</span>{!busy && <ArrowRight size={16} />}
              </button>
              <button type="button" className="auth-choice-button" onClick={signInDiscord} disabled={busy}>
                <span className="auth-choice-icon">{busy ? <LoaderCircle size={18} className="animate-spin" /> : <DiscordLogo size={20} />}</span>
                <span className="auth-choice-label">Sign in with Discord</span>{!busy && <ArrowRight size={16} />}
              </button>
              <div className="auth-divider"><span>or</span></div>
              <button type="button" className="auth-choice-button" onClick={() => { setError(null); setScreen('offline'); }} disabled={busy}>
                <span className="auth-choice-icon"><UserRound size={18} /></span><span className="auth-choice-label">Use an offline profile</span><ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <form onSubmit={screen === 'offline' ? createOfflineProfile : createDiscordProfile} className="auth-form">
              <div className="auth-field">
                <label className="form-label" htmlFor="profile-username">Minecraft username</label>
                <input id="profile-username" className="input-text" value={username} onChange={(event) => { setUsername(event.target.value); setError(null); }} placeholder="3–16 letters, numbers, or underscores" maxLength={16} autoComplete="nickname" autoFocus required />
              </div>
              <button className="btn btn-primary btn-lg auth-action" type="submit" disabled={busy || !/^[A-Za-z0-9_]{3,16}$/.test(username.trim())}>
                {busy ? <LoaderCircle size={18} className="animate-spin" /> : screen === 'offline' ? <UserRound size={18} /> : <DiscordLogo size={18} />}
                {busy ? 'Connecting securely…' : screen === 'offline' ? 'Continue Offline' : 'Create Discord profile'}{!busy && <ArrowRight size={16} />}
              </button>
              <div className="auth-nav-row"><button type="button" className="auth-nav-button secondary" onClick={() => { setError(null); setScreen('choose'); }} disabled={busy}><ArrowLeft size={14} /> Back</button></div>
            </form>
          )}

          <div className="auth-trust"><ShieldCheck size={15} /> Microsoft and Discord authenticate through their official sign-in flows.</div>
        </section>
      </main>
    </div>
  );
};
