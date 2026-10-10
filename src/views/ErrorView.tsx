import React from 'react';
import { AlertTriangle, Bug, Home, RotateCcw } from 'lucide-react';

export interface UserFacingError {
  reference: string;
  title: string;
  message: string;
}

interface Props {
  error: UserFacingError;
  onRetry: () => void;
  onReport: () => void;
  onDismiss: () => void;
}

export const ErrorView: React.FC<Props> = ({ error, onRetry, onReport, onDismiss }) => (
  <section className="error-page" role="alert">
    <div className="error-card">
      <div className="error-mark"><AlertTriangle size={24} /></div>
      <p className="support-eyebrow">A safe recovery page</p>
      <h1>{error.title}</h1>
      <p className="error-message">{error.message}</p>
      <div className="error-reference">Reference <code>{error.reference}</code></div>
      <p className="error-privacy">Technical traces, account information, and local file paths are hidden. Nothing is sent to support unless you choose to submit a report.</p>
      <div className="error-actions">
        <button className="btn btn-primary" onClick={onRetry}><RotateCcw size={15} /> Try again</button>
        <button className="btn btn-secondary" onClick={onReport}><Bug size={15} /> Report a problem</button>
        <button className="btn btn-ghost" onClick={onDismiss}><Home size={15} /> Overview</button>
      </div>
    </div>
  </section>
);
