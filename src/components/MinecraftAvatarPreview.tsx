import React from 'react';

interface MinecraftAvatarPreviewProps {
  skinUrl?: string;
  capeUrl?: string;
  size?: 'small' | 'large';
}

export const MinecraftAvatarPreview: React.FC<MinecraftAvatarPreviewProps> = ({ skinUrl, capeUrl, size = 'large' }) => (
  <div className={`minecraft-avatar-preview minecraft-avatar-${size}`} aria-label="Minecraft player cosmetic preview">
    <div className="minecraft-avatar-cape" style={capeUrl ? { backgroundImage: `url(${capeUrl})` } : undefined} />
    <div className="minecraft-avatar-head" style={skinUrl ? { backgroundImage: `url(${skinUrl})` } : undefined} />
    <div className="minecraft-avatar-body" style={skinUrl ? { backgroundImage: `url(${skinUrl})` } : undefined} />
    <div className="minecraft-avatar-arm minecraft-avatar-arm-left" style={skinUrl ? { backgroundImage: `url(${skinUrl})` } : undefined} />
    <div className="minecraft-avatar-arm minecraft-avatar-arm-right" style={skinUrl ? { backgroundImage: `url(${skinUrl})` } : undefined} />
    <div className="minecraft-avatar-leg minecraft-avatar-leg-left" style={skinUrl ? { backgroundImage: `url(${skinUrl})` } : undefined} />
    <div className="minecraft-avatar-leg minecraft-avatar-leg-right" style={skinUrl ? { backgroundImage: `url(${skinUrl})` } : undefined} />
  </div>
);
