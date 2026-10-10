import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  reference: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    reference: ''
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, reference: globalThis.crypto?.randomUUID?.().slice(0, 8).toUpperCase() || Math.random().toString(36).slice(2, 10).toUpperCase() };
  }

  public componentDidCatch(_error: Error, _errorInfo: ErrorInfo) { /* Error details stay local and are not persisted. */ }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return <div className="error-page" role="alert"><div className="error-card">
        <div className="error-mark"><AlertTriangle size={24} /></div>
        <p className="support-eyebrow">A safe recovery page</p>
        <h1>DewClient could not display this page</h1>
        <p className="error-message">Reload the interface to continue. Technical traces and local paths are hidden and stay on this device.</p>
        <div className="error-reference">Reference <code>{this.state.reference}</code></div>
        <div className="error-actions"><button className="btn btn-primary" onClick={this.handleReload}><RefreshCw size={15} /> Reload DewClient</button></div>
      </div></div>;
    }

    return this.props.children;
  }
}
