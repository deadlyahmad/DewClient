import React, { useState } from 'react';
import { Bug, CheckCircle2, LockKeyhole, Send } from 'lucide-react';
import { PRODUCT_VERSION } from '../../shared/constants/versions.ts';

interface Props {
  minecraftVersion: string | null;
}

type Category = 'launcher' | 'game-launch' | 'account' | 'cosmetics' | 'other';

export const SupportView: React.FC<Props> = ({ minecraftVersion }) => {
  const [category, setCategory] = useState<Category>('launcher');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string; id?: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await window.dewclient.support.submitBugReport({
        category,
        title: title.trim(),
        description: description.trim(),
        clientVersion: PRODUCT_VERSION,
        minecraftVersion
      });
      setResult({ kind: 'success', message: 'Your report was sent to the DewClient team.', id: response.id });
      setTitle('');
      setDescription('');
    } catch (error) {
      setResult({ kind: 'error', message: error instanceof Error ? error.message : 'The report could not be sent. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="support-page">
      <header className="support-header">
        <div className="support-icon"><Bug size={22} /></div>
        <div>
          <p className="support-eyebrow">DewClient support</p>
          <h1>Report a problem</h1>
          <p className="support-intro">Tell us what happened so we can investigate and improve the launcher.</p>
        </div>
      </header>

      <div className="support-privacy">
        <LockKeyhole size={17} aria-hidden="true" />
        <div><strong>Private by default</strong><span>Only the details you enter and the app/game version are sent. Logs, account credentials, tokens, and local files are never attached.</span></div>
      </div>

      <form className="support-form" onSubmit={submit}>
        <label className="support-field">
          <span>What is the issue about?</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as Category)}>
            <option value="launcher">Launcher or settings</option>
            <option value="game-launch">Minecraft launch or install</option>
            <option value="account">Accounts and sign-in</option>
            <option value="cosmetics">Cosmetics</option>
            <option value="other">Something else</option>
          </select>
        </label>
        <label className="support-field">
          <span>Short title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} minLength={8} maxLength={120} required placeholder="For example: Minecraft closes while loading" />
          <small>{title.length}/120</small>
        </label>
        <label className="support-field">
          <span>What happened?</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={20} maxLength={5000} required rows={7} placeholder="Include the steps you took and what you expected to happen. Please do not paste passwords or access tokens." />
          <small>{description.length}/5000</small>
        </label>

        {result && (
          <div className={`support-result ${result.kind}`} role="status" aria-live="polite">
            {result.kind === 'success' && <CheckCircle2 size={17} />}
            <span>{result.message}{result.id ? ` Reference: ${result.id}` : ''}</span>
          </div>
        )}

        <footer className="support-actions">
          <span>DewClient {PRODUCT_VERSION}{minecraftVersion ? ` · Minecraft ${minecraftVersion}` : ''}</span>
          <button className="btn btn-primary" type="submit" disabled={busy || title.trim().length < 8 || description.trim().length < 20}>
            <Send size={15} /> {busy ? 'Sending…' : 'Send report'}
          </button>
        </footer>
      </form>
    </section>
  );
};
