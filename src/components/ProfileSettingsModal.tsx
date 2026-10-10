import React, { useState } from 'react';
import { User, ShieldCheck, X } from 'lucide-react';
import type { UserAccount } from '../../shared/types/account.ts';
import { MinecraftAvatarPreview } from './MinecraftAvatarPreview.tsx';

interface ProfileSettingsModalProps {
  account: UserAccount | null;
  onClose: () => void;
  onUpdateAccount?: (id: string, partial: any) => Promise<void>;
}

export const ProfileSettingsModal: React.FC<ProfileSettingsModalProps> = ({
  account,
  onClose,
  onUpdateAccount
}) => {
  const [skinUrl, setSkinUrl] = useState('');
  const [capeUrl, setCapeUrl] = useState('');
  const [skinAssetPath, setSkinAssetPath] = useState('');
  const [cosmeticError, setCosmeticError] = useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setSkinUrl('');
    setCapeUrl('');
    setSkinAssetPath('');
    if (!account) return () => { cancelled = true; };

    const refresh = async () => {
      try {
        const result = await window.dewclient.auth.getCosmetics();
        if (cancelled || result?.accountId !== account.id) return;
        setSkinUrl(result.skinPreviewUrl || '');
        setCapeUrl(result.capePreviewUrl || '');
      } catch (error: any) {
        if (!cancelled) setCosmeticError(error?.message || 'Could not load server cosmetics.');
      }
    };
    void refresh();
    const unsubscribe = window.dewclient.auth.onCosmeticsSync((status) => {
      if (status?.accountId === account.id) void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [account?.id]);

  if (!account) return null;

  const isMicrosoft = account.type === 'microsoft';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (onUpdateAccount) {
      const partial: Record<string, unknown> = {};
      const cosmetics: Record<string, unknown> = { ...(account.cosmetics || {}) };
      if (skinAssetPath) {
        partial.skinAssetPath = skinAssetPath;
        cosmetics.skinAssetPath = skinAssetPath;
        cosmetics.skinSource = 'custom';
      }
      if (Object.keys(cosmetics).length) partial.cosmetics = cosmetics;
      if (Object.keys(partial).length) await onUpdateAccount(account.id, partial);
    }
    onClose();
  };

  const chooseSkin = async () => {
    try {
      setCosmeticError(null);
      const selected = await window.dewclient?.auth.pickCosmetic(account.id, 'skin');
      if (selected) {
        const previewUrl = await window.dewclient.auth.getCosmeticPreview(account.id, selected.path, 'skin');
        setSkinUrl(previewUrl);
        setSkinAssetPath(selected.path);
      }
    } catch (err: any) {
      setCosmeticError(err?.message || 'Could not load that image.');
    }
  };

  const removeSkin = async () => {
    try {
      setCosmeticError(null);
      await window.dewclient?.auth.removeCosmetic(account.id, 'skin');
      setSkinUrl('');
      setSkinAssetPath('');
    } catch (err: any) {
      setCosmeticError(err?.message || 'Could not remove that cosmetic file.');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'var(--accent-primary-glow)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-primary)'
            }}>
              <User size={18} />
            </div>
            <h3 className="modal-title">Profile Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            style={{ padding: '6px', borderRadius: '50%' }}
            aria-label="Close dialog"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSave}>
          {/* Account Identity Card */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '20px'
          }}>
            {account.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt={account.username}
                style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--bg-input)' }}
              />
            ) : (
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'var(--bg-surface-hover)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <User size={24} color="var(--text-secondary)" />
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <span style={{ fontSize: '16px', fontWeight: 700 }}>{account.username}</span>
                {isMicrosoft ? (
                  <span className="badge badge-cyan" style={{ fontSize: '10px' }}>
                    <ShieldCheck size={11} /> Verified Account
                  </span>
                ) : (
                  <span className="badge badge-gray" style={{ fontSize: '10px' }}>
                    Offline Profile
                  </span>
                )}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {isMicrosoft ? 'Verified online account' : 'Local Sandbox Profile'}
              </div>
            </div>
          </div>

          <MinecraftAvatarPreview skinUrl={skinUrl} capeUrl={capeUrl} />

          <div className="profile-cosmetics-upload">
            <div className="form-label">Profile skin</div>
            <div className="profile-cosmetic-row">
              <div className="profile-cosmetic-preview">{skinUrl ? <img src={skinUrl} alt="Skin preview" /> : <User size={18} />}</div>
              <div><strong>Skin</strong><small>PNG, JPG, or WebP up to 50 MiB</small></div>
              <div><button type="button" className="btn btn-secondary btn-sm" onClick={chooseSkin}>Upload skin</button>{skinAssetPath && <button type="button" className="btn btn-secondary btn-sm" onClick={removeSkin}>Remove</button>}</div>
            </div>
            {cosmeticError && <div className="auth-error">{cosmeticError}</div>}
          </div>

          {isMicrosoft && (
            <div style={{
              padding: '14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              marginBottom: '20px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5
            }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Verified Account Details
              </div>
              Your account identity is securely stored on this device. Player cosmetics can be managed from the Cosmetics page.
            </div>
          )}

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Preferences
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
