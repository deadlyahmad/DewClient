import React from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { DewLogo } from '../components/DewLogo.tsx';

export const StartupLoadingView: React.FC<{ message?: string }> = ({ message = 'Preparing your launcher' }) => (
  <div className="startup-screen">
    <div className="startup-orbit" aria-hidden="true" />
      <DewLogo size="hero" />
    <div className="startup-title">DewClient</div>
    <div className="startup-message">{message}</div>
    <div className="startup-progress" aria-label="Loading">
      <span />
    </div>
    <div className="startup-detail"><LoaderCircle size={14} className="animate-spin" /> <Sparkles size={14} /> Loading launcher services</div>
  </div>
);
