import React, { useState } from 'react';
import { Check, LoaderCircle, Plus, Trash2, UserRound } from 'lucide-react';
import type { UserAccount } from '../../shared/types/account.ts';
import { ACCOUNT_LIMITS, countAccountCategories } from '../../shared/constants/accountLimits.ts';
import { MicrosoftLogo } from '../components/MicrosoftLogo.tsx';
import { DiscordLogo } from '../components/DiscordLogo.tsx';
import { getUserFacingErrorMessage } from '../utils/userFacingError.ts';

interface AccountsViewProps {
  accounts: UserAccount[];
  activeAccount: UserAccount | null;
  onSelectAccount: (uuid: string) => Promise<void>;
  onRemoveAccount: (uuid: string) => Promise<void>;
  onAddOfflineProfile: (username: string) => Promise<void>;
  onMicrosoftLogin: () => Promise<void>;
  onDiscordStart: () => Promise<{ ticket: string }>;
  onDiscordComplete: (input: { ticket: string; username?: string }) => Promise<{ requiresUsername?: boolean; suggestedUsername?: string; ticket?: string }>;
  onChangeUsername: (accountId: string, username: string) => Promise<void>;
}

export const AccountsView: React.FC<AccountsViewProps> = ({ accounts, activeAccount, onSelectAccount, onRemoveAccount, onAddOfflineProfile, onMicrosoftLogin, onDiscordStart, onDiscordComplete, onChangeUsername }) => {
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [offlineUsername, setOfflineUsername] = useState('');
  const [discordTicket, setDiscordTicket] = useState('');
  const [discordUsername, setDiscordUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [renameTarget, setRenameTarget] = useState<UserAccount | null>(null);
  const [renameUsername, setRenameUsername] = useState('');
  const counts = countAccountCategories(accounts);
  const offlineLimitReached = counts.offline >= ACCOUNT_LIMITS.offline;
  const discordLimitReached = counts.dew >= ACCOUNT_LIMITS.dew;

  const signInDiscord = async () => {
    setBusy(true); setError(''); setSuccess('');
    try {
      const { ticket } = await onDiscordStart();
      const result = await onDiscordComplete({ ticket });
      if (result.requiresUsername) {
        setDiscordTicket(result.ticket || ticket);
        setDiscordUsername(result.suggestedUsername || '');
      } else {
        setSuccess('Discord profile added to this device.');
      }
    } catch (err: any) { setError(getUserFacingErrorMessage(err, 'Discord sign-in could not be completed.')); }
    finally { setBusy(false); }
  };

  const signInMicrosoft = async () => {
    setBusy(true); setError(''); setSuccess('');
    try { await onMicrosoftLogin(); }
    catch (err: any) { setError(getUserFacingErrorMessage(err, 'Microsoft sign-in could not be completed.')); }
    finally { setBusy(false); }
  };

  const finishDiscordProfile = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await onDiscordComplete({ ticket: discordTicket, username: discordUsername.trim() });
      setDiscordTicket(''); setDiscordUsername('');
    } catch (err: any) { setError(getUserFacingErrorMessage(err, 'The Discord profile could not be created.')); }
    finally { setBusy(false); }
  };

  const addOffline = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await onAddOfflineProfile(offlineUsername.trim());
      setOfflineOpen(false); setOfflineUsername(''); setSuccess('Offline profile added.');
    } catch (err: any) { setError(getUserFacingErrorMessage(err, 'Could not add this offline profile.')); }
    finally { setBusy(false); }
  };

  return (
    <div className="accounts-view" style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 980, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Account Profiles</h2>
          <p style={{ margin: '7px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>{counts.microsoft} Microsoft · {counts.dew}/{ACCOUNT_LIMITS.dew} Discord · {counts.offline}/{ACCOUNT_LIMITS.offline} offline</p>
        </div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setError(''); setOfflineOpen(true); }} disabled={offlineLimitReached}><Plus size={14} /> Offline profile</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void signInDiscord()} disabled={busy || discordLimitReached} title={discordLimitReached ? 'Remove a Discord account to add another' : undefined}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <DiscordLogo size={16} />} Sign in with Discord</button>
          <button type="button" className="btn btn-microsoft btn-sm" onClick={() => void signInMicrosoft()} disabled={busy}><MicrosoftLogo size={16} /> Microsoft</button>
        </div>
      </header>

      {error && <div className="auth-error" role="alert">{error}</div>}
      {success && <div className="auth-success" role="status">{success}</div>}
      {discordTicket && <form className="card auth-form" onSubmit={finishDiscordProfile} style={{ maxWidth: 560 }}>
        <div><strong>Choose your Minecraft name</strong><p className="text-muted" style={{ margin: '5px 0 12px' }}>This Discord profile can change its name once each month.</p></div>
        <input className="input-text" value={discordUsername} onChange={(event) => setDiscordUsername(event.target.value)} placeholder="3–16 letters, numbers, or underscores" maxLength={16} autoFocus required />
        <button className="btn btn-primary" type="submit" disabled={busy || !/^[A-Za-z0-9_]{3,16}$/.test(discordUsername.trim())}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />} Create profile</button>
      </form>}

      {accounts.length === 0 ? <section className="card" style={{ textAlign: 'center', padding: '54px 20px' }}><UserRound size={38} color="var(--text-dim)" style={{ margin: '0 auto 14px' }} /><h3 style={{ margin: 0 }}>No accounts yet</h3><p className="text-muted">Add an offline profile or sign in with Microsoft or Discord.</p></section> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {accounts.map((account) => {
            const isActive = activeAccount?.id === account.id;
            const provider = account.type === 'microsoft' ? 'Microsoft account' : account.type === 'discord' ? 'Discord account' : account.accountType === 'dew' ? 'Dew account' : 'Offline profile';
            return <article key={account.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 17px', borderColor: isActive ? 'var(--accent-primary)' : undefined }}>
              {account.avatarUrl ? <img src={account.avatarUrl} alt="" width={40} height={40} style={{ borderRadius: 10, imageRendering: 'pixelated' }} /> : <div className="auth-choice-icon">{account.type === 'discord' ? <DiscordLogo size={20} /> : <UserRound size={18} />}</div>}
              <div style={{ minWidth: 0, flex: 1 }}><strong>{account.username}</strong><div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>{provider}{account.type === 'discord' ? ' · name changes every 1 month' : ''}</div></div>
              {isActive ? <span className="btn btn-primary btn-sm" aria-current="true"><Check size={14} /> Active</span> : <button className="btn btn-secondary btn-sm" type="button" onClick={() => void onSelectAccount(account.uuid)}>Use account</button>}
              {account.type === 'discord' && <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setRenameTarget(account); setRenameUsername(account.username); setError(''); }}>Change name</button>}
              <button className="btn btn-ghost btn-sm" type="button" aria-label={`Remove ${account.username}`} onClick={() => void onRemoveAccount(account.uuid)}><Trash2 size={15} /></button>
            </article>;
          })}
        </div>
      )}

      {offlineOpen && <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOfflineOpen(false); }}><form className="modal-content auth-form" role="dialog" aria-modal="true" aria-labelledby="offline-profile-title" onSubmit={addOffline} style={{ maxWidth: 430 }}>
        <h3 id="offline-profile-title" style={{ margin: 0 }}>Add offline profile</h3><label className="form-label" htmlFor="offline-profile-name">Minecraft username</label><input id="offline-profile-name" className="input-text" value={offlineUsername} onChange={(event) => setOfflineUsername(event.target.value)} maxLength={16} autoFocus required />
        <div className="auth-nav-row"><button className="btn btn-secondary" type="button" onClick={() => setOfflineOpen(false)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy || !/^[A-Za-z0-9_]{3,16}$/.test(offlineUsername.trim())}>{busy ? 'Adding…' : 'Add profile'}</button></div>
      </form></div>}
      {renameTarget?.type === 'discord' && <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameTarget(null); }}><form className="modal-content auth-form account-rename-modal" role="dialog" aria-modal="true" aria-labelledby="discord-rename-title" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await onChangeUsername(renameTarget.id, renameUsername.trim()); setRenameTarget(null); setSuccess('Your in-game name was changed.'); } catch (err: any) { setError(getUserFacingErrorMessage(err, 'The name could not be changed.')); } finally { setBusy(false); } }} style={{ maxWidth: 450 }}>
        <h3 id="discord-rename-title" style={{ margin: 0 }}>Change in-game name</h3><p className="text-muted" style={{ margin: 0 }}>This name can be changed once per month. The server checks the cooldown.</p><label className="form-label" htmlFor="discord-new-username">New Minecraft username</label><input id="discord-new-username" className="input-text" value={renameUsername} onChange={(event) => setRenameUsername(event.target.value)} maxLength={16} autoFocus required />
        {renameTarget.nextUsernameChangeAt && Date.parse(renameTarget.nextUsernameChangeAt) > Date.now() && <p className="text-muted" style={{ margin: 0 }}>Next change available: {new Date(renameTarget.nextUsernameChangeAt).toLocaleDateString()}.</p>}
        <div className="auth-nav-row"><button className="btn btn-secondary" type="button" onClick={() => setRenameTarget(null)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy || !/^[A-Za-z0-9_]{3,16}$/.test(renameUsername.trim()) || Boolean(renameTarget.nextUsernameChangeAt && Date.parse(renameTarget.nextUsernameChangeAt) > Date.now())}>{busy ? 'Saving…' : 'Save name'}</button></div>
      </form></div>}
    </div>
  );
};
